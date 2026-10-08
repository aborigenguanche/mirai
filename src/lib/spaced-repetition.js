// ═══════════════════════════════════════════════════════════
// MIRIAI — Algoritmo SM-2 (Spaced Repetition)
// ═══════════════════════════════════════════════════════════

/**
 * Clasifica el tipo de error según tiempo y opción elegida
 * @param {boolean} esCorrecta
 * @param {string}  respuestaCorrecta  'a'|'b'|'c'|'d'|'e'
 * @param {string}  respuestaDada
 * @param {number}  tiempoSecs
 * @returns {'conceptual'|'confusion'|'descuido'|null}
 */
export function clasificarError(esCorrecta, respuestaCorrecta, respuestaDada, tiempoSecs) {
  if (esCorrecta) return null;

  // Descuido: respuesta muy rápida (< 8s) — leyó mal el enunciado
  if (tiempoSecs < 8) return 'descuido';

  // Confusión: eligió opción adyacente a la correcta
  const orden = ['a','b','c','d','e'];
  const idxCorrecta = orden.indexOf(respuestaCorrecta);
  const idxDada     = orden.indexOf(respuestaDada);
  if (Math.abs(idxCorrecta - idxDada) === 1) return 'confusion';

  // Conceptual: tardó mucho (> 30s) o eligió opción muy diferente
  return 'conceptual';
}

/**
 * Algoritmo SM-2 — calcula el nuevo estado de la tarjeta
 * @param {object} estado  { intervalo, repeticiones, facilidad }
 * @param {number} calidad 0-5 (0-1 fail, 2 barely pass, 3-5 pass)
 * @returns {{ intervalo, repeticiones, facilidad, proximaRevision }}
 */
export function sm2(estado, calidad) {
  let { intervalo, repeticiones, facilidad } = estado;

  if (calidad >= 3) {
    // Respuesta correcta
    if (repeticiones === 0)      intervalo = 1;
    else if (repeticiones === 1) intervalo = 6;
    else                         intervalo = Math.round(intervalo * facilidad);
    repeticiones++;
  } else {
    // Respuesta incorrecta — reiniciar
    repeticiones = 0;
    intervalo    = 1;
  }

  // Actualizar factor de facilidad (mínimo 1.3)
  facilidad = Math.max(1.3, facilidad + 0.1 - (5 - calidad) * (0.08 + (5 - calidad) * 0.02));

  const hoy = new Date();
  hoy.setDate(hoy.getDate() + intervalo);
  const proximaRevision = hoy.toISOString().split('T')[0];

  return { intervalo, repeticiones, facilidad, proximaRevision };
}

/**
 * Convierte tiempo + corrección en calidad SM-2 (0-5)
 */
export function calcularCalidad(esCorrecta, tiempoSecs) {
  if (!esCorrecta) {
    if (tiempoSecs < 8)  return 1; // descuido — casi sabía
    if (tiempoSecs < 30) return 0; // no sabía
    return 0;
  }
  // Correcta — calidad según velocidad
  if (tiempoSecs < 10) return 5; // rápido y correcto
  if (tiempoSecs < 25) return 4;
  if (tiempoSecs < 45) return 3;
  return 3; // lento pero correcto
}

/**
 * Genera el plan de estudio del día
 */
export function generarPlanDia({ especialidades, diasAlMir, horasDisponibles = 2 }) {
  const pregsPerHour = 25;
  const totalPregs   = Math.round(horasDisponibles * pregsPerHour);

  // Distribución recomendada
  const repaso   = Math.round(totalPregs * 0.4); // 40% repaso spaced
  const errores  = Math.round(totalPregs * 0.25); // 25% errores frecuentes
  const nuevas   = Math.round(totalPregs * 0.35); // 35% preguntas nuevas

  // Especialidades prioritarias (las más débiles)
  const prioritarias = [...especialidades]
    .sort((a, b) => a.pct - b.pct)
    .slice(0, 3);

  // Urgencia según días al MIR
  let urgencia = 'normal';
  if (diasAlMir !== null) {
    if (diasAlMir < 30)  urgencia = 'critica';
    else if (diasAlMir < 90)  urgencia = 'alta';
    else if (diasAlMir < 180) urgencia = 'media';
  }

  return { repaso, errores, nuevas, prioritarias, urgencia, totalPregs };
}

/**
 * Mensajes del Coach según rendimiento
 */
export function mensajeCoach({ tasa, racha, diasAlMir, peorEsp, tipoErrorMasFrecuente }) {
  const msgs = [];

  if (diasAlMir !== null && diasAlMir < 30) {
    msgs.push({ tipo: 'urgente', texto: `Quedan ${diasAlMir} días para el MIR. Cada sesión cuenta.` });
  }

  if (tipoErrorMasFrecuente === 'conceptual') {
    msgs.push({ tipo: 'consejo', texto: `Tus errores son principalmente conceptuales en ${peorEsp}. Dedica 20 minutos a leer el capítulo antes de practicar.` });
  } else if (tipoErrorMasFrecuente === 'confusion') {
    msgs.push({ tipo: 'consejo', texto: `Confundes opciones similares. Cuando dudes, descarta activamente cada opción incorrecta antes de elegir.` });
  } else if (tipoErrorMasFrecuente === 'descuido') {
    msgs.push({ tipo: 'consejo', texto: `Cometes errores por velocidad. Lee el enunciado completo antes de mirar las opciones.` });
  }

  if (tasa >= 70) {
    msgs.push({ tipo: 'positivo', texto: `${tasa}% de acierto. Estás por encima del corte. Mantén el ritmo.` });
  } else if (tasa >= 55) {
    msgs.push({ tipo: 'neutro', texto: `Estás a ${65 - tasa}pp del corte. Enfócate en ${peorEsp}.` });
  } else {
    msgs.push({ tipo: 'alerta', texto: `Necesitas reforzar los conceptos básicos antes de seguir avanzando.` });
  }

  if (racha >= 7) {
    msgs.push({ tipo: 'positivo', texto: `${racha} días de racha. La constancia es lo que más diferencia a los que aprueban.` });
  }

  return msgs[0] || { tipo: 'neutro', texto: 'Sigue practicando.' };
}
