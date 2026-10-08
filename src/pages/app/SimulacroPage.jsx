import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import {
  fetchSimulacroQuestions, startSession, submitSession,
  getHistoricalCutoffs, fetchSpecialties, reportError,
} from '../../lib/supabase';
import { useAuthStore, toast } from '../../store';
import { MIR_CONFIG, calcPercentile, estimateOrder, analyzeSpecialties, analyzeBySpecialty } from '../../lib/mir-scoring';
import { Button, Badge, ScoreRing, Card, CardHeader, Spinner } from '../../components/ui';

const SIMULACRO_QUESTIONS = 210;
const SIMULACRO_MINS      = 235;
// Tiempo proporcional al nº de preguntas (50 → ~56 min, 210 → 3h55)
const minsFor = n => Math.max(1, Math.round(SIMULACRO_MINS * n / SIMULACRO_QUESTIONS));
const fmtMins = m => m >= 60 ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}` : `${m} min`;

export default function SimulacroPage() {
  const { profile, refreshProfile } = useAuthStore();
  const storageKey = `mirai:sim:${profile?.id}`;

  const [phase, setPhase]             = useState('intro');   // intro | config | exam | result
  const [cutoffs, setCutoffs]         = useState([]);
  const [specialties, setSpecialties] = useState([]);
  const [config, setConfig]           = useState({ numQuestions: SIMULACRO_QUESTIONS });
  const [loading, setLoading]         = useState(false);
  const [responses, setResponses]     = useState({});        // { questionId: letra }  (sin entrada = en blanco)
  const [questions, setQuestions]     = useState([]);
  const [current, setCurrent]         = useState(0);
  const [flagged, setFlagged]         = useState(new Set());
  const [sessionId, setSessionId]     = useState(null);
  const [secsLeft, setSecsLeft]       = useState(0);
  const [result, setResult]           = useState(null);
  const [submitError, setSubmitError] = useState(null);
  const [mapOpen, setMapOpen]         = useState(false);

  const endAtRef     = useRef(0);          // instante (ms) en que se acaba el tiempo
  const qStart       = useRef(Date.now());
  const timesRef     = useRef({});         // { questionId: segundos acumulados }
  const finishingRef = useRef(false);      // evita doble entrega
  const retryAtRef   = useRef(0);          // espera entre reintentos si falla la red

  // `live` siempre refleja el estado ACTUAL. handleFinish lo lee desde aquí, de modo que
  // la entrega automática al agotarse el tiempo (dentro de un setInterval) nunca usa un
  // estado obsoleto — antes enviaba todas las respuestas en blanco.
  const live = useRef({});
  live.current = { questions, responses, current, sessionId, cutoffs, specialties, secsLeft };
  const finishRef = useRef(null);

  useEffect(() => {
    Promise.all([
      getHistoricalCutoffs(2024).then(setCutoffs),
      fetchSpecialties().then(setSpecialties),
    ]);
  }, []);

  // Recuperar un simulacro en curso tras recargar la página
  useEffect(() => {
    if (!profile) return;
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return;
      const sv = JSON.parse(raw);
      if (!sv.sessionId || !sv.questions?.length) return;
      timesRef.current = sv.times || {};
      endAtRef.current = sv.endAt;
      setQuestions(sv.questions);
      setResponses(sv.responses || {});
      setFlagged(new Set(sv.flagged || []));
      setCurrent(Math.min(sv.current || 0, sv.questions.length - 1));
      setSessionId(sv.sessionId);
      setSecsLeft(Math.max(0, Math.round((sv.endAt - Date.now()) / 1000)));
      qStart.current = Date.now();
      setPhase('exam');
      toast.info('Hemos recuperado tu simulacro en curso');
    } catch { try { localStorage.removeItem(storageKey); } catch { /* sin storage */ } }
  }, [profile?.id]);

  // Guardar el progreso en cada cambio (sobrevive a F5 / cierre accidental)
  useEffect(() => {
    if (phase !== 'exam' || !sessionId) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify({
        sessionId, questions, responses, flagged: [...flagged], current,
        endAt: endAtRef.current, times: timesRef.current,
      }));
    } catch { /* sin storage */ }
  }, [phase, sessionId, questions, responses, flagged, current]);

  // Cuenta atrás con reloj real (no se frena en pestañas en segundo plano)
  useEffect(() => {
    if (phase !== 'exam') return;
    const tick = () => {
      const left = Math.max(0, Math.round((endAtRef.current - Date.now()) / 1000));
      setSecsLeft(left);
      if (left <= 0) finishRef.current?.();
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [phase]);

  // Atajos: A–E responden, ← → navegan
  useEffect(() => {
    if (phase !== 'exam') return;
    function onKey(e) {
      const tag = (e.target?.tagName || '').toLowerCase();
      if (tag === 'textarea' || tag === 'input' || e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      const cq = live.current.questions[live.current.current];
      if (['a', 'b', 'c', 'd', 'e'].includes(k) && cq?.options.some(o => o.letter === k)) handleAnswer(k);
      else if (k === 'arrowright') handleNext();
      else if (k === 'arrowleft')  handlePrev();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase]);

  async function handleStart() {
    setLoading(true);
    try {
      // El servidor reparte las preguntas según el peso real de cada especialidad
      const qs = await fetchSimulacroQuestions(config.numQuestions);
      if (!qs.length) { toast.error('Todavía no hay preguntas suficientes para un simulacro.'); return; }
      const minutes = minsFor(qs.length);
      const session = await startSession({ mode: 'simulacro', total: qs.length, timeLimitMinutes: minutes });
      timesRef.current   = {};
      endAtRef.current   = Date.now() + minutes * 60000;
      qStart.current     = Date.now();
      finishingRef.current = false;
      retryAtRef.current   = 0;
      setQuestions(qs); setSessionId(session.id); setResponses({}); setCurrent(0);
      setFlagged(new Set()); setSubmitError(null); setResult(null);
      setSecsLeft(minutes * 60);
      setPhase('exam');
    } catch (e) {
      toast.error(e.code === '42501' ? 'Tu acceso ha caducado.' : 'No se pudo iniciar el simulacro: ' + e.message);
      reportError(e);
    } finally { setLoading(false); }
  }

  // Cada respuesta se guarda al instante en el estado (y de ahí en localStorage)
  function handleAnswer(letter) {
    const cq = live.current.questions[live.current.current];
    if (!cq) return;
    setResponses(prev => {
      const n = { ...prev };
      if (letter === null) delete n[cq.id]; else n[cq.id] = letter;
      return n;
    });
  }
  const setSelected = handleAnswer;   // el botón "Dejar en blanco" usa setSelected(null)

  function commitTime() {
    const cq = live.current.questions[live.current.current];
    if (!cq) return;
    timesRef.current[cq.id] = (timesRef.current[cq.id] || 0) + Math.round((Date.now() - qStart.current) / 1000);
    qStart.current = Date.now();
  }
  function handleNext() { commitTime(); setCurrent(c => Math.min(c + 1, live.current.questions.length - 1)); }
  function handlePrev() { commitTime(); setCurrent(c => Math.max(c - 1, 0)); }
  function goTo(idx)    { commitTime(); setCurrent(idx); }
  function toggleFlag() {
    const id = live.current.questions[live.current.current]?.id;
    if (!id) return;
    setFlagged(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  // Entrega: el servidor corrige TODO y devuelve las soluciones solo ahora
  async function handleFinish() {
    if (finishingRef.current || Date.now() < retryAtRef.current) return;
    finishingRef.current = true;
    commitTime();
    const st = live.current;
    setLoading(true); setSubmitError(null);
    const answers = st.questions.map(q => ({
      question_id: q.id, letter: st.responses[q.id] ?? null, time_secs: timesRef.current[q.id] || 0,
    }));
    try {
      const sub = await submitSession(st.sessionId, answers);
      try { localStorage.removeItem(storageKey); } catch { /* sin storage */ }
      const byId = Object.fromEntries((sub.results || []).map(r => [r.question_id, r]));
      const rows = st.questions.map(q => ({
        question: q, selected_option_letter: byId[q.id]?.selected ?? null, is_correct: !!byId[q.id]?.is_correct,
      }));
      const score = sub.score;
      setResult({
        correct: sub.correct, wrong: sub.wrong, blank: sub.blank, score,
        percentile: calcPercentile(score), order: estimateOrder(score),
        analysis: analyzeSpecialties(score, st.cutoffs),
        bySpecialty: analyzeBySpecialty(rows, st.specialties),
        total: st.questions.length,
        secsUsed: Math.max(0, minsFor(st.questions.length) * 60 - st.secsLeft),
      });
      await refreshProfile?.();      // especialidades débiles recalculadas en el servidor
      setPhase('result');
    } catch (e) {
      finishingRef.current = false;
      retryAtRef.current = Date.now() + 5000;
      setSubmitError(e.message || 'Error de red');
      reportError(e);
    } finally { setLoading(false); }
  }
  finishRef.current = handleFinish;

  const mins     = Math.floor(secsLeft / 60);
  const secs     = String(secsLeft % 60).padStart(2, '0');
  const answered = Object.keys(responses).length;
  const q        = questions[current];
  const selected = q ? (responses[q.id] ?? null) : null;

  // ─── INTRO ─────────────────────────────────────────────
  if (phase === 'intro') return (
    <div className="max-w-2xl mx-auto py-8">
      <div className="bg-ink rounded-2xl p-8 mb-6 relative overflow-hidden">
        <div className="absolute inset-0 dot-pattern opacity-30 pointer-events-none"/>
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_500px_400px_at_80%_120%,rgba(0,229,199,.18),transparent)] pointer-events-none"/>
        <div className="relative z-10">
          <div className="inline-flex items-center gap-2 bg-pulse/20 border border-pulse/30 text-pulse px-3 py-1.5 rounded-full font-mono text-xs font-semibold mb-4">
            🎯 SIMULACRO OFICIAL MIR
          </div>
          <h1 className="font-display text-3xl font-bold text-white mb-3">Simulacro MIR real</h1>
          <p className="text-white/60 leading-relaxed">
            Replicamos las condiciones exactas del examen MIR: {MIR_CONFIG.totalQuestions} preguntas,{' '}
            {SIMULACRO_MINS} minutos, distribución real por especialidades y puntuación oficial
            (+{MIR_CONFIG.correctPoints} acierto / {MIR_CONFIG.wrongPoints} fallo / {MIR_CONFIG.blankPoints} blanco).
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-6">
        {[
          { icon:'⏱', title:`${SIMULACRO_MINS} minutos`,    desc:'Tiempo real del examen MIR' },
          { icon:'📝', title:`${SIMULACRO_QUESTIONS} preguntas`, desc:'Distribuidas por peso real' },
          { icon:'🧮', title:'+3 / -1 / 0',                 desc:'Fórmula de corrección oficial' },
          { icon:'📍', title:'Predicción de plaza',          desc:'Número de orden estimado' },
        ].map(s => (
          <div key={s.title} className="bg-white border border-border rounded-xl p-4 flex items-start gap-3">
            <span className="text-2xl shrink-0">{s.icon}</span>
            <div><div className="font-display font-bold text-sm text-ink">{s.title}</div><div className="text-xs text-slate-400 mt-0.5">{s.desc}</div></div>
          </div>
        ))}
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 mb-6">
        <div className="font-mono text-[0.65rem] font-semibold uppercase tracking-wider text-amber-600 mb-2">⚠️ Antes de empezar</div>
        <ul className="text-sm text-amber-700 flex flex-col gap-1.5">
          <li>• Asegúrate de tener {SIMULACRO_MINS} minutos sin interrupciones</li>
          <li>• El temporizador arrancará en cuanto pulses "Comenzar"</li>
          <li>• Puedes marcar preguntas para revisarlas antes de entregar</li>
          <li>• Si el tiempo se acaba, el examen se entrega automáticamente</li>
        </ul>
      </div>

      <Button fullWidth size="lg" loading={loading} onClick={() => setPhase('config')}>
        Preparar simulacro →
      </Button>
      <Link to="/app/examen" className="block text-center text-sm text-slate-400 mt-3 hover:text-sky-600 transition-colors">
        Prefiero practicar preguntas sueltas
      </Link>
    </div>
  );

  // ─── CONFIG ────────────────────────────────────────────
  if (phase === 'config') return (
    <div className="max-w-lg mx-auto py-8">
      <h2 className="font-display text-2xl font-bold text-ink mb-6 text-center">Configurar simulacro</h2>
      <div className="bg-white border border-border rounded-xl p-6 mb-5 shadow-sm">
        <div className="mb-5">
          <label className="block text-sm font-semibold text-ink mb-2">Número de preguntas</label>
          <div className="grid grid-cols-3 gap-3">
            {[[50,'Parcial ~'+fmtMins(minsFor(50))],[100,'Medio ~'+fmtMins(minsFor(100))],[210,'Completo '+fmtMins(minsFor(210))]].map(([n,l]) => (
              <button key={n} onClick={() => setConfig(c=>({...c,numQuestions:n}))}
                className={`p-3 rounded-lg border-2 text-center transition-all ${config.numQuestions===n?'border-ink bg-ink text-white':'border-border hover:border-sky-300 hover:bg-sky-50 text-ink'}`}>
                <div className="font-display font-bold text-xl">{n}</div>
                <div className={`text-xs mt-0.5 ${config.numQuestions===n?'text-white/60':'text-slate-400'}`}>{l}</div>
              </button>
            ))}
          </div>
        </div>
        <div className="bg-sky-50 border border-sky-200 rounded-lg p-4 text-sm text-sky-700">
          💡 El simulacro completo de 210 preguntas es el más realista.
        </div>
      </div>
      <div className="flex gap-3">
        <Button variant="secondary" fullWidth onClick={() => setPhase('intro')}>← Volver</Button>
        <Button fullWidth loading={loading} onClick={handleStart}>Comenzar simulacro →</Button>
      </div>
    </div>
  );

  // ─── EXAM ──────────────────────────────────────────────
  if (phase === 'exam' && q) {
    const isFlagged = flagged.has(q.id);
    const pctDone   = Math.round((answered / questions.length) * 100);
    const isUrgent  = secsLeft < 10 * 60;

    return (
      <div className="flex flex-col h-screen overflow-hidden">
        {loading && (
          <div className="fixed inset-0 z-[300] bg-ink/70 flex items-center justify-center">
            <div className="bg-white rounded-xl px-6 py-5 text-center"><Spinner size="lg"/><div className="mt-3 text-sm font-semibold text-ink">Entregando y corrigiendo…</div></div>
          </div>
        )}
        {submitError && !loading && (
          <div className="fixed top-16 left-1/2 -translate-x-1/2 z-[300] bg-amber-50 border border-amber-300 rounded-lg px-4 py-3 text-sm text-amber-800 flex items-center gap-3 shadow-lg">
            <span>No se pudo entregar. Tus respuestas están a salvo.</span>
            <button onClick={() => { retryAtRef.current = 0; handleFinish(); }} className="font-semibold underline">Reintentar</button>
          </div>
        )}
        {mapOpen && (
          <div className="lg:hidden fixed inset-0 z-[250] bg-ink/50" onClick={() => setMapOpen(false)}>
            <div className="absolute bottom-0 inset-x-0 bg-white rounded-t-2xl p-4 max-h-[70vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
              <div className="text-xs font-mono font-semibold uppercase tracking-wider text-slate-400 mb-3">Navegador · {answered}/{questions.length} respondidas</div>
              <div className="grid grid-cols-7 gap-1.5">
                {questions.map((qq, i) => {
                  const r = responses[qq.id];
                  return (
                    <button key={qq.id} onClick={() => { goTo(i); setMapOpen(false); }}
                      className={`h-9 rounded-md text-xs font-mono font-bold border ${i===current?'border-ink bg-ink text-white':flagged.has(qq.id)?'border-amber-400 bg-amber-50 text-amber-700':r?'border-pulse-dim/40 bg-pulse-bg text-pulse-dim':'border-border bg-white text-slate-400'}`}>
                      {i + 1}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}
        {/* Topbar fijo */}
        <div className={`border-b px-5 py-3 flex items-center gap-4 shrink-0 ${isUrgent?'bg-red-50 border-red-200':'bg-white border-border'}`}>
          <div className="flex items-center gap-2 shrink-0">
            <div className="w-7 h-7 bg-ink rounded-full flex items-center justify-center">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M2 12h4l2-7 4 14 3-9 2 4h5" stroke="#00E5C7" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </div>
            <span className="font-display font-bold text-sm text-ink hidden sm:block">MIR<em className="text-sky-500 not-italic">ai</em> Simulacro</span>
          </div>
          <div className="flex-1 flex items-center gap-3">
            <div className="flex-1 h-1.5 bg-sky-100 rounded-full overflow-hidden">
              <div className="h-full bg-gradient-to-r from-sky-400 to-pulse rounded-full transition-all" style={{width:`${pctDone}%`}}/>
            </div>
            <span className="font-mono text-xs text-slate-400 shrink-0">{answered}/{questions.length}</span>
          </div>
          <div className={`flex items-center gap-2 px-4 py-2 rounded-full font-mono text-sm font-bold shrink-0 ${isUrgent?'bg-red-500 text-white animate-pulse':'bg-ink text-pulse'}`}>
            ⏱ {mins}:{secs}
          </div>
          <button onClick={() => setMapOpen(true)} className="lg:hidden px-3 py-1.5 border border-border text-xs font-semibold rounded-full shrink-0">Mapa</button>
          <button onClick={() => { if (confirm('¿Entregar el simulacro ahora?')) handleFinish(); }}
            className="px-3 py-1.5 bg-ink text-white text-xs font-bold rounded-full hover:opacity-90 transition-opacity shrink-0">
            Entregar
          </button>
        </div>

        <div className="flex flex-1 overflow-hidden">
          {/* Panel lateral */}
          <div className="hidden lg:flex flex-col w-52 border-r border-border bg-surface overflow-y-auto shrink-0">
            <div className="p-3 border-b border-border">
              <div className="text-xs font-mono font-semibold uppercase tracking-wider text-slate-400 mb-2">Navegador</div>
              <div className="flex gap-2 text-[0.6rem] text-slate-400 flex-wrap">
                <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-pulse-dim inline-block"/>Respondida</span>
                <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-amber-400 inline-block"/>Marcada</span>
                <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-surface border border-border inline-block"/>Sin resp.</span>
              </div>
            </div>
            <div className="p-2 grid grid-cols-5 gap-1">
              {questions.map((qq, i) => {
                const r      = responses[qq.id];
                const isFlag = flagged.has(qq.id);
                const isCurr = i === current;
                return (
                  <button key={qq.id} onClick={() => goTo(i)}
                    className={`w-8 h-8 rounded-md text-xs font-mono font-bold transition-all border
                      ${isCurr ? 'border-ink bg-ink text-white' :
                        isFlag  ? 'border-amber-400 bg-amber-50 text-amber-700' :
                        r ? 'border-pulse-dim/40 bg-pulse-bg text-pulse-dim' :
                        'border-border bg-white text-slate-400 hover:border-sky-300'}`}>
                    {i + 1}
                  </button>
                );
              })}
            </div>
            <div className="p-3 border-t border-border mt-auto">
              <div className="text-xs text-slate-400 mb-1 font-mono">{answered} respondidas</div>
              <div className="text-xs text-slate-400 font-mono">{flagged.size} marcadas</div>
              <div className="text-xs text-slate-400 font-mono">{questions.length - answered} sin responder</div>
            </div>
          </div>

          {/* Área de pregunta */}
          <div className="flex-1 overflow-y-auto">
            <div className="max-w-3xl mx-auto p-5 lg:p-8">
              <div className="flex items-center gap-2 mb-4 flex-wrap">
                <span className="font-mono text-xs text-slate-400 bg-surface border border-border px-2.5 py-1 rounded-full font-semibold">
                  Pregunta {current + 1} de {questions.length}
                </span>
                {q.specialty && (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-ink text-white font-mono text-[0.68rem] font-semibold uppercase tracking-wider">
                    <span className="w-1.5 h-1.5 rounded-full" style={{background:q.specialty.color||'#00E5C7'}}/>
                    {q.specialty.name}
                  </span>
                )}
                {q.year_exam && <span className="text-xs text-slate-400 font-mono">MIR {q.year_exam}</span>}
                <button onClick={toggleFlag}
                  className={`ml-auto flex items-center gap-1.5 text-xs font-semibold px-3 py-1 rounded-full border transition-all ${isFlagged?'bg-amber-50 border-amber-300 text-amber-600':'border-border text-slate-400 hover:border-amber-300 hover:bg-amber-50 hover:text-amber-600'}`}>
                  🚩 {isFlagged ? 'Marcada' : 'Marcar'}
                </button>
              </div>

              <div className="bg-white border border-border rounded-xl p-6 mb-5 shadow-sm">
                <p className="font-display text-base font-semibold text-ink leading-relaxed">{q.text}</p>
                {q.image_url && <img src={q.image_url} alt="Imagen de la pregunta" loading="lazy" className="mt-4 max-h-96 w-auto mx-auto rounded-lg border border-border"/>}
              </div>

              <div className="flex flex-col gap-3 mb-6">
                {q.options.map(opt => {
                  const isCurSel  = selected === opt.letter;
                  const isPrevSel = false;
                  return (
                    <button key={opt.letter} onClick={() => handleAnswer(opt.letter)}
                      className={`flex items-start gap-4 p-4 rounded-xl border-2 text-left transition-all duration-150 w-full cursor-pointer active:scale-[.99]
                        ${isCurSel  ? 'border-sky-500 bg-sky-50' :
                          isPrevSel ? 'border-sky-300 bg-sky-50/60' :
                          'border-border bg-white hover:border-sky-300 hover:bg-sky-50'}`}>
                      <span className={`w-7 h-7 rounded-full border-2 flex items-center justify-center font-mono text-xs font-bold shrink-0 mt-0.5 transition-all ${isCurSel?'bg-sky-500 border-sky-500 text-white':isPrevSel?'bg-sky-200 border-sky-300 text-sky-700':'bg-surface border-border text-slate-400'}`}>
                        {opt.letter.toUpperCase()}
                      </span>
                      <span className="text-sm leading-relaxed pt-0.5 text-ink">{opt.text}</span>
                    </button>
                  );
                })}
                <button onClick={() => handleAnswer(null)}
                  className={`flex items-center gap-3 px-4 py-3 rounded-xl border-2 text-left transition-all text-sm font-medium ${selected===null?'border-slate-300 bg-slate-50 text-slate-600':'border-border text-slate-400 hover:border-slate-300 hover:bg-slate-50'}`}>
                  <span className="w-7 h-7 rounded-full border-2 border-slate-300 flex items-center justify-center text-xs text-slate-400 shrink-0">—</span>
                  Dejar en blanco
                </button>
              </div>

              <div className="flex items-center justify-between">
                <button onClick={handlePrev} disabled={current===0}
                  className="px-5 py-2.5 border border-border rounded-full text-sm font-semibold text-slate-500 hover:border-sky-300 hover:bg-sky-50 transition-all disabled:opacity-40 disabled:pointer-events-none">
                  ← Anterior
                </button>
                <span className="text-xs text-slate-400 font-mono">{answered} respondidas · {questions.length - answered} restantes</span>
                {current < questions.length - 1 ? (
                  <button onClick={handleNext}
                    className="px-6 py-2.5 bg-ink text-white rounded-full text-sm font-bold hover:-translate-y-0.5 hover:shadow-lg transition-all">
                    Siguiente →
                  </button>
                ) : (
                  // BUG 2 FIX: antes era handleNext() + handleFinish() que causaba
                  // una race condition — setResponses de handleNext es async y
                  // handleFinish leía el state antes de que se aplicara,
                  // perdiendo siempre la última respuesta.
                  // Ahora handleFinish recibe selected directamente como parámetro
                  // y construye la copia local antes de procesar.
                  <button onClick={() => handleFinish()}
                    className="px-6 py-2.5 bg-pulse text-ink rounded-full text-sm font-bold hover:brightness-110 hover:-translate-y-0.5 transition-all">
                    Entregar examen →
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ─── RESULT ────────────────────────────────────────────
  if (phase === 'result' && result) return <SimulacroResult result={result} cutoffs={cutoffs} onRepeat={() => { finishingRef.current = false; setResult(null); setPhase('intro'); }} />;

  return <div className="flex items-center justify-center h-64"><Spinner size="lg"/></div>;
}

function SimulacroResult({ result, cutoffs, onRepeat }) {
  const { correct, wrong, blank, total, score, percentile, order, bySpecialty } = result;
  const pct      = Math.round((correct / total) * 100);
  const minsUsed = Math.round(result.secsUsed / 60);

  const SPECIALTY_ANALYSIS = analyzeSpecialties(score, cutoffs);
  const reachable = SPECIALTY_ANALYSIS.filter(s => s.reachable);
  const notYet    = SPECIALTY_ANALYSIS.filter(s => !s.reachable).slice(0, 5);

  const [tab, setTab] = useState('resumen');

  return (
    <div className="max-w-3xl mx-auto py-8">
      <div className="bg-white border border-border rounded-2xl p-8 mb-5 text-center shadow-sm relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_500px_400px_at_50%_120%,rgba(0,229,199,.06),transparent)] pointer-events-none"/>
        <div className="inline-flex items-center gap-2 bg-ink text-pulse px-3 py-1.5 rounded-full font-mono text-xs font-semibold mb-6">
          🎯 RESULTADO DEL SIMULACRO MIR
        </div>

        <div className="flex items-center justify-center gap-8 mb-6 flex-wrap">
          <ScoreRing pct={pct} size={140} />
          <div className="text-left">
            <div className="font-mono text-[0.65rem] font-semibold uppercase tracking-widest text-slate-400 mb-1">Puntuación MIR</div>
            <div className="font-display font-bold text-5xl text-ink mb-1">{Math.round(score)}</div>
            <div className="text-sm text-slate-400">de {MIR_CONFIG.maxScore} puntos posibles</div>
            <div className="flex items-center gap-2 mt-3">
              <span className={`font-mono text-xs font-bold px-3 py-1.5 rounded-full ${score >= 400 ? 'bg-pulse-bg text-pulse-dim' : score >= 300 ? 'bg-amber-50 text-amber-600' : 'bg-red-50 text-red-500'}`}>
                Percentil {percentile}
              </span>
            </div>
          </div>
        </div>

        <div className="bg-ink rounded-xl p-5 mb-6 relative overflow-hidden">
          <div className="absolute inset-0 dot-pattern opacity-30 pointer-events-none"/>
          <div className="relative z-10">
            <div className="font-mono text-[0.65rem] font-semibold uppercase tracking-widest text-white/40 mb-1">Número de orden estimado</div>
            <div className="font-display font-bold text-4xl text-pulse mb-1">#{order.toLocaleString('es-ES')}</div>
            <div className="text-sm text-white/60">
              de {MIR_CONFIG.totalCandidates.toLocaleString('es-ES')} presentados en MIR 2024
              {reachable.length > 0 && ` · ${reachable.length} especialidades alcanzables`}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-4 gap-3 mb-4">
          {[
            { label:'Correctas',   val:correct,          color:'text-pulse-dim' },
            { label:'Incorrectas', val:wrong,            color:'text-red-400' },
            { label:'En blanco',   val:blank,            color:'text-slate-400' },
            { label:'Tiempo',      val:`${minsUsed}min`, color:'text-sky-600' },
          ].map(s => (
            <div key={s.label} className="bg-surface border border-border rounded-lg py-3 px-2 text-center">
              <div className={`font-display font-bold text-xl ${s.color}`}>{s.val}</div>
              <div className="text-xs text-slate-400 mt-0.5">{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-5 overflow-x-auto pb-1">
        {[['resumen','Resumen'],['especialidades','Por especialidad'],['plaza','Predicción de plaza']].map(([k,l]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`px-4 py-2 rounded-full text-sm font-semibold whitespace-nowrap transition-all ${tab===k?'bg-ink text-white':'bg-white border border-border text-slate-500 hover:border-sky-300'}`}>
            {l}
          </button>
        ))}
      </div>

      {tab === 'resumen' && (
        <Card>
          <CardHeader title="Análisis global" subtitle="Puntos fuertes y áreas de mejora" />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {bySpecialty?.filter(e => e.total > 0).sort((a,b)=>b.pct-a.pct).slice(0,10).map(e => (
              <div key={e.id}>
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{background:e.color||'#0EA5E9'}}/>
                    <span className="text-sm font-medium text-ink">{e.name}</span>
                  </div>
                  <span className={`font-mono text-sm font-bold ${e.pct>=70?'text-pulse-dim':e.pct>=50?'text-amber-500':'text-red-400'}`}>
                    {e.correct}/{e.total} ({e.pct ?? '—'}%)
                  </span>
                </div>
                <div className="h-2 bg-sky-50 rounded-full overflow-hidden">
                  <div className="h-full rounded-full transition-all duration-700"
                    style={{width:`${e.pct||0}%`, background:e.pct>=70?'linear-gradient(90deg,#0EA5E9,#00E5C7)':e.pct>=50?'#F59E0B':'#EF4444'}}/>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {tab === 'especialidades' && (
        <Card>
          <CardHeader title="Detalle por especialidad MIR" />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  {['Especialidad','Correctas','Total','Tasa','Estado'].map(h => (
                    <th key={h} className="text-left pb-3 font-mono text-[0.65rem] uppercase tracking-wider text-slate-400 pr-4">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {bySpecialty?.filter(e => e.total > 0).sort((a,b)=>a.pct-b.pct).map(e => (
                  <tr key={e.id} className="border-b border-border last:border-0 hover:bg-sky-50 transition-colors">
                    <td className="py-3 pr-4">
                      <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{background:e.color||'#0EA5E9'}}/>
                        <span className="font-medium text-ink">{e.name}</span>
                      </div>
                    </td>
                    <td className="py-3 pr-4 font-mono font-bold text-pulse-dim">{e.correct}</td>
                    <td className="py-3 pr-4 font-mono text-slate-500">{e.total}</td>
                    <td className="py-3 pr-4">
                      <span className={`font-mono font-bold ${e.pct>=70?'text-pulse-dim':e.pct>=50?'text-amber-500':'text-red-400'}`}>{e.pct}%</span>
                    </td>
                    <td className="py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${e.status==='strong'?'bg-pulse-bg text-pulse-dim':e.status==='medium'?'bg-amber-50 text-amber-600':e.status==='weak'?'bg-red-50 text-red-500':'bg-surface text-slate-400'}`}>
                        {e.status==='strong'?'Fuerte':e.status==='medium'?'Medio':e.status==='weak'?'Débil':'Sin datos'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {tab === 'plaza' && (
        <div className="flex flex-col gap-5">
          <Card>
            <CardHeader title="Especialidades alcanzables con tu puntuación" subtitle={`Basado en cutoffs MIR 2024 · Puntuación: ${Math.round(score)} pts`} />
            {reachable.length === 0 ? (
              <div className="text-center py-8">
                <div className="text-3xl mb-2">💪</div>
                <p className="text-sm text-slate-500">Aún no alcanzas el cutoff mínimo de ninguna especialidad.</p>
                <p className="text-xs text-slate-400 mt-1">El mínimo más bajo registrado es {cutoffs.length ? Math.min(...cutoffs.map(c=>c.min_score)).toFixed(1) + ' pts' : '—'}.</p>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {reachable.slice(0, 8).map(s => (
                  <div key={s.specialty_id} className="flex items-center gap-3 p-3 bg-pulse-bg border border-pulse-dim/20 rounded-lg">
                    <span className="text-pulse-dim text-lg shrink-0">✓</span>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-sm text-ink">{s.specialty?.name || s.specialty_id}</div>
                      <div className="text-xs text-slate-400 font-mono">Cutoff: {s.min_score} pts · {s.total_spots} plazas</div>
                    </div>
                    <span className="font-mono text-xs font-bold text-pulse-dim shrink-0">+{s.margin} pts</span>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {notYet.length > 0 && (
            <Card>
              <CardHeader title="Especialidades fuera de alcance" subtitle="Cuántos puntos te faltan para cada una" />
              <div className="flex flex-col gap-3">
                {notYet.map(s => (
                  <div key={s.specialty_id} className="flex items-center gap-3 p-3 bg-red-50 border border-red-200 rounded-lg">
                    <span className="text-red-400 text-lg shrink-0">✕</span>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-sm text-ink">{s.specialty?.name || s.specialty_id}</div>
                      <div className="text-xs text-slate-400 font-mono">Cutoff: {s.min_score} pts · {s.total_spots} plazas</div>
                    </div>
                    <span className="font-mono text-xs font-bold text-red-400 shrink-0">{s.gap} pts</span>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
      )}

      <div className="flex gap-3 justify-center flex-wrap mt-6">
        <Button onClick={onRepeat}>Repetir simulacro →</Button>
        <Link to="/app/examen?modo=errores" className="px-6 py-3 bg-white border border-border text-ink rounded-full font-semibold text-sm hover:border-sky-300 hover:bg-sky-50 transition-all">Practicar errores</Link>
        <Link to="/app/plan"    className="px-6 py-3 bg-white border border-border text-ink rounded-full font-semibold text-sm hover:border-sky-300 hover:bg-sky-50 transition-all">Volver al plan</Link>
      </div>
    </div>
  );
}
