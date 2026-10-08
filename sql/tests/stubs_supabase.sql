-- Simula lo que Supabase ya trae: roles, esquema auth y auth.uid()
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE auth.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text, raw_user_meta_data jsonb DEFAULT '{}'::jsonb, created_at timestamptz DEFAULT now());
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT USAGE ON SCHEMA public, auth, extensions TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
-- Si pg_trgm no está disponible (sandbox), simulamos similarity(); en Postgres normal/Supabase se usa la real
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_available_extensions WHERE name = 'pg_trgm') THEN
    EXECUTE 'CREATE FUNCTION extensions.similarity(a text, b text) RETURNS real LANGUAGE sql IMMUTABLE AS $f$ SELECT CASE WHEN a = b THEN 1.0 ELSE 0.1 END::real $f$';
    EXECUTE 'GRANT EXECUTE ON FUNCTION extensions.similarity(text, text) TO PUBLIC';
  END IF;
END $$;
-- Ayudantes de aserción
CREATE SCHEMA test;
CREATE TABLE test.results (ok boolean, name text);
GRANT USAGE ON SCHEMA test TO PUBLIC; GRANT ALL ON test.results TO PUBLIC;
CREATE FUNCTION test.ok(cond boolean, name text) RETURNS void LANGUAGE plpgsql AS
  $$ BEGIN INSERT INTO test.results VALUES (COALESCE(cond, false), name); END $$;
CREATE FUNCTION test.throws(q text, name text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE q; INSERT INTO test.results VALUES (false, name || '  [NO lanzó error]');
  EXCEPTION WHEN OTHERS THEN INSERT INTO test.results VALUES (true, name); END;
END $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA test TO PUBLIC;
