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
-- =====================================================================
-- 002 — FUNCIONES BASE: permisos, perfiles, repetición espaciada, ranking
-- =====================================================================

-- ¿Es admin quien llama?
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin');
$$;

-- ¿Tiene acceso vigente? (admin, trial no vencido o suscripción activa no vencida)
CREATE OR REPLACE FUNCTION public.has_access()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
     WHERE p.id = auth.uid()
       AND ( p.role = 'admin'
          OR (p.subscription_status = 'active' AND (p.subscription_ends_at IS NULL OR p.subscription_ends_at > now()))
          OR (p.subscription_status = 'trial'  AND (p.trial_ends_at        IS NULL OR p.trial_ends_at        > now())) )
  );
$$;

-- Alta automática del perfil al registrarse
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, role, subscription_status, onboarding_completed)
  VALUES (NEW.id, NEW.email,
          COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name'),
          'user', 'trial', false)
  ON CONFLICT (id) DO UPDATE SET
    email     = EXCLUDED.email,
    full_name = COALESCE(EXCLUDED.full_name, public.profiles.full_name);
  INSERT INTO public.events (user_id, name) VALUES (NEW.id, 'signup');
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Un usuario normal NO puede tocar rol / suscripción / pago / email
CREATE OR REPLACE FUNCTION public.protect_profile_fields()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_admin() THEN
    IF NEW.role                   IS DISTINCT FROM OLD.role
    OR NEW.subscription_status    IS DISTINCT FROM OLD.subscription_status
    OR NEW.subscription_plan      IS DISTINCT FROM OLD.subscription_plan
    OR NEW.subscription_ends_at   IS DISTINCT FROM OLD.subscription_ends_at
    OR NEW.trial_ends_at          IS DISTINCT FROM OLD.trial_ends_at
    OR NEW.stripe_customer_id     IS DISTINCT FROM OLD.stripe_customer_id
    OR NEW.stripe_subscription_id IS DISTINCT FROM OLD.stripe_subscription_id
    OR NEW.email                  IS DISTINCT FROM OLD.email
    OR NEW.created_at             IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'No tienes permiso para modificar estos campos del perfil' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_protect_profile_fields ON public.profiles;
CREATE TRIGGER trg_protect_profile_fields BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_profile_fields();

-- Retirar el trigger antiguo de ranking (recalculaba un COUNT por cada fila insertada)
DO $$
DECLARE r record;
BEGIN
  IF to_regclass('public.exam_responses') IS NOT NULL THEN
    FOR r IN SELECT t.tgname FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
              WHERE t.tgrelid = 'public.exam_responses'::regclass
                AND NOT t.tgisinternal AND p.proname = 'update_weekly_ranking'
    LOOP
      EXECUTE format('DROP TRIGGER %I ON public.exam_responses', r.tgname);
    END LOOP;
  END IF;
END $$;
DROP FUNCTION IF EXISTS public.update_weekly_ranking();

-- ── Repetición espaciada (SM-2) en el servidor ───────────────────────
-- Aislada aquí: si algún día se cambia por FSRS, solo se toca fn_apply_review.
CREATE OR REPLACE FUNCTION public.fn_sm2_quality(p_ok boolean, p_secs int)
RETURNS int LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN NOT p_ok THEN (CASE WHEN p_secs < 10 THEN 1 ELSE 0 END)
              WHEN p_secs < 15 THEN 5
              WHEN p_secs < 30 THEN 4
              ELSE 3 END;
$$;

CREATE OR REPLACE FUNCTION public.fn_error_type(p_chosen text, p_correct text, p_secs int)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_secs < 10 THEN 'descuido'
    WHEN abs(ascii(lower(p_chosen)) - ascii(lower(p_correct))) = 1 THEN 'confusion'
    ELSE 'conceptual' END;
$$;

CREATE OR REPLACE FUNCTION public.fn_apply_review(
  p_uid uuid, p_qid uuid, p_ok boolean, p_chosen text, p_correct text, p_secs int)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  s public.user_question_state%ROWTYPE;
  v_secs int := CASE WHEN COALESCE(p_secs, 0) = 0 THEN 30 ELSE p_secs END;
  q int := public.fn_sm2_quality(p_ok, v_secs);
  v_int int; v_rep int; v_ef numeric;
BEGIN
  SELECT * INTO s FROM public.user_question_state WHERE user_id = p_uid AND question_id = p_qid;
  v_int := COALESCE(s.interval_days, 1);
  v_rep := COALESCE(s.repetitions, 0);
  v_ef  := COALESCE(s.ease_factor, 2.5);
  IF q >= 3 THEN
    IF    v_rep = 0 THEN v_int := 1;
    ELSIF v_rep = 1 THEN v_int := 6;
    ELSE  v_int := round(v_int * v_ef)::int;
    END IF;
    v_rep := v_rep + 1;
  ELSE
    v_rep := 0; v_int := 1;
  END IF;
  v_ef := greatest(1.3, v_ef + 0.1 - (5 - q) * (0.08 + (5 - q) * 0.02));

  INSERT INTO public.user_question_state AS u
    (user_id, question_id, interval_days, repetitions, ease_factor, next_review,
     times_wrong, times_correct, last_error_type, updated_at)
  VALUES (p_uid, p_qid, v_int, v_rep, v_ef, current_date + v_int,
          CASE WHEN p_ok THEN 0 ELSE 1 END, CASE WHEN p_ok THEN 1 ELSE 0 END,
          CASE WHEN p_ok THEN NULL ELSE public.fn_error_type(p_chosen, p_correct, v_secs) END, now())
  ON CONFLICT (user_id, question_id) DO UPDATE SET
    interval_days   = EXCLUDED.interval_days,
    repetitions     = EXCLUDED.repetitions,
    ease_factor     = EXCLUDED.ease_factor,
    next_review     = EXCLUDED.next_review,
    times_wrong     = u.times_wrong   + CASE WHEN p_ok THEN 0 ELSE 1 END,
    times_correct   = u.times_correct + CASE WHEN p_ok THEN 1 ELSE 0 END,
    last_error_type = COALESCE(EXCLUDED.last_error_type, u.last_error_type),
    updated_at      = now();
