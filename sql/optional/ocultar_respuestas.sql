-- =====================================================================
-- OPCIONAL (avanzado) — Ocultar a nivel de columna la solución y la explicación
-- =====================================================================
-- Con INSTALL_COMPLETO.sql la app ya NO pide la respuesta correcta al servidor hasta que corrige,
-- y un usuario sin acceso vigente no puede leer el banco. Pero un usuario CON acceso podría llamar a
-- la API a mano y leer questions.correct_option_letter / explanation de todo el banco.
-- Este script lo impide: solo se podrá obtener la solución respondiendo (submit_answer /
-- submit_session) o mediante las RPC de admin.
--
-- ⚠ ANTES DE ACTIVARLO: cualquier página que haga  select('*')  o pida esas columnas a la tabla
-- fallará con "permission denied" (la app de este paquete ya está preparada; revisa las páginas que
-- no se han auditado: Preguntas del admin, Estadísticas, Notas, AppPages.jsx…).
-- =====================================================================
REVOKE SELECT ON public.questions FROM authenticated;
GRANT SELECT (id, text, difficulty, year_exam, question_number, specialty_id, is_active, created_at,
              image_url, subtopic, source, status, reviewed_by, reviewed_at)
  ON public.questions TO authenticated;
-- Para deshacerlo:  GRANT SELECT ON public.questions TO authenticated;
