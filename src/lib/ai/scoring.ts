// LLM-based auto-scoring using z-ai-web-dev-sdk.
// Given the rubric, assignment description, and submission content,
// asks the LLM to score each criterion and return strict JSON.
// Falls back to the mock computeAutoScore on any failure.

import ZAI from "z-ai-web-dev-sdk";
import { computeAutoScore as mockAutoScore } from "@/lib/queries";

let _zai: any = null;
async function getZAI() {
  if (!_zai) _zai = await ZAI.create();
  return _zai;
}

export interface LLMScoringInput {
  assignmentTitle: string;
  assignmentDescription?: string;
  submissionContent: string;
  criteria: { id: string; name: string; description?: string; weight: number; maxScore: number }[];
}

export interface LLMScoringResult {
  criteriaScores: { criterionId: string; score: number; reasoning: string }[];
  totalScore: number; // 0-100
  confidence: number; // 0-1
  provider: "ZAI_LLM" | "MOCK";
}

/**
 * Ask the LLM to score the submission. Accepts either:
 *   - a single LLMScoringInput object (preferred)
 *   - 4 positional args: (submissionId, criteria, assignmentDescription, submissionContent)
 *     (matches how /api/ai-simulate/route.ts calls this)
 *
 * Returns a result with criteriaScores (per-criterion scores out of maxScore)
 * and a totalScore normalized to 0-100. On any failure, falls back to mock.
 */
export async function computeAutoScoreLLM(
  submissionIdOrInput: string | LLMScoringInput,
  criteria?: { id: string; name: string; description?: string; weight: number; maxScore: number }[],
  assignmentDescription?: string,
  submissionContent?: string
): Promise<LLMScoringResult> {
  let input: LLMScoringInput;
  if (typeof submissionIdOrInput === "string") {
    input = {
      assignmentTitle: submissionIdOrInput, // best-effort (the route doesn't pass title here)
      assignmentDescription: assignmentDescription ?? "",
      submissionContent: submissionContent ?? "",
      criteria: criteria ?? [],
    };
  } else {
    input = submissionIdOrInput;
  }

  try {
    const zai = await getZAI();
    const criteriaSpec = input.criteria.map((c) => ({
      criterionId: c.id,
      name: c.name,
      description: c.description || "",
      weight: c.weight,
      maxScore: c.maxScore,
    }));

    const systemPrompt = `You are an expert evaluator for student assignments. Score each rubric criterion out of its maxScore based on the submission. Return STRICT JSON only — no markdown, no prose. The JSON shape must be exactly:
{"criteriaScores":[{"criterionId":"<id>","score":<number>,"reasoning":"<1 short sentence>"}],"totalScore":<0-100>,"confidence":<0-1>}`;

    const userPrompt = `Assignment: ${input.assignmentTitle || "(untitled)"}
Description: ${input.assignmentDescription || "(no description provided)"}

Rubric criteria:
${JSON.stringify(criteriaSpec, null, 2)}

Student submission:
"""
${(input.submissionContent || "").slice(0, 4000)}
"""

Score each criterion. totalScore is the weighted percentage (0-100). confidence is how sure you are (0-1).`;

    const completion = await zai.chat.completions.create({
      messages: [
        { role: "assistant", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      thinking: { type: "disabled" },
    });

    const raw = completion.choices?.[0]?.message?.content || "";
    const parsed = safeParseJSON(raw);
    if (!parsed || !Array.isArray(parsed.criteriaScores)) {
      throw new Error("LLM did not return valid criteria scores");
    }

    const resultCriteriaScores = parsed.criteriaScores
      .filter((cs: any) => cs.criterionId && typeof cs.score === "number")
      .map((cs: any) => ({
        criterionId: String(cs.criterionId),
        score: Number(cs.score),
        reasoning: String(cs.reasoning || "").slice(0, 200),
      }));

    return {
      criteriaScores: resultCriteriaScores,
      totalScore: clamp(Number(parsed.totalScore) || 0, 0, 100),
      confidence: clamp(Number(parsed.confidence) || 0.5, 0, 1),
      provider: "ZAI_LLM",
    };
  } catch (e) {
    console.error("[ai/scoring] LLM failed, falling back to mock:", e);
    const mock = mockAutoScore(
      input.criteria.map((c) => ({ score: c.maxScore * 0.75, max: c.maxScore, weight: c.weight }))
    );
    return {
      criteriaScores: [],
      totalScore: mock,
      confidence: 0.3,
      provider: "MOCK",
    };
  }
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function safeParseJSON(s: string): any | null {
  let cleaned = s.trim();
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fenceMatch) cleaned = fenceMatch[1];
  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}
