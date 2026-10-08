-- =====================================================================
-- 001 — TABLAS, COLUMNAS, ÍNDICES  (idempotente: sirve para instalar de cero
--        o para actualizar una BD ya existente sin perder datos)
-- =====================================================================
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions; -- @trgm

-- ── Especialidades ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.specialties (
  id         text PRIMARY KEY,
  name       text NOT NULL,
  color      text,
  mir_weight int  NOT NULL DEFAULT 5,
  created_at timestamptz DEFAULT now()
);

-- ── Perfiles ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text,
  full_name text,
  role text NOT NULL DEFAULT 'user',
  subscription_status text NOT NULL DEFAULT 'trial',
  subscription_plan text,
  trial_ends_at timestamptz DEFAULT (now() + interval '14 days'),
  subscription_ends_at timestamptz,
  stripe_customer_id text,
  stripe_subscription_id text,
  onboarding_completed boolean NOT NULL DEFAULT false,
  baseline_score numeric,
  weak_specialties text[] DEFAULT '{}',
  fecha_mir date,                                  -- obsoleta: la fecha vive en app_config
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS email text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS full_name text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'user';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS subscription_status text NOT NULL DEFAULT 'trial';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS subscription_plan text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS trial_ends_at timestamptz;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS subscription_ends_at timestamptz;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS stripe_customer_id text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS stripe_subscription_id text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS onboarding_completed boolean NOT NULL DEFAULT false;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS baseline_score numeric;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS weak_specialties text[] DEFAULT '{}';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS fecha_mir date;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
ALTER TABLE public.profiles ALTER COLUMN trial_ends_at SET DEFAULT (now() + interval '14 days');
UPDATE public.profiles SET trial_ends_at = now() + interval '14 days'
 WHERE subscription_status = 'trial' AND trial_ends_at IS NULL;

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles ADD  CONSTRAINT profiles_role_check CHECK (role IN ('user','admin'));
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_subscription_status_check;
ALTER TABLE public.profiles ADD  CONSTRAINT profiles_subscription_status_check CHECK (subscription_status IN ('trial','active','expired'));
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_subscription_plan_check;
ALTER TABLE public.profiles ADD  CONSTRAINT profiles_subscription_plan_check CHECK (subscription_plan IN ('monthly','annual','premium'));

-- ── Preguntas ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  text text NOT NULL,
  explanation text,
  correct_option_letter char(1) NOT NULL,
  difficulty smallint NOT NULL DEFAULT 3,
  year_exam int,
  question_number int,
  specialty_id text REFERENCES public.specialties(id),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now()
);
-- Modelo de contenido ampliado
ALTER TABLE public.questions ADD COLUMN IF NOT EXISTS image_url   text;
ALTER TABLE public.questions ADD COLUMN IF NOT EXISTS subtopic    text;
ALTER TABLE public.questions ADD COLUMN IF NOT EXISTS source      text NOT NULL DEFAULT 'original';
ALTER TABLE public.questions ADD COLUMN IF NOT EXISTS status      text NOT NULL DEFAULT 'published';
ALTER TABLE public.questions ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;
ALTER TABLE public.questions ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;
ALTER TABLE public.questions DROP CONSTRAINT IF EXISTS questions_source_check;
ALTER TABLE public.questions ADD  CONSTRAINT questions_source_check CHECK (source IN ('official','original','adapted'));
ALTER TABLE public.questions DROP CONSTRAINT IF EXISTS questions_status_check;
ALTER TABLE public.questions ADD  CONSTRAINT questions_status_check CHECK (status IN ('draft','reviewed','published'));
ALTER TABLE public.questions DROP CONSTRAINT IF EXISTS questions_difficulty_range;
ALTER TABLE public.questions ADD  CONSTRAINT questions_difficulty_range CHECK (difficulty BETWEEN 1 AND 5) NOT VALID;
ALTER TABLE public.questions DROP CONSTRAINT IF EXISTS questions_letter_check;
ALTER TABLE public.questions ADD  CONSTRAINT questions_letter_check CHECK (lower(correct_option_letter) IN ('a','b','c','d','e')) NOT VALID;

CREATE TABLE IF NOT EXISTS public.question_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id uuid NOT NULL REFERENCES public.questions(id) ON DELETE CASCADE,
  letter char(1) NOT NULL,
  text text NOT NULL
);
DELETE FROM public.question_options a USING public.question_options b
 WHERE a.ctid < b.ctid AND a.question_id = b.question_id AND a.letter = b.letter;
CREATE UNIQUE INDEX IF NOT EXISTS ux_question_options_q_letter ON public.question_options(question_id, letter);

-- ── Sesiones y respuestas ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.exam_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  mode text NOT NULL DEFAULT 'study',
  specialty_filter text[] DEFAULT '{}',
  total_questions int,
  time_limit_minutes int,
  started_at timestamptz DEFAULT now(),
  finished_at timestamptz,
  score numeric,
  num_correct int DEFAULT 0,
  num_wrong int DEFAULT 0,
  num_blank int DEFAULT 0
);
ALTER TABLE public.exam_sessions DROP CONSTRAINT IF EXISTS exam_sessions_mode_check;
ALTER TABLE public.exam_sessions ADD  CONSTRAINT exam_sessions_mode_check
  CHECK (mode IN ('study','exam','simulacro','repaso','errores'));

