import { useState, useEffect, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  supabase, fetchQuestions, fetchQuestionsByIds, startSession, submitAnswer, finishSession,
  getRepasoPendiente, getMostFailed, getNote, upsertNote, reportQuestion, reportError,
} from '../../lib/supabase';
import { useAuthStore, useExamStore, toast } from '../../store';
import { calcMirScore } from '../../lib/mir-scoring';
import { Button, Spinner, ScoreRing } from '../../components/ui';

// Las preguntas del modo "errores" llegan con la solución (ya las contestó);
// se retira para tratarlas igual que el resto: la corrige el servidor.
const stripKey = ({ correct_option_letter, explanation, ...rest }) => rest;

export default function ExamenPage() {
  const { profile, refreshProfile } = useAuthStore();
  const exam           = useExamStore();
  const [searchParams] = useSearchParams();
  const modoUrl        = searchParams.get('modo') || 'study';
  const espUrl         = searchParams.get('especialidad') || '';
  const [loadingStart, setLoadingStart] = useState(false);
  const [setupErr,     setSetupErr]     = useState('');
  const [saving,       setSaving]       = useState(false);
  const [saveError,    setSaveError]    = useState(false);
  const closedRef = useRef(null);   // sesión ya cerrada en el servidor

  // Sesión guardada de otro usuario o demasiado antigua → se descarta
  useEffect(() => { if (profile && exam.isStale(profile.id)) exam.reset(); }, []);

  // Cronómetro con reloj real (sobrevive a pestañas en segundo plano y a recargas)
  useEffect(() => {
    if (exam.phase !== 'exam') return;
    exam.tick();
    const id = setInterval(() => exam.tick(), 1000);
    return () => clearInterval(id);
  }, [exam.phase]);

  // Cierre de la sesión en el servidor (idempotente: calcula puntuación y especialidades débiles)
  async function closeSession() {
    setSaving(true); setSaveError(false);
    try {
      await finishSession({ sessionId: exam.sessionId });
      closedRef.current = exam.sessionId;
      await refreshProfile?.();
    } catch (e) { setSaveError(true); reportError(e); }
    finally { setSaving(false); }
  }
  useEffect(() => {
    if ((exam.phase === 'result' || exam.phase === 'review') && exam.sessionId && closedRef.current !== exam.sessionId) closeSession();
  }, [exam.phase, exam.sessionId]);

  async function handleStart() {
    setSetupErr(''); setLoadingStart(true);
    const cfg = exam.setupConfig;
    try {
      let questions = [];
      if (cfg.mode === 'repaso') {
        const due = await getRepasoPendiente(profile.id, cfg.numQuestions);
        if (!due.length) { setSetupErr('No hay repasos pendientes hoy. ¡Estás al día!'); return; }
        questions = await fetchQuestionsByIds(due.map(p => p.question_id));
      } else if (cfg.mode === 'errores') {
        const failed = await getMostFailed(profile.id, cfg.numQuestions);
        questions = failed.map(f => f.question).filter(Boolean).map(stripKey);
      } else {
        questions = await fetchQuestions({
          specialtyId: cfg.specialtyId, difficulty: cfg.difficulty || undefined, limit: cfg.numQuestions,
        });
      }
      if (!questions.length) { setSetupErr('No hay preguntas disponibles con estos filtros.'); return; }

      const session = await startSession({
        mode: cfg.mode || 'study',
        specialtyFilter: cfg.specialtyId ? [cfg.specialtyId] : [],
        total: questions.length,
      });
      closedRef.current = null;
      exam.startExam({ sessionId: session.id, questions, mode: cfg.mode || 'study', ownerId: profile.id });
    } catch (e) {
      setSetupErr(e.code === '42501'
        ? 'Tu acceso ha caducado. Renueva tu plan para seguir practicando.'
        : 'No se pudo iniciar la sesión: ' + e.message);
      reportError(e);
    } finally { setLoadingStart(false); }
  }

  if (exam.phase === 'setup')  return <Setup onStart={handleStart} loading={loadingStart} error={setupErr} modoUrl={modoUrl} espUrl={espUrl} />;
  if (exam.phase === 'exam')   return <ExamScreen />;
  return <ResultScreen saving={saving} saveError={saveError} onRetry={closeSession} />;
}

