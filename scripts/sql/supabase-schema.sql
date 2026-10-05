// LearnLens — Supabase SQL schema + RLS policies + storage bucket
// Run this in your Supabase SQL Editor (Dashboard → SQL → New query → paste → Run).
//
// After this runs successfully:
//   1. All tables exist with the right columns + foreign keys.
//   2. RLS is enabled on every table.
//   3. Policies let users read/update their own data + faculty read
//      submissions on their courses + admins read everything.
//   4. A `submissions` storage bucket is created (public read, auth-write).
//   5. A seed function is defined (see supabase-seed.sql next).
//
// Re-running this script is idempotent — uses `IF NOT EXISTS` everywhere.

-- ─────────────────────────────────────────────────────────
-- ENUMS (use TEXT with CHECK constraints for SQLite compat... actually
-- this is Postgres so we can use real enums).
-- ─────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('STUDENT', 'FACULTY', 'MENTOR', 'COORDINATOR', 'ADMIN');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE assignment_type AS ENUM ('TEXT', 'IMAGE', 'AUDIO', 'VIDEO');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE submission_status AS ENUM ('SUBMITTED', 'EVALUATED', 'LATE', 'PENDING');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE competency_type AS ENUM ('CO', 'PO');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE feedback_source AS ENUM ('FACULTY', 'PEER', 'AI_SIMULATION');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE notification_type AS ENUM (
    'NEW_ASSIGNMENT', 'DEADLINE_REMINDER', 'RESULT_PUBLISHED',
    'PEER_REVIEW_ASSIGNED', 'AI_ANALYSIS_READY'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─────────────────────────────────────────────────────────
-- PROFILES — extends auth.users with role + display fields
-- ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.profiles (
  id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email       TEXT NOT NULL,
  name        TEXT NOT NULL,
  role        user_role NOT NULL DEFAULT 'STUDENT',
  avatar_url  TEXT,
  mentor_id   UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS profiles_role_idx ON public.profiles(role);
CREATE INDEX IF NOT EXISTS profiles_mentor_id_idx ON public.profiles(mentor_id);

-- Auto-create a profile row when a new auth user signs up
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
    COALESCE((NEW.raw_user_meta_data->>'role')::user_role, 'STUDENT')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ─────────────────────────────────────────────────────────
-- COURSES + ENROLLMENTS
-- ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.courses (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code           TEXT UNIQUE NOT NULL,
  name           TEXT NOT NULL,
  description    TEXT,
  semester       TEXT NOT NULL DEFAULT '2026-1',
  faculty_id     UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  coordinator_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.enrollments (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  course_id  UUID NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, course_id)
);

-- ─────────────────────────────────────────────────────────
-- COMPETENCIES (CO/PO)
-- ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.competencies (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code          TEXT NOT NULL,
  name          TEXT NOT NULL,
  type          competency_type NOT NULL,
  course_id     UUID NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  target_level  REAL DEFAULT 75.0
);

-- ─────────────────────────────────────────────────────────
-- ASSIGNMENTS + RUBRICS + RUBRIC_CRITERIA
-- ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.assignments (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title          TEXT NOT NULL,
  description    TEXT,
  type           assignment_type NOT NULL,
  deadline       TIMESTAMPTZ NOT NULL,
  course_id      UUID NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  competency_id  UUID REFERENCES public.competencies(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS assignments_course_id_idx ON public.assignments(course_id);

CREATE TABLE IF NOT EXISTS public.rubrics (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id   UUID NOT NULL UNIQUE REFERENCES public.assignments(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.rubric_criteria (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rubric_id    UUID NOT NULL REFERENCES public.rubrics(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  description  TEXT,
  weight       REAL NOT NULL DEFAULT 0.33,
  max_score    REAL NOT NULL DEFAULT 10.0
);

-- ─────────────────────────────────────────────────────────
-- SUBMISSIONS
-- ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.submissions (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id        UUID NOT NULL REFERENCES public.assignments(id) ON DELETE CASCADE,
  user_id              UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  content              TEXT,
  file_url             TEXT,
  file_name            TEXT,
  file_type            TEXT,
  storage_path         TEXT,
  mime_type            TEXT,
  file_size            INTEGER,
  media_extracted_text TEXT,
  status               submission_status NOT NULL DEFAULT 'SUBMITTED',
  submitted_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS submissions_user_idx ON public.submissions(user_id);
CREATE INDEX IF NOT EXISTS submissions_assignment_idx ON public.submissions(assignment_id);

-- ─────────────────────────────────────────────────────────
-- EVALUATIONS + PEER REVIEWS  (peer_reviews table exists for schema
-- completeness, but seeded to ZERO per the user's request — "fresh site")
-- ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.evaluations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id UUID NOT NULL REFERENCES public.submissions(id) ON DELETE CASCADE,
  evaluator_id  UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  criterion_id  UUID NOT NULL REFERENCES public.rubric_criteria(id) ON DELETE CASCADE,
  score         REAL NOT NULL,
  comment       TEXT,
  is_peer       BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (submission_id, evaluator_id, criterion_id)
);

CREATE TABLE IF NOT EXISTS public.peer_reviews (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id UUID NOT NULL REFERENCES public.submissions(id) ON DELETE CASCADE,
  reviewer_id   UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  criterion_id  UUID NOT NULL REFERENCES public.rubric_criteria(id) ON DELETE CASCADE,
  score         REAL NOT NULL,
  comment       TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (submission_id, reviewer_id, criterion_id)
);

-- ─────────────────────────────────────────────────────────
-- SIMILARITY REPORTS  (AI cache)
-- ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.similarity_reports (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id            UUID NOT NULL REFERENCES public.submissions(id) ON DELETE CASCADE,
  compared_to_submission_id UUID REFERENCES public.submissions(id) ON DELETE SET NULL,
  similarity               REAL NOT NULL,
  auto_score               REAL,
  feedback_text           TEXT,
  media_extracted_text    TEXT,
  criteria_reasoning      TEXT,
  confidence              REAL,
  provider                TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────────────────
-- FEEDBACK
-- ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.feedback (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id UUID NOT NULL REFERENCES public.submissions(id) ON DELETE CASCADE,
  author_id     UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  recipient_id  UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  text          TEXT NOT NULL,
  source        feedback_source NOT NULL DEFAULT 'FACULTY',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────────────────
-- NOTIFICATIONS
-- ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.notifications (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  type       notification_type NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL,
  link       TEXT,
  read       BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notif_user_read_idx ON public.notifications(user_id, read);
CREATE INDEX IF NOT EXISTS notif_user_created_idx ON public.notifications(user_id, created_at DESC);

-- ─────────────────────────────────────────────────────────
-- ROW LEVEL SECURITY
-- ─────────────────────────────────────────────────────────
ALTER TABLE public.profiles           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.courses            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.enrollments        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.competencies       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assignments        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rubrics            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rubric_criteria    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.submissions        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evaluations        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.peer_reviews       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.similarity_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feedback           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications      ENABLE ROW LEVEL SECURITY;

-- Helper: is current user an admin?
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'ADMIN');
$$;

-- Helper: is current user a faculty member?
CREATE OR REPLACE FUNCTION public.is_faculty()
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'FACULTY');
$$;

-- Helper: is current user a coordinator?
CREATE OR REPLACE FUNCTION public.is_coordinator()
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'COORDINATOR');
$$;

-- Helper: is current user a mentor?
CREATE OR REPLACE FUNCTION public.is_mentor()
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'MENTOR');
$$;

-- Helper: is current user a student?
CREATE OR REPLACE FUNCTION public.is_student()
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'STUDENT');
$$;

-- ─────────────────────────────────────────────────────────
-- PROFILES POLICIES
-- ─────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "profiles_select_authenticated" ON public.profiles;
CREATE POLICY "profiles_select_authenticated" ON public.profiles
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "profiles_update_self" ON public.profiles;
CREATE POLICY "profiles_update_self" ON public.profiles
  FOR UPDATE TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());

DROP POLICY IF EXISTS "profiles_admin_all" ON public.profiles;
CREATE POLICY "profiles_admin_all" ON public.profiles
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

-- ─────────────────────────────────────────────────────────
-- COURSES POLICIES
-- ─────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "courses_select_authenticated" ON public.courses;
CREATE POLICY "courses_select_authenticated" ON public.courses
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "courses_faculty_insert_update" ON public.courses;
CREATE POLICY "courses_faculty_insert_update" ON public.courses
  FOR ALL TO authenticated USING (public.is_faculty() OR public.is_admin())
  WITH CHECK (public.is_faculty() OR public.is_admin());

-- ─────────────────────────────────────────────────────────
-- ENROLLMENTS POLICIES
-- ─────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "enrollments_select_self_or_staff" ON public.enrollments;
CREATE POLICY "enrollments_select_self_or_staff" ON public.enrollments
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_faculty() OR public.is_admin() OR public.is_coordinator() OR public.is_mentor());

DROP POLICY IF EXISTS "enrollments_admin_faculty_insert" ON public.enrollments;
CREATE POLICY "enrollments_admin_faculty_insert" ON public.enrollments
  FOR INSERT TO authenticated WITH CHECK (public.is_admin() OR public.is_faculty());

DROP POLICY IF EXISTS "enrollments_admin_delete" ON public.enrollments;
CREATE POLICY "enrollments_admin_delete" ON public.enrollments
  FOR DELETE TO authenticated USING (public.is_admin());

-- ─────────────────────────────────────────────────────────
-- COMPETENCIES / ASSIGNMENTS / RUBRICS — readable to authenticated;
-- writable by faculty (for assignments in their courses) or admin
-- ─────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "competencies_select_authenticated" ON public.competencies;
CREATE POLICY "competencies_select_authenticated" ON public.competencies
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "competencies_faculty_admin_write" ON public.competencies;
CREATE POLICY "competencies_faculty_admin_write" ON public.competencies
  FOR ALL TO authenticated
  USING (public.is_faculty() OR public.is_admin())
  WITH CHECK (public.is_faculty() OR public.is_admin());

DROP POLICY IF EXISTS "assignments_select_authenticated" ON public.assignments;
CREATE POLICY "assignments_select_authenticated" ON public.assignments
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "assignments_faculty_admin_write" ON public.assignments;
CREATE POLICY "assignments_faculty_admin_write" ON public.assignments
  FOR ALL TO authenticated
  USING (public.is_faculty() OR public.is_admin())
  WITH CHECK (public.is_faculty() OR public.is_admin());

DROP POLICY IF EXISTS "rubrics_select_authenticated" ON public.rubrics;
CREATE POLICY "rubrics_select_authenticated" ON public.rubrics
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "rubrics_faculty_admin_write" ON public.rubrics;
CREATE POLICY "rubrics_faculty_admin_write" ON public.rubrics
  FOR ALL TO authenticated
  USING (public.is_faculty() OR public.is_admin())
  WITH CHECK (public.is_faculty() OR public.is_admin());

DROP POLICY IF EXISTS "criteria_select_authenticated" ON public.rubric_criteria;
CREATE POLICY "criteria_select_authenticated" ON public.rubric_criteria
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "criteria_faculty_admin_write" ON public.rubric_criteria;
CREATE POLICY "criteria_faculty_admin_write" ON public.rubric_criteria
  FOR ALL TO authenticated
  USING (public.is_faculty() OR public.is_admin())
  WITH CHECK (public.is_faculty() OR public.is_admin());

-- ─────────────────────────────────────────────────────────
-- SUBMISSIONS — students see their own; faculty see submissions for
-- their courses; admins see all; mentors see submissions for their
-- mentees.
-- ─────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "submissions_select_visible" ON public.submissions;
CREATE POLICY "submissions_select_visible" ON public.submissions
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.is_admin()
    OR public.is_faculty()
    OR public.is_coordinator()
    OR (public.is_mentor() AND user_id IN (SELECT id FROM public.profiles WHERE mentor_id = auth.uid()))
  );

DROP POLICY IF EXISTS "submissions_student_insert_self" ON public.submissions;
CREATE POLICY "submissions_student_insert_self" ON public.submissions
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND public.is_student());

DROP POLICY IF EXISTS "submissions_student_update_self" ON public.submissions;
CREATE POLICY "submissions_student_update_self" ON public.submissions
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- ─────────────────────────────────────────────────────────
-- EVALUATIONS + PEER REVIEWS — faculty write for their course's
-- submissions; students write peer_reviews for assigned reviews.
-- ─────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "evaluations_select_visible" ON public.evaluations;
CREATE POLICY "evaluations_select_visible" ON public.evaluations
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.submissions s WHERE s.id = evaluations.submission_id AND s.user_id = auth.uid())
    OR public.is_faculty() OR public.is_admin() OR public.is_coordinator() OR public.is_mentor()
  );

