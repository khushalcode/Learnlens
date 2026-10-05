// Centralized Prisma queries + AI simulation logic
import { db } from "@/lib/db";
import { createHash } from "crypto";
import { totalStorageStats } from "@/lib/storage";

// ─────────────────────────────────────────────────────────
// AI SIMULATION (rule-based, no real ML)
// ─────────────────────────────────────────────────────────

/**
 * Deterministic pseudo-random based on string seed.
 * Returns 0-1. Same input → same output.
 */
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
 * Compute similarity % between a submission and the rest of the class.
 * Mock logic: deterministic, seeded by submission ID.
 */
export function computeSimilarity(submissionId: string): number {
  // Returns 12-78% — high enough to feel realistic, never 100% (which would mean plagiarism)
  return parseFloat((12 + seeded(submissionId + "-sim", 66)).toFixed(1));
}

/**
 * Compute auto-score suggestion based on rubric criteria weighted average.
 * This mirrors how faculty score would aggregate, but with ±5% noise to feel "AI".
 */
export function computeAutoScore(
  criteriaScores: { score: number; max: number; weight: number }[]
): number {
  if (criteriaScores.length === 0) return 0;
  const weighted = criteriaScores.reduce(
    (acc, cs) => acc + (cs.score / cs.max) * cs.weight,
    0
  );
  // Add small noise so AI suggestion differs slightly from actual faculty score
  const noise = (seeded(JSON.stringify(criteriaScores), 1) - 0.5) * 6;
  return Math.max(0, Math.min(100, parseFloat((weighted * 100 + noise).toFixed(1))));
}

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
  const [facultyEvals, peerReviews, criteria] = await Promise.all([
    db.evaluation.findMany({
      where: { submissionId, isPeer: false },
      include: { criterion: true },
    }),
    db.peerReview.findMany({
      where: { submissionId },
      include: { criterion: true },
    }),
    db.rubricCriterion.findMany({
      where: { rubric: { assignmentId: (await db.submission.findUnique({ where: { id: submissionId } }))?.assignmentId } },
    }),
  ]);

  if (!criteria.length) {
    return { facultyScore: null, peerScore: null, finalScore: null, criteriaBreakdown: [] };
  }

  const facultyByCrit: Record<string, number[]> = {};
  const peerByCrit: Record<string, number[]> = {};
  for (const e of facultyEvals) {
    if (!facultyByCrit[e.criterionId]) facultyByCrit[e.criterionId] = [];
    facultyByCrit[e.criterionId].push(e.score);
  }
  for (const p of peerReviews) {
    if (!peerByCrit[p.criterionId]) peerByCrit[p.criterionId] = [];
    peerByCrit[p.criterionId].push(p.score);
  }

  let facultyTotal = 0;
  let peerTotal = 0;
  let finalTotal = 0;
  const breakdown = criteria.map((c) => {
    const facAvg = facultyByCrit[c.id]?.length ? facultyByCrit[c.id].reduce((a, b) => a + b, 0) / facultyByCrit[c.id].length : null;
    const peerAvg = peerByCrit[c.id]?.length ? peerByCrit[c.id].reduce((a, b) => a + b, 0) / peerByCrit[c.id].length : null;
    const facPct = facAvg !== null ? (facAvg / c.maxScore) * 100 : null;
    const peerPct = peerAvg !== null ? (peerAvg / c.maxScore) * 100 : null;
    const critFinal = facPct !== null && peerPct !== null ? facPct * 0.7 + peerPct * 0.3 : (facPct ?? peerPct);
    if (facPct !== null) facultyTotal += facPct * c.weight;
    if (peerPct !== null) peerTotal += peerPct * c.weight;
    if (critFinal !== null) finalTotal += critFinal * c.weight;
    return {
      name: c.name,
      facultyScore: facPct ? parseFloat(facPct.toFixed(1)) : null,
      peerScore: peerPct ? parseFloat(peerPct.toFixed(1)) : null,
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
  // Get the user record directly
  const userRecord = await db.user.findUnique({ where: { id: userId } });
  if (!userRecord) {
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

  // Get student's submissions with assignment + scores
  const submissions = await db.submission.findMany({
    where: { userId },
    include: {
      assignment: { include: { competency: true, course: true } },
      evaluations: { include: { criterion: true } },
      peerReviews: { include: { criterion: true } },
      similarityReports: true,
      feedback: { include: { author: true } },
    },
    orderBy: { submittedAt: "asc" },
  });

  if (!submissions.length) {
    return {
      student: { id: userId, name: userRecord.name, email: userRecord.email },
      learningCurve: [],
      classAverage: [],
      competencies: [],
      recentFeedback: [],
      aiReports: [],
      submissionsCount: 0,
      avgScore: 0,
    };
  }

  // Compute final scores for each submission
  const submissionsWithScores = await Promise.all(
    submissions.map(async (s) => {
      const scores = await computeFinalScore(s.id);
      return {
        ...s,
        scores,
      };
    })
  );

  // Learning curve: score per assignment over time
  const learningCurve = submissionsWithScores
    .filter((s) => s.scores.finalScore !== null)
    .map((s) => ({
      assignmentTitle: s.assignment.title,
      assignmentId: s.assignment.id,
      score: s.scores.finalScore!,
      submittedAt: s.submittedAt,
      competencyCode: s.assignment.competency?.code ?? null,
    }));

  // Class average for comparison
  const courseIds = [...new Set(submissions.map((s) => s.assignment.courseId))];
  const allCourseSubmissions = await db.submission.findMany({
    where: { assignment: { courseId: { in: courseIds } } },
    include: { assignment: true },
  });
  const classAvgByAssignment: Record<string, number[]> = {};
  for (const s of allCourseSubmissions) {
    const scores = await computeFinalScore(s.id);
    if (scores.finalScore !== null) {
      if (!classAvgByAssignment[s.assignmentId]) classAvgByAssignment[s.assignmentId] = [];
      classAvgByAssignment[s.assignmentId].push(scores.finalScore);
    }
  }
  const classAverage = Object.entries(classAvgByAssignment).map(([aid, scores]) => ({
    assignmentId: aid,
    assignmentTitle: submissionsWithScores.find((s) => s.assignment.id === aid)?.assignment.title ?? aid,
    avgScore: parseFloat((scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1)),
  }));

  // Weak competencies: averaged score per competency code < 60
  const compScores: Record<string, number[]> = {};
  for (const s of submissionsWithScores) {
    if (s.scores.finalScore !== null && s.assignment.competency?.code) {
      if (!compScores[s.assignment.competency.code]) compScores[s.assignment.competency.code] = [];
      compScores[s.assignment.competency.code].push(s.scores.finalScore);
    }
  }
  const competencies = Object.entries(compScores).map(([code, scores]) => ({
    code,
    avgScore: parseFloat((scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1)),
    count: scores.length,
    weak: scores.reduce((a, b) => a + b, 0) / scores.length < 60,
  }));

  // Recent feedback
  const recentFeedback = submissionsWithScores
    .flatMap((s) => s.feedback.map((f) => ({ ...f, assignmentTitle: s.assignment.title })))
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, 5);

  // Recent AI similarity reports
  const aiReports = submissionsWithScores
    .map((s) => ({
      assignmentTitle: s.assignment.title,
      similarity: s.similarityReports[0]?.similarity ?? null,
      autoScore: s.similarityReports[0]?.autoScore ?? null,
      feedbackText: s.similarityReports[0]?.feedbackText ?? null,
    }))
    .filter((r) => r.similarity !== null);

  return {
    student: { id: userId, name: userRecord.name, email: userRecord.email },
    learningCurve,
    classAverage,
    competencies,
    recentFeedback,
    aiReports,
    submissionsCount: submissions.length,
    avgScore: learningCurve.length
      ? parseFloat((learningCurve.reduce((a, b) => a + b.score, 0) / learningCurve.length).toFixed(1))
      : 0,
  };
}

export async function getFacultyDashboard(userId: string) {
  const courses = await db.course.findMany({
    where: { facultyId: userId },
    include: {
      assignments: {
        include: {
          rubric: { include: { criteria: true } },
          competency: true,
          submissions: true,
        },
        orderBy: { createdAt: "asc" },
      },
      enrollments: true,
    },
  });

  // Pending evaluations (submissions without faculty evals)
  const assignmentsWithStats = await Promise.all(
    courses.flatMap((c) =>
      c.assignments.map(async (a) => {
        const submissions = await db.submission.findMany({
          where: { assignmentId: a.id },
          include: { evaluations: { where: { isPeer: false } } },
        });
        const evaluated = submissions.filter((s) => s.evaluations.length > 0).length;
        return {
          ...a,
          totalSubmissions: submissions.length,
          evaluated,
          pending: submissions.length - evaluated,
        };
      })
    )
  );

  return {
    faculty: { id: userId },
    courses: courses.map((c) => ({
      ...c,
      assignmentCount: c.assignments.length,
      studentCount: c.enrollments.length,
      assignments: assignmentsWithStats.filter((a) => a.courseId === c.id),
    })),
  };
}

export async function getMentorDashboard(userId: string) {
  const mentees = await db.user.findMany({
    where: { mentorId: userId },
    include: {
      submissions: {
        include: { assignment: true },
        orderBy: { submittedAt: "asc" },
      },
    },
  });

  const menteesWithScores = await Promise.all(
    mentees.map(async (m) => {
      const scores = await Promise.all(
        m.submissions.map(async (s) => {
          const sc = await computeFinalScore(s.id);
          return {
            assignmentTitle: s.assignment.title,
            assignmentId: s.assignment.id,
            submittedAt: s.submittedAt,
            score: sc.finalScore,
          };
        })
      );
      const validScores = scores.filter((s) => s.score !== null) as {
        assignmentTitle: string;
        assignmentId: string;
        submittedAt: Date;
        score: number;
      }[];

      // At-risk: last 2 scores both dropped
      let atRisk = false;
      let trend: "up" | "down" | "stable" | "insufficient" = "insufficient";
      if (validScores.length >= 2) {
        const last = validScores[validScores.length - 1].score;
        const prev = validScores[validScores.length - 2].score;
        if (last < prev) {
          trend = "down";
          // Check if the previous score also dropped (i.e., 2 consecutive drops)
          if (validScores.length >= 3) {
            const prevPrev = validScores[validScores.length - 3].score;
            if (prev < prevPrev) atRisk = true;
          }
          // If only 2 scores and both low, still flag
          if (validScores.length === 2 && last < 60) atRisk = true;
        } else if (last > prev) {
          trend = "up";
        } else {
          trend = "stable";
        }
      }

      return {
        id: m.id,
        name: m.name,
        email: m.email,
        scores: validScores,
        avgScore: validScores.length
          ? parseFloat((validScores.reduce((a, b) => a + b.score, 0) / validScores.length).toFixed(1))
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
  const courses = await db.course.findMany({
    where: { coordinatorId: userId },
    include: {
      enrollments: { include: { user: { include: { submissions: true } } } },
      assignments: { include: { competency: true } },
      competencies: true,
    },
  });

  // For each course, compute batch stats
  const courseStats = await Promise.all(
    courses.map(async (c) => {
      const allSubmissions = await db.submission.findMany({
        where: { assignment: { courseId: c.id } },
        include: { assignment: true, user: true },
      });
      const scoresByStudent: Record<string, number[]> = {};
      const scoresByAssignment: Record<string, { title: string; scores: number[] }> = {};
      for (const s of allSubmissions) {
        const sc = await computeFinalScore(s.id);
        if (sc.finalScore !== null) {
          if (!scoresByStudent[s.userId]) scoresByStudent[s.userId] = [];
          scoresByStudent[s.userId].push(sc.finalScore);
          if (!scoresByAssignment[s.assignmentId]) {
            scoresByAssignment[s.assignmentId] = { title: s.assignment.title, scores: [] };
          }
          scoresByAssignment[s.assignmentId].scores.push(sc.finalScore);
        }
      }

      // Per-student avg
      const ranking = Object.entries(scoresByStudent)
        .map(([sid, scores]) => {
          const sub = allSubmissions.find((s) => s.userId === sid);
          return {
            studentId: sid,
            name: sub?.user.name ?? "Unknown",
            email: sub?.user.email ?? "",
            avgScore: parseFloat((scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1)),
            assignmentCount: scores.length,
          };
        })
        .sort((a, b) => b.avgScore - a.avgScore);

      // CO-PO attainment: avg score per competency
      const coPoAttainment = await Promise.all(
        c.competencies.map(async (comp) => {
          const compAssignments = c.assignments.filter((a) => a.competencyId === comp.id);
          let allScores: number[] = [];
          for (const a of compAssignments) {
            const sub = await db.submission.findMany({ where: { assignmentId: a.id } });
            for (const s of sub) {
              const sc = await computeFinalScore(s.id);
              if (sc.finalScore !== null) allScores.push(sc.finalScore);
            }
          }
          const avg = allScores.length
            ? allScores.reduce((a, b) => a + b, 0) / allScores.length
            : 0;
          return {
            code: comp.code,
            name: comp.name,
            type: comp.type,
            avgAttainment: parseFloat(avg.toFixed(1)),
            target: comp.targetLevel ?? 75,
            status: avg >= (comp.targetLevel ?? 75) ? "achieved" : avg >= (comp.targetLevel ?? 75) * 0.8 ? "at-risk" : "below",
          };
        })
      );

      // Trend chart: avg score per assignment over time
      const trend = Object.values(scoresByAssignment).map((a) => ({
        title: a.title,
        avgScore: parseFloat((a.scores.reduce((x, y) => x + y, 0) / a.scores.length).toFixed(1)),
      }));

      return {
        course: { id: c.id, code: c.code, name: c.name },
        studentCount: c.enrollments.length,
        batchAverage: ranking.length
          ? parseFloat((ranking.reduce((a, b) => a + b.avgScore, 0) / ranking.length).toFixed(1))
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
  const [users, courses, assignments, submissions, evaluations, feedback, storageStats, notifications] = await Promise.all([
    db.user.count(),
    db.course.count(),
    db.assignment.count(),
    db.submission.count(),
    db.evaluation.count(),
    db.feedback.count(),
    totalStorageStats().catch(() => ({ count: 0, size: 0, perBucket: {} })),
    db.notification.count(),
  ]);

  const usersByRole = await db.user.groupBy({ by: ["role"], _count: true });

  return {
    totals: { users, courses, assignments, submissions, evaluations, feedback, notifications },
    usersByRole: usersByRole.map((u) => ({ role: u.role, count: u._count })),
    storage: {
      fileCount: storageStats.count,
      sizeBytes: storageStats.size,
      sizeMB: parseFloat((storageStats.size / (1024 * 1024)).toFixed(2)),
      perBucket: storageStats.perBucket,
    },
  };
}

// ─────────────────────────────────────────────────────────
// DETAIL QUERIES
// ─────────────────────────────────────────────────────────

export async function getAssignmentDetail(assignmentId: string) {
  return db.assignment.findUnique({
    where: { id: assignmentId },
    include: {
      course: true,
      rubric: { include: { criteria: true } },
      competency: true,
      submissions: {
        include: {
          user: true,
          evaluations: { where: { isPeer: false } },
          peerReviews: true,
          similarityReports: true,
        },
      },
    },
  });
}

export async function getStudentAssignmentList(userId: string) {
  const enrollments = await db.enrollment.findMany({
    where: { userId },
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

  // For each assignment, check if student has a submission
  const result = [];
  for (const e of enrollments) {
    for (const a of e.course.assignments) {
      const submission = await db.submission.findFirst({
        where: { assignmentId: a.id, userId },
        include: { similarityReports: true, feedback: true },
      });
      const scores = submission ? await computeFinalScore(submission.id) : null;
      result.push({
        ...a,
        courseCode: e.course.code,
        courseName: e.course.name,
        submission: submission
          ? { ...submission, scores }
          : null,
      });
    }
  }
  return result;
}
