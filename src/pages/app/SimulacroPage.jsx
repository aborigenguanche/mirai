import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import {
  supabase, fetchQuestions, createSession, finishSession,
  saveResponses, getHistoricalCutoffs, fetchSpecialties
} from '../../lib/supabase';
import { useAuthStore, useExamStore, toast } from '../../store';
import {
  MIR_CONFIG, calcMirScore, extrapolateScore, calcPercentile,
  estimateOrder, analyzeSpecialties, analyzeBySpecialty, classifyError,
  calcQuality, sm2
} from '../../lib/mir-scoring';
import { upsertQuestionState } from '../../lib/supabase';
import { Button, Badge, ScoreRing, Card, CardHeader, Spinner } from '../../components/ui';

const SIMULACRO_QUESTIONS = 210;
const SIMULACRO_MINS      = 235; // tiempo real MIR

export default function SimulacroPage() {
  const { profile } = useAuthStore();
  const exam        = useExamStore();
  const [phase, setPhase]       = useState('intro'); // intro|config|exam|result
  const [cutoffs, setCutoffs]   = useState([]);
  const [specialties, setSpecialties] = useState([]);
  const [config, setConfig]     = useState({ year: SIMULACRO_QUESTIONS, numQuestions: SIMULACRO_QUESTIONS });
  const [loading, setLoading]   = useState(false);
  const [responses, setResponses] = useState({});
  const [questions, setQuestions] = useState([]);
  const [current, setCurrent]   = useState(0);
  const [selected, setSelected] = useState(null);
  const [flagged, setFlagged]   = useState(new Set());
  const [sessionId, setSessionId] = useState(null);
  const [secsLeft, setSecsLeft] = useState(SIMULACRO_MINS * 60);
  const [result, setResult]     = useState(null);
  const timerRef = useRef(null);
  const qStart   = useRef(null);

  useEffect(() => {
    Promise.all([
      getHistoricalCutoffs(2024).then(setCutoffs),
      fetchSpecialties().then(setSpecialties),
    ]);
  }, []);

  // Timer regresivo
  useEffect(() => {
    if (phase !== 'exam') { clearInterval(timerRef.current); return; }
    timerRef.current = setInterval(() => {
      setSecsLeft(s => {
        if (s <= 1) { clearInterval(timerRef.current); handleFinish(); return 0; }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(timerRef.current);
  }, [phase]);

  async function handleStart() {
    setLoading(true);
    // Cargar preguntas distribuidas por especialidad según peso MIR real
    let all = [];
    for (const sp of specialties) {
      const weight  = MIR_CONFIG.distributionBySpecialty[sp.id] || 5;
      const qs      = await fetchQuestions({ specialtyId: sp.id, limit: weight });
      all = [...all, ...qs];
    }
    // Complementar hasta SIMULACRO_QUESTIONS
    if (all.length < config.numQuestions) {
      const extra = await fetchQuestions({ limit: config.numQuestions - all.length,
        excludeIds: all.map(q => q.id) });
      all = [...all, ...extra];
    }
    const shuffled = all.sort(() => Math.random() - 0.5).slice(0, config.numQuestions);

    const session = await createSession({
      userId: profile.id, mode: 'simulacro',
      specialtyFilter: [], totalQuestions: shuffled.length,
      timeLimitMinutes: SIMULACRO_MINS,
    });

    setQuestions(shuffled);
    setSessionId(session.id);
    setSecsLeft(SIMULACRO_MINS * 60);
    setResponses({});
    setCurrent(0);
    setSelected(null);
    setFlagged(new Set());
    qStart.current = Date.now();
    setLoading(false);
    setPhase('exam');
  }

  function handleAnswer(letter) {
    if (responses[questions[current]?.id]?.confirmed) return;
    setSelected(letter);
  }

  function handleNext() {
    const q = questions[current];
    if (q) {
      const timeSecs = Math.round((Date.now() - qStart.current) / 1000);
      setResponses(prev => ({
        ...prev,
        [q.id]: { letter: selected, timeSecs, confirmed: true },
      }));
    }
    setSelected(null);
    qStart.current = Date.now();
    if (current < questions.length - 1) setCurrent(c => c + 1);
  }

  function handlePrev() {
    if (current > 0) { setCurrent(c => c - 1); setSelected(responses[questions[current-1]?.id]?.letter || null); }
  }

  function goTo(idx) {
    const q = questions[current];
    if (q && selected !== null) {
      setResponses(prev => ({
        ...prev,
        [q.id]: { ...(prev[q.id]||{}), letter: selected, timeSecs: Math.round((Date.now()-qStart.current)/1000) },
      }));
    }
    setCurrent(idx);
    setSelected(responses[questions[idx]?.id]?.letter || null);
    qStart.current = Date.now();
  }

  function toggleFlag() {
    const id = questions[current]?.id;
    if (!id) return;
    setFlagged(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  async function handleFinish() {
    clearInterval(timerRef.current);
    setLoading(true);

    // Calcular resultados
    let correct = 0, wrong = 0, blank = 0;
    const responseRows = [];

    questions.forEach(q => {
      const r = responses[q.id];
      const letter = r?.letter || null;
      const isCorrect = letter === q.correct_option_letter;
      if (!letter) blank++;
      else if (isCorrect) correct++;
      else wrong++;

      responseRows.push({
        session_id: sessionId, question_id: q.id, user_id: profile.id,
        selected_option_letter: letter, is_correct: isCorrect,
        time_taken_seconds: r?.timeSecs || null,
      });
    });

    const score     = calcMirScore({ correct, wrong, blank });
    const extrap    = extrapolateScore({ correct, wrong, blank, totalAnswered: questions.length });
    const percentile = calcPercentile(score);
    const order     = estimateOrder(score);
    const analysis  = analyzeSpecialties(score, cutoffs);
    const bySpecialty = analyzeBySpecialty(responseRows.map((r,i) => ({
      ...r, question: questions[i], is_correct: r.is_correct,
    })), specialties);

    await Promise.all([
      finishSession({ sessionId, numCorrect: correct, numWrong: wrong, numBlank: blank, score }),
      saveResponses(responseRows),
    ]);

    // SM-2 en background
    questions.forEach(async (q, i) => {
      const r = responseRows[i];
      const { data: existing } = await supabase.from('user_question_state')
        .select('*').eq('user_id', profile.id).eq('question_id', q.id).maybeSingle();
      const quality  = calcQuality(r.is_correct, r.time_taken_seconds || 30);
      const newState = sm2(existing || {}, quality);
      const errType  = classifyError(r.is_correct, q.correct_option_letter, r.selected_option_letter, r.time_taken_seconds);
      await upsertQuestionState(profile.id, q.id, {
        ...newState, last_error_type: errType || existing?.last_error_type,
        times_wrong:   (existing?.times_wrong   || 0) + (r.is_correct ? 0 : 1),
        times_correct: (existing?.times_correct || 0) + (r.is_correct ? 1 : 0),
      });
    });

    setResult({ correct, wrong, blank, score, percentile, order, extrap, analysis, bySpecialty,
      total: questions.length, secsUsed: SIMULACRO_MINS * 60 - secsLeft });
    setLoading(false);
    setPhase('result');
  }

  const mins = Math.floor(secsLeft / 60);
  const secs = String(secsLeft % 60).padStart(2, '0');
  const answered = Object.values(responses).filter(r => r.letter).length;
  const q = questions[current];

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
          { icon:'⏱', title:`${SIMULACRO_MINS} minutos`, desc:'Tiempo real del examen MIR' },
          { icon:'📝', title:`${SIMULACRO_QUESTIONS} preguntas`, desc:'Distribuidas por peso real' },
          { icon:'🧮', title:'+3 / -1 / 0', desc:'Fórmula de corrección oficial' },
          { icon:'📍', title:'Predicción de plaza', desc:'Número de orden estimado' },
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
            {[[50,'Parcial ~25min'],[100,'Medio ~50min'],[210,'Completo 3h55min']].map(([n,l]) => (
              <button key={n} onClick={() => setConfig(c=>({...c,numQuestions:n}))}
                className={`p-3 rounded-lg border-2 text-center transition-all ${config.numQuestions===n?'border-ink bg-ink text-white':'border-border hover:border-sky-300 hover:bg-sky-50 text-ink'}`}>
                <div className="font-display font-bold text-xl">{n}</div>
                <div className={`text-xs mt-0.5 ${config.numQuestions===n?'text-white/60':'text-slate-400'}`}>{l}</div>
              </button>
            ))}
          </div>
        </div>
        <div className="bg-sky-50 border border-sky-200 rounded-lg p-4 text-sm text-sky-700">
          💡 El simulacro completo de 210 preguntas es el más realista. Los parciales son buenos para entrenar gestión del tiempo.
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
    const resp      = responses[q.id];
    const isFlagged = flagged.has(q.id);
    const pctDone   = Math.round((answered / questions.length) * 100);
    const isUrgent  = secsLeft < 10 * 60;

    return (
      <div className="flex flex-col h-screen overflow-hidden">
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
          <button onClick={() => { if (confirm('¿Entregar el simulacro ahora?')) handleFinish(); }}
            className="px-3 py-1.5 bg-ink text-white text-xs font-bold rounded-full hover:opacity-90 transition-opacity shrink-0">
            Entregar
          </button>
        </div>

        <div className="flex flex-1 overflow-hidden">
          {/* Panel lateral — mapa de preguntas */}
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
                const r = responses[qq.id];
                const isFlag = flagged.has(qq.id);
                const isCurr = i === current;
                return (
                  <button key={qq.id} onClick={() => goTo(i)}
                    className={`w-8 h-8 rounded-md text-xs font-mono font-bold transition-all border
                      ${isCurr ? 'border-ink bg-ink text-white' :
                        isFlag ? 'border-amber-400 bg-amber-50 text-amber-700' :
                        r?.letter ? 'border-pulse-dim/40 bg-pulse-bg text-pulse-dim' :
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
              {/* Meta */}
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
              </div>

              <div className="flex flex-col gap-3 mb-6">
                {q.options.map(opt => {
                  const isCurSel  = selected === opt.letter;
                  const isPrevSel = resp?.letter === opt.letter && !isCurSel;
                  return (
                    <button key={opt.letter} onClick={() => handleAnswer(opt.letter)}
                      className={`flex items-start gap-4 p-4 rounded-xl border-2 text-left transition-all duration-150 w-full cursor-pointer active:scale-[.99]
                        ${isCurSel ? 'border-sky-500 bg-sky-50' :
                          isPrevSel ? 'border-sky-300 bg-sky-50/60' :
                          'border-border bg-white hover:border-sky-300 hover:bg-sky-50'}`}>
                      <span className={`w-7 h-7 rounded-full border-2 flex items-center justify-center font-mono text-xs font-bold shrink-0 mt-0.5 transition-all ${isCurSel?'bg-sky-500 border-sky-500 text-white':isPrevSel?'bg-sky-200 border-sky-300 text-sky-700':'bg-surface border-border text-slate-400'}`}>
                        {opt.letter.toUpperCase()}
                      </span>
                      <span className="text-sm leading-relaxed pt-0.5 text-ink">{opt.text}</span>
                    </button>
                  );
                })}
                {/* Dejar en blanco */}
                <button onClick={() => setSelected(null)}
                  className={`flex items-center gap-3 px-4 py-3 rounded-xl border-2 text-left transition-all text-sm font-medium ${!selected?'border-slate-300 bg-slate-50 text-slate-600':'border-border text-slate-400 hover:border-slate-300 hover:bg-slate-50'}`}>
                  <span className="w-7 h-7 rounded-full border-2 border-slate-300 flex items-center justify-center text-xs text-slate-400 shrink-0">—</span>
                  Dejar en blanco
                </button>
              </div>

              {/* Navegación */}
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
                  <button onClick={() => { handleNext(); handleFinish(); }}
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
  if (phase === 'result' && result) return <SimulacroResult result={result} cutoffs={cutoffs} onRepeat={() => setPhase('intro')} />;

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
      {/* Hero resultado */}
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

        {/* Predicción de plaza */}
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
            { label:'Correctas',   val:correct,  color:'text-pulse-dim' },
            { label:'Incorrectas', val:wrong,    color:'text-red-400' },
            { label:'En blanco',   val:blank,    color:'text-slate-400' },
            { label:'Tiempo',      val:`${minsUsed}min`, color:'text-sky-600' },
          ].map(s => (
            <div key={s.label} className="bg-surface border border-border rounded-lg py-3 px-2 text-center">
              <div className={`font-display font-bold text-xl ${s.color}`}>{s.val}</div>
              <div className="text-xs text-slate-400 mt-0.5">{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Tabs análisis */}
      <div className="flex gap-2 mb-5 overflow-x-auto pb-1">
        {[['resumen','Resumen'],['especialidades','Por especialidad'],['plaza','Predicción de plaza']].map(([k,l]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`px-4 py-2 rounded-full text-sm font-semibold whitespace-nowrap transition-all ${tab===k?'bg-ink text-white':'bg-white border border-border text-slate-500 hover:border-sky-300'}`}>
            {l}
          </button>
        ))}
      </div>

      {/* Tab resumen */}
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

      {/* Tab especialidades */}
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

      {/* Tab predicción */}
      {tab === 'plaza' && (
        <div className="flex flex-col gap-5">
          <Card>
            <CardHeader title="Especialidades alcanzables con tu puntuación" subtitle={`Basado en cutoffs MIR 2024 · Puntuación: ${Math.round(score)} pts`} />
            {reachable.length === 0 ? (
              <div className="text-center py-8">
                <div className="text-3xl mb-2">💪</div>
                <p className="text-sm text-slate-500">Aún no alcanzas el cutoff mínimo de ninguna especialidad.</p>
                <p className="text-xs text-slate-400 mt-1">El mínimo más bajo registrado es {Math.min(...cutoffs.map(c=>c.min_score)).toFixed(1)} pts.</p>
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

      {/* Acciones */}
      <div className="flex gap-3 justify-center flex-wrap mt-6">
        <Button onClick={onRepeat}>Repetir simulacro →</Button>
        <Link to="/app/errores" className="px-6 py-3 bg-white border border-border text-ink rounded-full font-semibold text-sm hover:border-sky-300 hover:bg-sky-50 transition-all">Analizar errores</Link>
        <Link to="/app/plan"    className="px-6 py-3 bg-white border border-border text-ink rounded-full font-semibold text-sm hover:border-sky-300 hover:bg-sky-50 transition-all">Volver al plan</Link>
      </div>
    </div>
  );
}
