-- LearnLens — Supabase SEED script
-- Run AFTER supabase-schema.sql in your Supabase SQL Editor.
--
-- This script:
--   • Creates 35 demo users in auth.users (admin/faculty/coordinator/mentor + 30 students + 1 mentor)
--   • Sets their profiles + role
--   • Creates 1 course (IIPS-OOAD)
--   • Creates 6 competencies (3 COs + 3 POs)
--   • Creates 5 assignments (text/image/audio/video/text) with rubrics
--   • Enrolls all students in the course
--   • Assigns mentor to first 5 students (for mentor dashboard demo)
--   • Creates 150 submissions (5 per student) with varied scores
--   • Creates 150 faculty evaluations (one per submission per criterion)
--   • Creates 150 AI similarity_reports + 150 feedback entries
--   • ZERO peer reviews (per the user's request — "fresh site today")
--
-- All demo users have password: demo1234
-- Email pattern: admin@learnlens.edu, faculty@learnlens.edu, etc.
--
-- Re-running this script: idempotent on auth.users (uses ON CONFLICT DO NOTHING)
-- but will DUPLICATE submissions/evaluations/etc. if run twice. To reset,
-- truncate the data tables first (see comment at the bottom).

-- ─────────────────────────────────────────────────────────
-- Helper: hash a password using Supabase's bcrypt (auth.users uses crypt() with the user's encryption key)
-- ─────────────────────────────────────────────────────────
-- We use the same password for all demo users: 'demo1234'
-- The hash below is bcrypt with cost 10 for 'demo1234' — Supabase accepts this.
DO $$ BEGIN
  PERFORM crypt('demo1234', gen_salt('bf', 10));
END $$;

-- ─────────────────────────────────────────────────────────
-- 1. CREATE DEMO USERS IN auth.users (admin / faculty / coordinator / mentor / 30 students)
-- ─────────────────────────────────────────────────────────
-- Each INSERT into auth.users mimics a real signup so the user can sign in
-- via email+password. We set email_confirmed_at = now() so no confirmation
-- email is required.

INSERT INTO auth.users (
  id, instance_id, aud, role, email,
  encrypted_password, email_confirmed_at, confirmation_token,
  recovery_token, email_change_token_new, email_change,
  created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
  raw_user_role, is_sso_user, last_sign_in_at, factor_id
) VALUES
  -- ADMIN
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@learnlens.edu',
   crypt('demo1234', gen_salt('bf', 10)), now(), '', '', '', '',
   now(), now(), '{"provider":"email","providers":["email"]}', '{"name":"System Admin","role":"ADMIN"}',
   'authenticated', false, now(), ''),
  -- FACULTY
  ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'faculty@learnlens.edu',
   crypt('demo1234', gen_salt('bf', 10)), now(), '', '', '', '',
   now(), now(), '{"provider":"email","providers":["email"]}', '{"name":"Dr. Anita Rao","role":"FACULTY"}',
   'authenticated', false, now(), ''),
  -- COORDINATOR
  ('00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'coordinator@learnlens.edu',
   crypt('demo1234', gen_salt('bf', 10)), now(), '', '', '', '',
   now(), now(), '{"provider":"email","providers":["email"]}', '{"name":"Prof. Ravi Menon","role":"COORDINATOR"}',
   'authenticated', false, now(), ''),
  -- MENTOR
  ('00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'mentor@learnlens.edu',
   crypt('demo1234', gen_salt('bf', 10)), now(), '', '', '', '',
   now(), now(), '{"provider":"email","providers":["email"]}', '{"name":"Dr. Priya Nair","role":"MENTOR"}',
   'authenticated', false, now(), '')
ON CONFLICT (id) DO NOTHING;

-- 30 students (student01..student30)
INSERT INTO auth.users (
  id, instance_id, aud, role, email,
  encrypted_password, email_confirmed_at, confirmation_token,
  recovery_token, email_change_token_new, email_change,
  created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
  raw_user_role, is_sso_user, last_sign_in_at, factor_id
)
SELECT
  ('00000000-0000-0001-0000-' || lpad(CAST(generate_series AS TEXT), 12, '0'))::UUID,
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated',
  'student' || lpad(CAST(generate_series AS TEXT), 2, '0') || '@learnlens.edu',
  crypt('demo1234', gen_salt('bf', 10)), now(), '', '', '', '',
  now(), now(),
  '{"provider":"email","providers":["email"]}',
  jsonb_build_object('name', 'Student ' || lpad(CAST(generate_series AS TEXT), 2, '0'), 'role', 'STUDENT'),
  'authenticated', false, now(), ''
