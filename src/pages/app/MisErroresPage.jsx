import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { supabase, getMostFailed, countRepasoPendiente } from '../../lib/supabase';
import { useAuthStore } from '../../store';
import { toast } from '../../store';
import { Card, CardHeader, Badge, EmptyState, LoadingScreen } from '../../components/ui';

const TIPO_INFO = {
  conceptual: {
    label:    'Error conceptual',
    color:    'text-red-500',
    bg:       'bg-red-50',
    border:   'border-red-200',
    barColor: 'bg-red-400',
    icon:     '🧠',
    desc:     'No tienes claro el concepto. Necesitas estudiar el tema desde cero antes de practicar más preguntas.',
    consejo:  'Lee el capítulo correspondiente antes de tu próxima sesión en esta especialidad.',
  },
  confusion: {
    label:    'Error por confusión',
    color:    'text-amber-600',
    bg:       'bg-amber-50',
    border:   'border-amber-200',
    barColor: 'bg-amber-400',
    icon:     '🔀',
    desc:     'Confundes opciones parecidas. Conoces el tema pero mezclas detalles específicos.',
    consejo:  'Cuando dudes, descarta activamente cada opción incorrecta antes de marcar la tuya.',
  },
  descuido: {
    label:    'Error por descuido',
    color:    'text-sky-600',
    bg:       'bg-sky-50',
    border:   'border-sky-200',
    barColor: 'bg-sky-400',
    icon:     '⚡',
    desc:     'Respondes demasiado rápido sin leer bien el enunciado. Sabes la respuesta pero te precipitas.',
    consejo:  'Lee el enunciado completo antes de mirar las opciones. No mires las respuestas hasta terminar de leer.',
  },
};

// Convierte difficulty numérico al label y variante del badge
function difficultyBadge(d) {
  if (!d) return null;
  if (d <= 2) return { label: 'Fácil',   variant: 'green' };
  if (d === 3) return { label: 'Media',  variant: 'amber' };
  return         { label: 'Difícil',     variant: 'red'   };
}

