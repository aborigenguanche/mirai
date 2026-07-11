import { useState, useEffect, useRef } from 'react';
import { useSpacedRepetition } from '../../hooks/useSpacedRepetition';
import { clasificarError } from '../../lib/spaced-repetition';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useAuthStore, useExamStore } from '../../store';
import { Button, Badge, Spinner } from '../../components/ui';

const ESPECIALIDADES = [
  'Cardiología','Neumología','Digestivo','Nefrología','Neurología',
  'Endocrinología','Reumatología','Hematología','Oncología','Infecciosas',
  'Ginecología','Obstetricia','Pediatría','Psiquiatría','Dermatología',
  'Oftalmología','ORL','Traumatología','Urología','Cirugía General',
];

export default function PracticarPage() {
  const { usuario } = useAuthStore();
  const exam = useExamStore();
  const sr   = useSpacedRepetition(usuario.id);
  const [searchParams] = useSearchParams();
  const modo = searchParams.get('modo') || 'normal'; // 'normal' | 'repaso' | 'errores'
  const [loadingStart, setLoadingStart] = useState(false);
  const [setupError, setSetupError]     = useState('');
  const [config, setConfig]             = useState({
    especialidad: searchParams.get('especialidad') || '',
    numPreguntas: 20,
    dificultad: '',
  });
  const timerRef = useRef(null);

  // Timer global
  useEffect(() => {
    if (exam.fase === 'examen') {
      timerRef.current = setInterval(() => exam.tickTimer(), 1000);
    } else {
      clearInterval(timerRef.current);
    }
    return () => clearInterval(timerRef.current);
  }, [exam.fase]);

  // Auto-arrancar en modo repaso o errores
  useEffect(() => {
    if (exam.fase === 'setup' && (modo === 'repaso' || modo === 'errores')) {
      handleStart();
    }
  }, [modo]);

  // Guardar sesión al terminar + actualizar SM-2
  useEffect(() => {
    if (exam.fase === 'resultado' && exam.intentos.length > 0) {
      saveSession();
    }
  }, [exam.fase]);

  async function saveSession() {
    try {
      // Guardar intentos con tipo_error clasificado
      const intentosConError = exam.intentos.map((intento, i) => {
        const pregunta = exam.preguntas[i];
        const tipoError = clasificarError(
          intento.es_correcto,
          pregunta?.respuesta_correcta,
          intento.respuesta_dada,
          intento.tiempo_segundos
        );
        return { ...intento, usuario_id: usuario.id, tipo_error: tipoError };
      });
      await supabase.from('intentos').insert(intentosConError);

      // Actualizar SM-2 para cada intento
      for (let i = 0; i < exam.intentos.length; i++) {
        const intento  = exam.intentos[i];
        const pregunta = exam.preguntas[i];
        if (pregunta) {
          await sr.registrarResultado({
            preguntaId:        pregunta.id,
            esCorrecta:        intento.es_correcto,
            respuestaCorrecta: pregunta.respuesta_correcta,
            respuestaDada:     intento.respuesta_dada,
            tiempoSecs:        intento.tiempo_segundos || 30,
          });
        }
      }

      const especialidades = [...new Set(exam.preguntas.slice(0, exam.intentos.length).map(p => p.especialidad))];
      await supabase.from('sesiones').insert({
        usuario_id: usuario.id,
        total_preguntas: exam.intentos.length,
        total_correctas: exam.correctas,
        especialidades,
        duracion_minutos: Math.round(exam.timerSecs / 60),
      });
    } catch (err) {
      console.error('Error guardando sesión:', err);
    }
  }

  async function handleStart() {
    setSetupError('');
    setLoadingStart(true);
    let preguntas = [];

    if (modo === 'repaso') {
      // Preguntas pendientes de repaso SM-2
      const pendientes = await sr.getPendientesHoy(config.numPreguntas);
      if (pendientes.length === 0) {
        setSetupError('No hay preguntas pendientes de repaso hoy. ¡Estás al día!');
        setLoadingStart(false);
        return;
      }
      const ids = pendientes.map(p => p.pregunta_id);
      const { data } = await supabase.from('preguntas').select('*').in('id', ids).eq('activa', true);
      preguntas = data || [];
    } else if (modo === 'errores') {
      // Preguntas más falladas
      const falladas = await sr.getMasFalladas(config.numPreguntas);
      preguntas = falladas.map(f => f.pregunta).filter(Boolean);
    } else {
      // Modo normal
      let query = supabase.from('preguntas').select('*').eq('activa', true);
      if (config.especialidad) query = query.eq('especialidad', config.especialidad);
      if (config.dificultad)   query = query.eq('dificultad', config.dificultad);
      const { data } = await query;
      preguntas = data || [];
    }

    setLoadingStart(false);
    if (!preguntas.length) {
      setSetupError('No hay preguntas disponibles con estos filtros.');
      return;
    }
    const shuffled = preguntas.sort(() => Math.random() - .5).slice(0, config.numPreguntas);
    exam.startExam(shuffled);
  }

  if (exam.fase === 'setup')     return <Setup config={config} setConfig={setConfig} onStart={handleStart} loading={loadingStart} error={setupError} />;
  if (exam.fase === 'examen')    return <Examen />;
  if (exam.fase === 'resultado') return <Resultado />;
  return null;
}