// ─── SETUP ─────────────────────────────────────────────────
function Setup({ onStart, loading, error, modoUrl, espUrl }) {
  const exam = useExamStore();
  const cfg  = exam.setupConfig;
  const [specialties, setSpecialties] = useState([]);

  useEffect(() => {
    supabase.from('specialties').select('id,name').order('name').then(({ data }) => setSpecialties(data||[]));
    if (modoUrl) exam.setSetupConfig({ mode: modoUrl });
    if (espUrl)  exam.setSetupConfig({ specialtyId: espUrl });
  }, []);

  const MODOS = [
    { key:'study',   label:'Estudio',    desc:'Explicación tras cada respuesta', icon:'📖' },
    { key:'errores', label:'Errores',    desc:'Preguntas que más has fallado',   icon:'🎯' },
    { key:'repaso',  label:'Repaso SM-2',desc:'Pendientes según el algoritmo',  icon:'🔁' },
  ];
  const NUMS = [10,20,40,80];

  return (
    <div className="flex items-center justify-center min-h-[80vh]">
      <div className="w-full max-w-lg">
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 bg-ink text-pulse px-4 py-1.5 rounded-full font-mono text-xs font-semibold mb-4">
            <span className="w-1.5 h-1.5 rounded-full bg-pulse animate-pulse-dot"/>
            NUEVA SESIÓN
          </div>
          <h1 className="font-display text-3xl font-bold text-ink tracking-tight mb-2">Configura tu sesión</h1>
          <p className="text-slate-400 text-sm">La constancia supera a la intensidad.</p>
        </div>

        <div className="bg-white border border-border rounded-xl p-6 shadow-sm">
          {/* Modo */}
          <div className="mb-5">
            <label className="block text-sm font-semibold text-ink mb-2">Modo de práctica</label>
            <div className="flex flex-col gap-2">
              {MODOS.map(m => (
                <button key={m.key} onClick={() => exam.setSetupConfig({ mode: m.key })}
                  className={`flex items-center gap-3 p-3 rounded-lg border-2 text-left transition-all ${cfg.mode===m.key?'border-ink bg-ink text-white':'border-border hover:border-sky-300 hover:bg-sky-50'}`}>
                  <span className="text-lg shrink-0">{m.icon}</span>
                  <div>
                    <div className={`text-sm font-semibold ${cfg.mode===m.key?'text-white':'text-ink'}`}>{m.label}</div>
                    <div className={`text-xs ${cfg.mode===m.key?'text-white/60':'text-slate-400'}`}>{m.desc}</div>
                  </div>
                  {cfg.mode===m.key && <span className="ml-auto text-pulse">✓</span>}
                </button>
              ))}
            </div>
          </div>

          {/* Especialidad (solo modo study) */}
          {cfg.mode === 'study' && (
            <div className="mb-5">
              <label className="block text-sm font-semibold text-ink mb-2">Especialidad</label>
              <select value={cfg.specialtyId} onChange={e => exam.setSetupConfig({ specialtyId: e.target.value })}
                className="w-full px-3.5 py-2.5 border border-border rounded-md text-sm text-ink bg-white outline-none focus:border-sky-400 transition-all cursor-pointer">
                <option value="">Todas las especialidades</option>
                {specialties.map(sp => <option key={sp.id} value={sp.id}>{sp.name}</option>)}
              </select>
            </div>
          )}

          {/* Dificultad (solo modo study) */}
          {cfg.mode === 'study' && (
            <div className="mb-5">
              <label className="block text-sm font-semibold text-ink mb-2">Dificultad</label>
              <div className="grid grid-cols-4 gap-2">
                {[['','Todas'],['1-2','Fácil'],['3','Media'],['4-5','Difícil']].map(([v,l]) => (
                  <button key={v} onClick={() => exam.setSetupConfig({ difficulty: v })}
                    className={`py-2 rounded-lg border-2 text-sm font-semibold transition-all ${cfg.difficulty===v?'border-ink bg-ink text-white':'border-border hover:border-sky-300 hover:bg-sky-50 text-slate-600'}`}>
                    {l}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Nº preguntas */}
          <div className="mb-6">
            <label className="block text-sm font-semibold text-ink mb-2">Número de preguntas</label>
            <div className="grid grid-cols-4 gap-2">
              {NUMS.map(n => (
                <button key={n} onClick={() => exam.setSetupConfig({ numQuestions: n })}
                  className={`py-3 rounded-lg border-2 transition-all text-center ${cfg.numQuestions===n?'border-ink bg-ink text-white':'border-border hover:border-sky-300 hover:bg-sky-50 text-ink'}`}>
                  <div className="font-display font-bold text-lg">{n}</div>
                  <div className={`text-xs mt-0.5 ${cfg.numQuestions===n?'text-white/60':'text-slate-400'}`}>~{n} min</div>
                </button>
              ))}
            </div>
          </div>

          {error && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-500 mb-4">{error}</div>}

          <button onClick={onStart} disabled={loading}
            className="w-full py-3.5 bg-ink text-white rounded-full font-bold text-base hover:-translate-y-0.5 hover:shadow-xl transition-all disabled:opacity-60 disabled:pointer-events-none flex items-center justify-center gap-2 relative overflow-hidden group">
            <span className="absolute inset-0 bg-gradient-to-r from-transparent via-pulse/20 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-500"/>
            {loading ? <><Spinner size="sm" light/> Cargando...</> : 'Empezar sesión →'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── EXAM SCREEN ───────────────────────────────────────────
function ExamScreen() {
  const exam    = useExamStore();
  const profile = useAuthStore(s => s.profile);
  const q       = exam.getCurrentQuestion();
  const resp    = q ? exam.getResponse(q.id) : null;
  const revealed = !!resp && resp.pending === false && resp.correctLetter != null;
  const isLast   = exam.current >= exam.questions.length - 1;
  const progress = Math.round(((exam.current + (revealed ? 1 : 0)) / exam.questions.length) * 100);
  const mins = Math.floor(exam.timerSecs / 60);
  const secs = String(exam.timerSecs % 60).padStart(2, '0');

  const [note, setNote]             = useState('');
  const [noteOpen, setNoteOpen]     = useState(false);
  const [noteSaving, setNoteSaving] = useState(false);

  useEffect(() => {
    if (!q || !profile || !noteOpen) return;
    getNote(profile.id, q.id).then(n => setNote(n?.content || ''));
  }, [q?.id, noteOpen]);

  async function saveNote() {
    setNoteSaving(true);
    await upsertNote(profile.id, q.id, note);
    setNoteSaving(false);
    toast.success('Nota guardada');
    setNoteOpen(false);
  }

  // Responder: la corrige el servidor (devuelve letra correcta + explicación)
  async function pick(letter) {
    const r = exam.answer(q.id, letter);
    if (!r) return;
    try {
      const fb = await submitAnswer(exam.sessionId, q.id, letter, r.timeSecs);
      exam.resolveAnswer(q.id, fb);
    } catch (e) {
      exam.clearResponse(q.id);
      toast.error(e.code === '42501' ? 'Tu acceso ha caducado.' : 'No se pudo guardar tu respuesta. Inténtalo de nuevo.');
      reportError(e);
    }
  }

  // Reportar pregunta
  const [reportOpen, setReportOpen]       = useState(false);
  const [reportReason, setReportReason]   = useState('wrong_answer');
  const [reportText, setReportText]       = useState('');
  const [reportSending, setReportSending] = useState(false);
  useEffect(() => { setReportOpen(false); setReportText(''); }, [q?.id]);
  async function sendReport() {
    setReportSending(true);
    try {
      await reportQuestion({ questionId: q.id, userId: profile.id, reason: reportReason, comment: reportText });
      toast.success('Gracias, revisaremos la pregunta');
      setReportOpen(false); setReportText('');
    } catch (e) { toast.error('No se pudo enviar el reporte'); reportError(e); }
    finally { setReportSending(false); }
  }

  // Atajos de teclado: A–E responden, Enter / → siguiente
  useEffect(() => {
    function onKey(e) {
      const tag = (e.target?.tagName || '').toLowerCase();
      if (tag === 'textarea' || tag === 'input' || tag === 'select' || e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (!resp && q && ['a','b','c','d','e'].includes(k) && q.options.some(o => o.letter === k)) pick(k);
      else if (revealed && (k === 'enter' || k === 'arrowright')) exam.next();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [q?.id, resp, revealed]);

  if (!q) return null;

  return (
    <div className="flex flex-col min-h-[calc(100vh-80px)]">
      {/* Topbar */}
      <div className="bg-white border border-border rounded-xl p-4 mb-6 flex items-center gap-4">
        <div className="flex-1">
          <div className="flex justify-between text-xs font-mono text-slate-400 mb-1.5">
            <span>Pregunta {exam.current+1} de {exam.questions.length}</span>
            <span>{progress}%</span>
          </div>
          <div className="h-1.5 bg-sky-100 rounded-full overflow-hidden">
            <div className="h-full bg-gradient-to-r from-sky-500 to-pulse rounded-full transition-all duration-500" style={{width:`${progress}%`}}/>
          </div>
        </div>
        <div className={`flex items-center gap-2 px-3.5 py-2 rounded-full border font-mono text-sm font-semibold transition-all ${exam.timerSecs > exam.questions.length*90?'border-amber-300 bg-amber-50 text-amber-600':'border-border bg-surface text-ink'}`}>
          <span className="w-1.5 h-1.5 rounded-full bg-pulse animate-pulse-dot"/>
          {mins}:{secs}
        </div>
        <button onClick={() => { if (confirm('¿Terminar la sesión?')) exam.goToResult(); }}
          className="px-3 py-2 text-xs font-semibold text-slate-400 border border-border rounded-full hover:text-red-500 hover:border-red-200 hover:bg-red-50 transition-all">
          Terminar
        </button>
      </div>

      <div className="flex-1 max-w-3xl mx-auto w-full">
        {/* Meta badges */}
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          <span className="font-mono text-[0.65rem] font-semibold text-slate-400 bg-surface border border-border px-2.5 py-1 rounded-full">#{exam.current+1}</span>
          {q.specialty && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-ink text-white font-mono text-[0.68rem] font-semibold uppercase tracking-wider">
              <span className="w-1.5 h-1.5 rounded-full" style={{background:q.specialty.color||'#00E5C7'}}/>
              {q.specialty.name}
            </span>
          )}
          {q.difficulty && (
            <span className={`inline-flex px-2.5 py-0.5 rounded-full font-mono text-[0.68rem] font-semibold uppercase tracking-wider border ${q.difficulty<=2?'bg-emerald-50 text-emerald-700 border-emerald-200':q.difficulty===3?'bg-amber-50 text-amber-700 border-amber-200':'bg-red-50 text-red-500 border-red-200'}`}>
              {q.difficulty<=2?'Fácil':q.difficulty===3?'Media':'Difícil'}
            </span>
          )}
          {q.year_exam && <span className="text-xs text-slate-400 font-mono">MIR {q.year_exam}</span>}
          {q.question_number && <span className="text-xs text-slate-400 font-mono">Nº{q.question_number}</span>}
          <div className="ml-auto flex items-center gap-4">
            <button onClick={() => setReportOpen(o => !o)}
              className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-red-500 transition-colors font-medium">
              🚩 Reportar
            </button>
            <button onClick={() => setNoteOpen(o => !o)}
              className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-sky-600 transition-colors font-medium">
              📓 {noteOpen ? 'Cerrar nota' : 'Añadir nota'}
            </button>
          </div>
        </div>

        {/* Reporte */}
        {reportOpen && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-4">
            <div className="text-xs font-semibold text-red-600 mb-2">¿Qué problema tiene esta pregunta?</div>
            <select value={reportReason} onChange={e => setReportReason(e.target.value)}
              className="w-full mb-2 px-3 py-2 border border-red-200 rounded-md text-sm bg-white outline-none">
              <option value="wrong_answer">La respuesta correcta parece incorrecta</option>
              <option value="unclear">El enunciado es confuso o ambiguo</option>
              <option value="typo">Errata o error de redacción</option>
              <option value="outdated">Contenido desactualizado</option>
              <option value="other">Otro</option>
            </select>
            <textarea value={reportText} onChange={e => setReportText(e.target.value)} rows={2} maxLength={500}
              placeholder="Cuéntanos más (opcional)"
              className="w-full px-3 py-2 border border-red-200 rounded-md text-sm bg-white outline-none resize-none"/>
            <div className="flex justify-end mt-2">
              <button onClick={sendReport} disabled={reportSending}
                className="text-xs font-semibold text-red-600 hover:text-red-800 disabled:opacity-50">
                {reportSending ? 'Enviando...' : 'Enviar reporte'}
              </button>
            </div>
          </div>
        )}

        {/* Nota */}
        {noteOpen && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-4 animate-[slideDown_.2s_ease]">
            <textarea value={note} onChange={e => setNote(e.target.value)} rows={3}
              placeholder="Escribe tu nota personal sobre esta pregunta..."
              className="w-full bg-transparent text-sm text-amber-900 resize-none outline-none placeholder:text-amber-400"/>
            <div className="flex justify-end mt-2">
              <button onClick={saveNote} disabled={noteSaving}
                className="text-xs font-semibold text-amber-700 hover:text-amber-900 transition-colors">
                {noteSaving ? 'Guardando...' : '✓ Guardar nota'}
              </button>
            </div>
          </div>
        )}

        {/* Enunciado */}
        <div className="bg-white border border-border rounded-xl p-6 mb-4 shadow-sm">
          <p className="font-display text-base font-semibold text-ink leading-relaxed">{q.text}</p>
          {q.image_url && (
            <img src={q.image_url} alt="Imagen de la pregunta" loading="lazy"
              className="mt-4 max-h-96 w-auto mx-auto rounded-lg border border-border"/>
          )}
        </div>

        {/* Opciones */}
        <div className="flex flex-col gap-3 mb-5">
          {q.options.map(opt => {
            const isSelected = resp?.letter === opt.letter;
            const isCorrect  = revealed && opt.letter === resp.correctLetter;
            const isWrong    = revealed && isSelected && !isCorrect;
            const isDimmed   = revealed && !isCorrect && !isSelected;

            let cls = 'border-border bg-white hover:border-sky-300 hover:bg-sky-50';
            if (!revealed && isSelected) cls = 'border-sky-500 bg-sky-50';
            if (isCorrect)  cls = 'border-pulse-dim bg-pulse-bg shadow-[0_0_0_3px_rgba(0,229,199,.1)]';
            if (isWrong)    cls = 'border-red-400 bg-red-50';
            if (isDimmed)   cls = 'border-border bg-white opacity-50';

            let lCls = 'bg-surface border-border text-slate-400';
            if (!revealed && isSelected) lCls = 'bg-sky-500 border-sky-500 text-white';
            if (isCorrect)  lCls = 'bg-pulse-dim border-pulse-dim text-white';
            if (isWrong)    lCls = 'bg-red-400 border-red-400 text-white';

            return (
              <button key={opt.letter} onClick={() => !resp && pick(opt.letter)} disabled={!!resp}
                className={`flex items-start gap-4 p-4 rounded-xl border-2 text-left transition-all duration-200 w-full ${cls} ${!resp?'cursor-pointer active:scale-[.99]':'cursor-default'}`}>
                <span className={`w-7 h-7 rounded-full border-2 flex items-center justify-center font-mono text-xs font-bold shrink-0 mt-0.5 transition-all ${lCls}`}>
                  {opt.letter.toUpperCase()}
                </span>
                <span className={`text-sm leading-relaxed pt-0.5 flex-1 ${isCorrect?'font-semibold text-emerald-900':isWrong?'text-red-700':'text-ink'}`}>{opt.text}</span>
                {isCorrect && <span className="text-pulse-dim text-lg shrink-0">✓</span>}
                {isWrong   && <span className="text-red-400 text-lg shrink-0">✕</span>}
              </button>
            );
          })}
        </div>

        {/* Explicación (la devuelve el servidor tras corregir) */}
        {revealed && (
          <div className="bg-white border-l-4 border-pulse-dim rounded-r-xl p-5 mb-5 shadow-sm animate-[slideDown_.3s_ease]">
            <div className="font-mono text-[0.65rem] font-bold text-pulse-dim uppercase tracking-wider mb-2">✓ Explicación</div>
            <p className="text-sm text-ink leading-relaxed">{resp.explanation || 'Esta pregunta aún no tiene explicación.'}</p>
          </div>
        )}

        {/* Acciones */}
        <div className="flex justify-between items-center">
          <button onClick={() => exam.skip()}
            className={`px-5 py-2.5 border border-border rounded-full text-sm font-semibold text-slate-500 hover:border-sky-300 hover:bg-sky-50 transition-all ${resp?'invisible':''}`}>
            Saltar →
          </button>
          {revealed && (
            <button onClick={() => exam.next()}
              className="px-6 py-2.5 bg-ink text-white rounded-full text-sm font-bold hover:-translate-y-0.5 hover:shadow-lg transition-all flex items-center gap-2 relative overflow-hidden group">
              <span className="absolute inset-0 bg-gradient-to-r from-transparent via-pulse/20 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-500"/>
              {isLast ? 'Ver resultados →' : 'Siguiente →'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── RESULT SCREEN ─────────────────────────────────────────
function ResultScreen({ saving, saveError, onRetry }) {
  const exam = useExamStore();
  const { correct, wrong, blank, total } = exam.getStats();
  const pct   = total ? Math.round((correct / total) * 100) : 0;
  const score = calcMirScore({ correct, wrong, blank });
  const mins  = Math.round(exam.timerSecs / 60);

  const espMap = {};
  exam.questions.forEach(q => {
    const id   = q.specialty?.id;
    const name = q.specialty?.name || '—';
    if (!id) return;
    if (!espMap[id]) espMap[id] = { name, correct: 0, total: 0, color: q.specialty?.color };
    espMap[id].total++;
    if (exam.getResponse(q.id)?.isCorrect) espMap[id].correct++;
  });
  const bySpecialty = Object.values(espMap)
    .map(e => ({ ...e, pct: Math.round((e.correct/e.total)*100) }))
    .sort((a,b) => a.pct - b.pct);

  const [,title,sub] = [
    [90,'¡Sobresaliente! 🎉',`${pct}% de acierto. Rendimiento excepcional.`],
    [65,'¡Por encima del corte! ✓',`${pct}% — Buen ritmo para el MIR.`],
    [50,'Buen trabajo 💪',`${pct}% — Sigue practicando para superar el 65%.`],
    [0, 'A seguir mejorando 📚',`${pct}% — Revisa las explicaciones y repite.`],
  ].find(([min]) => pct >= min);

  return (
    <div className="max-w-2xl mx-auto py-8">
      {saving && <div className="mb-4 text-center text-xs text-slate-400 font-mono">Guardando resultados…</div>}
      {saveError && (
        <div className="mb-4 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-700 flex items-center justify-between gap-3">
          <span>No se pudo cerrar la sesión en el servidor. Tus respuestas ya estaban guardadas.</span>
          <button onClick={onRetry} className="font-semibold underline shrink-0">Reintentar</button>
        </div>
      )}
      <div className="bg-white border border-border rounded-xl p-8 mb-5 text-center shadow-sm relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_400px_300px_at_50%_120%,rgba(0,229,199,.06),transparent)] pointer-events-none"/>
        <div className="flex justify-center mb-6">
          <ScoreRing pct={pct} />
        </div>
        <h2 className="font-display font-bold text-2xl text-ink mb-2">{title}</h2>
        <p className="text-sm text-slate-400 mb-6 max-w-sm mx-auto">{sub}</p>
        <div className="grid grid-cols-4 gap-3 mb-6">
          {[
            { label:'Correctas',   val:correct,      color:'text-pulse-dim' },
            { label:'Incorrectas', val:wrong,        color:'text-red-400' },
            { label:'Blanco',      val:blank,        color:'text-slate-400' },
            { label:'Tiempo',      val:`${mins}min`, color:'text-sky-600' },
          ].map(s => (
            <div key={s.label} className="bg-surface border border-border rounded-lg py-3 px-2 text-center">
              <div className={`font-display font-bold text-xl ${s.color}`}>{s.val}</div>
              <div className="text-xs text-slate-400 mt-0.5">{s.label}</div>
            </div>
          ))}
        </div>
        <div className={`inline-flex items-center gap-2 px-4 py-2 rounded-full text-xs font-semibold border ${pct>=65?'bg-pulse-bg border-pulse-dim/30 text-pulse-dim':'bg-amber-50 border-amber-200 text-amber-600'}`}>
          {pct>=65 ? '✓ Por encima del corte MIR estimado (65%)' : `Necesitas ${65-pct}pp más para el corte`}
        </div>
      </div>

      {bySpecialty.length > 1 && (
        <div className="bg-white border border-border rounded-xl p-6 mb-5 shadow-sm">
          <h3 className="font-display font-bold text-base text-ink mb-4">Resultados por especialidad</h3>
          <div className="flex flex-col gap-3">
            {bySpecialty.map(e => (
              <div key={e.name}>
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{background:e.color||'#0EA5E9'}}/>
                    <span className="text-sm font-medium text-ink">{e.name}</span>
                  </div>
                  <span className={`font-mono text-sm font-bold ${e.pct>=65?'text-pulse-dim':e.pct>=50?'text-amber-500':'text-red-400'}`}>
                    {e.correct}/{e.total} ({e.pct}%)
                  </span>
                </div>
                <div className="h-2 bg-sky-50 rounded-full overflow-hidden">
                  <div className="h-full rounded-full transition-all duration-700"
                    style={{width:`${e.pct}%`, background: e.pct>=65?'linear-gradient(90deg,#0EA5E9,#00E5C7)':e.pct>=50?'#F59E0B':'#EF4444'}}/>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex gap-3 justify-center flex-wrap">
        <Button onClick={() => exam.reset()}>Nueva sesión →</Button>
        <Link to="/app/estadisticas" className="px-6 py-3 bg-white border border-border text-ink rounded-full font-semibold text-sm hover:border-sky-300 hover:bg-sky-50 transition-all">Ver estadísticas</Link>
        <Link to="/app/plan"         className="px-6 py-3 bg-white border border-border text-ink rounded-full font-semibold text-sm hover:border-sky-300 hover:bg-sky-50 transition-all">Volver al plan</Link>
      </div>
    </div>
  );
}
