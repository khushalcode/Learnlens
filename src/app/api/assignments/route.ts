// /api/assignments — POST (faculty create) + GET (student list).
//
// POST (Feature 4): after a faculty member creates an assignment, broadcast
// a NEW_ASSIGNMENT notification to every student enrolled in that course.
// Uses notifyEnrolledStudents() from /lib/notifications.
//
// GET (Feature 2): returns the assignments the current student is enrolled
// in, with rubric + competency + their existing submission if any. Used by
// the new SubmitWorkView form to populate the assignment picker + resubmit.

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
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

  // Verify faculty owns the course (RLS).
  const course = await db.course.findFirst({ where: { id: courseId, facultyId: session!.user.id } });
  if (!course) return NextResponse.json({ error: "Course not found or not authorized" }, { status: 404 });

  const assignment = await db.assignment.create({
    data: {
      title,
      description,
      type,
      deadline: new Date(deadline),
      courseId,
      competencyId: competencyId || null,
      rubric: rubric?.criteria?.length
        ? {
            create: {
              criteria: {
                create: rubric.criteria.map((c) => ({
                  name: c.name,
                  description: c.description,
                  weight: c.weight,
                  maxScore: c.maxScore,
                })),
              },
            },
          }
        : undefined,
    },
    include: { rubric: { include: { criteria: true } } },
  });

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

  return NextResponse.json({ assignment });
}

// GET — student-facing assignment list (with rubric + competency + existing
// submission + scores, if any). Faculty/coordinator/admin can also call this
// without the "student=true" flag and get a flat list of all assignments.
export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const studentMode = searchParams.get("student") === "true";

  if (studentMode && session.user.role === "STUDENT") {
    // Enrolled assignments for this student.
    const enrollments = await db.enrollment.findMany({
      where: { userId: session.user.id },
      include: {
        course: {
          include: {
            assignments: {
              include: { rubric: { include: { criteria: true } }, competency: true },
              orderBy: { deadline: "asc" },
            },
          },
        },
      },
    });
    const out = [];
    for (const e of enrollments) {
      for (const a of e.course.assignments) {
        const submission = await db.submission.findFirst({
          where: { assignmentId: a.id, userId: session.user.id },
          include: { similarityReports: true, feedback: true },
        });
        const scores = submission ? await computeFinalScore(submission.id) : null;
        out.push({
          ...a,
          courseCode: e.course.code,
          courseName: e.course.name,
          submission: submission ? { ...submission, scores } : null,
        });
      }
    }
    return NextResponse.json({ assignments: out });
  }

  // Faculty: assignments they created.
  if (session.user.role === "FACULTY") {
    const courses = await db.course.findMany({
      where: { facultyId: session.user.id },
      include: {
        assignments: {
          include: { rubric: { include: { criteria: true } }, competency: true, _count: { select: { submissions: true } } },
          orderBy: { createdAt: "asc" },
        },
      },
    });
    return NextResponse.json({
      assignments: courses.flatMap((c) =>
        c.assignments.map((a) => ({
          ...a,
          courseCode: c.code,
          courseName: c.name,
          submissionCount: a._count.submissions,
        }))
      ),
    });
  }

  // Coordinator / admin: all assignments.
  const all = await db.assignment.findMany({
    include: { course: true, rubric: { include: { criteria: true } }, competency: true },
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json({
    assignments: all.map((a) => ({
      ...a,
      courseCode: a.course.code,
      courseName: a.course.name,
    })),
  });
}