CREATE TABLE IF NOT EXISTS public.exam_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid REFERENCES public.exam_sessions(id) ON DELETE CASCADE,
  question_id uuid REFERENCES public.questions(id) ON DELETE CASCADE,
  selected_option_letter char(1),
  is_correct boolean,
  time_taken_seconds int,
  answered_at timestamptz DEFAULT now(),
  user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE
);
DELETE FROM public.exam_responses a USING public.exam_responses b
 WHERE a.ctid < b.ctid AND a.session_id = b.session_id AND a.question_id = b.question_id;
CREATE UNIQUE INDEX IF NOT EXISTS ux_exam_responses_session_question ON public.exam_responses(session_id, question_id);

CREATE TABLE IF NOT EXISTS public.user_question_state (
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  question_id uuid NOT NULL REFERENCES public.questions(id) ON DELETE CASCADE,
  interval_days int NOT NULL DEFAULT 0,
  repetitions int NOT NULL DEFAULT 0,
  ease_factor numeric NOT NULL DEFAULT 2.5,
  next_review date NOT NULL DEFAULT current_date,
  times_wrong int NOT NULL DEFAULT 0,
  times_correct int NOT NULL DEFAULT 0,
  last_error_type text,
  updated_at timestamptz DEFAULT now(),
  PRIMARY KEY (user_id, question_id)
);

-- ── Notas, notificaciones, ranking ───────────────────────────────────
CREATE TABLE IF NOT EXISTS public.notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  question_id uuid NOT NULL REFERENCES public.questions(id) ON DELETE CASCADE,
  content text,
  updated_at timestamptz DEFAULT now()
);
-- Si hubiera notas duplicadas (misma pregunta y usuario), se conserva la más reciente
DELETE FROM public.notes a USING public.notes b
 WHERE a.user_id = b.user_id AND a.question_id = b.question_id
   AND (a.updated_at < b.updated_at OR (a.updated_at = b.updated_at AND a.ctid < b.ctid));
CREATE UNIQUE INDEX IF NOT EXISTS ux_notes_user_question ON public.notes(user_id, question_id);

CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,   -- NULL = difusión a todos
  title text NOT NULL,
  body text,
  type text DEFAULT 'motivation',
  read boolean DEFAULT false,                                       -- legado; ahora se usa notification_reads
  sent_at timestamptz DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.notification_reads (
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  notification_id uuid NOT NULL REFERENCES public.notifications(id) ON DELETE CASCADE,
  read_at timestamptz DEFAULT now(),
  PRIMARY KEY (user_id, notification_id)
);

CREATE TABLE IF NOT EXISTS public.weekly_ranking (
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  week_start date NOT NULL,
  questions int DEFAULT 0,
  correct int DEFAULT 0,
  score numeric,
  percentile numeric,
  PRIMARY KEY (user_id, week_start)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_weekly_ranking_user_week ON public.weekly_ranking(user_id, week_start);

CREATE TABLE IF NOT EXISTS public.historical_cutoffs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  year int NOT NULL,
  specialty_id text REFERENCES public.specialties(id),
  min_score numeric,
  total_spots int
);

-- ── Administración, configuración, negocio ───────────────────────────
CREATE TABLE IF NOT EXISTS public.import_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  filename text,
  total int,
  imported int DEFAULT 0,
  skipped int DEFAULT 0,
  errors jsonb DEFAULT '[]'::jsonb,
  status text DEFAULT 'processing',
  created_at timestamptz DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.app_config (
  key text PRIMARY KEY,
  value text NOT NULL,
  updated_at timestamptz DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.subscription_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  plan text NOT NULL CHECK (plan IN ('monthly','annual','premium')),
  created_at timestamptz DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.question_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id uuid NOT NULL REFERENCES public.questions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  reason text NOT NULL CHECK (reason IN ('wrong_answer','unclear','typo','outdated','other')),
  comment text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','dismissed')),
  created_at timestamptz DEFAULT now(),
  resolved_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  resolved_at timestamptz
);
CREATE TABLE IF NOT EXISTS public.events (
  id bigserial PRIMARY KEY,
  user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  name text NOT NULL,
  props jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.client_errors (
  id bigserial PRIMARY KEY,
  user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  message text, stack text, url text, user_agent text,
  created_at timestamptz DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.stripe_events (
  id text PRIMARY KEY,
  type text,
  processed_at timestamptz DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.email_log (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  kind text NOT NULL,
  sent_at timestamptz DEFAULT now(),
  UNIQUE (user_id, kind)
);

-- ── Índices de rendimiento ───────────────────────────────────────────
CREATE INDEX IF NOT EXISTS ix_exam_responses_user_time   ON public.exam_responses(user_id, answered_at);
CREATE INDEX IF NOT EXISTS ix_exam_responses_question    ON public.exam_responses(question_id);
CREATE INDEX IF NOT EXISTS ix_uqs_user_review            ON public.user_question_state(user_id, next_review);
CREATE INDEX IF NOT EXISTS ix_uqs_user_wrong             ON public.user_question_state(user_id, times_wrong DESC) WHERE times_wrong > 0;
CREATE INDEX IF NOT EXISTS ix_questions_pool             ON public.questions(specialty_id, difficulty) WHERE is_active AND status = 'published';
CREATE INDEX IF NOT EXISTS ix_sessions_user_started      ON public.exam_sessions(user_id, started_at DESC);
CREATE INDEX IF NOT EXISTS ix_notifications_user_sent    ON public.notifications(user_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS ix_events_name_time           ON public.events(name, created_at);
CREATE INDEX IF NOT EXISTS ix_events_user                ON public.events(user_id);
CREATE INDEX IF NOT EXISTS ix_reports_status             ON public.question_reports(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_questions_text_trgm       ON public.questions USING gin(text gin_trgm_ops); -- @trgm
