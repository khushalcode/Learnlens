// Centralized Supabase queries + AI simulation logic.
//
// Migrated from Prisma+SQLite → real Supabase (live project).
// All function signatures + return shapes preserved exactly so the
// dashboards don't need to change.
//
// We use createSupabaseAdminClient() for all reads/writes — this
// bypasses RLS, which is acceptable because the API routes already
// enforce auth/role at the NextAuth layer (see src/lib/rls.ts).
// RLS in Supabase is a defense-in-depth backstop, not the primary
// auth boundary here.

import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { createHash } from "crypto";
import { getBucketStats, BUCKETS } from "@/lib/storage";

// ─────────────────────────────────────────────────────────
// camelCase helper — Supabase returns snake_case columns, but the
// dashboards expect Prisma-style camelCase (e.g. `assignmentId`,
// `submittedAt`, `criterion.maxScore`). Recursively convert.
// ─────────────────────────────────────────────────────────
function toCamelKey(key: string): string {
  return key.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
}

export function camelize<T>(obj: T): T {
  if (obj === null || obj === undefined) return obj;
  if (obj instanceof Date) return obj;
  if (Array.isArray(obj)) return obj.map(camelize) as unknown as T;
  if (typeof obj === "object" && !(obj instanceof Buffer)) {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(obj as Record<string, unknown>)) {
      out[toCamelKey(k)] = camelize((obj as Record<string, unknown>)[k]);
    }
    return out as T;
  }
  return obj;
}

// ─────────────────────────────────────────────────────────
// AI SIMULATION (rule-based, kept as mock fallbacks)
// ─────────────────────────────────────────────────────────

function seeded(seed: string, max = 1): number {
  const h = createHash("md5").update(seed).digest().readUInt32LE(0);
  return (h / 0xffffffff) * max;
}

const FEEDBACK_TEMPLATES = {
  excellent: [
    "Excellent work — strong command of the topic with clear, well-structured reasoning.",
    "Outstanding submission. You demonstrate mastery of the key concepts.",
    "Top-tier work. Sets a high bar for the cohort.",
  ],
  good: [
    "Solid submission — minor refinements would push this toward excellence.",
    "Good effort with clear understanding; some criteria could be developed further.",
    "Competent work meeting all expectations.",
  ],
  average: [
    "Acceptable submission, but several criteria need more depth.",
    "Meets minimum expectations. Spend more time on weaker criteria.",
    "Average work — adequate but not yet impressive.",
  ],
  needsWork: [
    "Below expectations. Please review the fundamentals and consider office hours.",
    "This needs major revision. Several criteria are incomplete.",
    "Concerning submission — focus on the weakest criteria and seek support.",
  ],
};

function feedbackForScore(score: number, seed: string): string {
  let bucket: keyof typeof FEEDBACK_TEMPLATES;
  if (score >= 85) bucket = "excellent";
  else if (score >= 70) bucket = "good";
  else if (score >= 50) bucket = "average";
  else bucket = "needsWork";
  const arr = FEEDBACK_TEMPLATES[bucket];
  return arr[Math.floor(seeded(seed, arr.length))];
}

/**
 * Deterministic mock similarity % for fallback (12-78%).
 */
export function computeSimilarity(submissionId: string): number {
  return parseFloat((12 + seeded(submissionId + "-sim", 66)).toFixed(1));
}

/**
 * Compute auto-score suggestion based on rubric criteria weighted average.
 * Mirrors how faculty score would aggregate, with ±5% noise to feel "AI".
 */
export function computeAutoScore(
  criteriaScores: { score: number; max: number; weight: number }[]
): number {
  if (criteriaScores.length === 0) return 0;
  const weighted = criteriaScores.reduce(
    (acc, cs) => acc + (cs.score / cs.max) * cs.weight,
    0
  );
  const noise = (seeded(JSON.stringify(criteriaScores), 1) - 0.5) * 6;
  return Math.max(0, Math.min(100, parseFloat((weighted * 100 + noise).toFixed(1))));
}

