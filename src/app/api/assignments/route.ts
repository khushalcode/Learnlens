// /api/assignments — POST (faculty create) + GET (student list / faculty list / coordinator list).
//
// POST (Feature 4): after a faculty member creates an assignment, broadcast
// a NEW_ASSIGNMENT notification to every student enrolled in that course.
// Uses notifyEnrolledStudents() from /lib/notifications.
//
// GET (Feature 2): returns the assignments the current student is enrolled
// in, with rubric + competency + their existing submission if any. Used by
// the new SubmitWorkView form to populate the assignment picker + resubmit.
//
// All Prisma calls have been migrated to Supabase. The function signatures +
// response shapes are preserved exactly so the front-end doesn't change.

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { camelize } from "@/lib/queries";
import { requireRole } from "@/lib/rls";
import { notifyEnrolledStudents, NOTIF_TYPES } from "@/lib/notifications";
import { computeFinalScore } from "@/lib/queries";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  const role = requireRole(session as any, "FACULTY");
  if (!role.ok) return role.response;

  const body = await req.json();
  const { title, description, type, deadline, courseId, competencyId, rubric } = body as {
    title: string;
    description?: string;
    type: string;
    deadline: string;
    courseId: string;
    competencyId?: string;
    rubric?: { criteria: { name: string; description?: string; weight: number; maxScore: number }[] };
  };

  if (!title || !type || !deadline || !courseId) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const supabase = createSupabaseAdminClient();

  // Verify faculty owns the course (RLS).
  const { data: course } = await supabase
    .from("courses")
    .select("id, faculty_id")
    .eq("id", courseId)
    .eq("faculty_id", session!.user.id)
    .maybeSingle();
  if (!course) {
    return NextResponse.json({ error: "Course not found or not authorized" }, { status: 404 });
  }

  // Insert the assignment.
  const { data: assignment, error: aErr } = await supabase
    .from("assignments")
    .insert({
      title,
      description: description ?? null,
      type: type.toUpperCase(),
      deadline: new Date(deadline).toISOString(),
      course_id: courseId,
      competency_id: competencyId || null,
    })
    .select()
    .single();
  if (aErr || !assignment) {
    return NextResponse.json({ error: aErr?.message ?? "Failed to create assignment" }, { status: 500 });
  }

  // Insert rubric + criteria if provided.
  let rubricRow: { id: string; assignment_id: string } | null = null;
  let criteriaRows: { id: string; rubric_id: string; name: string; description: string | null; weight: number; max_score: number }[] = [];
  if (rubric?.criteria?.length) {
    const { data: r, error: rErr } = await supabase
      .from("rubrics")
      .insert({ assignment_id: assignment.id })
      .select()
      .single();
    if (rErr || !r) {
      console.error("[assignments POST] rubric insert failed:", rErr?.message);
    } else {
      rubricRow = r as any;
      const { data: cRows, error: cErr } = await supabase
        .from("rubric_criteria")
        .insert(
          rubric.criteria.map((c) => ({
            rubric_id: r.id,
            name: c.name,
            description: c.description ?? null,
            weight: c.weight,
            max_score: c.maxScore,
          }))
        )
        .select();
      if (cErr) {
        console.error("[assignments POST] criteria insert failed:", cErr?.message);
      } else {
        criteriaRows = (cRows ?? []) as any;
      }
    }
  }

  // Notify every enrolled student about the new assignment.
  try {
    await notifyEnrolledStudents(
      courseId,
      NOTIF_TYPES.NEW_ASSIGNMENT,
      `New assignment: ${title}`,
      `Due ${new Date(deadline).toLocaleString()}.${description ? " " + description.slice(0, 120) : ""}`,
      `submit:`
    );
  } catch (err) {
    console.error("[assignments POST] notify enrolled failed:", err);
  }

  // Build response shape identical to the old Prisma include.
  return NextResponse.json({
    assignment: {
      ...camelize(assignment),
      rubric: rubricRow
        ? {
            ...camelize(rubricRow),
            criteria: camelize(criteriaRows),
          }
        : null,
    },
  });
}

