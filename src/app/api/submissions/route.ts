// /api/submissions — POST + GET handlers.
//
// POST is refactored (Feature 2) to accept multipart/form-data so the
// student form can upload real files. Supports two submit modes:
//
//   • TEXT  — field "content" with the text answer.
//   • FILE  — field "file" (image / audio / video) saved via the local
//             storage layer; we record storagePath + mimeType + fileSize.
//
// Resubmission logic: if a submission already exists for this user+assignment
// AND the deadline hasn't passed, we UPDATE the existing row (simpler than
// delete+recreate — preserves peer-review / evaluation references). For a
// resubmission with a file, the old file is deleted from storage first.
//
// After creating/updating the submission we kick off AI analysis inline
// (the call is awaited so the toast can show "AI running…" → "Submitted").
// We also notify the course faculty that a new submission arrived (so the
// bell lights up on the faculty dashboard).
//
// GET supports two modes:
//   • /api/submissions?assignmentId=…  → current user's submission for that assignment
//   • /api/submissions                 → all the current user's submissions (newest first)

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { computeFinalScore } from "@/lib/queries";
import { requireRole } from "@/lib/rls";
import { deleteFile, uploadFile } from "@/lib/storage";
import { notify, NOTIF_TYPES } from "@/lib/notifications";

export const dynamic = "force-dynamic";

const ACCEPTED_TEXT_MIME = new Set([
  "text/plain",
  "text/markdown",
]);

const ACCEPTED_IMAGE_MIME = new Set([
  "image/jpeg", "image/png", "image/webp", "image/gif", "image/bmp",
]);

const ACCEPTED_AUDIO_MIME = new Set([
  "audio/mpeg", "audio/wav", "audio/wave", "audio/x-wav",
  "audio/ogg", "audio/webm", "audio/mp4", "audio/m4a", "audio/flac",
]);

