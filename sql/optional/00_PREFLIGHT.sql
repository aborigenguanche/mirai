-- =====================================================================
-- PRE-VUELO: ejecútalo ANTES de INSTALL_COMPLETO.sql (solo lee, no cambia nada)
-- =====================================================================
-- 1) Tablas de public que el instalador NO conoce. El instalador borra TODAS las políticas RLS de
--    public y solo recrea las de sus 20 tablas: estas quedarían sin políticas (con RLS activado = nadie accede).
SELECT '1. tabla desconocida' AS comprobacion, t.tablename, t.rowsecurity AS rls_activado,
       (SELECT count(*) FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = t.tablename) AS politicas_que_se_borrarian
  FROM pg_tables t
 WHERE t.schemaname = 'public' AND t.tablename NOT IN
   ('specialties','profiles','questions','question_options','exam_sessions','exam_responses','user_question_state',
    'notes','notifications','notification_reads','weekly_ranking','historical_cutoffs','import_logs','app_config',
    'subscription_requests','question_reports','events','client_errors','stripe_events','email_log');

-- 2) Duplicados que impedirían crear índices únicos (el instalador ya limpia respuestas, opciones y notas)
SELECT '2. weekly_ranking duplicado' AS comprobacion, user_id::text, week_start::text, count(*) AS filas
  FROM public.weekly_ranking GROUP BY user_id, week_start HAVING count(*) > 1;

-- 3) ¿Dónde está pg_trgm? (el índice usa gin_trgm_ops: debe estar en el search_path, normalmente "extensions")
SELECT '3. pg_trgm' AS comprobacion, e.extname, n.nspname AS esquema
  FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace WHERE e.extname = 'pg_trgm';

-- 4) Funciones que se van a reemplazar: comprueba que firma y retorno coinciden con lo esperado
SELECT '4. funcion existente' AS comprobacion, p.proname, pg_get_function_identity_arguments(p.oid) AS argumentos,
       pg_get_function_result(p.oid) AS retorno
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname IN
   ('is_admin','has_access','handle_new_user','admin_delete_user','find_similar_questions','update_weekly_ranking','expire_trials');

-- 5) Estado de los datos
SELECT '5. usuarios sin perfil (se les creará)' AS comprobacion, count(*)::text AS cuantos
  FROM auth.users u LEFT JOIN public.profiles p ON p.id = u.id WHERE p.id IS NULL;
SELECT '5. admins actuales' AS comprobacion, email FROM public.profiles WHERE role = 'admin';
SELECT '5. preguntas / opciones' AS comprobacion,
       (SELECT count(*) FROM public.questions)::text || ' / ' || (SELECT count(*) FROM public.question_options)::text AS cuantos;