DROP POLICY IF EXISTS "evaluations_faculty_write" ON public.evaluations;
CREATE POLICY "evaluations_faculty_write" ON public.evaluations
  FOR ALL TO authenticated
  USING (public.is_faculty() OR public.is_admin())
  WITH CHECK (public.is_faculty() OR public.is_admin());

DROP POLICY IF EXISTS "peer_reviews_select_visible" ON public.peer_reviews;
CREATE POLICY "peer_reviews_select_visible" ON public.peer_reviews
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.submissions s WHERE s.id = peer_reviews.submission_id AND (s.user_id = auth.uid() OR reviewer_id = auth.uid()))
    OR public.is_faculty() OR public.is_admin() OR public.is_coordinator()
  );

DROP POLICY IF EXISTS "peer_reviews_student_or_faculty_write" ON public.peer_reviews;
CREATE POLICY "peer_reviews_student_or_faculty_write" ON public.peer_reviews
  FOR ALL TO authenticated
  USING (public.is_faculty() OR public.is_admin() OR reviewer_id = auth.uid())
  WITH CHECK (public.is_faculty() OR public.is_admin() OR reviewer_id = auth.uid());

-- ─────────────────────────────────────────────────────────
-- SIMILARITY REPORTS + FEEDBACK — visible to submission owner + faculty.
-- ─────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "similarity_select_visible" ON public.similarity_reports;
CREATE POLICY "similarity_select_visible" ON public.similarity_reports
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.submissions s WHERE s.id = similarity_reports.submission_id AND s.user_id = auth.uid())
    OR public.is_faculty() OR public.is_admin() OR public.is_coordinator() OR public.is_mentor()
  );