// Re-export the feedback template picker (used by ai/feedback.ts as fallback).
export { feedbackForScore };

// ─────────────────────────────────────────────────────────
// SCORING HELPERS
// ─────────────────────────────────────────────────────────

/**
 * Final score = weighted faculty (70%) + weighted peer (30%).
 * Both faculty & peer score each criterion; aggregate per criterion weighted by rubric weights.
 */
export async function computeFinalScore(submissionId: string): Promise<{
  facultyScore: number | null;
  peerScore: number | null;
  finalScore: number | null;
  criteriaBreakdown: { name: string; facultyScore: number | null; peerScore: number | null; weight: number; finalScore: number | null }[];
}> {
  const supabase = createSupabaseAdminClient();

  // Fetch the submission to find its assignment_id.
  const { data: submission } = await supabase
    .from("submissions")
    .select("id, assignment_id")
    .eq("id", submissionId)
    .single();

  if (!submission) {
    return { facultyScore: null, peerScore: null, finalScore: null, criteriaBreakdown: [] };
  }

  // Fetch rubric + criteria for the assignment.
  const { data: rubric } = await supabase
    .from("rubrics")
    .select("id, assignment_id")
    .eq("assignment_id", submission.assignment_id)
    .single();
  let criteria: { id: string; name: string; weight: number; max_score: number }[] = [];
  if (rubric) {
    const { data: criteriaRows } = await supabase
      .from("rubric_criteria")
      .select("id, name, weight, max_score")
      .eq("rubric_id", rubric.id);
    criteria = criteriaRows ?? [];
  }

  if (!criteria.length) {
    return { facultyScore: null, peerScore: null, finalScore: null, criteriaBreakdown: [] };
  }

  // Fetch faculty evaluations (is_peer=false) + peer reviews for this submission.
  const [facultyEvalsRes, peerReviewsRes] = await Promise.all([
    supabase
      .from("evaluations")
      .select("criterion_id, score")
      .eq("submission_id", submissionId)
      .eq("is_peer", false),
    supabase
      .from("peer_reviews")
      .select("criterion_id, score")
      .eq("submission_id", submissionId),
  ]);

  const facultyEvals = (facultyEvalsRes.data ?? []) as { criterion_id: string; score: number }[];
  const peerReviews = (peerReviewsRes.data ?? []) as { criterion_id: string; score: number }[];

  const facultyByCrit: Record<string, number[]> = {};
  const peerByCrit: Record<string, number[]> = {};
  for (const e of facultyEvals) {
    if (!facultyByCrit[e.criterion_id]) facultyByCrit[e.criterion_id] = [];
    facultyByCrit[e.criterion_id].push(e.score);
  }
  for (const p of peerReviews) {
    if (!peerByCrit[p.criterion_id]) peerByCrit[p.criterion_id] = [];
    peerByCrit[p.criterion_id].push(p.score);
  }

  let facultyTotal = 0;
  let peerTotal = 0;
  let finalTotal = 0;
  const breakdown = criteria.map((c) => {
    const facAvg = facultyByCrit[c.id]?.length
      ? facultyByCrit[c.id].reduce((a, b) => a + b, 0) / facultyByCrit[c.id].length
      : null;
    const peerAvg = peerByCrit[c.id]?.length
      ? peerByCrit[c.id].reduce((a, b) => a + b, 0) / peerByCrit[c.id].length
      : null;
    const facPct = facAvg !== null ? (facAvg / c.max_score) * 100 : null;
    const peerPct = peerAvg !== null ? (peerAvg / c.max_score) * 100 : null;
    const critFinal =
      facPct !== null && peerPct !== null
        ? facPct * 0.7 + peerPct * 0.3
        : facPct ?? peerPct;
    if (facPct !== null) facultyTotal += facPct * c.weight;
    if (peerPct !== null) peerTotal += peerPct * c.weight;
    if (critFinal !== null) finalTotal += critFinal * c.weight;
    return {
      name: c.name,
      facultyScore: facPct !== null ? parseFloat(facPct.toFixed(1)) : null,
      peerScore: peerPct !== null ? parseFloat(peerPct.toFixed(1)) : null,
      weight: c.weight,
      finalScore: critFinal !== null ? parseFloat(critFinal.toFixed(1)) : null,
    };
  });

  return {
    facultyScore: parseFloat(facultyTotal.toFixed(1)),
    peerScore: parseFloat(peerTotal.toFixed(1)),
    finalScore: parseFloat(finalTotal.toFixed(1)),
    criteriaBreakdown: breakdown,
  };
}

