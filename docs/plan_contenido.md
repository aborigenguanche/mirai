# MIRai — Plan de generación de contenido
## Sprint inicial: 100+ preguntas/semana

---

## 1. Distribución por especialidad

Basado en el peso real de cada especialidad en el examen MIR
(ya definido en vuestro `mir-scoring.js`). Para un banco inicial
de 1.000 preguntas, esta es la distribución proporcional:

| Especialidad    | Peso MIR | Preguntas objetivo (de 1.000) |
|------------------|:---:|:---:|
| Cardiología      | 18  | 86  |
| Digestivo        | 16  | 76  |
| Neurología       | 15  | 71  |
| Pediatría        | 15  | 71  |
| Infecciosas      | 14  | 67  |
| Neumología       | 13  | 62  |
| Endocrinología   | 12  | 57  |
| Ginecología      | 11  | 52  |
| Hematología      | 11  | 52  |
| Nefrología       | 11  | 52  |
| Traumatología    | 11  | 52  |
| Psiquiatría      | 10  | 48  |
| Oncología        | 10  | 48  |
| Reumatología     | 9   | 43  |
| Obstetricia      | 8   | 38  |
| Dermatología     | 7   | 33  |
| Urología         | 7   | 33  |
| ORL              | 6   | 29  |
| Oftalmología     | 6   | 29  |
| **TOTAL**        | 210 | **1.000** |

Seguir esta proporción evita el error típico de acumular 300
preguntas de cardio y 5 de ORL — el simulacro necesita cobertura
real de todas las especialidades para funcionar bien.

---

## 2. División del trabajo por especialidad

Repartíos las 19 especialidades según lo que cada uno domine
mejor de la carrera hasta ahora. Sugerencia de reparto equilibrado
(ajustad según vuestras rotaciones/intereses reales):

**Persona A** — especialidades más volumen clínico:
Cardiología, Digestivo, Neumología, Endocrinología, Nefrología,
Hematología, Reumatología, Oncología, Infecciosas

**Persona B** — resto:
Neurología, Pediatría, Ginecología, Obstetricia, Traumatología,
Psiquiatría, Dermatología, Urología, ORL, Oftalmología

Cada uno es responsable de la calidad clínica final de sus
especialidades — no solo generar, sino ser quien firma que esas
preguntas están bien.

---

## 3. Flujo de trabajo por pregunta

```
1. Seleccionar año + especialidad de examen oficial
   (ej: MIR 2022, preguntas de Cardiología)
        ↓
2. Pasar el PDF/texto a Claude con el prompt de generación
   (plantilla en sección 4)
        ↓
3. Claude devuelve la pregunta parafraseada + variada
   en formato CSV listo para importar
        ↓
4. Responsable de esa especialidad revisa:
   - ¿La pregunta tiene sentido clínico?
   - ¿La explicación es correcta?
   - ¿El nivel de dificultad es razonable?
        ↓
5. Acumular en lote de ~20-30 preguntas
        ↓
6. Importar desde /admin/importar
   → Comprobar duplicados (ya implementado)
   → Importar las que pasen el filtro
```

---

## 4. Prompt de generación reutilizable

Guardad esto como plantilla. Pegad el texto del examen oficial
(o el capítulo de bibliografía) donde indica, y Claude devuelve
el CSV listo para vuestro formato de importación.

```
Eres un experto en medicina y en el examen MIR español. Voy a
pasarte el texto de una pregunta de examen MIR oficial (o de un
capítulo de bibliografía médica). Tu tarea:

1. Si es una pregunta MIR oficial: parafraséala completamente
   (cambia el caso clínico, los datos del paciente, el orden de
   las opciones) manteniendo el mismo concepto médico evaluado.
   No copies el texto literal.

2. Si es bibliografía: genera una pregunta MIR nueva sobre el
   concepto clave del texto, con formato de caso clínico realista.

3. Genera 4-5 opciones de respuesta plausibles (los distractores
   deben ser errores comunes reales, no absurdos).

4. Escribe una explicación clara de por qué la respuesta correcta
   lo es, y por qué las demás no.

Devuelve el resultado en este formato CSV exacto, una fila por
pregunta, con las comillas dobles escapadas correctamente:

text,specialty_id,correct_option_letter,difficulty,year_exam,explanation,option_a,option_b,option_c,option_d,option_e,subtopic,source,status,image_url

specialty_id debe ser uno de: cardio, neumo, digest, nefro, neuro,
endoc, reuma, hemato, onco, infec, gineco, obste, pediatr, psiqui,
derma, oftalmo, orl, trauma, uro

difficulty es un número 1-5 (1=fácil, 5=difícil)

subtopic: subtema libre (p. ej. "Insuficiencia cardiaca"). source: official | original | adapted.
status: published (visible) o draft (oculta hasta revisarla). image_url: vacío salvo que haya imagen.
El importador rechaza las filas cuya letra correcta no esté entre las opciones.

Aquí está el texto de origen:

[PEGAR AQUÍ EL TEXTO DEL EXAMEN O BIBLIOGRAFÍA]
```

---

## 5. Ritmo semanal sugerido (100+/semana)

Con dos personas, ~50-60 preguntas cada uno por semana es
sostenible compaginando con la facultad:

```
Lunes-Martes    → Generación con Claude (lote de 30-40)
Miércoles-Jueves → Validación médica de vuestro propio lote
Viernes         → Importación conjunta + comprobación duplicados
Fin de semana   → Buffer / especialidades que hayan quedado atrás
```

A este ritmo:

| Semana | Preguntas acumuladas |
|---|---|
| 2   | 200  |
| 4   | 400  |
| 6   | 600  |
| 8   | 800  |
| 10  | 1.000 ✓ objetivo inicial |

---

## 6. Seguimiento de progreso

Llevad un control simple — puede ser una hoja de cálculo compartida
o directamente una tabla en Supabase. Lo mínimo a trackear:

| Especialidad | Objetivo | Generadas | Validadas | Importadas | Responsable |
|---|---|---|---|---|---|
| Cardiología | 86 | 0 | 0 | 0 | Persona A |
| ... | ... | ... | ... | ... | ... |

Esto os deja ver de un vistazo qué especialidades van atrasadas
antes de que sea demasiado tarde para nivelarlas.

---

## 7. Checklist de calidad antes de importar cada lote

Antes de dar el visto bueno a un lote, cada responsable confirma:

- [ ] El caso clínico es realista y coherente (edad, síntomas, contexto)
- [ ] Solo hay una respuesta correcta objetivamente
- [ ] Los distractores son errores plausibles, no absurdos
- [ ] La explicación es correcta y está bien argumentada
- [ ] No es traducción/copia literal de ningún examen oficial
- [ ] La dificultad asignada es razonable
- [ ] specialty_id coincide con la tabla `specialties` de la BD

---

## Próximo paso después de 1.000 preguntas

Con 1.000 preguntas bien distribuidas ya podéis:
- Abrir la beta cerrada gratuita (15-20 personas)
- El simulacro completo (210 preguntas) tiene margen de sobra
- El sistema de errores/repaso tiene suficiente variedad

De ahí seguís generando hacia los 3.000-5.000 para el lanzamiento
público, ya con feedback real de la beta guiando qué especialidades
o tipos de pregunta necesitan más profundidad.