// GET — student-facing assignment list (with rubric + competency + existing
// submission + scores, if any). Faculty/coordinator/admin can also call this
// without the "student=true" flag and get a flat list of all assignments.
export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = createSupabaseAdminClient();
  const { searchParams } = new URL(req.url);
  const studentMode = searchParams.get("student") === "true";

  if (studentMode && session.user.role === "STUDENT") {
    // Enrolled assignments for this student.
    const { data: enrollments } = await supabase
      .from("enrollments")
      .select(`
        id,
        user_id,
        course_id,
        course:courses (
          id,
          code,
          name,
          assignments:assignments (
            id,
            title,
            description,
            type,
            deadline,
            course_id,
            competency_id,
            created_at,
            competency:competencies (id, code, name, type, target_level, course_id),
            rubric:rubrics (id, assignment_id, criteria:rubric_criteria (id, name, description, weight, max_score, rubric_id))
          )
        )
      `)
      .eq("user_id", session.user.id);

    const out: any[] = [];
    for (const e of (enrollments ?? []) as any[]) {
      if (!e.course) continue;
      for (const a of e.course.assignments ?? []) {
        // Look up the student's submission for this assignment.
        const { data: submission } = await supabase
          .from("submissions")
          .select(`
            id,
            assignment_id,
            user_id,
            content,
            storage_path,
            mime_type,
            file_size,
            file_name,
            file_url,
            file_type,
            status,
            submitted_at,
            similarityReports:similarity_reports (id, submission_id, similarity, auto_score, feedback_text, provider, criteria_reasoning, confidence, media_extracted_text, compared_to_submission_id, created_at),
            feedback:feedback (id, text, created_at, author_id, recipient_id, source, submission_id)
          `)
          .eq("assignment_id", a.id)
          .eq("user_id", session.user.id)
          .maybeSingle();

        const scores = submission ? await computeFinalScore(submission.id) : null;
        out.push({
          ...camelize(a),
          courseCode: e.course.code,
          courseName: e.course.name,
          submission: submission ? { ...camelize(submission), scores } : null,
        });
      }
    }
    return NextResponse.json({ assignments: out });
  }

  // Faculty: assignments they created.
  if (session.user.role === "FACULTY") {
    const { data: courses } = await supabase
      .from("courses")
      .select(`
        id,
        code,
        name,
        faculty_id,
        assignments:assignments (
          id,
          title,
          description,
          type,
          deadline,
          course_id,
          competency_id,
          created_at,
          competency:competencies (id, code, name, type, target_level, course_id),
          rubric:rubrics (id, assignment_id, criteria:rubric_criteria (id, name, description, weight, max_score, rubric_id))
        )
      `)
      .eq("faculty_id", session.user.id);

    const out: any[] = [];
    for (const c of (courses ?? []) as any[]) {
      for (const a of c.assignments ?? []) {
        // Count submissions for this assignment.
        const { count } = await supabase
          .from("submissions")
          .select("id", { count: "exact", head: true })
          .eq("assignment_id", a.id);
        out.push({
          ...camelize(a),
          courseCode: c.code,
          courseName: c.name,
          submissionCount: count ?? 0,
        });
      }
    }
    // Sort by createdAt asc (matches the old Prisma orderBy).
    out.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    return NextResponse.json({ assignments: out });
  }

  // Coordinator / admin: all assignments.
  const { data: all } = await supabase
    .from("assignments")
    .select(`
      id,
      title,
      description,
      type,
      deadline,
      course_id,
      competency_id,
      created_at,
      course:courses (id, code, name, description, semester, faculty_id, coordinator_id, created_at),
      competency:competencies (id, code, name, type, target_level, course_id),
      rubric:rubrics (id, assignment_id, criteria:rubric_criteria (id, name, description, weight, max_score, rubric_id))
    `)
    .order("created_at", { ascending: true });

  return NextResponse.json({
    assignments: (all ?? []).map((a: any) => ({
      ...camelize(a),
      courseCode: a.course?.code,
      courseName: a.course?.name,
    })),
  });
}