DROP POLICY IF EXISTS "similarity_faculty_or_admin_write" ON public.similarity_reports;
CREATE POLICY "similarity_faculty_or_admin_write" ON public.similarity_reports
  FOR ALL TO authenticated
  USING (public.is_faculty() OR public.is_admin())
  WITH CHECK (public.is_faculty() OR public.is_admin());

DROP POLICY IF EXISTS "feedback_select_visible" ON public.feedback;
CREATE POLICY "feedback_select_visible" ON public.feedback
  FOR SELECT TO authenticated
  USING (
    recipient_id = auth.uid()
    OR public.is_faculty() OR public.is_admin() OR public.is_coordinator() OR public.is_mentor()
  );

DROP POLICY IF EXISTS "feedback_faculty_or_admin_write" ON public.feedback;
CREATE POLICY "feedback_faculty_or_admin_write" ON public.feedback
  FOR ALL TO authenticated
  USING (public.is_faculty() OR public.is_admin())
  WITH CHECK (public.is_faculty() OR public.is_admin());

-- ─────────────────────────────────────────────────────────
-- NOTIFICATIONS — each user sees only their own.
-- ─────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "notifications_select_own" ON public.notifications;
CREATE POLICY "notifications_select_own" ON public.notifications
  FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS "notifications_update_own" ON public.notifications;
