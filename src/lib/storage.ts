// Supabase-style local file storage abstraction.
// Files are saved under /home/z/my-project/upload/{bucket}/{path}
// and served via GET /api/storage/{bucket}/{path}.
//
// To swap to real Supabase Storage later: replace the body of each
// function with supabase.storage.from(bucket).upload(...) calls.
// The function signatures stay the same.

import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

export const STORAGE_ROOT = "/home/z/my-project/upload";

export const BUCKETS = {
  submissions: "submissions",
  avatars: "avatars",
} as const;

export type BucketName = keyof typeof BUCKETS | string;

// ─────────────────────────────────────────────────────────
// Path sanitization — no .., no leading /, no null bytes
// ─────────────────────────────────────────────────────────
function sanitizePath(p: string): string {
  if (!p) throw new Error("Path cannot be empty");
  // Strip leading slashes
  let cleaned = p.replace(/^\/+/, "");
  // Reject .. traversal
  if (cleaned.includes("..") || cleaned.includes("\0")) {
    throw new Error("Invalid path");
  }
  // Normalize backslashes to forward slashes
  cleaned = cleaned.replace(/\\/g, "/");
  return cleaned;
}

function fullPath(bucket: BucketName, filePath: string): string {
  const safe = sanitizePath(filePath);
  return path.join(STORAGE_ROOT, bucket, safe);
}

export interface UploadResult {
  bucket: string;
  path: string; // bucket-relative path
  url: string; // public URL relative to /api/storage
  size: number;
  mimeType: string;
}

// ─────────────────────────────────────────────────────────
// uploadFile — accepts Buffer or File-like, writes to local disk
// ─────────────────────────────────────────────────────────
export async function uploadFile(
  data: Buffer | Uint8Array,
  bucket: BucketName,
  filePath: string,
  mimeType = "application/octet-stream"
): Promise<UploadResult> {
  const safe = sanitizePath(filePath);
  const abs = fullPath(bucket, safe);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
  await fs.writeFile(abs, buf);
  return {
    bucket,
    path: safe,
    url: `/api/storage/${bucket}/${safe}`,
    size: buf.length,
    mimeType,
  };
}

// ─────────────────────────────────────────────────────────
// getFileUrl — public URL relative to current host (used in <img src=...>)
// ─────────────────────────────────────────────────────────
export function getFileUrl(bucket: BucketName, filePath: string): string {
  const safe = sanitizePath(filePath);
  return `/api/storage/${bucket}/${safe}`;
}

// ─────────────────────────────────────────────────────────
// getLocalPath — absolute disk path for a stored file (used by AI extraction)
// ─────────────────────────────────────────────────────────
export function getLocalPath(bucket: BucketName, filePath: string): string {
  return fullPath(bucket, filePath);
}

// ─────────────────────────────────────────────────────────
// deleteFile — remove a file from the bucket (silent if missing)
// ─────────────────────────────────────────────────────────
export async function deleteFile(bucket: BucketName, filePath: string): Promise<void> {
  try {
    const safe = sanitizePath(filePath);
    const abs = fullPath(bucket, safe);
    await fs.unlink(abs);
  } catch {
    // ignore — file may already be gone
  }
}

// ─────────────────────────────────────────────────────────
// listFiles — recursive listing under a prefix (for admin storage stats)
// ─────────────────────────────────────────────────────────
export async function listFiles(bucket: BucketName, prefix = ""): Promise<string[]> {
  const safe = sanitizePath(prefix);
  const abs = fullPath(bucket, safe);
  const out: string[] = [];
  async function walk(dir: string, rel: string) {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        await walk(path.join(dir, e.name), childRel);
      } else {
        out.push(childRel);
      }
    }
  }
  await walk(abs, safe);
  return out;
}

// ─────────────────────────────────────────────────────────
// readBytes — read a stored file's bytes (used by AI extraction)
// ─────────────────────────────────────────────────────────
export async function readBytes(bucket: BucketName, filePath: string): Promise<Buffer> {
  const abs = fullPath(bucket, filePath);
  return fs.readFile(abs);
}

// ─────────────────────────────────────────────────────────
// getBucketStats — total file count + total bytes for a bucket
// ─────────────────────────────────────────────────────────
export async function getBucketStats(bucket: BucketName): Promise<{ count: number; totalBytes: number }> {
  let count = 0;
  let totalBytes = 0;
  async function walk(dir: string) {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        await walk(full);
      } else {
        try {
          const stat = await fs.stat(full);
          count++;
          totalBytes += stat.size;
        } catch {
          // ignore stat errors
        }
      }
    }
  }
  await walk(path.join(STORAGE_ROOT, bucket));
  return { count, totalBytes };
}

// ─────────────────────────────────────────────────────────
// generateObjectKey — helper to build a unique storage path
// e.g. "submissions/{assignmentId}/{userId}/{uuid}-{originalName}"
// ─────────────────────────────────────────────────────────
export function generateObjectKey(parts: { assignmentId: string; userId: string; originalName: string }): string {
  const safeName = parts.originalName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-100);
  const uuid = randomUUID().split("-")[0];
  return `${parts.assignmentId}/${parts.userId}/${uuid}-${safeName}`;
}

// ─────────────────────────────────────────────────────────
// MIME type helpers — used by the storage API route
// ─────────────────────────────────────────────────────────
export function mimeTypeForExtension(ext: string): string {
  const map: Record<string, string> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    webp: "image/webp",
    bmp: "image/bmp",
    mp3: "audio/mpeg",
    wav: "audio/wav",
    ogg: "audio/ogg",
    m4a: "audio/mp4",
    mp4: "video/mp4",
    webm: "video/webm",
    mov: "video/quicktime",
    avi: "video/x-msvideo",
    pdf: "application/pdf",
    txt: "text/plain",
    json: "application/json",
    csv: "text/csv",
  };
  return map[ext.toLowerCase()] ?? "application/octet-stream";
}

export function isImageType(mime: string): boolean {
  return mime.startsWith("image/");
}
export function isAudioType(mime: string): boolean {
  return mime.startsWith("audio/");
}
export function isVideoType(mime: string): boolean {
  return mime.startsWith("video/");
}
