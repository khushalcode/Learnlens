/**
 * LearnLens seed script
 * Creates: 1 admin, 1 faculty+coordinator, 1 mentor, 30 students
 *          1 course, 6 competencies (CO1-3, PO1-3)
 *          5 assignments with rubrics (3 weighted criteria each)
 *          150 submissions (30 students × 5 assignments)
 *          evaluations (faculty + 1 peer per submission)
 *          similarity reports with mock AI feedback
 *          faculty feedback text
 *
 * Run: bun run scripts/seed.ts
 */
import { PrismaClient } from "@prisma/client";
import { createHash } from "crypto";

const prisma = new PrismaClient();

// Deterministic pseudo-random based on string seed
function seeded(seed: string, max = 1): number {
  const h = createHash("md5").update(seed).digest().readUInt32LE(0);
  return (h / 0xffffffff) * max;
}

function pick<T>(arr: T[], seed: string): T {
  return arr[Math.floor(seeded(seed, arr.length))];
}

const assignmentTypes = ["TEXT", "IMAGE", "AUDIO", "VIDEO"] as const;
const studentNames = [
  "Aarav Sharma", "Vivaan Patel", "Aditya Kumar", "Diya Singh", "Ananya Iyer",
  "Aryan Gupta", "Ishaan Reddy", "Saanvi Nair", "Arjun Menon", "Myra Joshi",
  "Kabir Bose", "Anika Rao", "Reyansh Das", "Aadya Pillai", "Vihaan Mehta",
  "Navya Agarwal", "Atharv Khanna", "Riya Malhotra", "Dhruv Saxena", "Sara Khan",
  "Ira Verma", "Veer Chauhan", "Mira Kapoor", "Reyansh Jain", "Anaya Bhat",
  "Arnav Mishra", "Pari Thakur", "Shaurya Rana", "Trisha Banerjee", "Rudra Pandey",
];

const assignmentSpecs = [
  { title: "Assignment 1: Requirements Elicitation Report", type: "TEXT", daysAgo: 35, deadlineDays: 5 },
  { title: "Assignment 2: Use Case Diagram Submission", type: "IMAGE", daysAgo: 28, deadlineDays: 7 },
  { title: "Assignment 3: Class Diagram Walkthrough (Audio)", type: "AUDIO", daysAgo: 21, deadlineDays: 7 },
  { title: "Assignment 4: Sequence Diagram Demo Video", type: "VIDEO", daysAgo: 14, deadlineDays: 7 },
  { title: "Assignment 5: Final SRS Document", type: "TEXT", daysAgo: 5, deadlineDays: 10 },
];

const rubricSpecs = [
  { name: "Correctness", description: "Technical accuracy of the submission", weight: 0.4, maxScore: 10 },
  { name: "Completeness", description: "Coverage of all required elements", weight: 0.3, maxScore: 10 },
  { name: "Clarity", description: "Readability and presentation quality", weight: 0.3, maxScore: 10 },
];

const competencySpecs = [
  { code: "CO1", name: "Apply OOAD principles to real-world systems", type: "CO" },
  { code: "CO2", name: "Construct UML diagrams for software design", type: "CO" },
  { code: "CO3", name: "Map requirements to design patterns", type: "CO" },
  { code: "PO1", name: "Engineering Knowledge", type: "PO" },
  { code: "PO2", name: "Problem Analysis", type: "PO" },
  { code: "PO3", name: "Design/Development of Solutions", type: "PO" },
];

const feedbackTemplates = {
  excellent: [
    "Outstanding work! Your submission demonstrates deep understanding of {topic}. The {criterion} aspect is particularly strong.",
    "Excellent submission. Clear mastery of {topic} — keep up this standard.",
    "Top-tier work. You've set a high bar for the class on {topic}.",
  ],
  good: [
    "Solid submission. You understand {topic} well — minor refinements on {criterion} would elevate this further.",
    "Good effort on {topic}. Consider revisiting the {criterion} to push toward excellence.",
    "Competent work. The {criterion} could use more depth, but overall a strong showing.",
  ],
  average: [
    "Acceptable submission, but {criterion} needs work. Review the {topic} material again.",
    "Meets minimum expectations. Spend more time on {criterion} for the next assignment.",
    "Average work — adequate but not impressive. Focus on {criterion} going forward.",
  ],
  needsWork: [
    "Below expectations. The {criterion} is significantly weak. Please attend office hours for {topic}.",
    "This needs major revision. The {criterion} is incomplete. Reach out for support on {topic}.",
    "Concerning submission — please review {topic} fundamentals and resubmit if allowed.",
  ],
};

function getFeedback(score: number, seed: string, criterion: string, topic: string): string {
  let bucket: keyof typeof feedbackTemplates;
  if (score >= 8.5) bucket = "excellent";
  else if (score >= 7) bucket = "good";
  else if (score >= 5) bucket = "average";
  else bucket = "needsWork";
  return pick(feedbackTemplates[bucket], seed)
    .replace("{criterion}", criterion.toLowerCase())
    .replace("{topic}", topic.toLowerCase());
}

