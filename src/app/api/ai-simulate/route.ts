// POST /api/ai-simulate?submissionId=xxx (Supabase-backed)
//
// Re-runs AI analysis for a submission. Uses the real z-ai-web-dev-sdk via
// the lib/ai/* helpers, with deterministic mock fallback on any failure. The
// endpoint:
//
//   1. Resolves the submission + its assignment + rubric criteria.
//   2. Extracts textual content (TEXT type → content; media → VLM/ASR/video).
//   3. Computes similarity (cosine TF/IDF over class siblings) — falls back
//      to deterministic mock if the submission has too little text.
//   4. Computes auto-score via LLM with strict-JSON prompt — falls back to
//      weighted-criteria mock on parse failure.
//   5. Generates feedback via LLM — falls back to template feedback.
//   6. Upserts a single similarity_reports row with the new fields:
//      similarity, autoScore, feedbackText, mediaExtractedText,
//      criteriaReasoning, confidence, provider.
//   7. Triggers AI_ANALYSIS_READY notification to the submission's student.
//
// Both students (after submitting) and faculty (from the Evaluate screen's
// "Run AI Analysis" button) may call this. The check is just session auth.

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
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

  const supabase = createSupabaseAdminClient();

  // Fetch the submission + assignment + rubric + criteria + evaluations + peer_reviews + existing reports.
  const { data: submission } = await supabase
    .from("submissions")
    .select(`
      id,
      assignment_id,
      user_id,
      content,
      storage_path,
      mime_type,
      file_size,
      file_name,
      file_url,
      file_type,
      status,
      submitted_at,
      assignment:assignments (
        id, title, description, type, deadline, course_id, competency_id, created_at,
        rubric:rubrics (id, assignment_id, criteria:rubric_criteria (id, name, description, weight, max_score, rubric_id))
      ),
      evaluations:evaluations (
        id, submission_id, evaluator_id, criterion_id, score, comment, is_peer, created_at,
        criterion:rubric_criteria (id, name, description, weight, max_score, rubric_id)
      ),
      peerReviews:peer_reviews (
        id, submission_id, reviewer_id, criterion_id, score, comment, created_at,
        criterion:rubric_criteria (id, name, description, weight, max_score, rubric_id)
      ),
      similarityReports:similarity_reports (
        id, submission_id, compared_to_submission_id, similarity, auto_score, feedback_text,
        media_extracted_text, criteria_reasoning, confidence, provider, created_at
      )
    `)
    .eq("id", submissionId)
    .maybeSingle();

  if (!submission) return NextResponse.json({ error: "Submission not found" }, { status: 404 });

  // ─────────────────────────────────────────────────────────
  // Step 1: get the textual content (extract from media if needed).
  // ─────────────────────────────────────────────────────────
  let contentText = await getSubmissionContentText(submissionId, submission as any);
  let mediaProvider = "MOCK";
  if (!contentText || contentText.length < 5) {
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
    const { computeSimilarity } = await import("@/lib/queries");
    similarity = computeSimilarity(submissionId);
  }

  // ─────────────────────────────────────────────────────────
  // Step 3: auto-score via LLM (with mock fallback).
  // ─────────────────────────────────────────────────────────
  const criteria = (submission as any).assignment?.rubric?.criteria ?? [];
  const criteriaInput = criteria.map((c: any) => ({
    criterionId: c.id,
    name: c.name,
    description: c.description ?? undefined,
    weight: c.weight,
    maxScore: c.max_score,
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
      (submission as any).assignment?.description ?? "",
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
      ((submission as any).evaluations ?? [])
        .filter((e: any) => e.is_peer === false)
        .map((e: any) => ({
          score: e.score,
          max: e.criterion?.max_score ?? 10,
          weight: e.criterion?.weight ?? 0.33,
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
          const c = criteria.find((cc: any) => cc.id === cs.criterionId);
          return { name: c?.name ?? "Criterion", score: cs.score, maxScore: c?.max_score ?? 10 };
        })
      : criteria.map((c: any) => ({ name: c.name, score: c.max_score * 0.7, maxScore: c.max_score }));
    const fb = await generateFeedbackLLM(
      submissionId,
      fbInput,
      (submission as any).assignment?.description ?? "",
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
  // Step 5: upsert similarity_reports.
  // ─────────────────────────────────────────────────────────
  const existing = (submission as any).similarityReports?.[0];
  const dataPayload: Record<string, unknown> = {
    similarity,
    auto_score: autoScore,
    feedback_text: feedbackText,
    media_extracted_text: contentText || null,
    criteria_reasoning: criteriaReasoningJson,
    confidence,
    compared_to_submission_id: comparedToSubmissionId,
    provider: providerLabel,
  };
  let report: any = null;
  if (existing) {
    const { data: updated } = await supabase
      .from("similarity_reports")
      .update(dataPayload)
      .eq("id", existing.id)
      .select()
      .single();
    report = updated;
  } else {
    const { data: inserted } = await supabase
      .from("similarity_reports")
      .insert({ submission_id: submissionId, ...dataPayload })
      .select()
      .single();
    report = inserted;
  }

  // ─────────────────────────────────────────────────────────
  // Step 6: notify the student that AI analysis is ready.
  // ─────────────────────────────────────────────────────────
  try {
    if (providerLabel !== "MOCK") {
      await notify(
        (submission as any).user_id,
        NOTIF_TYPES.AI_ANALYSIS_READY,
        `AI analysis ready: ${(submission as any).assignment?.title ?? "your submission"}`,
        `Similarity ${similarity.toFixed(1)}% · Auto-score ${autoScore.toFixed(1)}% · provider: ${providerLabel}`,
        `insights:`
      );
    }
  } catch (err) {
    console.error("[ai-simulate] notify failed:", err);
  }

  // Also refresh final score for the response payload.
  const finalScore = await computeFinalScore(submissionId);

  return NextResponse.json({ report, finalScore, provider: providerLabel });
}
