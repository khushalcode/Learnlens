// Media content extraction using z-ai-web-dev-sdk.
// - IMAGE → VLM describes the image (2-3 sentences)
// - AUDIO → ASR transcribes speech to text
// - VIDEO → video-understand skill describes the video
//
// All calls are wrapped in try/catch. On failure, returns "" so callers
// (similarity / scoring / feedback) can degrade gracefully.
//
// z-ai-web-dev-sdk is server-side only — never import this file from a 'use client' module.

import ZAI from "z-ai-web-dev-sdk";
import { promises as fs } from "node:fs";
import { isImageType, isAudioType, isVideoType, getLocalPath, BUCKETS } from "@/lib/storage";
import { db } from "@/lib/db";

let _zai: any = null;
async function getZAI() {
  if (!_zai) _zai = await ZAI.create();
  return _zai;
}

export interface ExtractedMedia {
  text: string;
  provider: "ZAI_VLM" | "ZAI_ASR" | "ZAI_VIDEO" | "MOCK" | "";
}

/**
 * Get the existing text content of a submission without re-extracting.
 * - For TEXT type: returns submission.content
 * - For media type: returns the cached mediaExtractedText on SimilarityReport
 *   (if extraction has run before) — empty string otherwise.
 */
export async function getSubmissionContentText(
  submissionId: string,
  submission?: any
): Promise<string> {
  let sub = submission;
  if (!sub) {
    sub = await db.submission.findUnique({
      where: { id: submissionId },
      include: { similarityReports: { take: 1, orderBy: { createdAt: "desc" } } },
    });
  }
  if (!sub) return "";
  // For TEXT type, just return the content.
  if (sub.content && sub.content.trim().length > 0) return sub.content;
  // For media, return any cached extracted text on the latest SimilarityReport.
  if (sub.similarityReports?.[0]?.mediaExtractedText) {
    return sub.similarityReports[0].mediaExtractedText;
  }
  // Or on the submission row itself.
  if (sub.mediaExtractedText) return sub.mediaExtractedText;
  return "";
}

/**
 * Extract textual content from a media submission. Loads the file
 * from local storage, dispatches to the right SDK call based on mimeType,
 * and returns the extracted text + provider string. On failure returns
 * empty text + provider="" so callers know to fall back.
 */
export async function extractMediaContent(
  submissionId: string
): Promise<ExtractedMedia> {
  try {
    const sub = await db.submission.findUnique({ where: { id: submissionId } });
    if (!sub || !sub.storagePath) return { text: "", provider: "" };
    const mime = sub.mimeType || sub.fileType || "";
    if (!mime) return { text: "", provider: "" };

    const localPath = getLocalPath(BUCKETS.submissions, sub.storagePath);

    if (isImageType(mime)) {
      const text = await describeImage(localPath, mime);
      return { text, provider: text ? "ZAI_VLM" : "" };
    }
    if (isAudioType(mime)) {
      const text = await transcribeAudio(localPath);
      return { text, provider: text ? "ZAI_ASR" : "" };
    }
    if (isVideoType(mime)) {
      const text = await describeVideo(localPath, mime);
      return { text, provider: text ? "ZAI_VIDEO" : "" };
    }
    return { text: "", provider: "" };
  } catch (e) {
    console.error("[ai/media] extraction failed:", e);
    return { text: "", provider: "" };
  }
}

async function describeImage(imagePath: string, mimeType: string): Promise<string> {
  const zai = await getZAI();
  const buf = await fs.readFile(imagePath);
  const base64 = buf.toString("base64");
  const dataUrl = `data:${mimeType};base64,${base64}`;

  const response = await zai.chat.completions.createVision({
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "Describe this image in 3-4 sentences. Focus on what a teacher would need to know to evaluate it as a homework submission (content, structure, key elements).",
          },
          { type: "image_url", image_url: { url: dataUrl } },
        ],
      },
    ],
    thinking: { type: "disabled" },
  });
  return response.choices?.[0]?.message?.content?.trim() || "";
}

async function transcribeAudio(audioPath: string): Promise<string> {
  const zai = await getZAI();
  const buf = await fs.readFile(audioPath);
  const base64 = buf.toString("base64");
  const response = await zai.audio.asr.create({ file_base64: base64 });
  return (response?.text || "").trim();
}

async function describeVideo(videoPath: string, mimeType: string): Promise<string> {
  const zai = await getZAI();
  const buf = await fs.readFile(videoPath);
  const base64 = buf.toString("base64");
  const dataUrl = `data:${mimeType};base64,${base64}`;

  const response = await zai.chat.completions.createVision({
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "Describe this video in 3-4 sentences. Focus on what a teacher would need to know to evaluate it as a homework submission (content, presentation, key points).",
          },
          { type: "video_url", video_url: { url: dataUrl } },
        ],
      },
    ],
    thinking: { type: "disabled" },
  });
  return response.choices?.[0]?.message?.content?.trim() || "";
}