// ─────────────────────────────────────────────────────────
// DASHBOARD QUERIES
// ─────────────────────────────────────────────────────────

export async function getStudentDashboard(userId: string) {
  const supabase = createSupabaseAdminClient();

  // Fetch the user's profile.
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, email, name")
    .eq("id", userId)
    .single();

  if (!profile) {
    return {
      student: { id: userId, name: "", email: "" },
      learningCurve: [],
      classAverage: [],
      competencies: [],
      recentFeedback: [],
      aiReports: [],
      submissionsCount: 0,
      avgScore: 0,
    };
  }

  // Fetch this student's submissions + their assignment (with course + competency).
  const { data: submissionsRaw } = await supabase
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
      assignment:assignments (
        id,
        title,
        description,
        type,
        deadline,
        course_id,
        competency_id,
        course:courses (id, code, name),
        competency:competencies (id, code, name, type)
      )
    `)
    .eq("user_id", userId)
    .order("submitted_at", { ascending: true });

  type SubmissionRow = {
    id: string;
    assignment_id: string;
    user_id: string;
    content: string | null;
    storage_path: string | null;
    mime_type: string | null;
    file_size: number | null;
    file_name: string | null;
    file_url: string | null;
    file_type: string | null;
    status: string;
    submitted_at: string;
    assignment: {
      id: string;
      title: string;
      description: string | null;
      type: string;
      deadline: string;
      course_id: string;
      competency_id: string | null;
      course: { id: string; code: string; name: string } | null;
      competency: { id: string; code: string; name: string; type: string } | null;
    } | null;
  };

  const submissions = (submissionsRaw ?? []) as unknown as SubmissionRow[];

  if (!submissions.length) {
    return {
      student: { id: userId, name: profile.name, email: profile.email },
      learningCurve: [],
      classAverage: [],
      competencies: [],
      recentFeedback: [],
      aiReports: [],
      submissionsCount: 0,
      avgScore: 0,
    };
  }

  // Compute final scores for each submission.
  const submissionsWithScores = await Promise.all(
    submissions.map(async (s) => {
      const scores = await computeFinalScore(s.id);
      return { ...s, scores };
    })
  );

  // Learning curve: score per assignment over time.
  const learningCurve = submissionsWithScores
    .filter((s) => s.scores.finalScore !== null)
    .map((s) => ({
      assignmentTitle: s.assignment?.title ?? "Untitled",
      assignmentId: s.assignment?.id ?? s.assignment_id,
      score: s.scores.finalScore as number,
      submittedAt: s.submitted_at,
      competencyCode: s.assignment?.competency?.code ?? null,
    }));

  // Class average: gather every submission in the same courses.
  const courseIds = [
    ...new Set(
      submissions
        .map((s) => s.assignment?.course_id)
        .filter((x): x is string => Boolean(x))
    ),
  ];

  const classAverage: {
    assignmentId: string;
    assignmentTitle: string;
    avgScore: number;
  }[] = [];
  if (courseIds.length) {
    const { data: allCourseSubs } = await supabase
      .from("submissions")
      .select("id, assignment_id, assignment:assignments (id, title, course_id)")
      .in("assignment.course_id", courseIds);

    const classAvgByAssignment: Record<string, number[]> = {};
    for (const s of (allCourseSubs ?? []) as any[]) {
      const scores = await computeFinalScore(s.id);
      if (scores.finalScore !== null) {
        const aid = s.assignment_id;
        if (!classAvgByAssignment[aid]) classAvgByAssignment[aid] = [];
        classAvgByAssignment[aid].push(scores.finalScore);
      }
    }
    for (const [aid, scores] of Object.entries(classAvgByAssignment)) {
      const matched = submissions.find(
        (s) => s.assignment?.id === aid || s.assignment_id === aid
      );
      classAverage.push({
        assignmentId: aid,
        assignmentTitle: matched?.assignment?.title ?? aid,
        avgScore: parseFloat(
          (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1)
        ),
      });
    }
  }

  // Weak competencies: averaged score per competency code < 60.
  const compScores: Record<string, number[]> = {};
  for (const s of submissionsWithScores) {
    if (s.scores.finalScore !== null && s.assignment?.competency?.code) {
      const code = s.assignment.competency.code;
      if (!compScores[code]) compScores[code] = [];
      compScores[code].push(s.scores.finalScore);
    }
  }
  const competencies = Object.entries(compScores).map(([code, scores]) => {
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    return {
      code,
      avgScore: parseFloat(avg.toFixed(1)),
      count: scores.length,
      weak: avg < 60,
    };
  });

  // Recent feedback: gather feedback rows for this student's submissions.
  const submissionIds = submissions.map((s) => s.id);
  let feedbackRows: any[] = [];
  if (submissionIds.length) {
    const { data } = await supabase
      .from("feedback")
      .select(`
        id,
        text,
        created_at,
        author_id,
        recipient_id,
        submission_id,
        source,
        author:profiles!feedback_author_id_fkey (id, name)
      `)
      .in("submission_id", submissionIds);
    feedbackRows = data ?? [];
  }

  const recentFeedback = feedbackRows
    .map((f) => {
      const sub = submissions.find((s) => s.id === f.submission_id);
      return {
        id: f.id,
        text: f.text,
        createdAt: f.created_at,
        author: f.author ? { id: f.author.id, name: f.author.name } : null,
        authorId: f.author_id,
        recipientId: f.recipient_id,
        source: f.source,
        submissionId: f.submission_id,
        assignmentTitle: sub?.assignment?.title ?? "Assignment",
      };
    })
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 5);

  // Recent AI similarity reports for the student's submissions.
  let aiReportRows: any[] = [];
  if (submissionIds.length) {
    const { data } = await supabase
      .from("similarity_reports")
      .select("id, submission_id, similarity, auto_score, feedback_text")
      .in("submission_id", submissionIds);
    aiReportRows = data ?? [];
  }
  const aiReports = submissionsWithScores
    .map((s) => {
      const r = aiReportRows.find((row: any) => row.submission_id === s.id);
      return {
        assignmentTitle: s.assignment?.title ?? "Untitled",
        similarity: r?.similarity ?? null,
        autoScore: r?.auto_score ?? null,
        feedbackText: r?.feedback_text ?? null,
      };
    })
    .filter((r) => r.similarity !== null);

  return {
    student: { id: userId, name: profile.name, email: profile.email },
    learningCurve,
    classAverage,
    competencies,
    recentFeedback,
    aiReports,
    submissionsCount: submissions.length,
    avgScore: learningCurve.length
      ? parseFloat(
          (learningCurve.reduce((a, b) => a + b.score, 0) / learningCurve.length).toFixed(1)
        )
      : 0,
  };
}

export async function getFacultyDashboard(userId: string) {
  const supabase = createSupabaseAdminClient();

  // Faculty's courses.
  const { data: coursesRaw } = await supabase
    .from("courses")
    .select(`
      id,
      code,
      name,
      description,
      semester,
      faculty_id,
      coordinator_id,
      created_at
    `)
    .eq("faculty_id", userId);

  type CourseRow = {
    id: string;
    code: string;
    name: string;
    description: string | null;
    semester: string;
    faculty_id: string;
    coordinator_id: string | null;
    created_at: string;
  };

  const courses = (coursesRaw ?? []) as unknown as CourseRow[];

  // For each course, fetch assignments + enrollments.
  const coursesWithChildren = await Promise.all(
    courses.map(async (c) => {
      const [assignmentsRes, enrollmentsRes] = await Promise.all([
        supabase
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
            competency:competencies (id, code, name, type),
            rubric:rubrics (id, assignment_id, criteria:rubric_criteria (id, name, description, weight, max_score, rubric_id))
          `)
          .eq("course_id", c.id)
          .order("created_at", { ascending: true }),
        supabase
          .from("enrollments")
          .select("id, user_id, course_id")
          .eq("course_id", c.id),
      ]);

      return {
        course: c,
        assignments: assignmentsRes.data ?? [],
        enrollments: enrollmentsRes.data ?? [],
      };
    })
  );

  // Per-assignment stats: count total + evaluated submissions.
  const assignmentsWithStats = await Promise.all(
    coursesWithChildren.flatMap((c) =>
      c.assignments.map(async (a: any) => {
        const { data: subs } = await supabase
          .from("submissions")
          .select("id")
          .eq("assignment_id", a.id);
        const totalSubs = subs?.length ?? 0;
        // Count how many submissions have at least one faculty eval (is_peer=false).
        const { data: evaluatedSubs } = await supabase
          .from("evaluations")
          .select("submission_id", { count: "exact", head: false })
          .eq("is_peer", false)
          .in(
            "submission_id",
            (subs ?? []).map((s: any) => s.id)
          );
        const evaluatedIds = new Set(
          (evaluatedSubs ?? []).map((e: any) => e.submission_id)
        );
        const evaluated = evaluatedIds.size;
        return {
          ...camelize(a),
          totalSubmissions: totalSubs,
          evaluated,
          pending: totalSubs - evaluated,
        };
      })
    )
  );

  return {
    faculty: { id: userId },
    courses: coursesWithChildren.map((c) => {
      const course = camelize(c.course) as any;
      const assignmentCount = c.assignments.length;
      const studentCount = c.enrollments.length;
      const mappedAssignments = c.assignments.map((a: any) => camelize(a));
      const statsById = new Map(
        assignmentsWithStats.map((a) => [a.id, a] as const)
      );
      return {
        ...course,
        assignmentCount,
        studentCount,
        enrollments: camelize(c.enrollments),
        assignments: mappedAssignments.map((a: any) => ({
          ...a,
          ...statsById.get(a.id),
        })),
      };
    }),
  };
}

