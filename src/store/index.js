import { create } from 'zustand';

// ─── Auth Store ────────────────────────────────────────────
export const useAuthStore = create((set) => ({
  profile:  null,
  loading:  true,
  setProfile:   (profile) => set({ profile, loading: false }),
  clearProfile: ()        => set({ profile: null, loading: false }),
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
// Gestiona el estado de una sesión de examen completa
export const useExamStore = create((set, get) => ({
  // Config
  sessionId:    null,
  mode:         'study',   // 'study' | 'exam' | 'simulacro'
  questions:    [],
  timeLimitSecs: null,

  // Estado
  phase:        'setup',   // 'setup' | 'exam' | 'review' | 'result'
  current:      0,
  responses:    {},        // { questionId: { letter, isCorrect, timeSecs, errorType } }
  timerSecs:    0,
  questionStart: null,

  // Configuración de setup
  setupConfig: {
    mode:        'study',
    specialtyId: '',
    difficulty:  '',
    numQuestions: 20,
    yearExam:    '',
  },

  setSetupConfig: (cfg) => set(s => ({ setupConfig: { ...s.setupConfig, ...cfg } })),

  startExam: ({ sessionId, questions, mode, timeLimitSecs = null }) => set({
    sessionId, questions, mode,
    timeLimitSecs: timeLimitSecs || (mode === 'simulacro' ? 235 * 60 : null),
    phase:        'exam',
    current:      0,
    responses:    {},
    timerSecs:    0,
    questionStart: Date.now(),
  }),

  answer: (questionId, letter) => {
    const { questions, current, responses, questionStart } = get();
    const q         = questions[current];
    if (!q || responses[questionId]) return; // ya respondida

    const timeSecs   = Math.round((Date.now() - questionStart) / 1000);
    const isCorrect  = letter === q.correct_option_letter;

    set(s => ({
      responses: {
        ...s.responses,
        [questionId]: { letter, isCorrect, timeSecs },
      },
    }));
    return { isCorrect, timeSecs };
  },

  next: () => {
    const { current, questions, mode } = get();
    const isLast = current >= questions.length - 1;
    if (isLast) {
      set({ phase: mode === 'exam' || mode === 'simulacro' ? 'review' : 'result' });
    } else {
      set({ current: current + 1, questionStart: Date.now() });
    }
  },

  skip: () => {
    const { current, questions, questionStart } = get();
    const q = questions[current];
    if (q) {
      const timeSecs = Math.round((Date.now() - questionStart) / 1000);
      set(s => ({
        responses: { ...s.responses, [q.id]: { letter: null, isCorrect: false, timeSecs, skipped: true } },
      }));
    }
    get().next();
  },

  goToReview: () => set({ phase: 'review' }),
  goToResult: () => set({ phase: 'result' }),

  tick: () => set(s => ({ timerSecs: s.timerSecs + 1 })),

  reset: () => set({
    sessionId: null, phase: 'setup', questions: [], current: 0,
    responses: {}, timerSecs: 0, questionStart: null, mode: 'study', timeLimitSecs: null,
  }),

  // Getters derivados
  getStats: () => {
    const { questions, responses } = get();
    let correct = 0, wrong = 0, blank = 0;
    questions.forEach(q => {
      const r = responses[q.id];
      if (!r || r.skipped || r.letter === null) blank++;
      else if (r.isCorrect) correct++;
      else wrong++;
    });
    return { correct, wrong, blank, total: questions.length };
  },

  getCurrentQuestion: () => {
    const { questions, current } = get();
    return questions[current] || null;
  },

  getResponse: (questionId) => {
    return get().responses[questionId] || null;
  },
}));