END $$;

-- Especialidades débiles: tasa de error entre TODAS las preguntas vistas (mín. 3 intentos)
CREATE OR REPLACE FUNCTION public.fn_refresh_weak_specialties(p_uid uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_ids text[];
BEGIN
  SELECT array_agg(t.sid ORDER BY t.err DESC) INTO v_ids FROM (
    SELECT q.specialty_id AS sid,
           sum(s.times_wrong)::numeric / NULLIF(sum(s.times_wrong + s.times_correct), 0) AS err
      FROM public.user_question_state s JOIN public.questions q ON q.id = s.question_id
     WHERE s.user_id = p_uid AND q.specialty_id IS NOT NULL
     GROUP BY q.specialty_id
    HAVING sum(s.times_wrong + s.times_correct) >= 3 AND sum(s.times_wrong) > 0
     ORDER BY 2 DESC LIMIT 5) t;
  IF v_ids IS NOT NULL THEN
    UPDATE public.profiles SET weak_specialties = v_ids WHERE id = p_uid;
  END IF;
END $$;

-- Ranking semanal: se recalcula UNA vez por sesión (no por cada respuesta)
CREATE OR REPLACE FUNCTION public.fn_refresh_weekly_ranking(p_uid uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_week date := date_trunc('week', now())::date; v_total int; v_ok int;
BEGIN
  SELECT count(*), count(*) FILTER (WHERE is_correct) INTO v_total, v_ok
    FROM public.exam_responses
   WHERE user_id = p_uid AND answered_at >= v_week::timestamptz;
  INSERT INTO public.weekly_ranking (user_id, week_start, questions, correct, score)
  VALUES (p_uid, v_week, v_total, v_ok, v_ok * 3 - (v_total - v_ok))
  ON CONFLICT (user_id, week_start) DO UPDATE SET
    questions = EXCLUDED.questions, correct = EXCLUDED.correct, score = EXCLUDED.score;
END $$;

-- Caducidad de trials y suscripciones (también lo comprueba has_access() al instante)
CREATE OR REPLACE FUNCTION public.expire_access()
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_n int;
BEGIN
  UPDATE public.profiles SET subscription_status = 'expired'
   WHERE role <> 'admin'
     AND ( (subscription_status = 'trial'  AND trial_ends_at        IS NOT NULL AND trial_ends_at        < now())
        OR (subscription_status = 'active' AND subscription_ends_at IS NOT NULL AND subscription_ends_at < now()) );
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;
DROP FUNCTION IF EXISTS public.expire_trials();
-- =====================================================================
-- 003 — RPC (toda escritura de resultados pasa por aquí, en transacción)
-- =====================================================================

-- ── Utilidades internas de formato de pregunta ───────────────────────
CREATE OR REPLACE FUNCTION public.fn_question_json(p_id uuid, p_include_key boolean DEFAULT false)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
           'id', q.id, 'text', q.text, 'difficulty', q.difficulty, 'year_exam', q.year_exam,
           'question_number', q.question_number, 'image_url', q.image_url, 'subtopic', q.subtopic,
           'specialty', jsonb_build_object('id', s.id, 'name', s.name, 'color', s.color, 'mir_weight', s.mir_weight),
           'options', COALESCE((SELECT jsonb_agg(jsonb_build_object('letter', o.letter, 'text', o.text) ORDER BY o.letter)
                                  FROM public.question_options o WHERE o.question_id = q.id), '[]'::jsonb))
         || CASE WHEN p_include_key
                 THEN jsonb_build_object('correct_option_letter', q.correct_option_letter, 'explanation', q.explanation)
                 ELSE '{}'::jsonb END
    FROM public.questions q LEFT JOIN public.specialties s ON s.id = q.specialty_id
   WHERE q.id = p_id;
$$;

CREATE OR REPLACE FUNCTION public.fn_questions_json(p_ids uuid[], p_include_key boolean DEFAULT false)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(jsonb_agg(public.fn_question_json(t.id, p_include_key) ORDER BY t.ord), '[]'::jsonb)
    FROM unnest(COALESCE(p_ids, '{}'::uuid[])) WITH ORDINALITY AS t(id, ord);
$$;

CREATE OR REPLACE FUNCTION public.fn_require_access()
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'No autenticado' USING ERRCODE = '28000'; END IF;
  IF NOT public.has_access() THEN RAISE EXCEPTION 'Tu acceso ha caducado' USING ERRCODE = '42501'; END IF;
  RETURN auth.uid();
END $$;

-- ── Banco de preguntas (sin la respuesta correcta) ───────────────────
CREATE OR REPLACE FUNCTION public.get_new_questions(
  p_specialty text DEFAULT NULL, p_difficulty text DEFAULT NULL, p_limit int DEFAULT 20)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := public.fn_require_access();
  v_lim int := least(greatest(COALESCE(p_limit, 20), 1), 100);
  v_lo int; v_hi int; v_ids uuid[]; v_n int; v_more uuid[];
BEGIN
  IF COALESCE(p_difficulty, '') <> '' THEN
    IF p_difficulty LIKE '%-%' THEN
      v_lo := split_part(p_difficulty, '-', 1)::int; v_hi := split_part(p_difficulty, '-', 2)::int;
    ELSE v_lo := p_difficulty::int; v_hi := v_lo; END IF;
  END IF;

  -- 1) preguntas que el usuario aún no ha visto, en orden aleatorio
  SELECT array_agg(t.id) INTO v_ids FROM (
    SELECT q.id FROM public.questions q
     WHERE q.is_active AND q.status = 'published'
       AND (COALESCE(p_specialty, '') = '' OR q.specialty_id = p_specialty)
       AND (v_lo IS NULL OR q.difficulty BETWEEN v_lo AND v_hi)
       AND NOT EXISTS (SELECT 1 FROM public.user_question_state s WHERE s.user_id = v_uid AND s.question_id = q.id)
     ORDER BY random() LIMIT v_lim) t;
  v_n := COALESCE(cardinality(v_ids), 0);

  -- 2) si no hay suficientes, completar con las vistas hace más tiempo
  IF v_n < v_lim THEN
    SELECT array_agg(t.id) INTO v_more FROM (
      SELECT q.id FROM public.questions q
        JOIN public.user_question_state s ON s.question_id = q.id AND s.user_id = v_uid
       WHERE q.is_active AND q.status = 'published'
         AND (COALESCE(p_specialty, '') = '' OR q.specialty_id = p_specialty)
         AND (v_lo IS NULL OR q.difficulty BETWEEN v_lo AND v_hi)
       ORDER BY s.updated_at ASC LIMIT (v_lim - v_n)) t;
    v_ids := COALESCE(v_ids, '{}') || COALESCE(v_more, '{}');
  END IF;
  RETURN public.fn_questions_json(v_ids, false);