export async function getMentorDashboard(userId: string) {
  const supabase = createSupabaseAdminClient();

  // Fetch mentees (profiles where mentor_id = userId).
  const { data: menteesRaw } = await supabase
    .from("profiles")
    .select("id, email, name")
    .eq("mentor_id", userId);

  type MenteeRow = { id: string; email: string; name: string };
  const mentees = (menteesRaw ?? []) as unknown as MenteeRow[];

  const menteesWithScores = await Promise.all(
    mentees.map(async (m) => {
      // Fetch mentee's submissions + assignment title.
      const { data: subsRaw } = await supabase
        .from("submissions")
        .select("id, assignment_id, submitted_at, assignment:assignments (id, title)")
        .eq("user_id", m.id)
        .order("submitted_at", { ascending: true });

      const subs = (subsRaw ?? []) as any[];

      const scores = await Promise.all(
        subs.map(async (s) => {
          const sc = await computeFinalScore(s.id);
          return {
            assignmentTitle: s.assignment?.title ?? "Untitled",
            assignmentId: s.assignment?.id ?? s.assignment_id,
            submittedAt: s.submitted_at,
            score: sc.finalScore,
          };
        })
      );

      const validScores = scores.filter(
        (s): s is { assignmentTitle: string; assignmentId: string; submittedAt: string; score: number } =>
          s.score !== null
      );

      // At-risk: last 2 scores both dropped.
      let atRisk = false;
      let trend: "up" | "down" | "stable" | "insufficient" = "insufficient";
      if (validScores.length >= 2) {
        const last = validScores[validScores.length - 1].score;
        const prev = validScores[validScores.length - 2].score;
        if (last < prev) {
          trend = "down";
          if (validScores.length >= 3) {
            const prevPrev = validScores[validScores.length - 3].score;
            if (prev < prevPrev) atRisk = true;
          }
          if (validScores.length === 2 && last < 60) atRisk = true;
        } else if (last > prev) {
          trend = "up";
        } else {
          trend = "stable";
        }
      }
      // Also flag if most-recent score is < 40%.
      if (validScores.length && validScores[validScores.length - 1].score < 40) {
        atRisk = true;
      }

      return {
        id: m.id,
        name: m.name,
        email: m.email,
        scores: validScores,
        avgScore: validScores.length
          ? parseFloat(
              (validScores.reduce((a, b) => a + b.score, 0) / validScores.length).toFixed(1)
            )
          : 0,
        atRisk,
        trend,
      };
    })
  );

  return {
    mentor: { id: userId },
    mentees: menteesWithScores,
    totalMentees: menteesWithScores.length,
    atRiskCount: menteesWithScores.filter((m) => m.atRisk).length,
  };
}

