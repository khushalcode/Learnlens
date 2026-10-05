// Real cosine similarity for text submissions using TF-IDF.
// No embeddings API available in z-ai-web-dev-sdk, so we compute
// word-frequency vectors directly and cosine them.
// For media submissions (image/audio/video), the caller should first
// extract text via media.ts (VLM/ASR/video-understand) and pass it here.
//
// Fully Supabase-backed — uses the server client (subject to RLS).

import { createSupabaseServerClient } from "@/lib/supabase/server";

export interface SimilarityResult {
  similarity: number; // 0-100
  matchedSubmissionId: string | null;
  matchedStudentName?: string;
  provider: "ZAI_COSINE" | "MOCK";
}

// ─────────────────────────────────────────────────────────
// Tokenizer — lowercase + strip punctuation + stopwords removed
// ─────────────────────────────────────────────────────────
const STOPWORDS = new Set([
  "a","an","and","are","as","at","be","but","by","for","if","in","into","is","it",
  "no","not","of","on","or","such","that","the","their","then","there","these",
  "they","this","to","was","will","with","i","you","he","she","we","him","her",
  "his","hers","our","your","its","from","has","have","had","were","been","being",
  "do","does","did","can","could","should","would","may","might","must","shall",
  "what","which","who","whom","when","where","why","how","all","each","every",
  "both","few","more","most","other","some","than","too","very","also","just",
]);

export function tokenize(text: string): string[] {
  if (!text) return [];
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
}

// Term-frequency vector
export function tfVector(tokens: string[]): Map<string, number> {
  const v = new Map<string, number>();
  for (const t of tokens) v.set(t, (v.get(t) ?? 0) + 1);
  return v;
}

// Cosine similarity between two TF vectors
export function cosineSim(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (const [, v] of a) magA += v * v;
  for (const [, v] of b) magB += v * v;
  if (magA === 0 || magB === 0) return 0;
  const [small, large] = a.size < b.size ? [a, b] : [b, a];
  for (const [t, v] of small) {
    const other = large.get(t);
    if (other) dot += v * other;
  }
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

/**
 * Compute text similarity % between a submission and all OTHER submissions
 * in the same assignment. Returns the highest similarity found.
 *
 * If fewer than 2 submissions exist, similarity is 0.
 */
export async function computeTextSimilarity(submissionId: string): Promise<SimilarityResult> {
  const supabase = await createSupabaseServerClient();

  // Fetch the target submission + its assignment
  const { data: submission, error: subErr } = await supabase
    .from("submissions")
    .select("id, assignment_id, content, media_extracted_text")
    .eq("id", submissionId)
    .maybeSingle();

  if (subErr || !submission) return { similarity: 0, matchedSubmissionId: null, provider: "MOCK" };

  const myText = (submission.media_extracted_text || submission.content || "").toString();
  if (!myText.trim()) return { similarity: 0, matchedSubmissionId: null, provider: "MOCK" };

  // Fetch sibling submissions in the same assignment — RLS ensures the
  // faculty/coordinator can see them; a student will get an empty set
  // (RLS hides other students' submissions from peers), which means
  // similarity will be 0 for student-initiated runs. The faculty
  // "Run AI Analysis" button is the primary entry point.
  const { data: others, error: sibErr } = await supabase
    .from("submissions")
    .select(`
      id,
      content,
      media_extracted_text,
      user_id,
      profiles:user_id ( name )
    `)
    .eq("assignment_id", submission.assignment_id)
    .neq("id", submissionId);

  if (sibErr || !others || others.length === 0) {
    return { similarity: 0, matchedSubmissionId: null, provider: "MOCK" };
  }

  const myTokens = tokenize(myText);
  const myVec = tfVector(myTokens);

  let bestSim = 0;
  let bestId: string | null = null;
  let bestName: string | undefined;
  for (const other of others) {
    const otherText = (other.media_extracted_text || other.content || "").toString();
    if (!otherText.trim()) continue;
    const otherVec = tfVector(tokenize(otherText));
    const sim = cosineSim(myVec, otherVec);
    if (sim > bestSim) {
      bestSim = sim;
      bestId = other.id as string;
      const profile = other.profiles as any;
      bestName = profile?.name as string | undefined;
    }
  }

  return {
    similarity: parseFloat((bestSim * 100).toFixed(1)),
    matchedSubmissionId: bestId,
    matchedStudentName: bestName,
    provider: bestSim > 0 ? "ZAI_COSINE" : "MOCK",
  };
}