END $$;

-- Simulacro: reparto por peso real de cada especialidad, calculado en el servidor
CREATE OR REPLACE FUNCTION public.get_simulacro_questions(p_total int DEFAULT 210)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_total int := least(greatest(COALESCE(p_total, 210), 1), 210);
  v_ids uuid[]; v_more uuid[];
BEGIN
  PERFORM public.fn_require_access();
  WITH w AS (
    SELECT s.id, s.mir_weight::numeric AS w FROM public.specialties s
     WHERE s.mir_weight > 0 AND EXISTS (SELECT 1 FROM public.questions q
            WHERE q.specialty_id = s.id AND q.is_active AND q.status = 'published')),
  tot AS (SELECT sum(w) AS t FROM w),
  picked AS (
    SELECT q.id,
           row_number() OVER (PARTITION BY q.specialty_id ORDER BY random()) AS rn,
           greatest(1, round(w.w / tot.t * v_total)) AS quota
      FROM public.questions q JOIN w ON w.id = q.specialty_id CROSS JOIN tot
     WHERE q.is_active AND q.status = 'published')
  SELECT array_agg(id ORDER BY random()) INTO v_ids FROM picked WHERE rn <= quota;
  v_ids := COALESCE(v_ids, '{}');
  IF cardinality(v_ids) > v_total THEN
    v_ids := v_ids[1:v_total];
  ELSIF cardinality(v_ids) < v_total THEN
    SELECT array_agg(t.id) INTO v_more FROM (
      SELECT q.id FROM public.questions q
       WHERE q.is_active AND q.status = 'published' AND q.id <> ALL (v_ids)
       ORDER BY random() LIMIT (v_total - cardinality(v_ids))) t;
    v_ids := v_ids || COALESCE(v_more, '{}');
  END IF;
  RETURN public.fn_questions_json(v_ids, false);
END $$;

-- Preguntas por id (repaso espaciado) — sin respuesta
CREATE OR REPLACE FUNCTION public.get_questions_by_ids(p_ids uuid[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_ids uuid[];
BEGIN
  PERFORM public.fn_require_access();
  SELECT array_agg(q.id) INTO v_ids FROM public.questions q
   WHERE q.id = ANY (p_ids) AND q.is_active AND q.status = 'published';
  RETURN public.fn_questions_json(v_ids, false);
END $$;

-- Preguntas falladas por el usuario (aquí sí lleva la respuesta: ya las contestó)
CREATE OR REPLACE FUNCTION public.get_failed_questions(p_limit int DEFAULT 30)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := public.fn_require_access();
BEGIN
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
             'question_id', t.question_id, 'times_wrong', t.times_wrong,
             'times_correct', t.times_correct, 'last_error_type', t.last_error_type,
             'question', public.fn_question_json(t.question_id, true)) ORDER BY t.times_wrong DESC)
      FROM (SELECT s.question_id, s.times_wrong, s.times_correct, s.last_error_type
              FROM public.user_question_state s JOIN public.questions q ON q.id = s.question_id
             WHERE s.user_id = v_uid AND s.times_wrong > 0 AND q.is_active
             ORDER BY s.times_wrong DESC LIMIT least(greatest(COALESCE(p_limit, 30), 1), 500)) t
  ), '[]'::jsonb);
END $$;

-- Para el repaso SM-2: pendientes de hoy (id + datos de planificación)
CREATE OR REPLACE FUNCTION public.get_due_reviews(p_limit int DEFAULT 20)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := public.fn_require_access();
BEGIN
  RETURN COALESCE((SELECT jsonb_agg(to_jsonb(t)) FROM (
    SELECT s.question_id, s.interval_days, s.repetitions, s.ease_factor, s.times_wrong
      FROM public.user_question_state s JOIN public.questions q ON q.id = s.question_id
     WHERE s.user_id = v_uid AND s.next_review <= current_date AND q.is_active AND q.status = 'published'
     ORDER BY s.next_review LIMIT least(greatest(COALESCE(p_limit, 20), 1), 200)) t), '[]'::jsonb);
END $$;

