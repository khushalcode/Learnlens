// /api/evaluations — POST handler (Supabase-backed).
//
// Adds a notification trigger (Feature 4): when faculty submits a faculty
// (non-peer) evaluation, the submission's student gets a RESULT_PUBLISHED
// notification (so the bell lights up on the student dashboard).
//
// Resubmission semantics are unchanged: faculty can re-score an existing
// evaluation row by POSTing the same submissionId+criterionId+evaluatorId
// tuple — we look it up and UPDATE instead of INSERT (the Supabase UNIQUE
// constraint on (submission_id, evaluator_id, criterion_id) mirrors the
// old Prisma @@unique).

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
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

  const supabase = createSupabaseAdminClient();

  if (isPeer) {
    // Peer review: student cannot review their own submission.
    const { data: sub } = await supabase
      .from("submissions")
      .select("id, user_id")
      .eq("id", submissionId)
      .maybeSingle();
    if (sub?.user_id === session.user.id) {
      return NextResponse.json({ error: "Cannot review your own submission" }, { status: 400 });
    }

    // Look for an existing peer_review with the same (submission_id, reviewer_id, criterion_id).
    const { data: existing } = await supabase
      .from("peer_reviews")
      .select("id")
      .eq("submission_id", submissionId)
      .eq("reviewer_id", session.user.id)
      .eq("criterion_id", criterionId)
      .maybeSingle();

    let pr: any;
    if (existing?.id) {
      const { data: updated, error } = await supabase
        .from("peer_reviews")
        .update({ score, comment: comment ?? null })
        .eq("id", existing.id)
        .select()
        .single();
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      pr = updated;
    } else {
      const { data: inserted, error } = await supabase
        .from("peer_reviews")
        .insert({
          submission_id: submissionId,
          reviewer_id: session.user.id,
          criterion_id: criterionId,
          score,
          comment: comment ?? null,
        })
        .select()
        .single();
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      pr = inserted;

      // Notify the submission's owner they've been peer-reviewed.
      try {
        const { data: submission } = await supabase
          .from("submissions")
          .select(`
            user_id,
            assignment:assignments (id, title)
          `)
          .eq("id", submissionId)
          .maybeSingle();
        if (submission && submission.user_id !== session.user.id) {
          await notify(
            submission.user_id,
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

  // Faculty evaluation — look for an existing row to update.
  const { data: existing } = await supabase
    .from("evaluations")
    .select("id")
    .eq("submission_id", submissionId)
    .eq("evaluator_id", session.user.id)
    .eq("criterion_id", criterionId)
    .maybeSingle();

  let ev: any;
  if (existing?.id) {
    const { data: updated, error } = await supabase
      .from("evaluations")
      .update({ score, comment: comment ?? null })
      .eq("id", existing.id)
      .select()
      .single();
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    ev = updated;
  } else {
    const { data: inserted, error } = await supabase
      .from("evaluations")
      .insert({
        submission_id: submissionId,
        evaluator_id: session.user.id,
        criterion_id: criterionId,
        score,
        comment: comment ?? null,
        is_peer: false,
      })
      .select()
      .single();
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    ev = inserted;
  }

  // Notify the student that a result was published.
  try {
    const { data: submission } = await supabase
      .from("submissions")
      .select(`
        user_id,
        assignment:assignments (id, title),
        evaluations:evaluations (
          id, score, comment, criterion_id, criterion:rubric_criteria (id, name, weight, max_score)
        )
      `)
      .eq("id", submissionId)
      .maybeSingle();
    if (submission && submission.user_id !== session.user.id) {
      await notify(
        submission.user_id,
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
