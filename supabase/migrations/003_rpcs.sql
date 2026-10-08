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