// ─── PANTALLA CONFIGURACIÓN ────────────────────────────────
function Setup({ config, setConfig, onStart, loading, error }) {
  const NUMS = [10, 20, 40, 80];
  return (
    <div className="flex items-center justify-center min-h-[80vh]">
      <div className="w-full max-w-lg">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 bg-ink text-pulse px-4 py-1.5 rounded-full font-mono text-xs font-semibold mb-4">
            <span className="w-1.5 h-1.5 rounded-full bg-pulse animate-pulse-dot" />
            NUEVO BLOQUE DE PRÁCTICA
          </div>
          <h1 className="font-display text-3xl font-bold text-ink tracking-tight mb-2">Configura tu sesión</h1>
          <p className="text-slate-400 text-sm">Cuanto más constante seas, más sube tu puntuación.</p>
        </div>

        <div className="bg-white border border-border rounded-xl p-6 shadow-sm">
          {/* Especialidad */}
          <div className="mb-5">
            <label className="block text-sm font-semibold text-ink mb-2">Especialidad</label>
            <select
              value={config.especialidad}
              onChange={e => setConfig(p => ({...p, especialidad: e.target.value}))}
              className="w-full px-3.5 py-2.5 border border-border rounded-md text-sm text-ink bg-white outline-none focus:border-sky-400 focus:shadow-[0_0_0_3px_rgba(14,165,233,.1)] transition-all cursor-pointer"
            >
              <option value="">Todas las especialidades</option>
              {ESPECIALIDADES.map(e => <option key={e} value={e}>{e}</option>)}
            </select>
          </div>

          {/* Número de preguntas */}
          <div className="mb-5">
            <label className="block text-sm font-semibold text-ink mb-2">Número de preguntas</label>
            <div className="grid grid-cols-4 gap-2">
              {NUMS.map(n => (
                <button key={n} onClick={() => setConfig(p => ({...p, numPreguntas: n}))}
                  className={`py-3 rounded-lg border-2 transition-all text-center ${config.numPreguntas === n
                    ? 'border-ink bg-ink text-white'
                    : 'border-border hover:border-sky-300 hover:bg-sky-50 text-ink'}`}>
                  <div className="font-display font-bold text-lg">{n}</div>
                  <div className={`text-xs mt-0.5 ${config.numPreguntas === n ? 'text-white/60' : 'text-slate-400'}`}>
                    ~{n} min
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Dificultad */}
          <div className="mb-6">
            <label className="block text-sm font-semibold text-ink mb-2">Dificultad</label>
            <div className="grid grid-cols-4 gap-2">
              {[['','Todas'],['facil','Fácil'],['media','Media'],['dificil','Difícil']].map(([val, label]) => (
                <button key={val} onClick={() => setConfig(p => ({...p, dificultad: val}))}
                  className={`py-2.5 rounded-lg border-2 text-sm font-semibold transition-all ${config.dificultad === val
                    ? 'border-ink bg-ink text-white'
                    : 'border-border hover:border-sky-300 hover:bg-sky-50 text-slate-600'}`}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-500 mb-4">
              {error}
            </div>
          )}

          <button onClick={onStart} disabled={loading}
            className="w-full py-3.5 bg-ink text-white rounded-full font-bold text-base hover:-translate-y-0.5 hover:shadow-xl hover:shadow-ink/20 transition-all disabled:opacity-60 disabled:pointer-events-none flex items-center justify-center gap-2 relative overflow-hidden group">
            <span className="absolute inset-0 bg-gradient-to-r from-transparent via-pulse/20 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-500" />
            {loading ? <><Spinner size="sm" light /> Cargando preguntas...</> : <>Empezar sesión →</>}
          </button>
        </div>

        <p className="text-center text-xs text-slate-400 mt-4">
          Las preguntas se seleccionan aleatoriamente del banco de {config.especialidad || 'todas las especialidades'}
        </p>
      </div>
    </div>
  );
}

// ─── PANTALLA EXAMEN ───────────────────────────────────────
function Examen() {
  const exam = useExamStore();
  const p = exam.preguntas[exam.current];
  const progPct = Math.round((exam.current / exam.preguntas.length) * 100);
  const mins = Math.floor(exam.timerSecs / 60);
  const secs = String(exam.timerSecs % 60).padStart(2, '0');
  const isLast = exam.current >= exam.preguntas.length - 1;
  const LETRAS = ['a','b','c','d','e'];

  if (!p) return null;

  return (
    <div className="flex flex-col min-h-[calc(100vh-80px)]">
      {/* Topbar examen */}
      <div className="bg-white border border-border rounded-xl p-4 mb-6 flex items-center gap-4">
        <div className="flex-1">
          <div className="flex justify-between text-xs font-mono text-slate-400 mb-1.5">
            <span>Pregunta {exam.current + 1} de {exam.preguntas.length}</span>
            <span>{progPct}%</span>
          </div>
          <div className="h-1.5 bg-sky-100 rounded-full overflow-hidden">
            <div className="h-full bg-gradient-to-r from-sky-500 to-pulse rounded-full transition-all duration-500" style={{ width: `${progPct}%` }} />
          </div>
        </div>
        <div className={`flex items-center gap-2 px-4 py-2 rounded-full border font-mono text-sm font-semibold transition-all ${exam.timerSecs > exam.preguntas.length * 120 ? 'border-amber-300 bg-amber-50 text-amber-600' : 'border-border bg-surface text-ink'}`}>
          <span className="w-1.5 h-1.5 rounded-full bg-pulse animate-pulse-dot" />
          {mins}:{secs}
        </div>
        <button onClick={() => { if (confirm('¿Terminar la sesión ahora?')) exam.finishExam(); }}
          className="px-3 py-2 text-xs font-semibold text-slate-400 border border-border rounded-full hover:text-red-500 hover:border-red-200 hover:bg-red-50 transition-all">
          Terminar
        </button>
      </div>

      {/* Pregunta */}
      <div className="flex-1 max-w-3xl mx-auto w-full">
        {/* Meta */}
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          <span className="font-mono text-[0.65rem] font-semibold uppercase tracking-wider text-slate-400 bg-surface border border-border px-2.5 py-1 rounded-full">
            #{exam.current + 1}
          </span>
          <Badge variant="ink">{p.especialidad}</Badge>
          <Badge variant={p.dificultad === 'facil' ? 'green' : p.dificultad === 'media' ? 'amber' : 'red'}>{p.dificultad}</Badge>
          {p.anyo_mir && <Badge variant="gray">MIR {p.anyo_mir}</Badge>}
        </div>

        {/* Enunciado */}
        <div className="bg-white border border-border rounded-xl p-6 mb-4 shadow-sm">
          <p className="font-display text-base font-semibold text-ink leading-relaxed">{p.enunciado}</p>
        </div>

        {/* Opciones */}
        <div className="flex flex-col gap-3 mb-5">
          {LETRAS.filter(l => p[`opcion_${l}`]).map(l => {
            const isSelected  = exam.respondida && exam.intentos.at(-1)?.respuesta_dada === l;
            const isCorrect   = exam.respondida && p.respuesta_correcta === l;
            const isWrong     = isSelected && !isCorrect;

            let cls = 'border-border bg-white hover:border-sky-300 hover:bg-sky-50';
            if (exam.respondida) {
              if (isCorrect) cls = 'border-pulse-dim bg-pulse-bg shadow-[0_0_0_3px_rgba(0,229,199,.1)]';
              else if (isWrong) cls = 'border-red-400 bg-red-50';
              else cls = 'border-border bg-white opacity-60';
            }

            let letterCls = 'bg-surface border-border text-slate-400';
            if (exam.respondida) {
              if (isCorrect) letterCls = 'bg-pulse-dim border-pulse-dim text-white';
              else if (isWrong) letterCls = 'bg-red-400 border-red-400 text-white';
            }

            return (
              <button key={l}
                onClick={() => !exam.respondida && exam.responder(l)}
                disabled={exam.respondida}
                className={`flex items-start gap-4 p-4 rounded-xl border-2 text-left transition-all duration-200 w-full ${cls} ${!exam.respondida ? 'cursor-pointer active:scale-[.99]' : 'cursor-default'}`}
              >
                <span className={`w-7 h-7 rounded-full border-2 flex items-center justify-center font-mono text-xs font-bold shrink-0 mt-0.5 transition-all ${letterCls}`}>
                  {l.toUpperCase()}
                </span>
                <span className={`text-sm leading-relaxed pt-0.5 ${isCorrect ? 'font-semibold text-emerald-900' : isWrong ? 'text-red-700' : 'text-ink'}`}>
                  {p[`opcion_${l}`]}
                </span>
                {isCorrect && <span className="ml-auto text-pulse-dim text-lg shrink-0">✓</span>}
                {isWrong   && <span className="ml-auto text-red-400 text-lg shrink-0">✕</span>}
              </button>
            );
          })}
        </div>

        {/* Explicación */}
        {exam.respondida && (
          <div className="animate-slide-down bg-white border-l-4 border-pulse-dim rounded-r-xl p-5 mb-5 shadow-sm">
            <div className="flex items-center gap-2 mb-2">
              <span className="font-mono text-xs font-bold text-pulse-dim uppercase tracking-wider">✓ Explicación</span>
            </div>
            <p className="text-sm text-ink leading-relaxed mb-2">{p.explicacion}</p>
            {p.referencia && (
              <p className="text-xs text-slate-400 italic flex items-center gap-1.5">
                <span>📚</span> {p.referencia}
              </p>
            )}
          </div>
        )}

        {/* Acciones */}
        <div className="flex justify-end gap-3">
          {!exam.respondida && (
            <button onClick={() => exam.nextQuestion()}
              className="px-5 py-2.5 border border-border rounded-full text-sm font-semibold text-slate-500 hover:border-sky-300 hover:bg-sky-50 transition-all">
              Saltar →
            </button>
          )}
          {exam.respondida && (
            <button onClick={() => exam.nextQuestion()}
              className="px-6 py-2.5 bg-ink text-white rounded-full text-sm font-bold hover:-translate-y-0.5 hover:shadow-lg transition-all flex items-center gap-2 relative overflow-hidden group">
              <span className="absolute inset-0 bg-gradient-to-r from-transparent via-pulse/20 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-500" />
              {isLast ? 'Ver resultados →' : 'Siguiente →'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── PANTALLA RESULTADO ────────────────────────────────────
function Resultado() {
  const exam = useExamStore();
  const total  = exam.intentos.length;
  const pct    = total ? Math.round((exam.correctas / total) * 100) : 0;
  const mins   = Math.round(exam.timerSecs / 60);
  const circumference = 2 * Math.PI * 52;
  const offset = circumference - (circumference * pct / 100);

  const [strokeOffset, setStrokeOffset] = useState(circumference);
  useEffect(() => {
    const t = setTimeout(() => setStrokeOffset(offset), 100);
    return () => clearTimeout(t);
  }, [offset]);

  const msgs = [
    [90, '¡Sobresaliente! 🎉', 'Rendimiento excepcional. Muy por encima del corte.'],
    [65, '¡Por encima del corte! ✓', `${pct}% de acierto. Estás en buena posición para el MIR.`],
    [50, 'Buen trabajo 💪',  `${pct}% de acierto. Sigue practicando para superar el 65%.`],
    [0,  'A seguir mejorando 📚', `${pct}% de acierto. Revisa las explicaciones y repite.`],
  ];
  const [, title, sub] = msgs.find(([min]) => pct >= min);

  // Análisis por especialidad de esta sesión
  const espMap = {};
  exam.preguntas.slice(0, total).forEach((p, i) => {
    if (!espMap[p.especialidad]) espMap[p.especialidad] = { total: 0, correctas: 0 };
    espMap[p.especialidad].total++;
    if (exam.intentos[i]?.es_correcto) espMap[p.especialidad].correctas++;
  });
  const espResults = Object.entries(espMap).map(([nombre, d]) => ({
    nombre, pct: Math.round((d.correctas / d.total) * 100), ...d,
  })).sort((a, b) => a.pct - b.pct);

  return (
    <div className="max-w-2xl mx-auto py-8">
      {/* Header resultado */}
      <div className="bg-white border border-border rounded-xl p-8 mb-5 text-center shadow-sm relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_400px_300px_at_50%_120%,rgba(0,229,199,.06),transparent)] pointer-events-none" />

        {/* Donut */}
        <div className="relative w-36 h-36 mx-auto mb-6">
          <svg className="w-36 h-36 -rotate-90" viewBox="0 0 120 120">
            <circle cx="60" cy="60" r="52" fill="none" stroke="#E0F2FE" strokeWidth="10" />
            <circle cx="60" cy="60" r="52" fill="none" stroke="url(#grad)" strokeWidth="10"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={strokeOffset}
              style={{ transition: 'stroke-dashoffset 1.2s cubic-bezier(.22,1,.36,1)' }}
            />
            <defs>
              <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#0EA5E9" />
                <stop offset="100%" stopColor="#00E5C7" />
              </linearGradient>
            </defs>
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="font-display font-bold text-3xl text-ink leading-none">{pct}%</span>
            <span className="text-xs text-slate-400 mt-0.5">acierto</span>
          </div>
        </div>

        <h2 className="font-display font-bold text-2xl text-ink mb-2">{title}</h2>
        <p className="text-sm text-slate-400 leading-relaxed mb-6 max-w-sm mx-auto">{sub}</p>

        <div className="grid grid-cols-3 gap-3 mb-6">
          {[
            { label: 'Preguntas', val: total,          color: 'text-ink' },
            { label: 'Correctas', val: exam.correctas, color: 'text-pulse-dim' },
            { label: 'Tiempo',    val: `${mins} min`,  color: 'text-sky-600' },
          ].map(s => (
            <div key={s.label} className="bg-surface border border-border rounded-lg py-3 px-2">
              <div className={`font-display font-bold text-xl ${s.color}`}>{s.val}</div>
              <div className="text-xs text-slate-400 mt-0.5">{s.label}</div>
            </div>
          ))}
        </div>

        {/* Indicador corte MIR */}
        <div className={`inline-flex items-center gap-2 px-4 py-2 rounded-full text-xs font-semibold border ${pct >= 65 ? 'bg-pulse-bg border-pulse-dim/30 text-pulse-dim' : 'bg-amber-50 border-amber-200 text-amber-600'}`}>
          {pct >= 65 ? '✓ Por encima del corte MIR estimado (65%)' : `Necesitas ${65 - pct} puntos más para el corte`}
        </div>
      </div>

      {/* Resultados por especialidad */}
      {espResults.length > 1 && (
        <div className="bg-white border border-border rounded-xl p-6 mb-5 shadow-sm">
          <h3 className="font-display font-bold text-base text-ink mb-4">Resultados por especialidad</h3>
          <div className="flex flex-col gap-3">
            {espResults.map(e => {
              const color = e.pct >= 70 ? 'from-sky-400 to-pulse' : e.pct >= 50 ? 'from-sky-400 to-sky-500' : e.pct >= 30 ? 'from-amber-400 to-amber-500' : 'from-red-400 to-red-500';
              return (
                <div key={e.nombre}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium text-ink">{e.nombre}</span>
                    <span className={`font-mono text-sm font-bold ${e.pct >= 65 ? 'text-pulse-dim' : e.pct >= 50 ? 'text-amber-500' : 'text-red-400'}`}>
                      {e.correctas}/{e.total} ({e.pct}%)
                    </span>
                  </div>
                  <div className="h-2 bg-sky-50 rounded-full overflow-hidden">
                    <div className={`h-full bg-gradient-to-r ${color} rounded-full`} style={{ width: `${e.pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Acciones */}
      <div className="flex gap-3 justify-center flex-wrap">
        <button onClick={() => exam.resetExam()}
          className="px-6 py-3 bg-ink text-white rounded-full font-bold hover:-translate-y-0.5 hover:shadow-lg transition-all flex items-center gap-2 relative overflow-hidden group">
          <span className="absolute inset-0 bg-gradient-to-r from-transparent via-pulse/20 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-500" />
          Nueva sesión →
        </button>
        <a href="/app/estadisticas"
          className="px-6 py-3 bg-white border border-border text-ink rounded-full font-semibold text-sm hover:border-sky-300 hover:bg-sky-50 transition-all">
          Ver estadísticas
        </a>
        <a href="/app/dashboard"
          className="px-6 py-3 bg-white border border-border text-ink rounded-full font-semibold text-sm hover:border-sky-300 hover:bg-sky-50 transition-all">
          Volver al dashboard
        </a>
      </div>
    </div>
  );
}