export async function getCoordinatorDashboard(userId: string) {
  const supabase = createSupabaseAdminClient();

  // Coordinator's courses.
  const { data: coursesRaw } = await supabase
    .from("courses")
    .select("id, code, name, description, semester, faculty_id, coordinator_id, created_at")
    .eq("coordinator_id", userId);

  type CourseRow = {
    id: string;
    code: string;
    name: string;
    description: string | null;
    semester: string;
    faculty_id: string;
    coordinator_id: string | null;
    created_at: string;
  };
  const courses = (coursesRaw ?? []) as unknown as CourseRow[];

  const courseStats = await Promise.all(
    courses.map(async (c) => {
      // Fetch enrollments + students + their submissions.
      const { data: enrollmentsRaw } = await supabase
        .from("enrollments")
        .select("id, user_id, course_id, user:profiles (id, name, email)")
        .eq("course_id", c.id);

      // Fetch assignments for the course (with competency).
      const { data: assignmentsRaw } = await supabase
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
          competency:competencies (id, code, name, type)
        `)
        .eq("course_id", c.id);

      // Fetch competencies for the course.
      const { data: competenciesRaw } = await supabase
        .from("competencies")
        .select("id, code, name, type, course_id, target_level")
        .eq("course_id", c.id);

      // All submissions for this course (via assignment.course_id).
      const { data: allSubsRaw } = await supabase
        .from("submissions")
        .select("id, assignment_id, user_id, assignment:assignments (id, title, course_id), user:profiles (id, name, email)")
        .in("assignment.course_id", [c.id]);

      const allSubmissions = (allSubsRaw ?? []) as any[];

      const scoresByStudent: Record<string, number[]> = {};
      const scoresByAssignment: Record<string, { title: string; scores: number[] }> = {};
      for (const s of allSubmissions) {
        const sc = await computeFinalScore(s.id);
        if (sc.finalScore !== null) {
          if (!scoresByStudent[s.user_id]) scoresByStudent[s.user_id] = [];
          scoresByStudent[s.user_id].push(sc.finalScore);
          const aid = s.assignment_id;
          if (!scoresByAssignment[aid]) {
            scoresByAssignment[aid] = {
              title: s.assignment?.title ?? "Assignment",
              scores: [],
            };
          }
          scoresByAssignment[aid].scores.push(sc.finalScore);
        }
      }

      // Per-student ranking.
      const ranking = Object.entries(scoresByStudent)
        .map(([sid, scores]) => {
          const sub = allSubmissions.find((s) => s.user_id === sid);
          return {
            studentId: sid,
            name: sub?.user?.name ?? "Unknown",
            email: sub?.user?.email ?? "",
            avgScore: parseFloat(
              (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1)
            ),
            assignmentCount: scores.length,
          };
        })
        .sort((a, b) => b.avgScore - a.avgScore);

      // CO-PO attainment per competency.
      const coPoAttainment = await Promise.all(
        (competenciesRaw ?? []).map(async (comp: any) => {
          const compAssignments = (assignmentsRaw ?? []).filter(
            (a: any) => a.competency_id === comp.id
          );
          const allScores: number[] = [];
          for (const a of compAssignments) {
            const { data: sub } = await supabase
              .from("submissions")
              .select("id")
              .eq("assignment_id", a.id);
            for (const s of sub ?? []) {
              const sc = await computeFinalScore(s.id);
              if (sc.finalScore !== null) allScores.push(sc.finalScore);
            }
          }
          const target = comp.target_level ?? 75;
          const avg = allScores.length
            ? allScores.reduce((x, y) => x + y, 0) / allScores.length
            : 0;
          return {
            code: comp.code,
            name: comp.name,
            type: comp.type,
            avgAttainment: parseFloat(avg.toFixed(1)),
            target,
            status:
              avg >= target
                ? "achieved"
                : avg >= target * 0.8
                ? "at-risk"
                : "below",
          };
        })
      );

      // Trend: avg score per assignment over time.
      const trend = Object.values(scoresByAssignment).map((a) => ({
        title: a.title,
        avgScore: parseFloat(
          (a.scores.reduce((x, y) => x + y, 0) / a.scores.length).toFixed(1)
        ),
      }));

      return {
        course: { id: c.id, code: c.code, name: c.name },
        studentCount: enrollmentsRaw?.length ?? 0,
        batchAverage: ranking.length
          ? parseFloat(
              (ranking.reduce((a, b) => a + b.avgScore, 0) / ranking.length).toFixed(1)
            )
          : 0,
        topStudents: ranking.slice(0, 5),
        bottomStudents: ranking.slice(-5).reverse(),
        ranking,
        coPoAttainment,
        trend,
      };
    })
  );

  return { coordinator: { id: userId }, courses: courseStats };
}

export async function getAdminDashboard() {
  const supabase = createSupabaseAdminClient();

  // Head counts for each table (head:true is much cheaper than full select).
  const [usersRes, coursesRes, assignmentsRes, submissionsRes, evaluationsRes, feedbackRes, notifsRes] =
    await Promise.all([
      supabase.from("profiles").select("*", { count: "exact", head: true }),
      supabase.from("courses").select("*", { count: "exact", head: true }),
      supabase.from("assignments").select("*", { count: "exact", head: true }),
      supabase.from("submissions").select("*", { count: "exact", head: true }),
      supabase.from("evaluations").select("*", { count: "exact", head: true }),
      supabase.from("feedback").select("*", { count: "exact", head: true }),
      supabase.from("notifications").select("*", { count: "exact", head: true }),
    ]);

  const users = usersRes.count ?? 0;
  const courses = coursesRes.count ?? 0;
  const assignments = assignmentsRes.count ?? 0;
  const submissions = submissionsRes.count ?? 0;
  const evaluations = evaluationsRes.count ?? 0;
  const feedback = feedbackRes.count ?? 0;
  const notifications = notifsRes.count ?? 0;

  // Group users by role.
  const { data: allProfiles } = await supabase
    .from("profiles")
    .select("role");
  const roleCounts: Record<string, number> = {};
  for (const p of (allProfiles ?? []) as { role: string }[]) {
    roleCounts[p.role] = (roleCounts[p.role] ?? 0) + 1;
  }
  const usersByRole = Object.entries(roleCounts).map(([role, count]) => ({
    role,
    count,
    _count: count, // dashboards accept either shape
  }));

  // Storage stats from the local storage layer (submissions + avatars buckets).
  const [subStats, avStats] = await Promise.all([
    getBucketStats(BUCKETS.submissions).catch(() => ({ count: 0, totalBytes: 0 })),
    getBucketStats(BUCKETS.avatars).catch(() => ({ count: 0, totalBytes: 0 })),
  ]);
  const totalCount = subStats.count + avStats.count;
  const totalBytes = subStats.totalBytes + avStats.totalBytes;

  return {
    totals: {
      users,
      courses,
      assignments,
      submissions,
      evaluations,
      feedback,
      notifications,
    },
    usersByRole,
    storage: {
      fileCount: totalCount,
      sizeBytes: totalBytes,
      sizeMB: parseFloat((totalBytes / (1024 * 1024)).toFixed(2)),
      perBucket: {
        submissions: subStats,
        avatars: avStats,
      },
    },
    // Bonus field per migration spec (additive, doesn't break dashboards).
    storageStats: { count: totalCount, totalBytes },
  };
}

// ─────────────────────────────────────────────────────────
// DETAIL QUERIES
// ─────────────────────────────────────────────────────────

export async function getAssignmentDetail(assignmentId: string) {
  const supabase = createSupabaseAdminClient();

  const { data: assignment } = await supabase
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
      rubric:rubrics (
        id,
        assignment_id,
        criteria:rubric_criteria (id, name, description, weight, max_score, rubric_id)
      )
    `)
    .eq("id", assignmentId)
    .single();

  if (!assignment) return null;

  // Fetch submissions for this assignment + their evaluations / peer reviews / similarity / user.
  const { data: submissionsRaw } = await supabase
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
      user:profiles (id, name, email)
    `)
    .eq("assignment_id", assignmentId);

  const submissions = (submissionsRaw ?? []) as any[];
  const submissionIds = submissions.map((s) => s.id);

  let evaluations: any[] = [];
  let peerReviews: any[] = [];
  let similarityReports: any[] = [];
  if (submissionIds.length) {
    const [eRes, pRes, sRes] = await Promise.all([
      supabase
        .from("evaluations")
        .select("*")
        .eq("is_peer", false)
        .in("submission_id", submissionIds),
      supabase
        .from("peer_reviews")
        .select("*")
        .in("submission_id", submissionIds),
      supabase
        .from("similarity_reports")
        .select("*")
        .in("submission_id", submissionIds),
    ]);
    evaluations = eRes.data ?? [];
    peerReviews = pRes.data ?? [];
    similarityReports = sRes.data ?? [];
  }

  const submissionsWithChildren = submissions.map((s) => {
    const subEvals = evaluations.filter(
      (e) => e.submission_id === s.id
    );
    const subPeerReviews = peerReviews.filter(
      (p) => p.submission_id === s.id
    );
    const subReports = similarityReports.filter(
      (r) => r.submission_id === s.id
    );
    return camelize({
      ...s,
      evaluations: subEvals,
      peerReviews: subPeerReviews,
      similarityReports: subReports,
    });
  });

  return camelize({
    ...assignment,
    submissions: submissionsWithChildren,
  });
}

export async function getStudentAssignmentList(userId: string) {
  const supabase = createSupabaseAdminClient();

  // Enrollments for this student + their courses' assignments.
  const { data: enrollmentsRaw } = await supabase
    .from("enrollments")
    .select(`
      id,
      user_id,
      course_id,
      course:courses (
        id,
        code,
        name,
        description,
        semester,
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
    .eq("user_id", userId);

  type EnrollmentRow = {
    id: string;
    user_id: string;
    course_id: string;
    course: {
      id: string;
      code: string;
      name: string;
      description: string | null;
      semester: string;
      assignments: any[];
    } | null;
  };

  const enrollments = (enrollmentsRaw ?? []) as unknown as EnrollmentRow[];

  const result: any[] = [];
  for (const e of enrollments) {
    if (!e.course) continue;
    for (const a of e.course.assignments) {
      // Check for existing submission by this student for this assignment.
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
          similarityReports:similarity_reports (id, submission_id, similarity, auto_score, feedback_text, provider),
          feedback:feedback (id, text, created_at, author_id, recipient_id, source, submission_id)
        `)
        .eq("assignment_id", a.id)
        .eq("user_id", userId)
        .maybeSingle();

      const scores = submission ? await computeFinalScore(submission.id) : null;
      result.push({
        ...camelize(a),
        courseCode: e.course.code,
        courseName: e.course.name,
        submission: submission ? { ...camelize(submission), scores } : null,
      });
    }
  }
  return result;
}
