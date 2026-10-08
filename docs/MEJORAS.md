# Estado de las mejoras de ingeniería

Leyenda: ✅ hecho y probado · 🟡 hecho pero sin poder probarlo contra el servicio real · ⚠️ parcial · ❌ no hecho (con motivo)

| # | Mejora | Estado | Detalle |
|---|---|---|---|
| 1 | Banco de preguntas público | ✅ | Solo `authenticated` con acceso vigente (`has_access()`) y pregunta publicada. El cliente nunca recibe la solución hasta que el servidor corrige. ⚠️ Un usuario **con acceso** aún podría leer la solución por la API a mano: para impedirlo, `sql/optional/ocultar_respuestas.sql` (requiere revisar las páginas sin auditar). |
| 2 | Guardado atómico y no falsificable | ✅ | `start_session`, `submit_answer`, `finish_session`, `submit_session`: transaccionales, idempotentes y corrigen en servidor. Los usuarios ya no pueden escribir en `exam_responses`, `exam_sessions`, `user_question_state` ni `weekly_ranking`. |
| 3 | Sesiones que sobreviven a F5 / cronómetro | ✅ | Store persistente (estudio) y simulacro recuperable (localStorage), reloj real (`endAt`/`startedAt`). Corregido: la entrega automática por tiempo agotado enviaba todo en blanco. |
| 4 | Modelo de contenido | ⚠️ | ✅ `image_url`, `subtopic`, `source`, `status` (borrador/revisada/publicada), `reviewed_by/at`, reportes de usuarios. ❌ No hay subida de imágenes (hace falta un bucket de Storage) ni cola de revisión de borradores en la UI (solo el campo `status` y la moderación de reportes). |
| 5 | Analíticas de admin | ✅ | RPC `admin_analytics`, `admin_user_stats`, `admin_funnel`, `admin_question_stats`; políticas de admin que faltaban. ⚠️ `DashboardPage` y las páginas de `AppPages.jsx` no se han auditado. |
| 6 | Observabilidad | ⚠️ | ✅ Tablas `events` y `client_errors`, `ErrorBoundary`, captura global de errores, embudo en admin. ❌ Sentry/PostHog: requieren cuentas; la solución propia cubre lo esencial. |
| 7 | Stripe | 🟡 | Checkout, portal de cliente y webhook (firma, idempotencia). El plan anual es **pago único hasta el MIR**. No probado con Stripe real. |
| 8 | Emails de ciclo de vida | 🟡 | Función + cron escritos (Resend). No probado; texto legal pendiente. |
| 9 | Legal / RGPD | ⚠️ | ✅ Exportar mis datos y eliminar mi cuenta. ❌ Términos, privacidad, cookies y desistimiento: los debe redactar un abogado. |
| 10 | Infraestructura de producción | ❌ | No es código: planes Pro de Supabase (backups) y Vercel (uso comercial). |
| 11 | Migraciones y entornos | ⚠️ | ✅ `supabase/migrations`, `INSTALL_COMPLETO.sql` (comprobado en CI contra las migraciones). ❌ No he creado un proyecto de staging. |
| 12 | TypeScript + tipos generados | ❌ | Migrar toda la base sin poder ejecutar vuestro build real era más riesgo que beneficio. Siguiente paso: `supabase gen types typescript` y migrar por carpetas. |
| 13 | Tests | ⚠️ | ✅ 31 tests de front (Vitest) + 112 pruebas SQL en PostgreSQL real + CI. ❌ E2E con Playwright (requiere flujo OAuth de Google). |
| 14 | Rendimiento de BD | ✅ | Índices, `(SELECT auth.uid())` en políticas, ranking una vez por sesión. Nota: `ORDER BY random()` es adecuado hasta unos 100k preguntas; después, `TABLESAMPLE`. |
| 15 | Frontend | ⚠️ | ✅ Carga diferida de admin y simulacro; SM-2 duplicado eliminado (ahora solo en servidor). ❌ TanStack Query. |
| — | Móvil | ⚠️ | ✅ Navegador del simulacro en móvil + atajos de teclado. ❌ PWA (faltan iconos exportados). |
| — | FSRS en vez de SM-2 | ❌ | El algoritmo está aislado en `fn_apply_review` para cambiarlo, pero implementarlo bien sin datos reales para validar sería adivinar. |
| — | Coach IA con LLM | ❌ | Hoy son reglas. Decisión de producto: hasta que lo sea, la landing debería decir "coach adaptativo", no "IA generativa". |
| — | Referidos / embajadores | ⚠️ | Stripe permite cupones (`allow_promotion_codes`). Sin panel de embajadores. |
| — | Auditoría y feature flags | ❌ | No hecho. |
| — | `exam_id` (MIR/EIR) | ❌ | No añadido; es barato hacerlo antes de tener miles de filas. |

## Bugs adicionales encontrados y corregidos
- Entrega automática del simulacro con estado obsoleto (enviaba todo en blanco al agotarse el tiempo).
- Tiempo del simulacro fijo en 235 min aunque fuera parcial de 50/100 preguntas; ahora es proporcional.
- No se podía cambiar una respuesta ya confirmada en el simulacro; la última respuesta podía perderse.
- Errores clasificados como `careless` (código) pero mostrados como `descuido` (UI): no se contaban.
- Alta de usuarios desde el admin con `signUp`: cambiaba la sesión del admin por la del nuevo usuario.
- "Leída" de una notificación de difusión se marcaba para todos los usuarios.
- Tasa de acierto calculada sobre un máximo de 1.000 filas; "errores" contaba respuestas, no preguntas distintas.
- `weak_specialties` sesgado (solo miraba preguntas falladas); el selector de dificultad omitía los niveles 2 y 4.
- Importador: aceptaba preguntas cuya letra correcta no estaba entre las opciones.
- `Math.min()` de cortes históricos vacíos mostraba "Infinity".