const ACCEPTED_VIDEO_MIME = new Set([
  "video/mp4", "video/webm", "video/ogg", "video/quicktime", "video/x-msvideo",
]);

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  const role = requireRole(session as any, "STUDENT");
  if (!role.ok) return role.response;

  const userId = session!.user.id;

  // Parse multipart/form-data.
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart/form-data" }, { status: 400 });
  }

  const assignmentId = (form.get("assignmentId") as string)?.toString();
  if (!assignmentId) {
    return NextResponse.json({ error: "Missing assignmentId" }, { status: 400 });
  }

  // Fetch assignment + verify the student is enrolled in its course.
  const assignment = await db.assignment.findUnique({
    where: { id: assignmentId },
    include: { course: { include: { enrollments: true, faculty: true } } },
  });
  if (!assignment) {
    return NextResponse.json({ error: "Assignment not found" }, { status: 404 });
  }
  const enrolled = assignment.course.enrollments.some((e) => e.userId === userId);
  if (!enrolled) {
    return NextResponse.json({ error: "You are not enrolled in this course" }, { status: 403 });
  }

  // Deadline check.
  const now = new Date();
  const deadlinePassed = assignment.deadline.getTime() < now.getTime();

  // Pull fields based on submission type.
  const type = assignment.type.toUpperCase();
  let content: string | null = null;
  let storagePath: string | null = null;
  let mimeType: string | null = null;
  let fileSize: number | null = null;
  let fileName: string | null = null;

  if (type === "TEXT") {
    const text = (form.get("content") as string)?.toString() ?? "";
    if (!text || text.trim().length < 20) {
      return NextResponse.json({ error: "Text submission must be at least 20 characters" }, { status: 400 });
    }
    content = text;
  } else {
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Missing file upload" }, { status: 400 });
    }
    if (file.size === 0) {
      return NextResponse.json({ error: "Uploaded file is empty" }, { status: 400 });
    }
    if (file.size > 50 * 1024 * 1024) {
      return NextResponse.json({ error: "File exceeds 50 MB limit" }, { status: 400 });
    }
    // Validate mime matches the assignment type.
    const mime = file.type || "application/octet-stream";
    const accept =
      type === "IMAGE" ? ACCEPTED_IMAGE_MIME :
      type === "AUDIO" ? ACCEPTED_AUDIO_MIME :
      type === "VIDEO" ? ACCEPTED_VIDEO_MIME :
      ACCEPTED_TEXT_MIME;
    if (!accept.has(mime)) {
      return NextResponse.json({ error: `File type ${mime} not allowed for ${type} assignment` }, { status: 400 });
    }
    // Save via storage layer.
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const relPath = `${userId}/${Date.now()}-${safeName}`;
    try {
      const uploaded = await uploadFile(file, "submissions", relPath);
      storagePath = uploaded.path;
      mimeType = uploaded.mimeType;
      fileSize = uploaded.size;
      fileName = file.name;
    } catch (err: any) {
      console.error("[submissions POST] upload failed:", err);
      return NextResponse.json({ error: "File upload failed: " + (err?.message || "unknown") }, { status: 500 });
    }
  }

  // Existing submission check — resubmit path.
  const existing = await db.submission.findFirst({
    where: { assignmentId, userId },
  });

  let submission;
  if (existing) {
    // Resubmit: deadline must not have passed (override allowed only for
    // late-submissions flag — but here we just enforce it).
    if (deadlinePassed) {
      // If we already uploaded a new file, clean it up since we're rejecting.
      if (storagePath) await deleteFile("submissions", storagePath).catch(() => {});
      return NextResponse.json({ error: "Deadline has passed; resubmission closed" }, { status: 409 });
    }
    // If a previous file existed, delete it.
    if (existing.storagePath) {
      await deleteFile("submissions", existing.storagePath).catch(() => {});
    }
    submission = await db.submission.update({
      where: { id: existing.id },
      data: {
        content,
        storagePath,
        mimeType,
        fileSize,
        fileName,
        // legacy fields kept in sync so older UI bits don't break
        fileUrl: storagePath ? `/api/storage/submissions/${storagePath}` : null,
        fileType: mimeType,
        status: "SUBMITTED",
        submittedAt: now,
      },
    });
    // Wipe stale AI reports since the submission content changed.
    await db.similarityReport.deleteMany({ where: { submissionId: submission.id } });
  } else {
    submission = await db.submission.create({
      data: {
        assignmentId,
        userId,
        content,
        storagePath,
        mimeType,
        fileSize,
        fileName,
        fileUrl: storagePath ? `/api/storage/submissions/${storagePath}` : null,
        fileType: mimeType,
        status: deadlinePassed ? "LATE" : "SUBMITTED",
      },
    });
  }

  // Kick off AI analysis inline. Wrap in try/catch — submission succeeded
  // even if AI fails (mock fallback will still produce a SimilarityReport).
  let aiProvider = "MOCK";
  try {
    const aiRes = await fetch(
      `${req.nextUrl?.origin ?? "http://localhost:3000"}/api/ai-simulate?submissionId=${submission.id}`,
      {
        method: "POST",
        headers: {
          cookie: req.headers.get("cookie") ?? "",
        },
      }
    );
    if (aiRes.ok) {
      const j = await aiRes.json().catch(() => ({}));
      aiProvider = j?.provider ?? "MOCK";
    }
  } catch (err) {
    console.error("[submissions POST] inline AI failed (non-fatal):", err);
    // Fallback: write a placeholder report so the UI shows *something*.
    try {
      await db.similarityReport.create({
        data: {
          submissionId: submission.id,
          similarity: 12,
          autoScore: 0,
          feedbackText: "AI analysis pending — faculty evaluation will refine the score.",
          provider: "MOCK",
        },
      });
    } catch {}
  }

  // Notify the faculty member of the course that a new submission arrived.
  try {
    const faculty = assignment.course.faculty;
    if (faculty) {
      await notify(
        faculty.id,
        NOTIF_TYPES.AI_ANALYSIS_READY, // reuse for "submission arrived"
        `New submission: ${assignment.title}`,
        `${session!.user.email} submitted. AI provider: ${aiProvider}.`,
        `evaluate:`
      );
    }
  } catch (err) {
    console.error("[submissions POST] notify faculty failed:", err);
  }

  return NextResponse.json({ submission, aiProvider });
}

// GET — list the current user's submissions, optionally for one assignment.
export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const assignmentId = searchParams.get("assignmentId");
  if (assignmentId) {
    const sub = await db.submission.findFirst({
      where: { assignmentId, userId: session.user.id },
      include: {
        similarityReports: true,
        feedback: { include: { author: true } },
        evaluations: { include: { criterion: true } },
        peerReviews: { include: { criterion: true } },
        assignment: true,
      },
    });
    if (!sub) return NextResponse.json({ submission: null });
    const scores = await computeFinalScore(sub.id);
    return NextResponse.json({ submission: { ...sub, scores } });
  }

  const subs = await db.submission.findMany({
    where: { userId: session.user.id },
    include: { assignment: true, similarityReports: true },
    orderBy: { submittedAt: "desc" },
  });
  return NextResponse.json({ submissions: subs });
}
