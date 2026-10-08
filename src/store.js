import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { supabase } from './lib/supabase'; // ← ajusta la ruta si tu store está en una subcarpeta

// ─── Auth Store ────────────────────────────────────────────
export const useAuthStore = create((set) => ({
  profile:  null,
  loading:  true,
  setProfile:   (profile) => set({ profile, loading: false }),
  clearProfile: ()        => set({ profile: null, loading: false }),
  // setLoading: necesario para que useAuth pueda indicar estado de carga
  // antes de que el perfil esté disponible
  setLoading:   (loading) => set({ loading }),

  // Recarga el perfil desde Supabase y actualiza el store
  // Úsalo después de cualquier update de perfil para que toda la app
  // (PlanDiaPage, Coach IA, navbar...) refleje los datos nuevos
  refreshProfile: async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single();
    if (data) set({ profile: data, loading: false });
  },
}));

// ─── Toast Store ───────────────────────────────────────────
let toastId = 0;
export const useToastStore = create((set) => ({
  toasts: [],
  add: (message, type = 'success') => {
    const id = ++toastId;
    set(s => ({ toasts: [...s.toasts, { id, message, type }] }));
    setTimeout(() => set(s => ({ toasts: s.toasts.filter(t => t.id !== id) })), 3500);
  },
  remove: (id) => set(s => ({ toasts: s.toasts.filter(t => t.id !== id) })),
}));

export const toast = {
  success: (m) => useToastStore.getState().add(m, 'success'),
  error:   (m) => useToastStore.getState().add(m, 'error'),
  warning: (m) => useToastStore.getState().add(m, 'warning'),
  info:    (m) => useToastStore.getState().add(m, 'info'),
};

// ─── Notification Store ────────────────────────────────────
export const useNotifStore = create((set) => ({
  notifications: [],
  unread:        0,
  set: (notifications) => set({
    notifications,
    unread: notifications.filter(n => !n.read).length,
  }),
  markRead: (id) => set(s => ({
    notifications: s.notifications.map(n => n.id === id ? { ...n, read: true } : n),
    unread: Math.max(0, s.unread - 1),
  })),
}));

// ─── Exam Store ────────────────────────────────────────────
// Estado de una sesión con feedback inmediato (estudio / errores / repaso).
// · Se persiste en localStorage: un F5 o un cierre accidental NO pierde la sesión.
// · El cronómetro usa el reloj real (startedAt), no un contador que se frena en segundo plano.
// · Las preguntas llegan SIN la respuesta correcta; esta solo se conoce cuando el servidor
//   corrige (resolveAnswer) → no hay nada que copiar del almacenamiento del navegador.
const MAX_SESSION_AGE_MS = 12 * 3600 * 1000;

export const useExamStore = create(persist((set, get) => ({
  ownerId:       null,
  sessionId:     null,
  mode:          'study',   // 'study' | 'errores' | 'repaso'
  questions:     [],
  timeLimitSecs: null,

  phase:         'setup',   // 'setup' | 'exam' | 'review' | 'result'
  current:       0,
  responses:     {},        // { questionId: { letter, isCorrect, correctLetter, explanation, timeSecs, pending, skipped } }
  timerSecs:     0,
  startedAt:     null,
  questionStart: null,

  setupConfig: { mode: 'study', specialtyId: '', difficulty: '', numQuestions: 20, yearExam: '' },
  setSetupConfig: (cfg) => set(s => ({ setupConfig: { ...s.setupConfig, ...cfg } })),

  startExam: ({ sessionId, questions, mode, ownerId, timeLimitSecs = null }) => set({
    ownerId, sessionId, questions, mode, timeLimitSecs,
    phase: 'exam', current: 0, responses: {}, timerSecs: 0,
    startedAt: Date.now(), questionStart: Date.now(),
  }),

  // Registra la elección (pendiente de corrección del servidor). Devuelve el tiempo empleado.
  answer: (questionId, letter) => {
    const { questions, current, responses, questionStart } = get();
    const q = questions[current];
    if (!q || q.id !== questionId || responses[questionId]) return null;
    const timeSecs = Math.max(0, Math.round((Date.now() - questionStart) / 1000));
    set(s => ({ responses: { ...s.responses, [questionId]: { letter, isCorrect: null, pending: true, timeSecs } } }));
    return { timeSecs };
  },
  resolveAnswer: (questionId, fb) => set(s => ({
    responses: { ...s.responses, [questionId]: {
      ...s.responses[questionId], pending: false,
      isCorrect: fb.is_correct, correctLetter: fb.correct_letter, explanation: fb.explanation } },
  })),
  clearResponse: (questionId) => set(s => {
    const r = { ...s.responses }; delete r[questionId]; return { responses: r };
  }),

  next: () => {
    const { current, questions } = get();
    if (current >= questions.length - 1) set({ phase: 'result' });
    else set({ current: current + 1, questionStart: Date.now() });
  },
  skip: () => {
    const { current, questions, responses } = get();
    const q = questions[current];
    if (q && !responses[q.id]) {
      set(s => ({ responses: { ...s.responses, [q.id]: { letter: null, isCorrect: false, skipped: true, timeSecs: 0 } } }));
    }
    get().next();
  },

  goToReview: () => set({ phase: 'review' }),
  goToResult: () => set({ phase: 'result' }),
  tick: () => set(s => ({ timerSecs: s.startedAt ? Math.floor((Date.now() - s.startedAt) / 1000) : s.timerSecs })),

  reset: () => set({
    ownerId: null, sessionId: null, phase: 'setup', questions: [], current: 0, responses: {},
    timerSecs: 0, startedAt: null, questionStart: null, mode: 'study', timeLimitSecs: null,
  }),

  // ¿Hay una sesión guardada que no pertenece a este usuario o es demasiado antigua?
  isStale: (userId) => {
    const { phase, ownerId, startedAt } = get();
    if (phase === 'setup') return false;
    return ownerId !== userId || !startedAt || Date.now() - startedAt > MAX_SESSION_AGE_MS;
  },

  getStats: () => {
    const { questions, responses } = get();
    let correct = 0, wrong = 0, blank = 0;
    questions.forEach(q => {
      const r = responses[q.id];
      if (!r || r.skipped || r.letter === null) blank++;
      else if (r.isCorrect === true) correct++;
      else if (r.isCorrect === false) wrong++;
      else blank++;              // pendiente de corregir
    });
    return { correct, wrong, blank, total: questions.length };
  },
  getCurrentQuestion: () => { const { questions, current } = get(); return questions[current] || null; },
  getResponse: (questionId) => get().responses[questionId] || null,
}), {
  name: 'mirai-exam',
  storage: createJSONStorage(() => localStorage),
  partialize: (s) => ({
    ownerId: s.ownerId, sessionId: s.sessionId, mode: s.mode, questions: s.questions,
    timeLimitSecs: s.timeLimitSecs, phase: s.phase, current: s.current,
    responses: s.responses, startedAt: s.startedAt, setupConfig: s.setupConfig,
  }),
  // Tras recargar: las respuestas "pendientes" se perdieron en vuelo → se descartan para poder repetirlas
  onRehydrateStorage: () => (state) => {
    if (!state) return;
    setTimeout(() => useExamStore.setState({
      questionStart: Date.now(),
      responses: Object.fromEntries(Object.entries(state.responses || {}).filter(([, r]) => !r.pending)),
    }), 0);
  },
}));
