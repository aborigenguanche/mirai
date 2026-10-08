# MIRai v3 — paquete completo

Contiene el código de la app, el SQL de instalación completo, las Edge Functions, las pruebas y la CI.
Lee antes `docs/MEJORAS.md` (qué está hecho, qué solo escrito pero sin probar, y qué no).

## 1. Base de datos — dos caminos

**A. Actualizar sin borrar nada (recomendado).** `sql/INSTALL_COMPLETO.sql` es idempotente: crea lo que falta,
añade columnas, limpia duplicados, **sustituye todas las políticas RLS** y respeta tus datos.
0. Ejecuta `sql/optional/00_PREFLIGHT.sql` y revisa el resultado (tablas que el instalador no conoce, etc.).
1. Copia de seguridad (Database → Backups, o `supabase db dump`).
2. SQL Editor → pega `sql/INSTALL_COMPLETO.sql` → Run (se puede ejecutar varias veces).
3. Si hace falta, promueve un admin: `UPDATE public.profiles SET role='admin' WHERE email='TU_EMAIL';`

**B. Empezar totalmente de cero.** ⚠️ Destructivo. Antes: copia de seguridad y **exporta tus preguntas y la tabla
`historical_cutoffs`** (el instalador no siembra datos oficiales). Luego: `sql/optional/00_RESET_DESTRUCTIVO.sql` →
`sql/INSTALL_COMPLETO.sql` → promover admin (arriba) → reimportar preguntas. Las cuentas de `auth.users` se conservan
y sus perfiles se recrean. **No borres el proyecto de Supabase** (perderías el login con Google, las URL de callback y los usuarios).

Probado contra PostgreSQL real: instalación limpia, segunda ejecución, actualización de una BD antigua con datos,
y reset + reinstalación (`sql/tests/`).

## 2. Código
- Copia `src/` encima de tu proyecto. Borra lo obsoleto: `pages/app/PracticarPage.jsx`, la carpeta `src/store/`
  (queda `src/store.js`), `hooks/useSpacedRepetition*` y `lib/spaced-repetition*`.
- `.env`: `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` (ver `.env.example`; también en Vercel → Environment Variables).
- Tests: `npm i -D vitest` y en `package.json` → `"scripts": { "test": "vitest run" }`.
- Supabase → Authentication → URL Configuration: Site URL y Redirect URLs con tu dominio de Vercel.

## 3. Cambios de comportamiento que debes conocer
- Los usuarios **ya no escriben resultados**: cualquier página que lo hiciera directamente fallará.
  Solo se ha eliminado un export (`updateWeakSpecialties`); `saveResponses`/`upsertQuestionState` lanzan un error explicativo.
- Un usuario sin acceso vigente no ve el banco (es lo previsto: el paywall).
- El plan "anual" es un pago único con acceso hasta el MIR (+7 días). Los importes del modal (`PaywallModal.jsx`) son
  orientativos: deben coincidir con los precios de Stripe.
- Errores nuevos se guardan como `descuido` / `confusion` / `conceptual`.

## 4. Stripe y emails (opcionales, **sin probar contra los servicios reales**)
`supabase/functions/README.md`. Mientras no estén desplegados, el paywall registra la solicitud en
`subscription_requests` y activas el plan a mano desde `/admin/usuarios`.

## 5. Prueba de humo tras instalar (10 min)
1. Cuenta normal: `await supabase.from('profiles').update({role:'admin'}).eq('id', …)` → **debe fallar**.
2. Cuenta nueva con Google → onboarding → `/app/plan`.
3. Sesión de estudio: responde, falla alguna → aparece la explicación y luego en Mis errores.
4. F5 en mitad de una sesión → se recupera. F5 en mitad de un simulacro → se recupera y el reloj sigue.
5. SQL: `UPDATE profiles SET trial_ends_at = now() - interval '1 day' WHERE email='…'` → recarga → paywall; las preguntas desaparecen.
6. Importa un CSV con una explicación con salto de línea; prueba una fila con la letra correcta ausente (debe rechazarla).
7. Admin: Analytics, Moderación, crear usuario (tu sesión no debe cambiar) y borrar usuario.

## 6. Sin auditar (nunca vi su código)
`AppPages.jsx` (probablemente Ranking, Notificaciones, Estadísticas, Notas), `LoginPage`, `CheckoutPage`,
`DashboardPage`, `PreguntasPage`, `components/ui`. Súbelos y los reviso.
