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
