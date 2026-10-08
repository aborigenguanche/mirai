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