-- ── Sesiones y respuestas ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.start_session(
  p_mode text, p_specialty_filter text[] DEFAULT '{}', p_total int DEFAULT 20, p_time_limit int DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := public.fn_require_access(); v_row public.exam_sessions;
BEGIN
  IF p_mode NOT IN ('study','exam','simulacro','repaso','errores') THEN
    RAISE EXCEPTION 'Modo no válido';
  END IF;
  INSERT INTO public.exam_sessions (user_id, mode, specialty_filter, total_questions, time_limit_minutes)
  VALUES (v_uid, p_mode, COALESCE(p_specialty_filter, '{}'),
          least(greatest(COALESCE(p_total, 1), 1), 300), p_time_limit)
  RETURNING * INTO v_row;
  INSERT INTO public.events (user_id, name, props)
  VALUES (v_uid, 'session_started', jsonb_build_object('mode', p_mode, 'total', v_row.total_questions));
  RETURN to_jsonb(v_row);
END $$;

-- Modos con feedback inmediato (estudio / errores / repaso): una respuesta = una transacción
CREATE OR REPLACE FUNCTION public.submit_answer(
  p_session_id uuid, p_question_id uuid, p_letter text, p_time_secs int DEFAULT 30)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := public.fn_require_access();
  v_sess public.exam_sessions%ROWTYPE; v_q public.questions%ROWTYPE; v_prev public.exam_responses%ROWTYPE;
  v_letter text := lower(trim(COALESCE(p_letter, '')));
  v_secs int := least(greatest(COALESCE(p_time_secs, 30), 0), 3600);
  v_ok boolean;
BEGIN
  SELECT * INTO v_sess FROM public.exam_sessions WHERE id = p_session_id AND user_id = v_uid;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sesión no válida' USING ERRCODE = 'P0002'; END IF;
  IF v_sess.finished_at IS NOT NULL THEN RAISE EXCEPTION 'La sesión ya está finalizada'; END IF;
  IF v_sess.mode IN ('exam','simulacro') THEN RAISE EXCEPTION 'Este modo se entrega con submit_session'; END IF;

  SELECT * INTO v_q FROM public.questions WHERE id = p_question_id AND is_active AND status = 'published';
  IF NOT FOUND THEN RAISE EXCEPTION 'Pregunta no disponible' USING ERRCODE = 'P0002'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.question_options WHERE question_id = p_question_id AND letter = v_letter) THEN
    RAISE EXCEPTION 'Opción no válida';
  END IF;

  SELECT * INTO v_prev FROM public.exam_responses WHERE session_id = p_session_id AND question_id = p_question_id;
  IF FOUND THEN   -- idempotente: un reintento por red no duplica nada
    RETURN jsonb_build_object('is_correct', v_prev.is_correct, 'correct_letter', v_q.correct_option_letter,
                              'explanation', v_q.explanation, 'already_answered', true);
  END IF;

  v_ok := (v_letter = lower(v_q.correct_option_letter::text));
  INSERT INTO public.exam_responses (session_id, question_id, user_id, selected_option_letter, is_correct, time_taken_seconds)
  VALUES (p_session_id, p_question_id, v_uid, v_letter, v_ok, v_secs);
  PERFORM public.fn_apply_review(v_uid, p_question_id, v_ok, v_letter, v_q.correct_option_letter::text, v_secs);

  RETURN jsonb_build_object('is_correct', v_ok, 'correct_letter', v_q.correct_option_letter, 'explanation', v_q.explanation);
END $$;

