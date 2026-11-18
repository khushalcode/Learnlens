
# Multimodel Student Assignment and Learning Analysis System

LearnLens is a multimodal assignment analysis and learning analytics platform. It turns every student submission into actionable learning analytics, with multimodal AI analysis, rubric evaluation, peer review, and role-based dashboards for students, faculty, mentors, coordinators and admins.

Live demo: https://learnlens-three.vercel.app/

---

## 1. Overview

LearnLens reads text, code, diagrams, audio and video submissions and converts them into three things:

- Rubric-aligned feedback
- Integrity signals (similarity and originality checks)
- Cohort-level learning analytics

It covers the whole learning loop: assignment authoring, submission, AI-assisted evaluation, moderated peer review, mentoring, and program-level insight. Every stage is connected, permissioned and measurable.

---

## 2. Core Platform Features

### 2.1 Multimodal Submission Analysis
Students can submit work in many formats, and LearnLens analyses all of them in one system:

- Essays and written text
- Code, notebooks and repositories
- Lab diagrams and images
- Presentation decks
- Voice reflections and audio
- Video

All of it is parsed into a shared evidence model, so feedback stays consistent regardless of format. The platform shows a live modality coverage breakdown (for example: written text 48%, code/notebooks 22%, diagrams and media 30%).

### 2.2 Explainable AI Scoring
Scores are never a black box.

- Every score links back to a specific rubric criterion
- Supporting evidence is highlighted in the submission
- Confidence bands are shown (for example ±2.1)
- Faculty can override any AI-suggested score
- A criterion trace is attached to each evaluation

### 2.3 Rubric Evaluation
- Rubric builder with outcome and weight mapping
- Criterion-level scoring (for example 92/100 rubric alignment)
- Modality rules per assignment
- Versioned evaluations (AI draft, then faculty-reviewed final)

### 2.4 Integrity and Similarity Detection
- Similarity and originality scoring (for example 2% match)
- Similarity risk shown per submission
- Flags for faculty review, with review history

### 2.5 Peer Review (Moderated)
- Blind double-review
- Reviewer calibration
- Appeal workflow
- Bias flags
- Structured, moderated rubrics with guided prompts for students
- Peer average ratings (for example 4.6/5)

### 2.6 AI-Drafted Feedback
- Tone-controlled comments
- Mapped to strengths, gaps and next-step resources
- Insight messages per submission (for example, flagging an under-labelled diagram before final grading)

### 2.7 Notifications
- Alerts for submissions, feedback, reviews and at-risk signals
- Progress digest emails to students and guardians (mentor tooling)

---

## 3. Role-Based Workspaces

Permissions, navigation and metrics adapt instantly per role. This is driven by Supabase auth claims and row-level security policies, not client-side checks.

### 3.1 Student Workspace: "See progress, not just marks"
- Personal mastery radar across rubric criteria (outcomes O1 to O5)
- Comparison against the cohort
- Actionable feedback with linked evidence and resources
- Peer review tasks with guided rubric prompts
- Personal targets and growth over time
- Term GPA and feedback-read tracking

### 3.2 Faculty Workspace: "Author, assign, evaluate faster"
- Build assignments with rubrics and modality rules
- Publish to sections
- Batch grading queue with AI-suggested scores
- Auto-prepare evaluations for review before release
- Review AI evaluations before releasing marks and feedback
- Integrity and similarity flags with review history
- Turnaround tracking (for example 1.8 days)

### 3.3 Mentor Workspace: "Spot the learner who needs you"
- Early-warning list built from submission cadence, feedback engagement and mastery trend
- Risk levels per mentee (high, medium, low) with explainable contributing factors
- Guided conversation plan for each mentee
- Session notes and goal tracking
- Progress digest emails to students and guardians

### 3.4 Coordinator Workspace: "Program-level clarity, in real time"
- Compare sections
- Monitor outcome coverage for accreditation
- Catch moderation outliers before grades are finalised
- Outcome attainment and accreditation evidence exports
- Grading consistency and inter-rater reliability reports
- Workload and submission-volume distribution by instructor
- Metrics such as sections reporting, moderation completion, GPA change, pass rate and outliers

### 3.5 Admin Workspace: "Governance without the guesswork"
- Manage users, roles, departments and terms
- User provisioning, role assignment and bulk import
- Role and policy matrix (read, grade, export permissions per role)
- RLS policy inspector and anomaly alerts
- Immutable audit log with export controls
- Control over who can read, grade or export student data

---

## 4. Learning Analytics