CREATE POLICY "notifications_update_own" ON public.notifications
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "notifications_insert_self_or_admin" ON public.notifications;
CREATE POLICY "notifications_insert_self_or_admin" ON public.notifications
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() OR public.is_admin());

-- ─────────────────────────────────────────────────────────
-- STORAGE BUCKET — submissions
-- Public read (so the file URL works), auth-write.
-- ─────────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('submissions', 'submissions', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "storage_submissions_read_public" ON storage.objects;
CREATE POLICY "storage_submissions_read_public" ON storage.objects
  FOR SELECT USING (bucket_id = 'submissions');

DROP POLICY IF EXISTS "storage_submissions_insert_auth" ON storage.objects;
CREATE POLICY "storage_submissions_insert_auth" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'submissions');

DROP POLICY IF EXISTS "storage_submissions_update_own" ON storage.objects;
CREATE POLICY "storage_submissions_update_own" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'submissions' AND owner = auth.uid())
  WITH CHECK (bucket_id = 'submissions');

DROP POLICY IF EXISTS "storage_submissions_delete_own" ON storage.objects;
CREATE POLICY "storage_submissions_delete_own" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'submissions' AND owner = auth.uid());

-- ─────────────────────────────────────────────────────────
-- updated_at trigger for profiles
-- ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS profiles_set_updated_at ON public.profiles;
CREATE TRIGGER profiles_set_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─────────────────────────────────────────────────────────
-- DONE. Now run supabase-seed.sql to populate demo data.
-- ─────────────────────────────────────────────────────────
