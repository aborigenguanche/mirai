import { describe, it, expect } from 'vitest';
import { MIR_CONFIG, calcMirScore, extrapolateScore, calcPercentile, estimateOrder,
         analyzeSpecialties, analyzeBySpecialty } from '../mir-scoring';

describe('puntuación MIR (+3 / -1 / 0)', () => {
  it('calcMirScore', () => {
    expect(calcMirScore({ correct: 10, wrong: 2, blank: 3 })).toBe(28);
    expect(calcMirScore({ correct: 0, wrong: 5, blank: 0 })).toBe(-5);
    expect(calcMirScore({ correct: 210, wrong: 0, blank: 0 })).toBe(MIR_CONFIG.maxScore);
  });
  it('extrapolateScore escala a 210 preguntas y suma 210', () => {
    const e = extrapolateScore({ correct: 50, wrong: 25, blank: 25, totalAnswered: 100 });
    expect(e.correct + e.wrong + e.blank).toBe(210);
    expect(e.score).toBe(e.correct * 3 - e.wrong);
  });
  it('los pesos por especialidad suman exactamente 210', () => {
    expect(Object.values(MIR_CONFIG.distributionBySpecialty).reduce((a, b) => a + b, 0)).toBe(210);
  });
});

describe('percentil y número de orden', () => {
  it('el percentil es creciente y ~50 en la media (350)', () => {
    expect(calcPercentile(350)).toBeGreaterThan(45);
    expect(calcPercentile(350)).toBeLessThan(55);
    expect(calcPercentile(450)).toBeGreaterThan(calcPercentile(300));
  });
  it('estimateOrder: mejor nota → mejor (menor) puesto, siempre ≥ 1', () => {
    expect(estimateOrder(500)).toBeLessThan(estimateOrder(300));
    expect(estimateOrder(630)).toBeGreaterThanOrEqual(1);
  });
});

describe('análisis de especialidades', () => {
  const cutoffs = [{ specialty_id: 'a', min_score: 400 }, { specialty_id: 'b', min_score: 300 }];
  it('alcanzables, margen y diferencia', () => {
    const r = analyzeSpecialties(350, cutoffs);
    const a = r.find(x => x.specialty_id === 'a'), b = r.find(x => x.specialty_id === 'b');
    expect(a.reachable).toBe(false); expect(a.gap).toBe(50);
    expect(b.reachable).toBe(true);  expect(b.margin).toBe(50);
  });
  it('con cutoffs vacíos no rompe', () => { expect(analyzeSpecialties(300, [])).toEqual([]); });
  it('analyzeBySpecialty cuenta aciertos, fallos y blancos', () => {
    const specs = [{ id: 'cardio', name: 'Cardiología', mir_weight: 18 }, { id: 'neumo', name: 'Neumología', mir_weight: 13 }];
    const rows = [
      { question: { specialty: { id: 'cardio' } }, selected_option_letter: 'a', is_correct: true },
      { question: { specialty: { id: 'cardio' } }, selected_option_letter: 'b', is_correct: false },
      { question: { specialty: { id: 'cardio' } }, selected_option_letter: null, is_correct: false },
    ];
    const c = analyzeBySpecialty(rows, specs).find(x => x.id === 'cardio');
    expect([c.correct, c.wrong, c.blank, c.total]).toEqual([1, 1, 1, 3]);
    expect(analyzeBySpecialty(rows, specs).find(x => x.id === 'neumo').status).toBe('unseen');
  });
});
