-- Programa el envío diario de emails de ciclo de vida (Edge Function send-lifecycle-emails).
-- Requiere: extensiones pg_cron y pg_net activadas (Database → Extensions), la función desplegada
-- y los secrets RESEND_API_KEY, EMAIL_FROM, SITE_URL, CRON_SECRET.
-- Sustituye <REF> y <CRON_SECRET> por tus valores reales.
SELECT cron.schedule('mirai-lifecycle-emails', '0 9 * * *', $$
  SELECT net.http_post(
    url     := 'https://<REF>.supabase.co/functions/v1/send-lifecycle-emails',
    headers := '{"Content-Type":"application/json","x-cron-secret":"<CRON_SECRET>"}'::jsonb,
    body    := '{}'::jsonb);
$$);
