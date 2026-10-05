// GET /api/storage/{bucket}/{...path} — serves a stored file from local disk.
// Mimics the response of Supabase Storage's public URL.
import { NextRequest } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import { STORAGE_ROOT, mimeTypeForExtension } from "@/lib/storage";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ bucket: string; path: string[] }> }) {
  const { bucket, path: pathParts } = await ctx.params;
  if (!bucket || !pathParts?.length) return new Response("Not found", { status: 404 });

  // Reject path traversal
  const joined = pathParts.join("/");
  if (joined.includes("..") || joined.includes("\0")) {
    return new Response("Invalid path", { status: 400 });
  }

  const abs = path.join(STORAGE_ROOT, bucket, joined);
  // Verify the resolved path is still inside the bucket directory
  const bucketRoot = path.join(STORAGE_ROOT, bucket);
  if (!abs.startsWith(bucketRoot)) {
    return new Response("Invalid path", { status: 400 });
  }

  try {
    const buf = await fs.readFile(abs);
    const ext = path.extname(abs).slice(1).toLowerCase();
    const contentType = mimeTypeForExtension(ext);
    return new Response(buf, {
      status: 200,
      headers: {
        "content-type": contentType,
        "cache-control": "public, max-age=86400",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
