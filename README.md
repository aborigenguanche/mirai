# MIRai — Fix Package

## Qué incluye este paquete

Todos los bugs encontrados y corregidos en la revisión del 11/07/2026.

---

## Estructura de archivos

```
src/
  pages/
    ExamenPage.jsx       ← bugs #1, #4 corregidos
    SimulacroPage.jsx    ← bugs #2, #3, #8 corregidos
    PlanDiaPage.jsx      ← bug #5 corregido
    PerfilPage.jsx       ← página nueva (no existía)
    MisErroresPage.jsx   ← reescrita completa (schema viejo)
  admin/
    AdminPages.jsx       ← bug #7 corregido
  lib/
    supabase.js          ← bugs #9, #10 corregidos
  store.js               ← refreshProfile añadido

supabase/
  functions/
    delete-user/
      index.ts           ← Edge Function nueva (bug #7)
```

---

## Bugs corregidos

### 🔴 Críticos

| # | Bug | Archivo |
|---|---|---|
| 1 | `persistSession` se ejecutaba dos veces (review + result) | ExamenPage.jsx |
| 2 | Última pregunta del simulacro siempre se perdía | SimulacroPage.jsx |
| 3 | `handleFinish` podía ejecutarse dos veces (timer + botón) | SimulacroPage.jsx |

### 🟡 Medios

| # | Bug | Archivo |
|---|---|---|
| 4 | `createSession` siempre guardaba mode: 'study' | ExamenPage.jsx |
| 5 | PlanDiaPage no recargaba al cambiar perfil | PlanDiaPage.jsx |
| 6 | fechaMir no sincronizaba con perfil actualizado | MisErroresPage.jsx |
| 7 | Admin delete solo borraba profiles, no auth.users | AdminPages.jsx + Edge Function |

### 🟠 Menores

| # | Bug | Archivo |
|---|---|---|
| 8 | Especialidades del simulacro se cargaban secuencialmente | SimulacroPage.jsx |
| 9 | getUserAnalytics llamaba a RPC inexistente | supabase.js |
| 10 | fetchSpecialties sin caché (4 requests por página) | supabase.js |

---

## Pasos de instalación

### 1. Copiar archivos src
Reemplaza los archivos existentes con los de este paquete. Las rutas
relativas son las mismas que en tu proyecto.

### 2. Fix del trigger en Supabase (ya aplicado en BD)
El trigger `update_weekly_ranking` tenía un conflicto de nombres que
hacía rollback de todos los inserts en `exam_responses`. Ya está
corregido directamente en la BD — no necesitas hacer nada.

### 3. Deploy la Edge Function delete-user
```bash
supabase functions deploy delete-user
```

### 4. Políticas RLS (ya aplicadas en BD)
Las siguientes políticas ya fueron añadidas durante la sesión:
- `exam_responses`: INSERT y SELECT para usuario propietario
- `user_question_state`: ALL para usuario propietario
- `exam_sessions`: ALL para usuario propietario

### 5. Borrar PracticarPage.jsx
Este archivo usa el schema antiguo (`intentos`, `sesiones`, `preguntas`)
que no existe en la BD actual. Bórralo — ExamenPage.jsx lo reemplaza.

---

## Nota sobre sesiones históricas

Las 13 sesiones anteriores al fix del trigger quedaron sin
`exam_responses` asociadas. Los datos de tasa de acierto partirán
de 0 y se irán acumulando con las nuevas sesiones. No es recuperable.

