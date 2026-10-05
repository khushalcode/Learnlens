// /api/evaluations — POST handler.
//
// Adds a notification trigger (Feature 4): when faculty submits a faculty
// (non-peer) evaluation, the submission's student gets a RESULT_PUBLISHED
// notification (so the bell lights up on the student dashboard).
//
// Resubmission semantics are unchanged: faculty can re-score an existing
// evaluation row by POSTing the same submissionId+criterionId+evaluatorId
// tuple (Prisma @@unique constraint triggers update).

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/rls";
import { notify, NOTIF_TYPES } from "@/lib/notifications";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { submissionId, criterionId, score, comment, isPeer } = body as {
    submissionId: string;
    criterionId: string;
    score: number;
    comment?: string;
    isPeer?: boolean;
  };

  if (!submissionId || !criterionId || score === undefined) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  // Role check.
  if (isPeer) {
    const r = requireRole(session as any, "STUDENT");
    if (!r.ok) return r.response;
  } else {
    const r = requireRole(session as any, "FACULTY");
    if (!r.ok) return r.response;
  }

  if (isPeer) {
    // Peer review: student cannot review their own submission.
    const sub = await db.submission.findUnique({ where: { id: submissionId } });
    if (sub?.userId === session.user.id) {
      return NextResponse.json({ error: "Cannot review your own submission" }, { status: 400 });
    }
    const existing = await db.peerReview.findUnique({
      where: {
        submissionId_reviewerId_criterionId: {
          submissionId,
          reviewerId: session.user.id,
          criterionId,
        },
      },
    });
    let pr;
    if (existing) {
      pr = await db.peerReview.update({
        where: { id: existing.id },
        data: { score, comment },
      });
    } else {
      pr = await db.peerReview.create({
        data: { submissionId, reviewerId: session.user.id, criterionId, score, comment },
      });
      // Notify the submission's owner they've been peer-reviewed.
      try {
        const submission = await db.submission.findUnique({
          where: { id: submissionId },
          include: { assignment: true, user: true },
        });
        if (submission && submission.userId !== session.user.id) {
          await notify(
            submission.userId,
            NOTIF_TYPES.PEER_REVIEW_ASSIGNED,
            `Peer review received: ${submission.assignment?.title ?? "your submission"}`,
            `A peer reviewed your submission.`,
            `submissions:`
          );
        }
      } catch (err) {
        console.error("[evaluations POST] peer-review notify failed:", err);
      }
    }
    return NextResponse.json({ peerReview: pr });
  }

  // Faculty evaluation.
  const existing = await db.evaluation.findUnique({
    where: {
      submissionId_evaluatorId_criterionId: {
        submissionId,
        evaluatorId: session.user.id,
        criterionId,
      },
    },
  });
  let ev;
  if (existing) {
    ev = await db.evaluation.update({
      where: { id: existing.id },
      data: { score, comment },
    });
  } else {
    ev = await db.evaluation.create({
      data: { submissionId, evaluatorId: session.user.id, criterionId, score, comment, isPeer: false },
    });
  }

  // Notify the student that a result was published.
  try {
    const submission = await db.submission.findUnique({
      where: { id: submissionId },
      include: { assignment: true, user: true, evaluations: { where: { isPeer: false }, include: { criterion: true } } },
    });
    if (submission && submission.userId !== session.user.id) {
      await notify(
        submission.userId,
        NOTIF_TYPES.RESULT_PUBLISHED,
        `Result published: ${submission.assignment?.title ?? "your submission"}`,
        `${session.user.name ?? "Faculty"} scored your submission. Open "My Submissions" to view.`,
        `submissions:`
      );
    }
  } catch (err) {
    console.error("[evaluations POST] result-published notify failed:", err);
  }

  return NextResponse.json({ evaluation: ev });
}
