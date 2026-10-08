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