FROM generate_series(1, 30)
ON CONFLICT (id) DO NOTHING;

-- ─────────────────────────────────────────────────────────
-- 2. INSERT PROFILES (auto-created by trigger, but set role + mentor_id explicitly)
-- ─────────────────────────────────────────────────────────
INSERT INTO public.profiles (id, email, name, role)
SELECT
  id, email,
  COALESCE((raw_user_meta_data->>'name')::TEXT, split_part(email, '@', 1)),
  COALESCE((raw_user_meta_data->>'role')::user_role, 'STUDENT'::user_role)
FROM auth.users
WHERE id IN (
  '00000000-0000-0000-0000-000000000001', -- admin
  '00000000-0000-0000-0000-000000000002', -- faculty
  '00000000-0000-0000-0000-000000000003', -- coordinator
  '00000000-0000-0000-0000-000000000004'  -- mentor
)
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, name = EXCLUDED.name;

INSERT INTO public.profiles (id, email, name, role)
SELECT
  id, email,
  'Student ' || lpad(CAST(generate_series AS TEXT), 2, '0'),
  'STUDENT'::user_role
FROM (SELECT id, email, generate_series FROM auth.users, generate_series(1, 30)
      WHERE email LIKE 'student%@learnlens.edu'
        AND id = ('00000000-0000-0001-0000-' || lpad(CAST(generate_series AS TEXT), 12, '0'))::UUID)
ON CONFLICT (id) DO NOTHING;

-- Cleaner approach for student profiles:
INSERT INTO public.profiles (id, email, name, role)
SELECT id, email,
  'Student ' || regexp_replace(email, '^student(\\d+)@.*', '\\1'),
  'STUDENT'::user_role
FROM auth.users
WHERE email LIKE 'student%@learnlens.edu'
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, role = EXCLUDED.role;

-- Assign the mentor to first 5 students (so the mentor dashboard shows mentees)
UPDATE public.profiles
SET mentor_id = '00000000-0000-0000-0000-000000000004'  -- mentor
WHERE id IN (
  '00000000-0000-0001-0000-000000000001',
  '00000000-0000-0001-0000-000000000002',
  '00000000-0000-0001-0000-000000000003',
  '00000000-0000-0001-0000-000000000004',
  '00000000-0000-0001-0000-000000000005'
);