export default function MisErroresPage() {
  // FIX: era `usuario`, ahora es `profile` (schema nuevo)
  const { profile, refreshProfile } = useAuthStore();

  const [loading, setLoading]         = useState(true);
  const [errStats, setErrStats]       = useState(null);
  const [masFalladas, setMasFalladas] = useState([]);
  const [pendientes, setPendientes]   = useState(0);
  const [tabActivo, setTabActivo]     = useState('resumen');
  const [expandida, setExpandida]     = useState(null);
  const [fechaMir, setFechaMir]       = useState(profile.fecha_mir || '');
  const [savingFecha, setSavingFecha] = useState(false);

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    setLoading(true);
    const uid = profile.id;

    // FIX: eliminado useSpacedRepetition — ahora usa getMostFailed y countRepasoPendiente
    // del schema nuevo (user_question_state + questions + specialties)
    const [falladas, pend] = await Promise.all([
      getMostFailed(uid, 200), // 200 para tener stats completas
      countRepasoPendiente(uid),
    ]);

    // Calcular errStats desde los resultados de getMostFailed
    // (equivalente a lo que hacía sr.getEstadisticasErrores())
    let total = 0;
    const porTipo = { conceptual: 0, confusion: 0, descuido: 0 };
    const espMap  = {};

    falladas.forEach(item => {
      total += item.times_wrong;
      const tipo    = item.last_error_type;
      const espName = item.question?.specialty?.name || 'Sin especialidad';

      if (tipo && porTipo[tipo] !== undefined) porTipo[tipo] += item.times_wrong;

      if (!espMap[espName]) {
        espMap[espName] = { nombre: espName, total: 0, conceptual: 0, confusion: 0, descuido: 0 };
      }
      espMap[espName].total += item.times_wrong;
      if (tipo && espMap[espName][tipo] !== undefined) espMap[espName][tipo] += item.times_wrong;
    });

    const porEspecialidad   = Object.values(espMap).sort((a, b) => b.total - a.total);
    const tipoMasFrecuente  = Object.entries(porTipo).sort((a, b) => b[1] - a[1]).find(([, v]) => v > 0)?.[0] || null;

    setErrStats({ total, tipoMasFrecuente, porTipo, porEspecialidad });
    // Mostrar solo las 50 más falladas en la lista
    setMasFalladas(falladas.slice(0, 50));
    setPendientes(pend);
    setLoading(false);
  }

  async function saveFechaMir() {
    setSavingFecha(true);
    // FIX: era `usuarios` table, ahora es `profiles`
    const { error } = await supabase
      .from('profiles')
      .update({ fecha_mir: fechaMir || null })
      .eq('id', profile.id);

    if (error) {
      toast.error('Error al guardar la fecha');
    } else {
      toast.success('Fecha del MIR guardada');
      if (typeof refreshProfile === 'function') await refreshProfile();
    }
    setSavingFecha(false);
  }

  if (loading) return <LoadingScreen message="Analizando tus errores..." />;

  const totalErrores      = errStats?.total || 0;
  const diasAlMir         = fechaMir
    ? Math.max(0, Math.ceil((new Date(fechaMir) - new Date()) / 86400000))
    : null;
  const tipoMasFrecuente  = errStats?.tipoMasFrecuente;
  const infoTipo          = tipoMasFrecuente ? TIPO_INFO[tipoMasFrecuente] : null;

  return (
    <div>
      {/* Header */}
      <div className="flex items-start justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-2xl font-bold text-ink tracking-tight">Análisis de errores</h1>
          <p className="text-sm text-slate-400 mt-1">El Coach IA analiza tus patrones de error para que estudies lo que de verdad necesitas</p>
        </div>
        <div className="flex items-center gap-2">
          {pendientes > 0 && (
            // FIX: /app/practicar → /app/examen
            <Link to="/app/examen?modo=repaso"
              className="inline-flex items-center gap-2 px-4 py-2 bg-pulse text-ink rounded-full text-sm font-bold hover:-translate-y-0.5 transition-all hover:shadow-lg">
              🔁 {pendientes} pendientes de repaso
            </Link>
          )}
          <Link to="/app/examen?modo=errores"
            className="inline-flex items-center gap-2 px-4 py-2 bg-ink text-white rounded-full text-sm font-semibold hover:-translate-y-0.5 transition-all hover:shadow-lg">
            Practicar errores →
          </Link>
        </div>
      </div>

      {/* Fecha MIR */}
      <div className={`rounded-xl p-5 mb-6 border relative overflow-hidden ${
        diasAlMir !== null
          ? (diasAlMir < 30 ? 'bg-red-50 border-red-200' : diasAlMir < 90 ? 'bg-amber-50 border-amber-200' : 'bg-ink border-ink')
          : 'bg-ink border-ink'}`}>
        <div className="absolute inset-0 dot-pattern pointer-events-none opacity-40"/>
        <div className="relative z-10 flex items-center justify-between gap-4 flex-wrap">
          <div>
            <div className="font-mono text-[0.65rem] font-semibold uppercase tracking-widest text-white/50 mb-1">Cuenta atrás MIR</div>
            {diasAlMir !== null ? (
              <div className="flex items-baseline gap-3">
                <span className={`font-display font-bold text-4xl ${diasAlMir < 30 ? 'text-red-500' : diasAlMir < 90 ? 'text-amber-500' : 'text-pulse'}`}>
                  {diasAlMir}
                </span>
                <span className="text-white/60 text-sm">días restantes</span>
                <span className={`font-mono text-xs px-2 py-1 rounded-full font-semibold ${diasAlMir < 30 ? 'bg-red-100 text-red-600' : diasAlMir < 90 ? 'bg-amber-100 text-amber-600' : 'bg-pulse-bg text-pulse-dim'}`}>
                  {diasAlMir < 30 ? '🚨 Fase crítica' : diasAlMir < 90 ? '⚡ Fase final' : '📅 En preparación'}
                </span>
              </div>
            ) : (
              <div className="text-white/60 text-sm">Configura la fecha del MIR para ver tu cuenta atrás</div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <input type="date" value={fechaMir} onChange={e => setFechaMir(e.target.value)}
              className="px-3 py-2 rounded-lg border border-white/20 bg-white/10 text-white text-sm outline-none focus:border-pulse/60 transition-all"/>
            <button onClick={saveFechaMir} disabled={savingFecha}
              className="px-4 py-2 bg-pulse text-ink rounded-lg text-sm font-bold hover:brightness-110 transition-all disabled:opacity-50">
              {savingFecha ? '...' : 'Guardar'}
            </button>
          </div>
        </div>
      </div>

      {totalErrores === 0 ? (
        <EmptyState icon="🎯" title="Sin errores registrados todavía"
          subtitle="Completa sesiones de práctica para que el Coach IA analice tus patrones de error y te dé recomendaciones personalizadas."
          action={
            <Link to="/app/examen" className="inline-flex items-center gap-2 px-5 py-2.5 bg-ink text-white rounded-full text-sm font-bold hover:-translate-y-0.5 transition-all">
              Empezar a practicar →
            </Link>
          }
        />
      ) : (
        <>
          {/* Coach IA — diagnóstico principal */}
          {infoTipo && (
            <div className={`rounded-xl p-5 mb-6 border ${infoTipo.bg} ${infoTipo.border} relative overflow-hidden`}>
              <div className="flex items-start gap-4">
                <span className="text-3xl shrink-0">{infoTipo.icon}</span>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-mono text-[0.65rem] font-semibold uppercase tracking-widest text-slate-400">Coach IA · Diagnóstico principal</span>
                  </div>
                  <h3 className="font-display font-bold text-base text-ink mb-1">
                    Tu error más frecuente: {infoTipo.label}
                  </h3>
                  <p className="text-sm text-slate-600 leading-relaxed mb-3">{infoTipo.desc}</p>
                  <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold ${infoTipo.bg} ${infoTipo.color} border ${infoTipo.border}`}>
                    💡 {infoTipo.consejo}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Tabs */}
          <div className="flex bg-white border border-border rounded-full p-1 gap-1 mb-5 w-fit overflow-x-auto">
            {[['resumen','Resumen'],['por-tipo','Por tipo'],['preguntas','Preguntas falladas'],['repaso','Plan de repaso']].map(([k, label]) => (
              <button key={k} onClick={() => setTabActivo(k)}
                className={`px-4 py-1.5 rounded-full text-xs font-semibold transition-all whitespace-nowrap ${tabActivo===k?'bg-ink text-white shadow':'text-slate-400 hover:text-ink'}`}>
                {label}
              </button>
            ))}
          </div>

          {/* ─── TAB RESUMEN ─── */}
          {tabActivo === 'resumen' && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
              <div className="lg:col-span-2">
                <Card>
                  <CardHeader title="Distribución de errores" subtitle={`${totalErrores} errores analizados`} />
                  <div className="flex flex-col gap-5">
                    {Object.entries(TIPO_INFO).map(([tipo, info]) => {
                      const n   = errStats.porTipo[tipo] || 0;
                      const pct = totalErrores ? Math.round((n/totalErrores)*100) : 0;
                      return (
                        <div key={tipo}>
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2.5">
                              <span className="text-lg">{info.icon}</span>
                              <div>
                                <div className={`text-sm font-semibold ${info.color}`}>{info.label}</div>
                                <div className="text-xs text-slate-400">{info.desc.split('.')[0]}.</div>
                              </div>
                            </div>
                            <div className="text-right shrink-0">
                              <div className={`font-display font-bold text-xl ${info.color}`}>{n}</div>
                              <div className="text-xs text-slate-400">{pct}%</div>
                            </div>
                          </div>
                          <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
                            <div className={`h-full ${info.barColor} rounded-full transition-all duration-700`} style={{width:`${pct}%`}}/>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {/* Proporción visual */}
                  <div className="mt-5 pt-5 border-t border-border">
                    <div className="text-xs text-slate-400 mb-2 font-mono uppercase tracking-wider">Proporción visual</div>
                    <div className="flex h-8 rounded-full overflow-hidden gap-0.5">
                      {Object.entries(TIPO_INFO).map(([tipo, info]) => {
                        const pct = totalErrores ? (errStats.porTipo[tipo]||0)/totalErrores*100 : 0;
                        if (pct === 0) return null;
                        return (
                          <div key={tipo} title={`${info.label}: ${Math.round(pct)}%`}
                            className={`${info.barColor} flex items-center justify-center text-white text-[0.6rem] font-bold transition-all`}
                            style={{width:`${pct}%`}}>
                            {pct > 12 && `${Math.round(pct)}%`}
                          </div>
                        );
                      })}
                    </div>
                    <div className="flex gap-4 mt-2">
                      {Object.entries(TIPO_INFO).map(([tipo, info]) => (
                        <div key={tipo} className="flex items-center gap-1.5 text-xs text-slate-500">
                          <span className={`w-2.5 h-2.5 rounded-full ${info.barColor} shrink-0`}/>
                          {info.label.split(' ').slice(-1)[0]}
                        </div>
                      ))}
                    </div>
                  </div>
                </Card>
              </div>

              {/* Errores por especialidad */}
              <Card>
                <CardHeader title="Por especialidad" subtitle="Dónde fallas más" />
                {errStats.porEspecialidad.length === 0 ? (
                  <EmptyState icon="📊" title="Sin datos" />
                ) : (
                  <div className="flex flex-col gap-3 max-h-80 overflow-y-auto scrollbar-thin">
                    {errStats.porEspecialidad.slice(0,10).map(e => (
                      <div key={e.nombre}>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-medium text-ink truncate">{e.nombre}</span>
                          <span className="font-mono text-xs font-bold text-red-400 shrink-0 ml-2">{e.total}</span>
                        </div>
                        <div className="flex gap-0.5 h-1.5">
                          {e.conceptual > 0 && <div className="bg-red-400 rounded-l-full" style={{width:`${(e.conceptual/e.total)*100}%`}}/>}
                          {e.confusion  > 0 && <div className="bg-amber-400"              style={{width:`${(e.confusion/e.total)*100}%`}}/>}
                          {e.descuido   > 0 && <div className="bg-sky-400 rounded-r-full" style={{width:`${(e.descuido/e.total)*100}%`}}/>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </div>
          )}

          {/* ─── TAB POR TIPO ─── */}
          {tabActivo === 'por-tipo' && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              {Object.entries(TIPO_INFO).map(([tipo, info]) => {
                const n       = errStats.porTipo[tipo] || 0;
                const pct     = totalErrores ? Math.round((n/totalErrores)*100) : 0;
                const espTipo = errStats.porEspecialidad
                  .filter(e => e[tipo] > 0)
                  .sort((a,b) => b[tipo]-a[tipo])
                  .slice(0,5);
                return (
                  <div key={tipo} className={`rounded-xl border p-5 ${info.bg} ${info.border}`}>
                    <div className="flex items-center gap-3 mb-4">
                      <span className="text-3xl">{info.icon}</span>
                      <div>
                        <div className={`font-display font-bold text-base ${info.color}`}>{info.label}</div>
                        <div className="font-mono text-xs text-slate-400">{n} errores · {pct}%</div>
                      </div>
                    </div>
                    <p className="text-xs text-slate-600 leading-relaxed mb-4">{info.desc}</p>
                    <div className={`text-xs font-semibold px-3 py-2 rounded-lg border ${info.border} ${info.color} mb-4`}>
                      💡 {info.consejo}
                    </div>
                    {espTipo.length > 0 && (
                      <div>
                        <div className="text-[0.65rem] font-mono font-semibold uppercase tracking-wider text-slate-400 mb-2">
                          Especialidades afectadas
                        </div>
                        <div className="flex flex-col gap-1.5">
                          {espTipo.map(e => (
                            <div key={e.nombre} className="flex items-center justify-between text-xs">
                              <span className="text-ink truncate">{e.nombre}</span>
                              <span className={`font-mono font-bold ${info.color}`}>{e[tipo]}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* ─── TAB PREGUNTAS FALLADAS ─── */}
          {tabActivo === 'preguntas' && (
            <Card padding={false}>
              <div className="p-5 border-b border-border flex items-center justify-between">
                <div>
                  <h3 className="font-display font-bold text-base text-ink">Preguntas que más fallas</h3>
                  <p className="text-xs text-slate-400 mt-0.5">{masFalladas.length} preguntas con al menos 1 error</p>
                </div>
                <Link to="/app/examen?modo=errores"
                  className="inline-flex items-center gap-2 px-4 py-2 bg-ink text-white rounded-full text-xs font-semibold hover:opacity-90 transition-opacity">
                  Practicar todas →
                </Link>
              </div>
              {masFalladas.length === 0 ? (
                <EmptyState icon="🎯" title="Sin preguntas falladas todavía" />
              ) : (
                <div className="divide-y divide-border">
                  {masFalladas.map(item => {
                    // FIX: nuevos nombres de campo (schema nuevo)
                    const p        = item.question;
                    if (!p) return null;
                    const isOpen   = expandida === item.question_id;
                    const total    = item.times_wrong + item.times_correct;
                    const tasaAc   = total > 0 ? Math.round((item.times_correct / total) * 100) : 0;
                    const tipoInfo = item.last_error_type ? TIPO_INFO[item.last_error_type] : null;
                    const diff     = difficultyBadge(p.difficulty);

                    return (
                      <div key={item.question_id}>
                        <button onClick={() => setExpandida(isOpen ? null : item.question_id)}
                          className="w-full text-left p-4 hover:bg-sky-50 transition-colors flex items-start gap-4 group">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1 flex-wrap">
                              {/* FIX: p.specialty?.name en lugar de p.especialidad */}
                              {p.specialty?.name && <Badge variant="blue">{p.specialty.name}</Badge>}
                              {/* FIX: difficulty numérico → badge */}
                              {diff && <Badge variant={diff.variant}>{diff.label}</Badge>}
                              {tipoInfo && (
                                <span className={`text-[0.65rem] font-semibold px-2 py-0.5 rounded-full border ${tipoInfo.bg} ${tipoInfo.color} ${tipoInfo.border}`}>
                                  {tipoInfo.icon} {tipoInfo.label}
                                </span>
                              )}
                            </div>
                            {/* FIX: p.text en lugar de p.enunciado */}
                            <p className="text-sm text-ink font-medium line-clamp-2 leading-snug">{p.text}</p>
                          </div>
                          <div className="shrink-0 text-right">
                            {/* FIX: item.times_wrong en lugar de item.veces_fallada */}
                            <div className="font-display font-bold text-lg text-red-400">{item.times_wrong}✕</div>
                            <div className={`text-xs font-mono font-semibold ${tasaAc>=65?'text-pulse-dim':tasaAc>=50?'text-amber-500':'text-red-400'}`}>{tasaAc}% acierto</div>
                            <div className="text-[0.6rem] text-slate-400 mt-0.5 group-hover:text-sky-600 transition-colors">{isOpen?'▲ Cerrar':'▼ Ver'}</div>
                          </div>
                        </button>

                        {isOpen && (
                          <div className="px-4 pb-4 animate-[slideDown_.2s_ease]">
                            <div className="bg-surface border border-border rounded-lg p-4">
                              <p className="text-sm font-semibold text-ink mb-3">{p.text}</p>
                              <div className="flex flex-col gap-1.5 mb-4">
                                {/* FIX: p.options array en lugar de p[opcion_${l}] */}
                                {(p.options || []).map(opt => (
                                  <div key={opt.letter}
                                    className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs border ${
                                      opt.letter === p.correct_option_letter
                                        ? 'border-pulse-dim bg-pulse-bg font-semibold text-emerald-800'
                                        : 'border-border text-slate-500'
                                    }`}>
                                    <span className={`w-5 h-5 rounded-full flex items-center justify-center font-mono font-bold text-[0.65rem] shrink-0 ${
                                      opt.letter === p.correct_option_letter
                                        ? 'bg-pulse-dim text-white'
                                        : 'bg-surface border border-border text-slate-400'
                                    }`}>
                                      {opt.letter.toUpperCase()}
                                    </span>
                                    {opt.text}
                                    {/* FIX: p.correct_option_letter en lugar de p.respuesta_correcta */}
                                    {opt.letter === p.correct_option_letter && <span className="ml-auto text-pulse-dim">✓</span>}
                                  </div>
                                ))}
                              </div>
                              {/* FIX: p.explanation en lugar de p.explicacion */}
                              <div className="bg-white border-l-4 border-pulse-dim rounded-r-lg p-3">
                                <div className="font-mono text-[0.65rem] font-bold text-pulse-dim uppercase tracking-wider mb-1">Explicación</div>
                                <p className="text-xs text-slate-600 leading-relaxed">{p.explanation}</p>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
          )}

          {/* ─── TAB PLAN DE REPASO ─── */}
          {tabActivo === 'repaso' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              <Card>
                <CardHeader
                  title="Pendientes de repaso hoy"
                  subtitle="Preguntas que el algoritmo SM-2 ha programado para hoy"
                  action={
                    <Link to="/app/examen?modo=repaso"
                      className="inline-flex items-center gap-2 px-3 py-1.5 bg-ink text-white rounded-full text-xs font-semibold hover:opacity-90">
                      Repasar →
                    </Link>
                  }
                />
                <div className="text-center py-8">
                  <div className={`font-display font-bold text-6xl mb-2 ${pendientes>0?'text-pulse-dim':'text-slate-300'}`}>
                    {pendientes}
                  </div>
                  <div className="text-sm text-slate-400 mb-4">
                    {pendientes === 0
                      ? '¡Al día! No hay repasos pendientes hoy.'
                      : `pregunta${pendientes!==1?'s':''} pendiente${pendientes!==1?'s':''} de repaso`}
                  </div>
                  {pendientes > 0 && (
                    <Link to="/app/examen?modo=repaso"
                      className="inline-flex items-center gap-2 px-5 py-2.5 bg-pulse text-ink rounded-full text-sm font-bold hover:-translate-y-0.5 transition-all hover:shadow-lg">
                      🔁 Empezar repaso →
                    </Link>
                  )}
                </div>
              </Card>

              <Card>
                <CardHeader title="Cómo funciona el repaso inteligente" />
                <div className="flex flex-col gap-4">
                  {[
                    { icon:'🎯', title:'Responde preguntas',   desc:'El algoritmo registra si aciertas, fallas y cuánto tardas.' },
                    { icon:'🧮', title:'Calcula el intervalo', desc:'Las preguntas que fallas vuelven mañana. Las que dominas, en días o semanas.' },
                    { icon:'📅', title:'Programa el repaso',   desc:'Cada día verás aquí cuántas preguntas necesitas repasar para no olvidar lo aprendido.' },
                    { icon:'📈', title:'Sube tu retención',    desc:'Con la repetición espaciada retienes el 90% del contenido con la mitad del tiempo.' },
                  ].map(s => (
                    <div key={s.title} className="flex items-start gap-3">
                      <span className="text-xl shrink-0">{s.icon}</span>
                      <div>
                        <div className="text-sm font-semibold text-ink">{s.title}</div>
                        <div className="text-xs text-slate-400 mt-0.5 leading-relaxed">{s.desc}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>

              {diasAlMir !== null && (
                <div className="lg:col-span-2">
                  <Card>
                    <CardHeader title="Proyección hasta el MIR" subtitle={`${diasAlMir} días restantes · basado en tu ritmo actual`} />
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      {[
                        { label:'Sesiones restantes',  val: diasAlMir,                                        desc:'si estudias 1 sesión/día' },
                        { label:'Preguntas posibles',  val: (diasAlMir * 20).toLocaleString('es-ES'),         desc:'a 20 preguntas/sesión' },
                        { label:'Ritmo necesario',     val: diasAlMir < 60 ? '30/día' : '20/día',             desc:'para cubrir todo el temario' },
                        { label:'Estado actual',       val: totalErrores > 50 ? '⚠️' : '✓',                   desc: totalErrores > 50 ? 'Muchos errores acumulados' : 'Buen control de errores' },
                      ].map(s => (
                        <div key={s.label} className="bg-surface border border-border rounded-lg p-4 text-center">
                          <div className="font-display font-bold text-2xl text-ink mb-1">{s.val}</div>
                          <div className="text-xs font-semibold text-ink mb-0.5">{s.label}</div>
                          <div className="text-[0.65rem] text-slate-400">{s.desc}</div>
                        </div>
                      ))}
                    </div>
                  </Card>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