Every chart drills down to the submissions behind it. Data can be filtered by section, outcome, modality or assessment type, and accreditation-ready evidence can be exported in one click.

- Feedback turnaround vs. mastery growth (rolling 12-week view across active sections)
- Mastery heatmaps
- Outcome coverage
- Outcome attainment (Knowledge, Application, Communication, Teamwork)
- At-risk learner detection (high risk, medium risk, recovered)
- Trend deltas per section
- Key metrics: average turnaround, mastery change, feedback open rate, resubmission count

---

## 5. Mock AI Engine

LearnLens ships with a deterministic mock AI service that mirrors the real model contract. Teams can build the entire product experience now and swap in production models later.

Capabilities:
- Embeddings
- Rubric scoring
- Similarity detection
- Sentiment analysis
- Skill tagging

Processing pipeline:
1. Ingest and normalise: chunking, OCR, code parsing and audio transcription into a unified evidence graph
2. Score against rubric: criterion-level scoring with confidence bands and highlighted supporting passages
3. Draft feedback: tone-controlled comments mapped to strengths, gaps and next steps
4. Signal and explain: similarity, sentiment, skill tags and risk indicators, each traceable to source

AI Analysis Sandbox: an in-browser demo that runs the mock analysis on a sample submission and shows rubric alignment, originality, sentiment and confidence, and detected skills. No student data leaves the browser.

---

## 6. Data Model (Supabase / PostgreSQL)

| Table        | Purpose                                              |
|--------------|------------------------------------------------------|
| profiles     | Users, roles, departments                            |
| assignments  | Rubrics, deadlines, sections                         |
| submissions  | Files, modality, timestamps (owner-scoped)           |
| evaluations  | Scores, feedback, versions (faculty and AI)          |
| peer_reviews | Blind pairs, appeals (moderated)                     |
| audit_log    | Actor, action, scope (append-only)                   |

Row-level security is enabled on all core tables. Example policy:

    create policy "students_read_own"
      on submissions for select
      using ( auth.uid() = student_id
        or has_role('faculty') );

---

## 7. Security and Governance

- Row-level security: students see only their own work, faculty see only their sections, coordinators see program scope, admins govern
- Every access event is logged
- Encrypted at rest and in transit: TLS 1.3, AES-256 storage, scoped signed URLs for every file access
- Full audit history: immutable, append-only log with retention policies and export controls
- FERPA and GDPR aligned: consent records, data export and right-to-erasure workflows
- SSO and directory sync: SAML/OIDC, SCIM provisioning, and role mapping from the student information system

---

## 8. Authentication and Access

- Sign in and create account flows
- Email authentication
- Role selection at signup: Student, Faculty, Mentor, Coordinator, Admin
- Remember me and forgot password
- Institution SSO option
- Guided workspace setup

---

## 9. Pricing Plans

| Plan        | Price                       | Includes                                                                                           |
|-------------|-----------------------------|----------------------------------------------------------------------------------------------------|
| Classroom   | Free                        | 1 course up to 40 students, assignment and rubric builder, mock AI analysis (200/month), student and faculty dashboards |
| Department  | $12 per educator per month  | Unlimited courses and sections, peer review and moderation, mentor and coordinator dashboards, at-risk detection and notifications, priority support and onboarding (14-day trial) |
| Institution | Custom                      | SSO/SAML, SCIM provisioning, admin governance and audit exports, accreditation reporting packs, dedicated success manager and SLA |

Monthly and yearly billing are available, with 20% off yearly.

---

## 10. Platform Highlights

- Submissions analysed across text, code, media and diagrams
- Significant reduction in time spent on first-pass grading and feedback drafting
- High rubric-alignment accuracy after faculty calibration
- Structured, moderated peer reviews at scale
- Built for universities, coding schools and K-12 districts

---

## 11. Implementation Roadmap

1. Access and onboarding: landing page, email auth, role selection, guided workspace setup
2. Data foundation: Supabase schema, migrations, storage buckets, role-scoped RLS policies
3. Teaching workflows: assignment authoring, submissions, evaluation, feedback, peer review
4. Intelligence layer: mock AI analysis, dashboards for students, mentors and coordinators
5. Polish and govern: notifications, admin controls, accessibility, theming, performance

---

## 12. Tech Stack

- React
- TypeScript
- Tailwind CSS
- Supabase (PostgreSQL, Auth, Storage, Row-Level Security)
- Deployed on Vercel

---

## 13. Notes

The current interface is a demonstration build. Sign-in is a demo flow, and no credentials are transmitted or stored. The AI engine uses deterministic mock output until production models are connected.