-- Cierre de una sesión con feedback inmediato (idempotente)
CREATE OR REPLACE FUNCTION public.finish_session(p_session_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := public.fn_require_access();
  v_sess public.exam_sessions%ROWTYPE; v_c int; v_w int; v_b int;
BEGIN
  SELECT * INTO v_sess FROM public.exam_sessions WHERE id = p_session_id AND user_id = v_uid;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sesión no válida' USING ERRCODE = 'P0002'; END IF;
  IF v_sess.finished_at IS NULL THEN
    SELECT count(*) FILTER (WHERE is_correct), count(*) FILTER (WHERE NOT is_correct AND selected_option_letter IS NOT NULL)
      INTO v_c, v_w FROM public.exam_responses WHERE session_id = p_session_id;
    v_b := greatest(COALESCE(v_sess.total_questions, 0) - v_c - v_w, 0);
    UPDATE public.exam_sessions SET finished_at = now(), num_correct = v_c, num_wrong = v_w, num_blank = v_b,
           score = v_c * 3 - v_w WHERE id = p_session_id RETURNING * INTO v_sess;
    PERFORM public.fn_refresh_weak_specialties(v_uid);
    PERFORM public.fn_refresh_weekly_ranking(v_uid);
    INSERT INTO public.events (user_id, name, props)
    VALUES (v_uid, 'session_finished', jsonb_build_object('mode', v_sess.mode, 'correct', v_c, 'wrong', v_w));
  END IF;
  RETURN jsonb_build_object('correct', v_sess.num_correct, 'wrong', v_sess.num_wrong,
                            'blank', v_sess.num_blank, 'score', v_sess.score);
END $$;

-- Examen / simulacro: el servidor corrige todo y devuelve las soluciones SOLO al entregar
CREATE OR REPLACE FUNCTION public.submit_session(p_session_id uuid, p_answers jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := public.fn_require_access();
  v_sess public.exam_sessions%ROWTYPE; v_item jsonb; v_q public.questions%ROWTYPE;
  v_qid uuid; v_letter text; v_secs int; v_ok boolean; v_rows int;
  v_c int := 0; v_w int := 0; v_b int; v_results jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO v_sess FROM public.exam_sessions WHERE id = p_session_id AND user_id = v_uid;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sesión no válida' USING ERRCODE = 'P0002'; END IF;
  IF v_sess.mode NOT IN ('exam','simulacro') THEN RAISE EXCEPTION 'Este modo no se entrega en bloque'; END IF;

  IF v_sess.finished_at IS NOT NULL THEN   -- reintento tras fallo de red: devolver lo ya corregido
    RETURN jsonb_build_object('already_submitted', true, 'correct', v_sess.num_correct,
      'wrong', v_sess.num_wrong, 'blank', v_sess.num_blank, 'score', v_sess.score,
      'results', COALESCE((SELECT jsonb_agg(jsonb_build_object('question_id', r.question_id,
          'selected', r.selected_option_letter, 'is_correct', r.is_correct,
          'correct_letter', q.correct_option_letter, 'explanation', q.explanation))
        FROM public.exam_responses r JOIN public.questions q ON q.id = r.question_id
       WHERE r.session_id = p_session_id), '[]'::jsonb));
  END IF;

  IF jsonb_typeof(p_answers) <> 'array' OR jsonb_array_length(p_answers) > 300 THEN
    RAISE EXCEPTION 'Respuestas no válidas';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_answers) LOOP
    v_qid    := (v_item->>'question_id')::uuid;
    v_letter := lower(nullif(trim(COALESCE(v_item->>'letter', '')), ''));
    v_secs   := least(greatest(COALESCE((v_item->>'time_secs')::int, 30), 0), 3600);
    SELECT * INTO v_q FROM public.questions WHERE id = v_qid AND is_active;
    CONTINUE WHEN NOT FOUND;

    v_ok := false;
    IF v_letter IS NOT NULL AND EXISTS (SELECT 1 FROM public.question_options WHERE question_id = v_qid AND letter = v_letter) THEN
      v_ok := (v_letter = lower(v_q.correct_option_letter::text));
      INSERT INTO public.exam_responses (session_id, question_id, user_id, selected_option_letter, is_correct, time_taken_seconds)
      VALUES (p_session_id, v_qid, v_uid, v_letter, v_ok, v_secs)
      ON CONFLICT (session_id, question_id) DO NOTHING;
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      IF v_rows = 1 THEN
        PERFORM public.fn_apply_review(v_uid, v_qid, v_ok, v_letter, v_q.correct_option_letter::text, v_secs);
        IF v_ok THEN v_c := v_c + 1; ELSE v_w := v_w + 1; END IF;
      END IF;
    ELSE
      v_letter := NULL;
    END IF;
    v_results := v_results || jsonb_build_object('question_id', v_qid, 'selected', v_letter,
      'is_correct', v_ok, 'correct_letter', v_q.correct_option_letter, 'explanation', v_q.explanation);
  END LOOP;

  v_b := greatest(COALESCE(v_sess.total_questions, 0) - v_c - v_w, 0);
  UPDATE public.exam_sessions SET finished_at = now(), num_correct = v_c, num_wrong = v_w,
         num_blank = v_b, score = v_c * 3 - v_w WHERE id = p_session_id;
  PERFORM public.fn_refresh_weak_specialties(v_uid);
  PERFORM public.fn_refresh_weekly_ranking(v_uid);
  INSERT INTO public.events (user_id, name, props)
  VALUES (v_uid, 'session_finished', jsonb_build_object('mode', v_sess.mode, 'correct', v_c, 'wrong', v_w));

  RETURN jsonb_build_object('correct', v_c, 'wrong', v_w, 'blank', v_b, 'score', v_c * 3 - v_w, 'results', v_results);
END $$;

-- ── Notificaciones (leído por usuario, también las de difusión) ──────
CREATE OR REPLACE FUNCTION public.get_my_notifications()
RETURNS TABLE (id uuid, user_id uuid, title text, body text, type text, sent_at timestamptz, read boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT n.id, n.user_id, n.title, n.body, n.type, n.sent_at, (r.notification_id IS NOT NULL) AS read
    FROM public.notifications n
    JOIN public.profiles p ON p.id = auth.uid()
    LEFT JOIN public.notification_reads r ON r.notification_id = n.id AND r.user_id = auth.uid()
   WHERE n.user_id = auth.uid() OR (n.user_id IS NULL AND n.sent_at >= p.created_at)
   ORDER BY n.sent_at DESC LIMIT 50;
$$;

CREATE OR REPLACE FUNCTION public.mark_notification_read(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'No autenticado' USING ERRCODE = '28000'; END IF;
  INSERT INTO public.notification_reads (user_id, notification_id)
  SELECT auth.uid(), n.id FROM public.notifications n
   WHERE n.id = p_id AND (n.user_id = auth.uid() OR n.user_id IS NULL)
  ON CONFLICT DO NOTHING;
END $$;

-- ── Eventos de producto y errores de cliente ─────────────────────────
CREATE OR REPLACE FUNCTION public.track_event(p_name text, p_props jsonb DEFAULT '{}'::jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR p_name !~ '^[a-z_]{3,40}$' THEN RETURN; END IF;
  IF (SELECT count(*) FROM public.events WHERE user_id = auth.uid() AND created_at > now() - interval '1 hour') > 300 THEN
    RETURN;
  END IF;
  INSERT INTO public.events (user_id, name, props)
  VALUES (auth.uid(), p_name, CASE WHEN length(COALESCE(p_props, '{}')::text) < 2000 THEN COALESCE(p_props, '{}') ELSE '{}' END);
END $$;

CREATE OR REPLACE FUNCTION public.log_client_error(p_message text, p_stack text DEFAULT NULL, p_url text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN; END IF;
  IF (SELECT count(*) FROM public.client_errors WHERE user_id = auth.uid() AND created_at > now() - interval '1 hour') >= 20 THEN
    RETURN;
  END IF;
  INSERT INTO public.client_errors (user_id, message, stack, url)
  VALUES (auth.uid(), left(p_message, 500), left(p_stack, 3000), left(p_url, 300));
END $$;

-- ── Cuenta del usuario (RGPD: portabilidad y supresión) ──────────────
CREATE OR REPLACE FUNCTION public.export_my_data()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado' USING ERRCODE = '28000'; END IF;
  RETURN jsonb_build_object(
    'exportado_el', now(),
    'perfil',        (SELECT to_jsonb(p) - 'stripe_customer_id' - 'stripe_subscription_id' FROM public.profiles p WHERE p.id = v_uid),
    'sesiones',      COALESCE((SELECT jsonb_agg(to_jsonb(s)) FROM public.exam_sessions s WHERE s.user_id = v_uid), '[]'),
    'respuestas',    COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM public.exam_responses r WHERE r.user_id = v_uid), '[]'),
    'estado_repaso', COALESCE((SELECT jsonb_agg(to_jsonb(u)) FROM public.user_question_state u WHERE u.user_id = v_uid), '[]'),
    'notas',         COALESCE((SELECT jsonb_agg(to_jsonb(n)) FROM public.notes n WHERE n.user_id = v_uid), '[]'),
    'solicitudes',   COALESCE((SELECT jsonb_agg(to_jsonb(q)) FROM public.subscription_requests q WHERE q.user_id = v_uid), '[]'));
END $$;

CREATE OR REPLACE FUNCTION public.fn_purge_user(p_uid uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
BEGIN
  DELETE FROM public.exam_responses      WHERE user_id = p_uid;
  DELETE FROM public.user_question_state WHERE user_id = p_uid;
  DELETE FROM public.exam_sessions       WHERE user_id = p_uid;
  DELETE FROM public.notes               WHERE user_id = p_uid;
  DELETE FROM public.notifications       WHERE user_id = p_uid;
  DELETE FROM public.weekly_ranking      WHERE user_id = p_uid;
  DELETE FROM public.profiles            WHERE id      = p_uid;
  DELETE FROM auth.users                 WHERE id      = p_uid;
END $$;

CREATE OR REPLACE FUNCTION public.delete_my_account()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); v_p public.profiles%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado' USING ERRCODE = '28000'; END IF;
  SELECT * INTO v_p FROM public.profiles WHERE id = v_uid;
  IF v_p.role = 'admin' THEN RAISE EXCEPTION 'Una cuenta de administrador no puede eliminarse a sí misma'; END IF;
  IF v_p.stripe_subscription_id IS NOT NULL AND v_p.subscription_status = 'active' THEN
    RAISE EXCEPTION 'Cancela tu suscripción desde "Gestionar suscripción" antes de eliminar la cuenta';
  END IF;
  PERFORM public.fn_purge_user(v_uid);
END $$;

-- ── Administración ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_delete_user(target_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Solo admins pueden eliminar usuarios' USING ERRCODE = '42501'; END IF;
  IF target_user_id = auth.uid() THEN RAISE EXCEPTION 'No puedes eliminarte a ti mismo'; END IF;
  PERFORM public.fn_purge_user(target_user_id);
END $$;

CREATE OR REPLACE FUNCTION public.find_similar_questions(query_text text, threshold float DEFAULT 0.65)
RETURNS TABLE (id uuid, text text, sim float)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, extensions AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Solo admins' USING ERRCODE = '42501'; END IF;
  RETURN QUERY SELECT q.id, q.text, similarity(q.text, query_text)::float AS sim
    FROM public.questions q
   WHERE q.is_active AND similarity(q.text, query_text) > threshold
   ORDER BY sim DESC LIMIT 3;
END $$;

CREATE OR REPLACE FUNCTION public.admin_analytics(p_days int DEFAULT 30)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_from timestamptz; v_days int := least(greatest(COALESCE(p_days, 30), 1), 730);
        v_out jsonb;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Solo admins' USING ERRCODE = '42501'; END IF;
  v_from := now() - make_interval(days => v_days);
  SELECT jsonb_build_object(
    'total',        (SELECT count(*) FROM public.exam_responses WHERE answered_at >= v_from),
    'corr',         (SELECT count(*) FROM public.exam_responses WHERE answered_at >= v_from AND is_correct),
    'avgTime',      COALESCE((SELECT round(avg(time_taken_seconds)) FROM public.exam_responses WHERE answered_at >= v_from), 0),
    'totalSess',    (SELECT count(*) FROM public.exam_sessions WHERE started_at >= v_from AND finished_at IS NOT NULL),
    'uniqueUsers',  (SELECT count(DISTINCT user_id) FROM public.exam_sessions WHERE started_at >= v_from AND finished_at IS NOT NULL),
    'activeRecent', (SELECT count(DISTINCT user_id) FROM public.exam_sessions
                      WHERE started_at >= greatest(v_from, now() - interval '7 days') AND finished_at IS NOT NULL),
    'avgQperSess',  COALESCE((SELECT round(avg(total_questions)) FROM public.exam_sessions WHERE started_at >= v_from AND finished_at IS NOT NULL), 0),
    'subs', jsonb_build_object(
        'active',  (SELECT count(*) FROM public.profiles WHERE subscription_status = 'active'),
        'trial',   (SELECT count(*) FROM public.profiles WHERE subscription_status = 'trial'),
        'expired', (SELECT count(*) FROM public.profiles WHERE subscription_status = 'expired')),
    'modos',        COALESCE((SELECT jsonb_object_agg(mode, c) FROM (
                        SELECT mode, count(*) AS c FROM public.exam_sessions
                         WHERE started_at >= v_from AND finished_at IS NOT NULL GROUP BY mode) m), '{}'::jsonb),
    'avgScore',     COALESCE((SELECT round(avg(score)) FROM public.weekly_ranking WHERE score IS NOT NULL), 0),
    'scoresCount',  (SELECT count(*) FROM public.weekly_ranking WHERE score IS NOT NULL),
    'crecimiento',  COALESCE((SELECT jsonb_agg(jsonb_build_object('date', d::date,
                          'nuevos', (SELECT count(*) FROM public.profiles WHERE created_at::date = d::date)) ORDER BY d)
                        FROM generate_series(current_date - (least(v_days, 30) - 1), current_date, interval '1 day') d), '[]'::jsonb)
  ) INTO v_out;
  RETURN v_out;
END $$;

CREATE OR REPLACE FUNCTION public.admin_user_stats(p_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Solo admins' USING ERRCODE = '42501'; END IF;
  RETURN jsonb_build_object(
    'total',  (SELECT count(*) FROM public.exam_responses WHERE user_id = p_user_id),
    'corr',   (SELECT count(*) FROM public.exam_responses WHERE user_id = p_user_id AND is_correct),
    'semana', (SELECT count(*) FROM public.exam_responses WHERE user_id = p_user_id AND answered_at > now() - interval '7 days'),
    'actividad', (SELECT jsonb_agg(COALESCE(c.n, 0) ORDER BY d.d)
                    FROM generate_series(current_date - 29, current_date, interval '1 day') AS d(d)
                    LEFT JOIN (SELECT answered_at::date AS day, count(*) AS n FROM public.exam_responses
                                WHERE user_id = p_user_id AND answered_at >= current_date - 29 GROUP BY 1) c
                           ON c.day = d.d::date));
END $$;

CREATE OR REPLACE FUNCTION public.admin_funnel()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Solo admins' USING ERRCODE = '42501'; END IF;
  RETURN jsonb_build_object(
    'registrados',  (SELECT count(*) FROM public.profiles WHERE role = 'user'),
    'onboarding',   (SELECT count(*) FROM public.profiles WHERE role = 'user' AND onboarding_completed),
    'primera_sesion', (SELECT count(DISTINCT s.user_id) FROM public.exam_sessions s JOIN public.profiles p ON p.id = s.user_id
                        WHERE p.role = 'user' AND s.finished_at IS NOT NULL),
    'volvieron',    (SELECT count(*) FROM (SELECT s.user_id FROM public.exam_sessions s JOIN public.profiles p ON p.id = s.user_id
                        WHERE p.role = 'user' AND s.finished_at IS NOT NULL
                        GROUP BY s.user_id HAVING count(DISTINCT s.started_at::date) >= 2) t),
    'vieron_paywall', (SELECT count(DISTINCT user_id) FROM public.events WHERE name = 'paywall_shown'),
    'pidieron_plan',  (SELECT count(DISTINCT user_id) FROM public.subscription_requests),
    'de_pago',        (SELECT count(*) FROM public.profiles WHERE role = 'user' AND subscription_status = 'active'));
END $$;

CREATE OR REPLACE FUNCTION public.admin_question_stats(p_min_attempts int DEFAULT 20, p_limit int DEFAULT 30)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Solo admins' USING ERRCODE = '42501'; END IF;
  RETURN COALESCE((SELECT jsonb_agg(to_jsonb(t)) FROM (
    SELECT q.id, left(q.text, 140) AS text, q.specialty_id,
           count(*) AS attempts, round(100.0 * avg((r.is_correct)::int), 1) AS accuracy
      FROM public.exam_responses r JOIN public.questions q ON q.id = r.question_id
     GROUP BY q.id, q.text, q.specialty_id
    HAVING count(*) >= COALESCE(p_min_attempts, 20)
     ORDER BY accuracy ASC LIMIT least(COALESCE(p_limit, 30), 200)) t), '[]'::jsonb);
END $$;

-- Pregunta completa (con solución) para el panel de administración
CREATE OR REPLACE FUNCTION public.admin_get_question(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Solo admins' USING ERRCODE = '42501'; END IF;
  RETURN public.fn_question_json(p_id, true) || (SELECT jsonb_build_object('status', q.status, 'is_active', q.is_active)
                                                   FROM public.questions q WHERE q.id = p_id);
END $$;
-- =====================================================================
-- 004 — RLS Y PERMISOS (mínimo privilegio)
--   · El banco de preguntas exige sesión + acceso vigente (trial/suscripción).
--   · Los usuarios NO escriben resultados: solo lo hacen las RPC del servidor.
--   · Este script borra TODAS las políticas antiguas de public y las recrea.
-- =====================================================================

-- 0) Partir de cero con las políticas
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT schemaname, tablename, policyname FROM pg_policies WHERE schemaname = 'public' LOOP
    EXECUTE format('DROP POLICY %I ON %I.%I', r.policyname, r.schemaname, r.tablename);
  END LOOP;
END $$;

ALTER TABLE public.specialties            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.questions              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.question_options       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exam_sessions          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exam_responses         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_question_state    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notes                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_reads     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.weekly_ranking         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.historical_cutoffs     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.import_logs            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_config             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscription_requests  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.question_reports       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.events                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_errors          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stripe_events          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_log              ENABLE ROW LEVEL SECURITY;

-- Especialidades / configuración / cortes históricos: lectura para usuarios logueados
CREATE POLICY specialties_read   ON public.specialties        FOR SELECT TO authenticated USING (true);
CREATE POLICY specialties_admin  ON public.specialties        FOR ALL    TO authenticated USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()));
CREATE POLICY app_config_read    ON public.app_config         FOR SELECT TO authenticated USING (true);
CREATE POLICY app_config_admin   ON public.app_config         FOR ALL    TO authenticated USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()));
CREATE POLICY cutoffs_read       ON public.historical_cutoffs FOR SELECT TO authenticated USING (true);
CREATE POLICY cutoffs_admin      ON public.historical_cutoffs FOR ALL    TO authenticated USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()));

