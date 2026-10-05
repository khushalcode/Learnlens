// Media content extraction using z-ai-web-dev-sdk.
// - IMAGE → VLM describes the image (2-3 sentences)
// - AUDIO → ASR transcribes speech to text
// - VIDEO → video-understand skill describes the video
//
// All calls are wrapped in try/catch. On failure, returns "" so callers
// (similarity / scoring / feedback) can degrade gracefully.
//
// z-ai-web-dev-sdk is server-side only — never import this file from a 'use client' module.
// Fully Supabase-backed — uses the server client (subject to RLS).

import ZAI from "z-ai-web-dev-sdk";
import { promises as fs } from "node:fs";
import { isImageType, isAudioType, isVideoType, getLocalPath, BUCKETS } from "@/lib/storage";
import { createSupabaseServerClient } from "@/lib/supabase/server";

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
 * - For media type: returns the cached media_extracted_text on similarity_reports
 *   (if extraction has run before) — empty string otherwise.
 *
 * Accepts an optional pre-fetched submission object to avoid a duplicate query.
 */
export async function getSubmissionContentText(
  submissionId: string,
  submission?: any
): Promise<string> {
  let sub = submission;
  if (!sub) {
    const supabase = await createSupabaseServerClient();
    // Fetch the submission + its latest similarity_report (which may cache the extracted text)
    const { data } = await supabase
      .from("submissions")
      .select(`
        id, content, media_extracted_text,
        similarity_reports ( media_extracted_text, created_at )
      `)
      .eq("id", submissionId)
      .maybeSingle();
    sub = data;
  }
  if (!sub) return "";

  // For TEXT type, return content directly
  if (sub.content && sub.content.trim().length > 0) return sub.content;

  // For media, return cached extracted text on the latest similarity_report
  if (Array.isArray(sub.similarity_reports) && sub.similarity_reports.length > 0) {
    const latest = sub.similarity_reports
      .slice()
      .sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];
    if (latest?.media_extracted_text) return latest.media_extracted_text;
  }

  // Or on the submission row itself
  if (sub.media_extracted_text) return sub.media_extracted_text;

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
    const supabase = await createSupabaseServerClient();
    const { data: sub, error } = await supabase
      .from("submissions")
      .select("id, storage_path, mime_type, file_type")
      .eq("id", submissionId)
      .maybeSingle();

    if (error || !sub || !sub.storage_path) return { text: "", provider: "" };
    const mime = sub.mime_type || sub.file_type || "";
    if (!mime) return { text: "", provider: "" };

    const localPath = getLocalPath(BUCKETS.submissions, sub.storage_path);

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