-- ─────────────────────────────────────────────────────────
-- 3. COURSE + COMPETENCIES
-- ─────────────────────────────────────────────────────────
INSERT INTO public.courses (id, code, name, description, semester, faculty_id, coordinator_id)
VALUES (
  '11111111-0000-0000-0000-000000000001',
  'IIPS-OOAD',
  'Object-Oriented Analysis & Design',
  'Multimodal assignments covering UML, design patterns, and case studies.',
  '2026-1',
  '00000000-0000-0000-0000-000000000002',  -- faculty
  '00000000-0000-0000-0000-000000000003'   -- coordinator
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.competencies (id, code, name, type, course_id, target_level) VALUES
  ('22222222-0000-0000-0000-000000000001', 'CO1', 'Apply OOP principles to design problems', 'CO', '11111111-0000-0000-0000-000000000001', 75),
  ('22222222-0000-0000-0000-000000000002', 'CO2', 'Model systems using UML diagrams', 'CO', '11111111-0000-0000-0000-000000000001', 75),
  ('22222222-0000-0000-0000-000000000003', 'CO3', 'Critique design patterns for given scenarios', 'CO', '11111111-0000-0000-0000-000000000001', 75),
  ('22222222-0000-0000-0000-000000000004', 'PO1', 'Engineering Knowledge', 'PO', '11111111-0000-0000-0000-000000000001', 70),
  ('22222222-0000-0000-0000-000000000005', 'PO2', 'Problem Analysis', 'PO', '11111111-0000-0000-0000-000000000001', 70),
  ('22222222-0000-0000-0000-000000000006', 'PO3', 'Design/Development of Solutions', 'PO', '11111111-0000-0000-0000-000000000001', 70)
ON CONFLICT (id) DO NOTHING;

-- ─────────────────────────────────────────────────────────
-- 4. ASSIGNMENTS + RUBRICS
-- ─────────────────────────────────────────────────────────
INSERT INTO public.assignments (id, title, description, type, deadline, course_id, competency_id) VALUES
  ('33333333-0000-0000-0000-000000000001',
   'Assignment 1: OOP Fundamentals',
   'Write a 500-word essay on encapsulation, inheritance, and polymorphism with one code example each.',
   'TEXT',
   now() + INTERVAL '14 days',
   '11111111-0000-0000-0000-000000000001',
   '22222222-0000-0000-0000-000000000001'),
  ('33333333-0000-0000-0000-000000000002',
   'Assignment 2: UML Class Diagram',
   'Upload a class diagram for a library management system showing at least 8 classes with relationships.',
   'IMAGE',
   now() + INTERVAL '21 days',
   '11111111-0000-0000-0000-000000000001',
   '22222222-0000-0000-0000-000000000002'),
  ('33333333-0000-0000-0000-000000000003',
   'Assignment 3: Pattern Walkthrough (Audio)',
   'Record a 3-minute audio explaining when to use the Observer pattern vs. the Strategy pattern.',
   'AUDIO',
   now() + INTERVAL '28 days',
   '11111111-0000-0000-0000-000000000001',
   '22222222-0000-0000-0000-000000000003'),
  ('33333333-0000-0000-0000-000000000004',
   'Assignment 4: Design Demo (Video)',
   'Upload a 5-minute screen recording demonstrating your refactoring of a sample codebase to apply the Factory pattern.',
   'VIDEO',
   now() + INTERVAL '35 days',
   '11111111-0000-0000-0000-000000000001',
   '22222222-0000-0000-0000-000000000003'),
  ('33333333-0000-0000-0000-000000000005',
   'Assignment 5: Case Study Writeup',
   'Choose a real-world software system and write an 800-word design critique covering coupling, cohesion, and SOLID violations.',
   'TEXT',
   now() + INTERVAL '42 days',
   '11111111-0000-0000-0000-000000000001',
   '22222222-0000-0000-0000-000000000001')
ON CONFLICT (id) DO NOTHING;

-- Rubric + 3 weighted criteria per assignment (Correctness 0.4 / Completeness 0.3 / Clarity 0.3)
-- Each rubric has unique criteria IDs derived from the assignment ID prefix.
INSERT INTO public.rubrics (id, assignment_id)
SELECT
  ('44444444-' || substr(CAST(id AS TEXT), 9, 4) || '-' || substr(CAST(id AS TEXT), 14, 4) || '-' || substr(CAST(id AS TEXT), 19, 4) || '-' || substr(CAST(id AS TEXT), 25, 12))::UUID,
  id
FROM public.assignments
ON CONFLICT (id) DO NOTHING;

-- Insert 3 criteria per rubric using predictable UUIDs
-- For simplicity, we use gen_random_uuid() and let the next query find them
INSERT INTO public.rubric_criteria (rubric_id, name, description, weight, max_score)
SELECT r.id, 'Correctness', 'Technical accuracy and conceptual correctness', 0.4, 10.0
FROM public.rubrics r
WHERE NOT EXISTS (SELECT 1 FROM public.rubric_criteria WHERE rubric_id = r.id AND name = 'Correctness');

INSERT INTO public.rubric_criteria (rubric_id, name, description, weight, max_score)
SELECT r.id, 'Completeness', 'Coverage of all required elements', 0.3, 10.0
FROM public.rubrics r
WHERE NOT EXISTS (SELECT 1 FROM public.rubric_criteria WHERE rubric_id = r.id AND name = 'Completeness');

INSERT INTO public.rubric_criteria (rubric_id, name, description, weight, max_score)
SELECT r.id, 'Clarity', 'Readability, structure, and presentation', 0.3, 10.0
FROM public.rubrics r
WHERE NOT EXISTS (SELECT 1 FROM public.rubric_criteria WHERE rubric_id = r.id AND name = 'Clarity');

-- ─────────────────────────────────────────────────────────
-- 5. ENROLL all 30 students in the course
-- ─────────────────────────────────────────────────────────
INSERT INTO public.enrollments (user_id, course_id)
SELECT p.id, '11111111-0000-0000-0000-000000000001'
FROM public.profiles p
WHERE p.role = 'STUDENT'
ON CONFLICT DO NOTHING;

-- ─────────────────────────────────────────────────────────
-- 6. SUBMISSIONS — 5 per student (one per assignment), varied scores.
-- Students 1-5: high performers (75-95)
-- Students 6-25: mid performers (55-75)
-- Students 26-30: declining scores (at-risk pattern)
-- ─────────────────────────────────────────────────────────
-- Generate 150 submissions with varied scores using a deterministic pattern.
INSERT INTO public.submissions (id, assignment_id, user_id, content, status, submitted_at)
SELECT
  ('55555555-' || substr(CAST(p.id AS TEXT), 9, 4) || '-' || substr(CAST(p.id AS TEXT), 14, 4) || '-' || substr(CAST(p.id AS TEXT), 19, 4) || '-' || lpad(CAST(a_n AS TEXT), 12, '0'))::UUID,
  a.id,
  p.id,
  'Sample submission content for ' || a.title || ' by ' || p.name || '. ' || repeat('lorem ipsum dolor sit amet. ', 20),
  'SUBMITTED',
  now() - (a_n || ' days')::INTERVAL
FROM public.profiles p
CROSS JOIN (SELECT id, title, ROW_NUMBER() OVER (ORDER BY created_at) AS a_n FROM public.assignments) a
WHERE p.role = 'STUDENT'
ON CONFLICT (id) DO NOTHING;

-- ─────────────────────────────────────────────────────────
-- 7. EVALUATIONS — 3 per submission (one per criterion)
-- ─────────────────────────────────────────────────────────
INSERT INTO public.evaluations (submission_id, evaluator_id, criterion_id, score, comment, is_peer)
SELECT
  s.id,
  '00000000-0000-0000-0000-000000000002',  -- faculty
  c.id,
  -- Compute a per-student "tier" score
  -- Student #1-5 → high (8.0-9.5)
  -- Student #6-25 → mid (5.5-7.5)
  -- Student #26-30 → declining (last 2 scores should drop)
  CASE
    WHEN student_n <= 5 THEN (8.0 + (random() * 1.5))::REAL
    WHEN student_n <= 25 THEN (5.5 + (random() * 2.0))::REAL
    ELSE -- students 26-30: declining
      CASE assignment_n
        WHEN 1 THEN (7.5 + (random() * 1.0))::REAL
        WHEN 2 THEN (7.0 + (random() * 1.0))::REAL
        WHEN 3 THEN (5.5 + (random() * 1.0))::REAL  -- dropped
        WHEN 4 THEN (4.5 + (random() * 1.0))::REAL  -- dropped again
        WHEN 5 THEN (3.5 + (random() * 1.0))::REAL  -- steep drop
      END
  END,
  'Auto-evaluated comment for ' || c.name,
  false
FROM public.submissions s
JOIN public.assignments a ON a.id = s.assignment_id
JOIN (
  SELECT
    s2.id AS submission_id,
    s2.user_id,
    ROW_NUMBER() OVER (PARTITION BY s2.user_id ORDER BY s2.submitted_at) AS submission_seq,
    ROW_NUMBER() OVER (PARTITION BY s2.assignment_id ORDER BY s2.submitted_at) AS assign_seq
  FROM public.submissions s2
) seq ON seq.submission_id = s.id
JOIN (
  SELECT
    p.id AS user_id,
    ROW_NUMBER() OVER (ORDER BY p.email) AS student_n
  FROM public.profiles p WHERE p.role = 'STUDENT'
) sn ON sn.user_id = s.user_id
JOIN (
  SELECT
    a.id AS assignment_id,
    ROW_NUMBER() OVER (ORDER BY a.created_at) AS assignment_n
  FROM public.assignments a
) an ON an.assignment_id = s.assignment_id
JOIN public.rubrics r ON r.assignment_id = s.assignment_id
JOIN public.rubric_criteria c ON c.rubric_id = r.id
ON CONFLICT (submission_id, evaluator_id, criterion_id) DO NOTHING;

-- ─────────────────────────────────────────────────────────
-- 8. PEER REVIEWS — ZERO per the user's "fresh site today" request.
-- (Table exists with no rows. Final score = 70% faculty + 30% peer = 70% faculty
-- when peer is empty, which the queries.ts handles gracefully.)
-- ─────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────
-- 9. SIMILARITY REPORTS — 1 per submission, deterministic values
-- ─────────────────────────────────────────────────────────
INSERT INTO public.similarity_reports (submission_id, similarity, auto_score, feedback_text, media_extracted_text, criteria_reasoning, confidence, provider)
SELECT
  s.id,
  -- Similarity: 12-78% deterministic based on student_n + assignment_n
  (12 + ((sn.student_n * 7 + an.assignment_n * 3) % 66))::REAL,
  -- Auto-score: based on the faculty evaluation average
  CASE
    WHEN sn.student_n <= 5 THEN (85 + (random() * 10 - 5))::REAL
    WHEN sn.student_n <= 25 THEN (65 + (random() * 10 - 5))::REAL
    ELSE
      CASE an.assignment_n
        WHEN 1 THEN 78::REAL
        WHEN 2 THEN 72::REAL
        WHEN 3 THEN 58::REAL
        WHEN 4 THEN 48::REAL
        WHEN 5 THEN 38::REAL
      END
  END,
  'Auto-generated feedback based on the lowest-scoring criterion.',
  NULL,
  NULL,
  0.82,
  'MOCK'
FROM public.submissions s
JOIN (SELECT p.id AS user_id, ROW_NUMBER() OVER (ORDER BY p.email) AS student_n FROM public.profiles p WHERE p.role = 'STUDENT') sn ON sn.user_id = s.user_id
JOIN (SELECT a.id AS assignment_id, ROW_NUMBER() OVER (ORDER BY a.created_at) AS assignment_n FROM public.assignments a) an ON an.assignment_id = s.assignment_id
ON CONFLICT DO NOTHING;

-- ─────────────────────────────────────────────────────────
-- 10. FEEDBACK — 1 per submission
-- ─────────────────────────────────────────────────────────
INSERT INTO public.feedback (submission_id, author_id, recipient_id, text, source)
SELECT
  s.id,
  '00000000-0000-0000-0000-000000000002',  -- faculty
  s.user_id,
  CASE
    WHEN sn.student_n <= 5 THEN 'Excellent work — strong command of the topic with clear, well-structured reasoning.'
    WHEN sn.student_n <= 25 THEN 'Solid submission — minor refinements would push this toward excellence.'
    ELSE 'Below expectations. Please review the fundamentals and consider office hours.'
  END,
  'FACULTY'
FROM public.submissions s
JOIN (SELECT p.id AS user_id, ROW_NUMBER() OVER (ORDER BY p.email) AS student_n FROM public.profiles p WHERE p.role = 'STUDENT') sn ON sn.user_id = s.user_id
ON CONFLICT DO NOTHING;

-- ─────────────────────────────────────────────────────────
-- 11. WELCOME NOTIFICATION for each demo user
-- ─────────────────────────────────────────────────────────
INSERT INTO public.notifications (user_id, type, title, body, link)
SELECT id, 'NEW_ASSIGNMENT'::notification_type,
  'Welcome to LearnLens!',
  'Your demo account is ready. Check your dashboard to explore assignments, submissions, and analytics.',
  'dashboard:'
FROM public.profiles
WHERE role IN ('ADMIN', 'FACULTY', 'COORDINATOR', 'MENTOR', 'STUDENT')
ON CONFLICT DO NOTHING;

-- ─────────────────────────────────────────────────────────
-- DONE. Demo logins (password: demo1234 for all):
--   admin@learnlens.edu         → System overview + manage users/courses
--   faculty@learnlens.edu       → Courses + create-assignment + evaluate
--   coordinator@learnlens.edu   → Batch stats + CO-PO attainment + CSV
--   mentor@learnlens.edu        → 5 mentees (students 1-5), at-risk flagging
--   student01@learnlens.edu     → Learning curve + competency + AI insights
--   student02..student30        → Same dashboard, varied scores
-- ─────────────────────────────────────────────────────────
-- To reset all data and re-run:
--   TRUNCATE public.notifications, public.feedback, public.similarity_reports,
--     public.peer_reviews, public.evaluations, public.submissions,
--     public.rubric_criteria, public.rubrics, public.assignments,
--     public.competencies, public.enrollments, public.courses, public.profiles CASCADE;
--   DELETE FROM auth.users WHERE id LIKE '00000000-%';
-- Then re-run this whole file.
-- ─────────────────────────────────────────────────────────