-- Perfiles
CREATE POLICY profiles_select_own   ON public.profiles FOR SELECT TO authenticated USING (id = (SELECT auth.uid()));
CREATE POLICY profiles_select_admin ON public.profiles FOR SELECT TO authenticated USING ((SELECT public.is_admin()));
CREATE POLICY profiles_update_own   ON public.profiles FOR UPDATE TO authenticated
  USING (id = (SELECT auth.uid())) WITH CHECK (id = (SELECT auth.uid()));   -- campos sensibles: trigger protect_profile_fields
CREATE POLICY profiles_update_admin ON public.profiles FOR UPDATE TO authenticated
  USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()));
CREATE POLICY profiles_insert_own   ON public.profiles FOR INSERT TO authenticated
  WITH CHECK (id = (SELECT auth.uid()) AND role = 'user' AND subscription_status = 'trial'
              AND stripe_customer_id IS NULL AND stripe_subscription_id IS NULL
              AND (trial_ends_at IS NULL OR trial_ends_at <= now() + interval '15 days'));
CREATE POLICY profiles_insert_admin ON public.profiles FOR INSERT TO authenticated WITH CHECK ((SELECT public.is_admin()));
CREATE POLICY profiles_delete_admin ON public.profiles FOR DELETE TO authenticated USING ((SELECT public.is_admin()));

