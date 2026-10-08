import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// localStorage mínimo (el entorno de pruebas es Node)
const mem = {};
globalThis.localStorage = {
  getItem: k => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); },
  removeItem: k => { delete mem[k]; }, clear: () => Object.keys(mem).forEach(k => delete mem[k]),
};
vi.mock('../lib/supabase', () => ({ supabase: {} }));
const { useExamStore } = await import('../store');

const Q = [1, 2, 3].map(i => ({ id: 'q' + i, text: 'Pregunta ' + i, options: [{ letter: 'a', text: 'A' }, { letter: 'b', text: 'B' }] }));
const st = () => useExamStore.getState();
const start = () => st().startExam({ sessionId: 's1', questions: Q, mode: 'study', ownerId: 'u1' });

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-01-01T10:00:00Z')); st().reset(); localStorage.clear(); });
afterEach(() => vi.useRealTimers());

describe('store de examen', () => {
  it('las preguntas no contienen la respuesta correcta (la corrige el servidor)', () => {
    start();
    expect(JSON.stringify(st().questions)).not.toMatch(/correct_option_letter|explanation/);
  });
  it('answer registra la elección como pendiente y devuelve el tiempo empleado', () => {
    start(); vi.advanceTimersByTime(7000);
    const r = st().answer('q1', 'a');
    expect(r.timeSecs).toBe(7);
    expect(st().responses.q1).toMatchObject({ letter: 'a', pending: true, isCorrect: null });
  });
  it('no se puede responder dos veces ni otra pregunta que no es la actual', () => {
    start();
    expect(st().answer('q1', 'a')).not.toBeNull();
    expect(st().answer('q1', 'b')).toBeNull();
    expect(st().answer('q3', 'a')).toBeNull();
  });
  it('resolveAnswer guarda la corrección del servidor; clearResponse permite reintentar', () => {
    start(); st().answer('q1', 'a');
    st().resolveAnswer('q1', { is_correct: false, correct_letter: 'b', explanation: 'Porque sí' });
    expect(st().responses.q1).toMatchObject({ pending: false, isCorrect: false, correctLetter: 'b', explanation: 'Porque sí' });
    st().clearResponse('q1');
    expect(st().responses.q1).toBeUndefined();
  });
  it('getStats: aciertos, fallos y blancos (saltadas y pendientes cuentan como blanco)', () => {
    start();
    st().answer('q1', 'a'); st().resolveAnswer('q1', { is_correct: true, correct_letter: 'a' });
    st().next(); st().answer('q2', 'a'); st().resolveAnswer('q2', { is_correct: false, correct_letter: 'b' });
    st().next(); st().skip();
    expect(st().getStats()).toEqual({ correct: 1, wrong: 1, blank: 1, total: 3 });
    expect(st().phase).toBe('result');
  });
  it('el cronómetro usa el reloj real, no un contador', () => {
    start(); vi.advanceTimersByTime(90_000); st().tick();
    expect(st().timerSecs).toBe(90);
  });
  it('isStale: sesión de otro usuario o de más de 12 h se descarta', () => {
    start();
    expect(st().isStale('u1')).toBe(false);
    expect(st().isStale('otro')).toBe(true);
    vi.advanceTimersByTime(13 * 3600 * 1000);
    expect(st().isStale('u1')).toBe(true);
  });
  it('se persiste en localStorage y NO incluye questionStart', () => {
    start(); st().answer('q1', 'a');
    const saved = JSON.parse(localStorage.getItem('mirai-exam')).state;
    expect(saved.sessionId).toBe('s1');
    expect(saved).not.toHaveProperty('questionStart');
  });
  it('al recargar se descartan las respuestas que quedaron "pendientes" en vuelo', async () => {
    start(); st().answer('q1', 'a');                          // pendiente
    st().next(); st().answer('q2', 'b'); st().resolveAnswer('q2', { is_correct: true, correct_letter: 'b' });
    await useExamStore.persist.rehydrate();
    await vi.advanceTimersByTimeAsync(5);
    expect(st().responses.q1).toBeUndefined();
    expect(st().responses.q2).toBeDefined();
  });
});
