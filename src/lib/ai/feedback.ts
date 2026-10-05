// LLM-based feedback generation using z-ai-web-dev-sdk.
// Produces 2-3 sentences of constructive feedback focused on the weakest criterion.
// Falls back to the existing template-based mock on failure.

import ZAI from "z-ai-web-dev-sdk";
import { createHash } from "crypto";

let _zai: any = null;
async function getZAI() {
  if (!_zai) _zai = await ZAI.create();
  return _zai;
}

const FEEDBACK_TEMPLATES = {
  excellent: [
    "Excellent work — strong command of the topic with clear, well-structured reasoning.",
    "Outstanding submission. You demonstrate mastery of the key concepts.",
    "Top-tier work. Sets a high bar for the cohort.",
  ],
  good: [
    "Solid submission — minor refinements would push this toward excellence.",
    "Good effort with clear understanding; some criteria could be developed further.",
    "Competent work meeting all expectations.",
  ],
  average: [
    "Acceptable submission, but several criteria need more depth.",
    "Meets minimum expectations. Spend more time on weaker criteria.",
    "Average work — adequate but not yet impressive.",
  ],
  needsWork: [
    "Below expectations. Please review the fundamentals and consider office hours.",
    "This needs major revision. Several criteria are incomplete.",
    "Concerning submission — focus on the weakest criteria and seek support.",
  ],
} as const;

/**
 * Mock feedback picker — exported so /api/ai-simulate can use it as a fallback.
 */
export function feedbackForScore(score: number, seed: string): string {
  let bucket: keyof typeof FEEDBACK_TEMPLATES;
  if (score >= 85) bucket = "excellent";
  else if (score >= 70) bucket = "good";
  else if (score >= 50) bucket = "average";
  else bucket = "needsWork";
  const arr = FEEDBACK_TEMPLATES[bucket];
  const h = createHash("md5").update(seed).digest().readUInt32LE(0);
  return arr[h % arr.length];
}

export interface FeedbackInput {
  assignmentTitle: string;
  assignmentDescription?: string;
  submissionContent: string;
  criteriaScores: { name: string; score: number; maxScore: number }[];
}

export interface FeedbackResult {
  text: string;
  provider: "ZAI_LLM" | "MOCK";
}

/**
 * Generate constructive feedback focused on the weakest-scoring criterion.
 * Accepts either:
 *   - a single FeedbackInput object (preferred)
 *   - 4 positional args: (submissionId, criteriaScores, assignmentDescription, submissionContent)
 *     (matches how /api/ai-simulate/route.ts calls this)
 */
export async function generateFeedbackLLM(
  submissionIdOrInput: string | FeedbackInput,
  criteriaScores?: { name: string; score: number; maxScore: number }[],
  assignmentDescription?: string,
  submissionContent?: string
): Promise<FeedbackResult> {
  let input: FeedbackInput;
  if (typeof submissionIdOrInput === "string") {
    input = {
      assignmentTitle: submissionIdOrInput,
      assignmentDescription: assignmentDescription ?? "",
      submissionContent: submissionContent ?? "",
      criteriaScores: criteriaScores ?? [],
    };
  } else {
    input = submissionIdOrInput;
  }

  try {
    const zai = await getZAI();
    const sorted = [...input.criteriaScores].sort(
      (a, b) => a.score / a.maxScore - b.score / b.maxScore
    );
    const weakest = sorted[0];

    const systemPrompt = `You are a constructive faculty member giving feedback on a student submission. Be specific, actionable, and 2-3 sentences. Focus on the weakest criterion: "${weakest?.name ?? "(unknown)"}". Do not use markdown. Be warm but honest.`;

    const userPrompt = `Assignment: ${input.assignmentTitle || "(untitled)"}
Description: ${input.assignmentDescription || "(none)"}

Criteria scores:
${input.criteriaScores.map((c) => `- ${c.name}: ${c.score}/${c.maxScore}`).join("\n")}

Weakest criterion: ${weakest?.name ?? "(unknown)"} at ${weakest ? ((weakest.score / weakest.maxScore) * 100).toFixed(0) : "?"}%

Submission excerpt:
"""
${(input.submissionContent || "").slice(0, 3000)}
"""

Give 2-3 sentences of feedback.`;

    const completion = await zai.chat.completions.create({
      messages: [
        { role: "assistant", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      thinking: { type: "disabled" },
    });

    const text = completion.choices?.[0]?.message?.content?.trim();
    if (!text) throw new Error("Empty feedback");

    return { text, provider: "ZAI_LLM" };
  } catch (e) {
    console.error("[ai/feedback] LLM failed, falling back to mock:", e);
    const lowest = input.criteriaScores
      .map((c) => (c.score / c.maxScore) * 100)
      .sort((a, b) => a - b)[0] ?? 50;
    return {
      text: feedbackForScore(lowest, JSON.stringify(input.criteriaScores)),
      provider: "MOCK",
    };
  }
}
