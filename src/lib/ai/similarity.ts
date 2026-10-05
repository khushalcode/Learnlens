// Real cosine similarity for text submissions using TF-IDF.
// No embeddings API available in z-ai-web-dev-sdk, so we compute
// word-frequency vectors directly and cosine them.
// For media submissions (image/audio/video), the caller should first
// extract text via media.ts (VLM/ASR/video-understand) and pass it here.

import { db } from "@/lib/db";

export interface SimilarityResult {
  similarity: number; // 0-100
  matchedSubmissionId: string | null;
  matchedStudentName?: string;
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

// Cosine similarity between two TF vectors (we treat any token
// not in both docs as zero contribution, which makes this equivalent
// to cosine over a sparse shared vocabulary).
export function cosineSim(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (const [, v] of a) magA += v * v;
  for (const [, v] of b) magB += v * v;
  if (magA === 0 || magB === 0) return 0;
  // Iterate smaller map
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
  const submission = await db.submission.findUnique({
    where: { id: submissionId },
    include: { assignment: true },
  });
  if (!submission) return { similarity: 0, matchedSubmissionId: null };

  const myText = submission.mediaExtractedText || submission.content || "";
  if (!myText.trim()) return { similarity: 0, matchedSubmissionId: null };

  const others = await db.submission.findMany({
    where: {
      assignmentId: submission.assignmentId,
      id: { not: submissionId },
    },
    include: { user: true },
  });

  if (others.length === 0) return { similarity: 0, matchedSubmissionId: null };

  const myTokens = tokenize(myText);
  const myVec = tfVector(myTokens);

  let bestSim = 0;
  let bestId: string | null = null;
  let bestName: string | undefined;
  for (const other of others) {
    const otherText = other.mediaExtractedText || other.content || "";
    if (!otherText.trim()) continue;
    const otherVec = tfVector(tokenize(otherText));
    const sim = cosineSim(myVec, otherVec);
    if (sim > bestSim) {
      bestSim = sim;
      bestId = other.id;
      bestName = other.user.name;
    }
  }

  return {
    similarity: parseFloat((bestSim * 100).toFixed(1)),
    matchedSubmissionId: bestId,
    matchedStudentName: bestName,
  };
}
