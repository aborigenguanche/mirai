// ═══════════════════════════════════════════════════════════
// MIRIAI — Fórmula MIR y simulacro
// ═══════════════════════════════════════════════════════════

// Parámetros reales MIR 2024
export const MIR_CONFIG = {
  totalQuestions:     210,
  correctPoints:      3,
  wrongPoints:        -1,
  blankPoints:        0,
  maxScore:           630,   // 210 * 3
  totalSpots:         8093,  // plazas MIR 2024 aprox
  totalCandidates:    14832, // presentados MIR 2024
  distributionBySpecialty: {
    cardio:  18, neumo: 13, digest: 16, nefro: 11, neuro: 15,
    endoc:   12, reuma: 9,  hemato: 11, onco: 10,  infec: 14,
    gineco:  11, obste: 8,  pediatr: 15, psiqui: 10, derma: 7,
    oftalmo: 6,  orl: 6,   trauma: 11, uro: 7,
  },
};

/**
 * Calcula la puntuación MIR bruta
 */
export function calcMirScore({ correct, wrong, blank }) {
  return (correct * MIR_CONFIG.correctPoints)
       + (wrong   * MIR_CONFIG.wrongPoints)
       + (blank   * MIR_CONFIG.blankPoints);
}

/**
 * Extrapola la puntuación a 210 preguntas
 */
export function extrapolateScore({ correct, wrong, blank, totalAnswered }) {
  const pctCorrect = correct / Math.max(totalAnswered, 1);
  const pctWrong   = wrong   / Math.max(totalAnswered, 1);
  const pctBlank   = blank   / Math.max(totalAnswered, 1);

  const extCorrect = Math.round(pctCorrect * MIR_CONFIG.totalQuestions);
  const extWrong   = Math.round(pctWrong   * MIR_CONFIG.totalQuestions);
  const extBlank   = MIR_CONFIG.totalQuestions - extCorrect - extWrong;

  return {
    correct: extCorrect, wrong: extWrong, blank: extBlank,
    score:   calcMirScore({ correct: extCorrect, wrong: extWrong, blank: extBlank }),
  };
}

/**
 * Calcula el percentil aproximado basándose en datos históricos
 * Curva normal aproximada centrada en 350 con SD ~80
 */
export function calcPercentile(score) {
  const mean = 350;
  const sd   = 80;
  const z    = (score - mean) / sd;
  return Math.min(99.9, Math.max(0.1, Math.round(normalCDF(z) * 100 * 10) / 10));
}

function normalCDF(z) {
  const a1 =  0.254829592, a2 = -0.284496736, a3 = 1.421413741;
  const a4 = -1.453152027, a5 =  1.061405429, p  = 0.3275911;
  const sign = z < 0 ? -1 : 1;
  z = Math.abs(z) / Math.sqrt(2);
  const t = 1 / (1 + p * z);
  const y = 1 - ((((a5*t + a4)*t + a3)*t + a2)*t + a1) * t * Math.exp(-z*z);
  return 0.5 * (1 + sign * y);
}

/**
 * Predice la especialidad que podría obtener
 */
export function predictSpecialty(score, cutoffs) {
  if (!cutoffs?.length) return null;
  const reachable = cutoffs
    .filter(c => score >= c.min_score)
    .sort((a, b) => b.min_score - a.min_score);
  return reachable[0] || null;
}

/**
 * Calcula qué especialidades son alcanzables y cuáles no
 */
export function analyzeSpecialties(score, cutoffs) {
  return cutoffs.map(c => ({
    ...c,
    reachable: score >= c.min_score,
    gap:       Math.round(c.min_score - score),
    margin:    Math.round(score - c.min_score),
  })).sort((a, b) => a.gap - b.gap);
}

/**
 * Genera el número de orden estimado
 */
export function estimateOrder(score) {
  const pct     = calcPercentile(score) / 100;
  const aboveMe = Math.round((1 - pct) * MIR_CONFIG.totalCandidates);
  return aboveMe + 1;
}

/**
 * Calcula la puntuación necesaria para una especialidad objetivo
 */
export function scoreNeededFor(specialty, cutoffs) {
  const c = cutoffs.find(x => x.specialty?.id === specialty || x.specialty_id === specialty);
  return c ? c.min_score : null;
}

/**
 * Análisis de rendimiento por especialidad MIR
 * Compara el % de acierto del usuario con el peso de cada especialidad
 */
export function analyzeBySpecialty(responses, specialties) {
  const map = {};
  responses.forEach(r => {
    const sid = r.question?.specialty?.id;
    if (!sid) return;
    if (!map[sid]) map[sid] = { correct: 0, wrong: 0, blank: 0, total: 0, name: r.question?.specialty?.name };
    map[sid].total++;
    if (r.selected_option_letter === null) map[sid].blank++;
    else if (r.is_correct)                 map[sid].correct++;
    else                                   map[sid].wrong++;
  });

  return specialties.map(sp => {
    const d   = map[sp.id] || { correct: 0, wrong: 0, blank: 0, total: 0 };
    const pct = d.total ? Math.round((d.correct / d.total) * 100) : null;
    const mirScore = calcMirScore(d);
    return {
      ...sp,
      ...d, pct, mirScore,
      impact: Math.round((sp.mir_weight || 5) * (pct || 0) / 100),
      status: pct === null ? 'unseen'
            : pct >= 70   ? 'strong'
            : pct >= 50   ? 'medium'
            :                'weak',
    };
  }).sort((a, b) => (a.pct ?? -1) - (b.pct ?? -1));
}

/**
 * Tiempo recomendado por pregunta en el MIR real
 */
export const MIR_TIME_PER_Q = Math.floor((3 * 60 + 55) / 210); // ~68 segundos

/**
 * Evalúa si el tiempo fue adecuado
 */
export function evaluateTime(seconds) {
  if (seconds < 10)  return 'rush';    // demasiado rápido
  if (seconds < 30)  return 'fast';    // rápido
  if (seconds < 90)  return 'normal';  // normal
  if (seconds < 150) return 'slow';    // lento
  return 'very_slow';                  // muy lento
}

/**
 * Clasifica el tipo de error
 */
export function classifyError(isCorrect, correctLetter, chosenLetter, seconds) {
  if (isCorrect) return null;
  if (seconds < 10) return 'careless';
  const order  = ['a','b','c','d','e'];
  const idxC   = order.indexOf(correctLetter);
  const idxCh  = order.indexOf(chosenLetter);
  if (idxC >= 0 && idxCh >= 0 && Math.abs(idxC - idxCh) === 1) return 'confusion';
  return 'conceptual';
}

/**
 * SM-2 simplificado
 */
export function sm2(state, quality) {
  let { interval_days: interval = 1, repetitions = 0, ease_factor: ef = 2.5 } = state;
  if (quality >= 3) {
    if      (repetitions === 0) interval = 1;
    else if (repetitions === 1) interval = 6;
    else                        interval = Math.round(interval * ef);
    repetitions++;
  } else {
    repetitions = 0; interval = 1;
  }
  ef = Math.max(1.3, ef + 0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
  const d = new Date(); d.setDate(d.getDate() + interval);
  return { interval_days: interval, repetitions, ease_factor: ef, next_review: d.toISOString().split('T')[0] };
}

export function calcQuality(isCorrect, seconds) {
  if (!isCorrect) return seconds < 10 ? 1 : 0;
  if (seconds < 15) return 5;
  if (seconds < 30) return 4;
  return 3;
}
