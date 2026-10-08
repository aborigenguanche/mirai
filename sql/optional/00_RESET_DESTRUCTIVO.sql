-- =====================================================================
-- ⚠⚠⚠ DESTRUCTIVO — BORRA TODOS LOS DATOS DE LA APLICACIÓN ⚠⚠⚠
-- Elimina el esquema "public" entero: preguntas, sesiones, respuestas, notas, perfiles,
-- configuración… NO toca auth.users (las cuentas de Google siguen existiendo; sus perfiles se
-- recrean con INSTALL_COMPLETO.sql). Haz ANTES una copia (Database → Backups, o `supabase db dump`)
-- y exporta tus preguntas y la tabla historical_cutoffs.
--
-- ¿Lo necesitas? Normalmente NO: INSTALL_COMPLETO.sql también actualiza una BD existente
-- sin perder datos. Úsalo solo si quieres empezar completamente de cero.
-- Orden: 1) este archivo  2) INSTALL_COMPLETO.sql  3) UPDATE ... SET role='admin' (ver 005)
-- =====================================================================
DROP SCHEMA public CASCADE;
CREATE SCHEMA public;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT ALL   ON SCHEMA public TO postgres, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES    TO postgres, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres, service_role;
