// POST /api/ai-simulate?submissionId=xxx
//
// Re-runs AI analysis for a submission. Refactored (Feature 3) to use the
// real z-ai-web-dev-sdk via the lib/ai/* helpers, with deterministic mock
// fallback on any failure. The endpoint:
//
//   1. Resolves the submission + its assignment + rubric criteria.
//   2. Extracts textual content (TEXT type → content; media → VLM/ASR/video).
//   3. Computes similarity (cosine TF/IDF over class siblings) — falls back
//      to deterministic mock if the submission has too little text.
//   4. Computes auto-score via LLM with strict-JSON prompt — falls back to
//      weighted-criteria mock on parse failure.
//   5. Generates feedback via LLM — falls back to template feedback.
//   6. Upserts a single SimilarityReport row with the new fields:
//      similarity, autoScore, feedbackText, mediaExtractedText,
//      criteriaReasoning, confidence, provider.
//   7. Triggers AI_ANALYSIS_READY notification to the submission's student.
//
// Both students (after submitting) and faculty (from the Evaluate screen's
// "Run AI Analysis" button) may call this. The check is just session auth.

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { computeFinalScore, computeAutoScore } from "@/lib/queries";
import { computeTextSimilarity } from "@/lib/ai/similarity";
import { extractMediaContent, getSubmissionContentText } from "@/lib/ai/media";
import { computeAutoScoreLLM } from "@/lib/ai/scoring";
import { generateFeedbackLLM } from "@/lib/ai/feedback";
import { notify, NOTIF_TYPES } from "@/lib/notifications";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const submissionId = searchParams.get("submissionId");
  if (!submissionId) return NextResponse.json({ error: "submissionId required" }, { status: 400 });

  const submission = await db.submission.findUnique({
    where: { id: submissionId },
    include: {
      assignment: {
        include: { rubric: { include: { criteria: true } } },
      },
      evaluations: { where: { isPeer: false }, include: { criterion: true } },
      peerReviews: { include: { criterion: true } },
      similarityReports: true,
    },
  });
  if (!submission) return NextResponse.json({ error: "Submission not found" }, { status: 404 });

  // ─────────────────────────────────────────────────────────
  // Step 1: get the textual content (extract from media if needed).
  // ─────────────────────────────────────────────────────────
  let contentText = await getSubmissionContentText(submissionId, submission);
  let mediaProvider = "MOCK";
  if (!contentText || contentText.length < 5) {
    // Try to extract via VLM / ASR / video-understand.
    const extracted = await extractMediaContent(submissionId);
    contentText = extracted.text;
    mediaProvider = extracted.provider;
  }

  // ─────────────────────────────────────────────────────────
  // Step 2: similarity (cosine TF/IDF) with mock fallback.
  // ─────────────────────────────────────────────────────────
  let similarity = 0;
  let comparedToSubmissionId: string | null = null;
  let similarityProvider = "MOCK";
  try {
    const sim = await computeTextSimilarity(submissionId);
    similarity = sim.similarity;
    comparedToSubmissionId = sim.matchedSubmissionId ?? null;
    similarityProvider = sim.provider;
  } catch (err: any) {
    console.error("[ai-simulate] similarity failed, fallback to mock:", err?.message || err);
    // Mock fallback — keep the legacy deterministic value.
    const { computeSimilarity } = await import("@/lib/queries");
    similarity = computeSimilarity(submissionId);
  }

  // ─────────────────────────────────────────────────────────
  // Step 3: auto-score via LLM (with mock fallback).
  // ─────────────────────────────────────────────────────────
  const criteria = submission.assignment?.rubric?.criteria ?? [];
  const criteriaInput = criteria.map((c) => ({
    criterionId: c.id,
    name: c.name,
    description: c.description ?? undefined,
    weight: c.weight,
    maxScore: c.maxScore,
  }));
  let autoScore = 0;
  let criteriaScores: { criterionId: string; score: number; reasoning: string }[] = [];
  let confidence: number | null = null;
  let scoreProvider = "MOCK";
  let criteriaReasoningJson: string | null = null;

  try {
    const llmScore = await computeAutoScoreLLM(
      submissionId,
      criteriaInput,
      submission.assignment?.description ?? "",
      contentText
    );
    autoScore = llmScore.totalScore;
    criteriaScores = llmScore.criteriaScores;
    confidence = llmScore.confidence;
    scoreProvider = llmScore.provider;
    criteriaReasoningJson = JSON.stringify(criteriaScores);
  } catch (err: any) {
    console.error("[ai-simulate] scoring failed, fallback to mock:", err?.message || err);
    autoScore = computeAutoScore(
      submission.evaluations.map((e) => ({
        score: e.score,
        max: e.criterion.maxScore,
        weight: e.criterion.weight,
      }))
    );
  }

  // ─────────────────────────────────────────────────────────
  // Step 4: feedback via LLM (with mock fallback).
  // ─────────────────────────────────────────────────────────
  let feedbackText = "";
  let feedbackProvider = "MOCK";
  try {
    const fbInput: { name: string; score: number; maxScore: number }[] = criteriaScores.length
      ? criteriaScores.map((cs) => {
          const c = criteria.find((cc) => cc.id === cs.criterionId)!;
          return { name: c?.name ?? "Criterion", score: cs.score, maxScore: c?.maxScore ?? 10 };
        })
      : criteria.map((c) => ({ name: c.name, score: c.maxScore * 0.7, maxScore: c.maxScore }));
    const fb = await generateFeedbackLLM(
      submissionId,
      fbInput,
      submission.assignment?.description ?? "",
      contentText
    );
    feedbackText = fb.text;
    feedbackProvider = fb.provider;
  } catch (err: any) {
    console.error("[ai-simulate] feedback failed, fallback to mock:", err?.message || err);
    const { feedbackForScore } = await import("@/lib/ai/feedback");
    feedbackText = feedbackForScore(autoScore, submissionId);
  }

  // Compose a provider label combining whichever engines actually ran.
  const providerLabel = [
    mediaProvider,
    similarityProvider,
    scoreProvider,
    feedbackProvider,
  ]
    .filter((p) => p && p !== "MOCK")
    .filter((p, i, a) => a.indexOf(p) === i)
    .join("+") || "MOCK";

  // ─────────────────────────────────────────────────────────
  // Step 5: upsert SimilarityReport.
  // ─────────────────────────────────────────────────────────
  const existing = submission.similarityReports[0];
  let report;
  const dataPayload: any = {
    similarity,
    autoScore,
    feedbackText,
    mediaExtractedText: contentText || null,
    criteriaReasoning: criteriaReasoningJson,
    confidence,
    comparedToSubmissionId,
    provider: providerLabel,
  };
  if (existing) {
    report = await db.similarityReport.update({ where: { id: existing.id }, data: dataPayload });
  } else {
    report = await db.similarityReport.create({
      data: { submissionId, ...dataPayload },
    });
  }

  // ─────────────────────────────────────────────────────────
  // Step 6: notify the student that AI analysis is ready.
  // ─────────────────────────────────────────────────────────
  // Only fire when the AI run actually completed (not just a mock fallback) —
  // mock-only runs already happened at submission time and we don't want to
  // spam the bell on every manual "Run AI Analysis" click.
  try {
    if (providerLabel !== "MOCK") {
      await notify(
        submission.userId,
        NOTIF_TYPES.AI_ANALYSIS_READY,
        `AI analysis ready: ${submission.assignment?.title ?? "your submission"}`,
        `Similarity ${similarity.toFixed(1)}% · Auto-score ${autoScore.toFixed(1)}% · provider: ${providerLabel}`,
        `insights:`
      );
    }
  } catch (err) {
    console.error("[ai-simulate] notify failed:", err);
  }

  // Also refresh final score for the response payload.
  const finalScore = await computeFinalScore(submission.id);

  return NextResponse.json({ report, finalScore, provider: providerLabel });
}
