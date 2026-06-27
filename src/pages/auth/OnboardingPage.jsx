import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase, fetchQuestions, fetchSpecialties } from '../../lib/supabase';
import { useAuthStore } from '../../store';
import { calcMirScore } from '../../lib/mir-scoring';
import { Button, Spinner } from '../../components/ui';

const ONBOARDING_QUESTIONS = 20;

export default function OnboardingPage() {
  const { profile, setProfile } = useAuthStore();
  const navigate = useNavigate();

  const [phase, setPhase]         = useState('intro');   // intro | exam | result
  const [questions, setQuestions] = useState([]);
  const [current, setCurrent]     = useState(0);
  const [responses, setResponses] = useState({});
  const [selected, setSelected]   = useState(null);
  const [revealed, setRevealed]   = useState(false);
  const [loading, setLoading]     = useState(false);
  const [saving, setSaving]       = useState(false);
  const startTime = useRef(null);

  async function startExam() {
    setLoading(true);
    const specialties = await fetchSpecialties();
    // 1 pregunta por especialidad + relleno hasta 20
    const perSp = Math.ceil(ONBOARDING_QUESTIONS / specialties.length);
    let all = [];
    for (const sp of specialties) {
      const qs = await fetchQuestions({ specialtyId: sp.id, limit: perSp });
      all = [...all, ...qs];
    }
    const shuffled = all.sort(() => Math.random() - 0.5).slice(0, ONBOARDING_QUESTIONS);
    setQuestions(shuffled);
    setLoading(false);
    setPhase('exam');
    startTime.current = Date.now();
  }

  function handleSelect(letter) {
    if (revealed) return;
    setSelected(letter);
  }

  function handleConfirm() {
    if (!selected && !revealed) return;
    if (!revealed) {
      const q = questions[current];
      const isCorrect = selected === q.correct_option_letter;
      const timeSecs  = Math.round((Date.now() - startTime.current) / 1000);
      setResponses(prev => ({ ...prev, [q.id]: { letter: selected, isCorrect, timeSecs } }));
      setRevealed(true);
      startTime.current = Date.now();
    } else {
      // Siguiente
      if (current >= questions.length - 1) {
        finishOnboarding();
      } else {
        setCurrent(c => c + 1);
        setSelected(null);
        setRevealed(false);
      }
    }
  }

  async function finishOnboarding() {
    setSaving(true);
    const vals   = Object.values(responses);
    const correct = vals.filter(r => r.isCorrect).length;
    const wrong   = vals.filter(r => !r.isCorrect).length;
    const blank   = ONBOARDING_QUESTIONS - vals.length;
    const score   = calcMirScore({ correct, wrong, blank });

    // Detectar especialidades débiles
    const espMap = {};
    questions.forEach((q, i) => {
      const sid = q.specialty?.id;
      if (!sid) return;
      if (!espMap[sid]) espMap[sid] = { name: q.specialty?.name, correct: 0, total: 0 };
      espMap[sid].total++;
      if (responses[q.id]?.isCorrect) espMap[sid].correct++;
    });
    const weakSpecialties = Object.entries(espMap)
      .filter(([, d]) => d.total > 0 && (d.correct / d.total) < 0.5)
      .map(([id]) => id);

    await supabase.from('profiles').update({
      onboarding_completed: true,
      baseline_score:       score,
      weak_specialties:     weakSpecialties,
    }).eq('id', profile.id);

    const updated = { ...profile, onboarding_completed: true, baseline_score: score, weak_specialties: weakSpecialties };
    setProfile(updated);
    setSaving(false);
    setPhase('result');
    setResponses(prev => ({
      ...prev,
      _summary: { correct, wrong, blank, score, weakSpecialties, total: ONBOARDING_QUESTIONS },
    }));
  }

  const q = questions[current];
  const resp = q ? responses[q.id] : null;
  const summary = responses._summary;
  const progress = Math.round(((current + (revealed ? 1 : 0)) / ONBOARDING_QUESTIONS) * 100);

  // ─── INTRO ─────────────────────────────────────────────
  if (phase === 'intro') return (
    <div className="min-h-screen bg-surface flex items-center justify-center p-6">
      <div className="max-w-lg w-full">
        <div className="bg-ink rounded-2xl p-8 mb-6 relative overflow-hidden">
          <div className="absolute inset-0 dot-pattern opacity-40 pointer-events-none" />
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_400px_300px_at_80%_120%,rgba(0,229,199,.15),transparent)] pointer-events-none" />
          <div className="relative z-10">
            <div className="w-12 h-12 bg-pulse/20 border border-pulse/30 rounded-xl flex items-center justify-center mb-4">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M2 12h4l2-7 4 14 3-9 2 4h5" stroke="#00E5C7" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </div>
            <h1 className="font-display text-2xl font-bold text-white mb-3">Diagnóstico inicial</h1>
            <p className="text-white/60 leading-relaxed text-sm">
              Antes de empezar, el Coach IA necesita conocer tu nivel actual. Responde <strong className="text-white">20 preguntas</strong> de diferentes especialidades — sin presión de tiempo. Con los resultados, creamos un plan de estudio personalizado desde el día 1.
            </p>
          </div>
        </div>

        <div className="bg-white border border-border rounded-xl p-6 mb-5">
          <h3 className="font-display font-bold text-base text-ink mb-4">¿Qué ocurre durante el diagnóstico?</h3>
          <div className="flex flex-col gap-3">
            {[
              ['🎯', 'Medimos tu tasa de acierto por especialidad'],
              ['🧠', 'Detectamos tus áreas más débiles y más fuertes'],
              ['📅', 'Generamos tu plan de estudio personalizado'],
              ['📊', 'Establecemos tu puntuación MIR de referencia'],
            ].map(([icon, text]) => (
              <div key={text} className="flex items-center gap-3 text-sm text-slate-600">
                <span className="text-base w-6 text-center shrink-0">{icon}</span>
                {text}
              </div>
            ))}
          </div>
        </div>

        <Button fullWidth size="lg" loading={loading} onClick={startExam}>
          Empezar diagnóstico →
        </Button>
        <p className="text-center text-xs text-slate-400 mt-3">~10 minutos · Puedes hacerlo en cualquier momento</p>
      </div>
    </div>
  );

  // ─── RESULTADO ─────────────────────────────────────────
  if (phase === 'result' && summary) {
    const tasa = Math.round((summary.correct / summary.total) * 100);
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center p-6">
        <div className="max-w-lg w-full">
          <div className="bg-white border border-border rounded-2xl p-8 mb-5 text-center shadow-sm">
            {/* Ring */}
            <div className="relative w-32 h-32 mx-auto mb-6">
              <svg className="w-32 h-32 -rotate-90" viewBox="0 0 120 120">
                <circle cx="60" cy="60" r="52" fill="none" stroke="#E0F2FE" strokeWidth="10"/>
                <circle cx="60" cy="60" r="52" fill="none" stroke="url(#og)" strokeWidth="10"
                  strokeLinecap="round" strokeDasharray={2*Math.PI*52}
                  strokeDashoffset={2*Math.PI*52*(1-tasa/100)}
                  style={{transition:'stroke-dashoffset 1.2s cubic-bezier(.22,1,.36,1)'}}/>
                <defs><linearGradient id="og" x1="0%" y1="0%" x2="100%" y2="0%"><stop offset="0%" stopColor="#0EA5E9"/><stop offset="100%" stopColor="#00E5C7"/></linearGradient></defs>
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="font-display font-bold text-3xl text-ink">{tasa}%</span>
                <span className="text-xs text-slate-400">acierto</span>
              </div>
            </div>

            <h2 className="font-display font-bold text-2xl text-ink mb-2">Diagnóstico completado</h2>
            <p className="text-sm text-slate-400 mb-6">
              {tasa >= 65 ? 'Buen punto de partida. Tu plan se enfocará en consolidar y ampliar.' :
               tasa >= 45 ? 'Nivel intermedio detectado. Hay margen de mejora claro.' :
               'Nivel inicial detectado. El plan de estudio te llevará al corte paso a paso.'}
            </p>

            <div className="grid grid-cols-3 gap-3 mb-6">
              {[
                { label: 'Correctas',  val: summary.correct, color: 'text-pulse-dim' },
                { label: 'Incorrectas',val: summary.wrong,   color: 'text-red-400' },
                { label: 'Score MIR',  val: Math.round(summary.score), color: 'text-sky-600' },
              ].map(s => (
                <div key={s.label} className="bg-surface border border-border rounded-lg p-3 text-center">
                  <div className={`font-display font-bold text-xl ${s.color}`}>{s.val}</div>
                  <div className="text-xs text-slate-400 mt-0.5">{s.label}</div>
                </div>
              ))}
            </div>

            {summary.weakSpecialties?.length > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-left mb-6">
                <div className="font-mono text-[0.65rem] font-bold uppercase tracking-wider text-amber-600 mb-2">Áreas a reforzar</div>
                <div className="flex flex-wrap gap-1.5">
                  {summary.weakSpecialties.map(id => (
                    <span key={id} className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium">{id}</span>
                  ))}
                </div>
              </div>
            )}

            <Button fullWidth size="lg" loading={saving} onClick={() => navigate('/app/plan', { replace: true })}>
              Ver mi plan personalizado →
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // ─── EXAMEN ────────────────────────────────────────────
  if (!q) return null;

  return (
    <div className="min-h-screen bg-surface flex flex-col">
      {/* Header */}
      <div className="bg-white border-b border-border px-5 py-4 sticky top-0 z-50">
        <div className="max-w-2xl mx-auto flex items-center gap-4">
          <div className="flex items-center gap-2 shrink-0">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M2 12h4l2-7 4 14 3-9 2 4h5" stroke="#00E5C7" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
            <span className="font-mono text-xs font-semibold text-slate-400">{current+1}/{ONBOARDING_QUESTIONS}</span>
          </div>
          <div className="flex-1 h-2 bg-sky-100 rounded-full overflow-hidden">
            <div className="h-full bg-gradient-to-r from-sky-400 to-pulse rounded-full transition-all duration-500" style={{width:`${progress}%`}}/>
          </div>
          <span className="font-mono text-xs text-slate-400 shrink-0">{progress}%</span>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 flex items-start justify-center p-5 pt-8">
        <div className="max-w-2xl w-full">
          {/* Meta */}
          <div className="flex items-center gap-2 mb-4 flex-wrap">
            {q.specialty && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-ink text-white font-mono text-[0.68rem] font-semibold uppercase tracking-wider">
                <span className="w-1.5 h-1.5 rounded-full" style={{background: q.specialty.color || '#00E5C7'}}/>
                {q.specialty.name}
              </span>
            )}
            {q.difficulty && (
              <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full font-mono text-[0.68rem] font-semibold uppercase tracking-wider border ${
                q.difficulty <= 2 ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                q.difficulty === 3 ? 'bg-amber-50 text-amber-700 border-amber-200' :
                'bg-red-50 text-red-500 border-red-200'}`}>
                {q.difficulty <= 2 ? 'Fácil' : q.difficulty === 3 ? 'Media' : 'Difícil'}
              </span>
            )}
            {q.year_exam && <span className="text-xs text-slate-400 font-mono">MIR {q.year_exam}</span>}
          </div>

          {/* Enunciado */}
          <div className="bg-white border border-border rounded-xl p-6 mb-4 shadow-sm">
            <p className="font-display text-base font-semibold text-ink leading-relaxed">{q.text}</p>
          </div>

          {/* Opciones */}
          <div className="flex flex-col gap-3 mb-5">
            {q.options.map(opt => {
              const isSelected = selected === opt.letter;
              const isCorrect  = revealed && opt.letter === q.correct_option_letter;
              const isWrong    = revealed && isSelected && !isCorrect;
              const isDimmed   = revealed && !isCorrect && !isSelected;

              let cls = 'border-border bg-white hover:border-sky-300 hover:bg-sky-50';
              if (!revealed && isSelected) cls = 'border-sky-500 bg-sky-50';
              if (isCorrect)  cls = 'border-pulse-dim bg-pulse-bg shadow-[0_0_0_3px_rgba(0,229,199,.1)]';
              if (isWrong)    cls = 'border-red-400 bg-red-50';
              if (isDimmed)   cls = 'border-border bg-white opacity-50';

              let letterCls = 'bg-surface border-border text-slate-400';
              if (!revealed && isSelected) letterCls = 'bg-sky-500 border-sky-500 text-white';
              if (isCorrect)  letterCls = 'bg-pulse-dim border-pulse-dim text-white';
              if (isWrong)    letterCls = 'bg-red-400 border-red-400 text-white';

              return (
                <button key={opt.letter} onClick={() => handleSelect(opt.letter)} disabled={revealed}
                  className={`flex items-start gap-4 p-4 rounded-xl border-2 text-left transition-all duration-200 w-full ${cls} ${!revealed?'cursor-pointer active:scale-[.99]':'cursor-default'}`}>
                  <span className={`w-7 h-7 rounded-full border-2 flex items-center justify-center font-mono text-xs font-bold shrink-0 mt-0.5 transition-all ${letterCls}`}>
                    {opt.letter.toUpperCase()}
                  </span>
                  <span className={`text-sm leading-relaxed pt-0.5 flex-1 ${isCorrect?'font-semibold text-emerald-900':isWrong?'text-red-700':'text-ink'}`}>
                    {opt.text}
                  </span>
                  {isCorrect && <span className="text-pulse-dim text-lg shrink-0 ml-auto">✓</span>}
                  {isWrong   && <span className="text-red-400 text-lg shrink-0 ml-auto">✕</span>}
                </button>
              );
            })}
          </div>

          {/* Explicación */}
          {revealed && (
            <div className="bg-white border-l-4 border-pulse-dim rounded-r-xl p-5 mb-5 shadow-sm animate-[slideDown_.3s_ease]">
              <div className="font-mono text-[0.65rem] font-bold text-pulse-dim uppercase tracking-wider mb-2">✓ Explicación</div>
              <p className="text-sm text-ink leading-relaxed">{q.explanation}</p>
            </div>
          )}

          {/* Acción */}
          <div className="flex justify-end">
            {!revealed ? (
              <Button onClick={handleConfirm} disabled={!selected} size="lg">
                Confirmar respuesta
              </Button>
            ) : (
              <Button onClick={handleConfirm} size="lg">
                {current >= questions.length - 1 ? 'Ver resultados →' : 'Siguiente →'}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
