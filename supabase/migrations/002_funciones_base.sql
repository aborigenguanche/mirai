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