async function main() {
  console.log("🗑️  Resetting database...");
  await prisma.$transaction([
    prisma.feedback.deleteMany(),
    prisma.similarityReport.deleteMany(),
    prisma.peerReview.deleteMany(),
    prisma.evaluation.deleteMany(),
    prisma.similarityReport.deleteMany(),
    prisma.submission.deleteMany(),
    prisma.rubricCriterion.deleteMany(),
    prisma.rubric.deleteMany(),
    prisma.assignment.deleteMany(),
    prisma.competency.deleteMany(),
    prisma.enrollment.deleteMany(),
    prisma.course.deleteMany(),
    prisma.user.deleteMany(),
  ]);

  // ─── USERS ────────────────────────────────────────────────
  console.log("👤 Creating users...");
  const admin = await prisma.user.create({
    data: {
      email: "admin@learnlens.edu",
      name: "System Administrator",
      password: "demo1234",
      role: "ADMIN",
    },
  });

  const faculty = await prisma.user.create({
    data: {
      email: "faculty@learnlens.edu",
      name: "Dr. Rajesh Krishnan",
      password: "demo1234",
      role: "FACULTY",
    },
  });

  const coordinator = await prisma.user.create({
    data: {
      email: "coordinator@learnlens.edu",
      name: "Prof. Meera Subramaniam",
      password: "demo1234",
      role: "COORDINATOR",
    },
  });

  const mentor = await prisma.user.create({
    data: {
      email: "mentor@learnlens.edu",
      name: "Dr. Vikram Anand",
      password: "demo1234",
      role: "MENTOR",
    },
  });

  // 30 students — performance tiered so we get a realistic curve + at-risk cases
  const students = [];
  for (let i = 0; i < 30; i++) {
    const name = studentNames[i];
    const email = `student${String(i + 1).padStart(2, "0")}@learnlens.edu`;
    // Performance tier: 0-4 = high, 5-24 = mid, 25-29 = low
    let baseLevel: number;
    if (i < 5) baseLevel = 88 + (i % 3); // 88-90
    else if (i < 25) baseLevel = 65 + ((i - 5) % 15); // 65-79
    else baseLevel = 45 + ((i - 25) % 10); // 45-54
    // At-risk flag for some students (drop in last 2 assignments)
    const isAtRisk = [9, 14, 22, 28].includes(i);
    const students_obj = await prisma.user.create({
      data: {
        email,
        name,
        password: "demo1234",
        role: "STUDENT",
        mentorId: mentor.id,
        // Store performance hint as part of name suffix — no, can't. Use a separate convention.
      },
    });
    students.push({ ...students_obj, _baseLevel: baseLevel, _isAtRisk: isAtRisk });
  }

  // ─── COURSE ───────────────────────────────────────────────
  console.log("📚 Creating course...");
  const course = await prisma.course.create({
    data: {
      code: "CSE301",
      name: "Object-Oriented Analysis & Design Lab",
      description: "Capstone lab covering SRS, UML, design patterns, and prototype development.",
      semester: "2026-1",
      facultyId: faculty.id,
      coordinatorId: coordinator.id,
    },
  });

  // Enroll all 30 students
  await prisma.enrollment.createMany({
    data: students.map((s) => ({ userId: s.id, courseId: course.id })),
  });

  // ─── COMPETENCIES ─────────────────────────────────────────
  console.log("🎯 Creating competencies (CO/PO)...");
  const competencies = [];
  for (const c of competencySpecs) {
    const comp = await prisma.competency.create({
      data: { ...c, courseId: course.id, targetLevel: 75.0 },
    });
    competencies.push(comp);
  }

  // ─── ASSIGNMENTS + RUBRICS ────────────────────────────────
  console.log("📝 Creating assignments with rubrics...");
  const assignments = [];
  for (let i = 0; i < assignmentSpecs.length; i++) {
    const spec = assignmentSpecs[i];
    const deadline = new Date(Date.now() - spec.daysAgo * 86400000 + spec.deadlineDays * 86400000);
    const assignment = await prisma.assignment.create({
      data: {
        title: spec.title,
        description: `Submit your ${spec.title.toLowerCase()} as a ${spec.type.toLowerCase()} file. Follow the rubric carefully.`,
        type: spec.type,
        deadline,
        courseId: course.id,
        // Link to a rotating competency
        competencyId: competencies[i % competencies.length].id,
      },
    });
    const rubric = await prisma.rubric.create({
      data: { assignmentId: assignment.id },
    });
    for (const rc of rubricSpecs) {
      await prisma.rubricCriterion.create({
        data: { ...rc, rubricId: rubric.id },
      });
    }
    assignments.push({ ...assignment, _spec: spec });
  }

  // ─── SUBMISSIONS + EVALUATIONS + PEER + SIMILARITY ────────
  console.log("📤 Creating 150 submissions + evaluations + AI reports...");
  let progress = 0;
  for (const student of students) {
    for (let ai = 0; ai < assignments.length; ai++) {
      const assignment = assignments[ai];
      progress++;
      if (progress % 30 === 0) console.log(`   ...${progress}/150`);

      // Score logic: base level ± variation, with progressive decline if at-risk
      let variationFactor = 1.0;
      if (student._isAtRisk && ai >= 3) {
        // Drop in last 2 assignments
        variationFactor = ai === 3 ? 0.75 : 0.6;
      }
      const noise = (seeded(`${student.id}-${ai}`, 1.0) - 0.5) * 8; // ±4
      const studentScore = Math.max(20, Math.min(98, student._baseLevel * variationFactor + noise));

      // Build submission content
      let content: string | null = null;
      let fileUrl: string | null = null;
      let fileName: string | null = null;
      if (assignment.type === "TEXT") {
        content = `Submission by ${student.name} for ${assignment.title}. ` +
          `This document covers the required analysis with detailed breakdown. ` +
          `Word count: ~${Math.floor(800 + seeded(student.id + ai, 1) * 400)}.`;
      } else {
        fileName = `${student.name.replace(/\s+/g, "_")}_${ai + 1}.${assignment.type.toLowerCase()}`;
        fileUrl = `/uploads/${fileName}`;
      }

      const submittedAt = new Date(assignment.deadline.getTime() - 86400000 * (1 + ai * 0.5));

      const submission = await prisma.submission.create({
        data: {
          assignmentId: assignment.id,
          userId: student.id,
          content,
          fileUrl,
          fileName,
          fileType: assignment.type === "IMAGE" ? "image/png"
            : assignment.type === "AUDIO" ? "audio/mpeg"
            : assignment.type === "VIDEO" ? "video/mp4"
            : null,
          status: "EVALUATED",
          submittedAt,
        },
      });

      // Faculty evaluations: 1 per criterion, score based on studentScore scaled to max
      const rubricCriteria = await prisma.rubricCriterion.findMany({
        where: { rubric: { assignmentId: assignment.id } },
      });
      const criterionScores: { id: string; score: number; max: number; weight: number }[] = [];
      for (const rc of rubricCriteria) {
        const critNoise = (seeded(`${student.id}-${ai}-${rc.id}`, 1.0) - 0.5) * 3;
        const critScorePct = studentScore / 100; // 0-1
        const critScore = Math.max(0, Math.min(rc.maxScore, rc.maxScore * critScorePct + critNoise));
        await prisma.evaluation.create({
          data: {
            submissionId: submission.id,
            evaluatorId: faculty.id,
            criterionId: rc.id,
            score: parseFloat(critScore.toFixed(2)),
            isPeer: false,
            comment: getFeedback(critScore, `${student.id}-${rc.id}`, rc.name, assignment.title),
          },
        });
        criterionScores.push({ id: rc.id, score: critScore, max: rc.maxScore, weight: rc.weight });
      }

      // Peer review: another student reviews this submission, 1 score per criterion
      // Pick a peer reviewer who isn't the submitter
      const peerReviewerIdx = (students.indexOf(student) + 7) % students.length;
      const peerReviewer = students[peerReviewerIdx];
      for (const rc of rubricCriteria) {
        const peerNoise = (seeded(`peer-${student.id}-${ai}-${rc.id}`, 1.0) - 0.5) * 4;
        const peerScore = Math.max(0, Math.min(rc.maxScore, criterionScores.find((cs) => cs.id === rc.id)!.score + peerNoise));
        await prisma.peerReview.create({
          data: {
            submissionId: submission.id,
            reviewerId: peerReviewer.id,
            criterionId: rc.id,
            score: parseFloat(peerScore.toFixed(2)),
            comment: Math.random() > 0.5 ? "Reviewed by peer." : null,
          },
        });
      }

      // AI similarity + auto-score + feedback (rule-based)
      const similarity = parseFloat((20 + seeded(`${student.id}-${ai}-sim`, 60)).toFixed(1));
      // Auto-score = faculty-weighted avg ± noise
      const weightedAvg = criterionScores.reduce((acc, cs) => acc + (cs.score / cs.max) * cs.weight, 0) * 100;
      const autoScore = parseFloat(weightedAvg.toFixed(1));

      await prisma.similarityReport.create({
        data: {
          submissionId: submission.id,
          similarity,
          autoScore,
          feedbackText: getFeedback(autoScore, `${student.id}-ai-${ai}`, "overall submission", assignment.title),
        },
      });

      // Faculty feedback (one per submission)
      await prisma.feedback.create({
        data: {
          submissionId: submission.id,
          authorId: faculty.id,
          recipientId: student.id,
          text: getFeedback(studentScore, `fb-${student.id}-${ai}`, "submission", assignment.title),
          source: "FACULTY",
        },
      });
    }
  }

  console.log("\n✅ Seed complete!");
  console.log("\n📋 Login credentials:");
  console.log("   Admin:        admin@learnlens.edu / demo1234");
  console.log("   Faculty:      faculty@learnlens.edu / demo1234");
  console.log("   Coordinator:  coordinator@learnlens.edu / demo1234");
  console.log("   Mentor:       mentor@learnlens.edu / demo1234");
  console.log("   Student 1:    student01@learnlens.edu / demo1234");
  console.log("   Student 30:   student30@learnlens.edu / demo1234");
}

main()
  .catch((e) => {
    console.error("❌ Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