-- Banco de preguntas: solo con sesión y acceso vigente; los admins ven todo
CREATE POLICY questions_read ON public.questions FOR SELECT TO authenticated
  USING ((SELECT public.is_admin()) OR (is_active AND status = 'published' AND (SELECT public.has_access())));
CREATE POLICY questions_admin ON public.questions FOR ALL TO authenticated
  USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()));
CREATE POLICY options_read ON public.question_options FOR SELECT TO authenticated
  USING ((SELECT public.is_admin()) OR ((SELECT public.has_access()) AND EXISTS (
          SELECT 1 FROM public.questions q WHERE q.id = question_id AND q.is_active AND q.status = 'published')));
CREATE POLICY options_admin ON public.question_options FOR ALL TO authenticated
  USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()));

-- Resultados: el usuario SOLO lee lo suyo; escribe únicamente vía RPC
CREATE POLICY sessions_select_own  ON public.exam_sessions       FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));
CREATE POLICY sessions_admin       ON public.exam_sessions       FOR ALL    TO authenticated USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()));
CREATE POLICY responses_select_own ON public.exam_responses      FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));
CREATE POLICY responses_admin      ON public.exam_responses      FOR ALL    TO authenticated USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()));
CREATE POLICY uqs_select_own       ON public.user_question_state FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));
CREATE POLICY uqs_admin            ON public.user_question_state FOR ALL    TO authenticated USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()));

-- Notas: propias
CREATE POLICY notes_own ON public.notes FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));

-- Notificaciones
CREATE POLICY notif_select      ON public.notifications      FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()) OR user_id IS NULL);
CREATE POLICY notif_admin       ON public.notifications      FOR ALL    TO authenticated USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()));
CREATE POLICY notif_reads_own   ON public.notification_reads FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));

-- Ranking: lectura para usuarios; escritura solo servidor
CREATE POLICY ranking_read  ON public.weekly_ranking FOR SELECT TO authenticated USING (true);
CREATE POLICY ranking_admin ON public.weekly_ranking FOR ALL    TO authenticated USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()));

-- Negocio y soporte
CREATE POLICY import_logs_admin ON public.import_logs FOR ALL TO authenticated USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()));
CREATE POLICY subreq_insert_own ON public.subscription_requests FOR INSERT TO authenticated WITH CHECK (user_id = (SELECT auth.uid()));
CREATE POLICY subreq_select_own ON public.subscription_requests FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));
CREATE POLICY subreq_admin      ON public.subscription_requests FOR ALL    TO authenticated USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()));
CREATE POLICY reports_insert_own ON public.question_reports FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()) AND (SELECT public.has_access()));
CREATE POLICY reports_select_own ON public.question_reports FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));
CREATE POLICY reports_admin      ON public.question_reports FOR ALL    TO authenticated USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()));
CREATE POLICY events_admin        ON public.events        FOR SELECT TO authenticated USING ((SELECT public.is_admin()));
CREATE POLICY client_errors_admin ON public.client_errors FOR SELECT TO authenticated USING ((SELECT public.is_admin()));
CREATE POLICY stripe_events_admin ON public.stripe_events FOR SELECT TO authenticated USING ((SELECT public.is_admin()));
CREATE POLICY email_log_admin     ON public.email_log     FOR SELECT TO authenticated USING ((SELECT public.is_admin()));

-- ── Permisos de objeto ───────────────────────────────────────────────
REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;
GRANT ALL ON ALL TABLES    IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;

-- Funciones: nada ejecutable por defecto; solo lo que el cliente necesita
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;
GRANT EXECUTE ON FUNCTION
  public.is_admin(), public.has_access(),
  public.get_new_questions(text, text, int), public.get_simulacro_questions(int),
  public.get_questions_by_ids(uuid[]), public.get_failed_questions(int), public.get_due_reviews(int),
  public.start_session(text, text[], int, int), public.submit_answer(uuid, uuid, text, int),
  public.finish_session(uuid), public.submit_session(uuid, jsonb),
  public.get_my_notifications(), public.mark_notification_read(uuid),
  public.track_event(text, jsonb), public.log_client_error(text, text, text),
  public.export_my_data(), public.delete_my_account(),
  public.admin_delete_user(uuid), public.find_similar_questions(text, float),
  public.admin_analytics(int), public.admin_user_stats(uuid),
  public.admin_funnel(), public.admin_question_stats(int, int), public.admin_get_question(uuid)
TO authenticated;
-- =====================================================================
-- 005 — DATOS INICIALES (no pisa nada existente)
-- =====================================================================
INSERT INTO public.specialties (id, name, color, mir_weight) VALUES
  ('cardio',  'Cardiología',          '#EF4444', 18),
  ('neumo',   'Neumología',           '#0EA5E9', 13),
  ('digest',  'Digestivo',            '#F59E0B', 16),
  ('nefro',   'Nefrología',           '#14B8A6', 11),
  ('neuro',   'Neurología',           '#8B5CF6', 15),
  ('endoc',   'Endocrinología',       '#F97316', 12),
  ('reuma',   'Reumatología',         '#EC4899',  9),
  ('hemato',  'Hematología',          '#DC2626', 11),
  ('onco',    'Oncología',            '#6366F1', 10),
  ('infec',   'Infecciosas',          '#22C55E', 14),
  ('gineco',  'Ginecología',          '#F472B6', 11),
  ('obste',   'Obstetricia',          '#FB7185',  8),
  ('pediatr', 'Pediatría',            '#38BDF8', 15),
  ('psiqui',  'Psiquiatría',          '#A78BFA', 10),
  ('derma',   'Dermatología',         '#FBBF24',  7),
  ('oftalmo', 'Oftalmología',         '#2DD4BF',  6),
  ('orl',     'ORL',                  '#84CC16',  6),
  ('trauma',  'Traumatología',        '#94A3B8', 11),
  ('uro',     'Urología',             '#0D9488',  7)
ON CONFLICT (id) DO NOTHING;

-- Fecha del MIR (cámbiala desde /admin/config)
INSERT INTO public.app_config (key, value) VALUES ('fecha_mir', '2027-01-30') ON CONFLICT (key) DO NOTHING;
-- NOTA: historical_cutoffs NO se siembra: son datos oficiales; impórtalos tú desde tu copia.

-- Usuarios que existan en auth.users pero no tengan perfil (p. ej. tras un reset del esquema public):
-- se les crea como usuarios normales en trial. En su primer login pasarán por el onboarding.
INSERT INTO public.profiles (id, email, full_name, role, subscription_status, onboarding_completed)
SELECT u.id, u.email, COALESCE(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name'), 'user', 'trial', false
  FROM auth.users u LEFT JOIN public.profiles p ON p.id = u.id
 WHERE p.id IS NULL
ON CONFLICT (id) DO NOTHING;

-- ⚠ DESPUÉS DE UNA REINSTALACIÓN LIMPIA NO HAY NINGÚN ADMIN. Ejecuta (con tu email real):
--   UPDATE public.profiles SET role = 'admin' WHERE email = 'TU_EMAIL@dominio.com';
-- =====================================================================
-- 006 — TAREAS PROGRAMADAS (solo si pg_cron está disponible; si no, se avisa y se sigue)
-- =====================================================================
DO $$
BEGIN
  BEGIN
    CREATE EXTENSION IF NOT EXISTS pg_cron;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'pg_cron no disponible: actívalo en Database → Extensions y vuelve a ejecutar este archivo.';
    RETURN;
  END;
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'mirai-expire-access';
  PERFORM cron.schedule('mirai-expire-access', '*/30 * * * *', 'SELECT public.expire_access()');
END $$;
