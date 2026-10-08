import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useAuthStore } from '../../store';
import { Card, CardHeader, Badge, EmptyState, LoadingScreen } from '../../components/ui';

export default function EstadisticasPage() {
  const { usuario } = useAuthStore();
  const [loading, setLoading]       = useState(true);
  const [intentos, setIntentos]     = useState([]);
  const [sesiones, setSesiones]     = useState([]);
  const [periodo, setPeriodo]       = useState('30'); // días
  const [tabEsp, setTabEsp]         = useState('rendimiento');

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    setLoading(true);
    const uid = usuario.id;
    const [{ data: its }, { data: sess }, { data: itsEsp }] = await Promise.all([
      supabase.from('intentos').select('es_correcto, created_at').eq('usuario_id', uid).order('created_at', { ascending: true }),
      supabase.from('sesiones').select('*').eq('usuario_id', uid).order('created_at', { ascending: false }),
      supabase.from('intentos').select('es_correcto, created_at, pregunta:preguntas(especialidad, dificultad)').eq('usuario_id', uid),
    ]);
    setIntentos(its || []);
    setSesiones(sess || []);
    // Store with specialty info
    setIntentos(itsEsp || []);
    setLoading(false);
  }

  if (loading) return <LoadingScreen message="Cargando estadísticas..." />;

  // ─── Cálculos con filtro de periodo ─────────────────────
  const cutoff = new Date(Date.now() - parseInt(periodo) * 86400000);
  const filtrados = intentos.filter(i => new Date(i.created_at) > cutoff);
  const sessFiltradas = sesiones.filter(s => new Date(s.created_at) > cutoff);

  const total     = filtrados.length;
  const correctas = filtrados.filter(i => i.es_correcto).length;
  const tasa      = total ? Math.round((correctas / total) * 100) : 0;

  // Días activos
  const diasActivos = new Set(filtrados.map(i => new Date(i.created_at).toDateString())).size;

  // Tiempo total estimado
  const tiempoTotal = sessFiltradas.reduce((acc, s) => acc + (s.duracion_minutos || 0), 0);

  // Racha actual
  function calcRacha(its) {
    if (!its.length) return 0;
    const dias = new Set(its.map(i => new Date(i.created_at).toDateString()));
    let r = 0;
    for (let i = 0; i < 365; i++) {
      const d = new Date(); d.setDate(d.getDate() - i);
      if (dias.has(d.toDateString())) r++;
      else if (i > 0) break;
    }
    return r;
  }
  const racha = calcRacha(intentos);

  // Especialidades
  const espMap = {};
  filtrados.forEach(i => {
    const esp = i.pregunta?.especialidad;
    const dif = i.pregunta?.dificultad;
    if (!esp) return;
    if (!espMap[esp]) espMap[esp] = { total: 0, correctas: 0, facil: 0, media: 0, dificil: 0, fC: 0, mC: 0, dC: 0 };
    espMap[esp].total++;
    if (i.es_correcto) espMap[esp].correctas++;
    if (dif) { espMap[esp][dif]++; if (i.es_correcto) espMap[esp][dif[0]+'C']++; }
  });
  const especialidades = Object.entries(espMap)
    .map(([nombre, d]) => ({
      nombre,
      total: d.total,
      correctas: d.correctas,
      pct: Math.round((d.correctas / d.total) * 100),
      facil:  d.facil,  fPct: d.facil  ? Math.round((d.fC / d.facil)  * 100) : null,
      media:  d.media,  mPct: d.media  ? Math.round((d.mC / d.media)  * 100) : null,
      dificil:d.dificil,dPct: d.dificil? Math.round((d.dC / d.dificil)* 100) : null,
    }))
    .sort((a, b) => a.pct - b.pct);

  // Evolución diaria (últimos N días)
  const numDias = Math.min(parseInt(periodo), 30);
  const evolucion = Array.from({ length: numDias }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() - (numDias - 1 - i));
    const dayStr = d.toDateString();
    const dayItns = filtrados.filter(it => new Date(it.created_at).toDateString() === dayStr);
    const c = dayItns.filter(it => it.es_correcto).length;
    const t = dayItns.length;
    return {
      dia: d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' }),
      total: t, correctas: c,
      tasa: t ? Math.round((c / t) * 100) : null,
    };
  });

  // Mejor y peor día
  const conDatos = evolucion.filter(d => d.tasa !== null);
  const mejorDia = conDatos.length ? conDatos.reduce((a, b) => a.tasa > b.tasa ? a : b) : null;
  const peorDia  = conDatos.length ? conDatos.reduce((a, b) => a.tasa < b.tasa ? a : b) : null;

  // Distribución por dificultad global
  const difMap = { facil: { t: 0, c: 0 }, media: { t: 0, c: 0 }, dificil: { t: 0, c: 0 } };
  filtrados.forEach(i => {
    const d = i.pregunta?.dificultad;
    if (d && difMap[d]) { difMap[d].t++; if (i.es_correcto) difMap[d].c++; }
  });

  // Tendencia (última semana vs semana anterior)
  const hace7  = new Date(Date.now() - 7 * 86400000);
  const hace14 = new Date(Date.now() - 14 * 86400000);
  const semActual = intentos.filter(i => new Date(i.created_at) > hace7);
  const semAnterior = intentos.filter(i => { const d = new Date(i.created_at); return d > hace14 && d <= hace7; });
  const tasaActual   = semActual.length ? Math.round((semActual.filter(i=>i.es_correcto).length/semActual.length)*100) : null;
  const tasaAnterior = semAnterior.length ? Math.round((semAnterior.filter(i=>i.es_correcto).length/semAnterior.length)*100) : null;
  const tendencia = tasaActual !== null && tasaAnterior !== null ? tasaActual - tasaAnterior : null;

  const maxBarEvo = Math.max(...evolucion.map(d => d.total), 1);

  if (!intentos.length) return (
    <div className="flex items-center justify-center min-h-[70vh]">
      <EmptyState
        icon="📊"
        title="Aún no tienes estadísticas"
        subtitle="Completa tu primera sesión de preguntas para ver aquí tu evolución, rendimiento por especialidad y mucho más."
        action={
          <Link to="/app/practicar" className="inline-flex items-center gap-2 px-5 py-2.5 bg-ink text-white rounded-full text-sm font-bold hover:-translate-y-0.5 transition-all hover:shadow-lg">
            Empezar ahora →
          </Link>
        }
      />
    </div>
  );

  return (
    <div>
      {/* Header */}
      <div className="flex items-start justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-2xl font-bold text-ink tracking-tight">Estadísticas avanzadas</h1>
          <p className="text-sm text-slate-400 mt-1">Análisis completo de tu rendimiento y evolución</p>
        </div>
        {/* Selector de periodo */}
        <div className="flex bg-white border border-border rounded-full p-1 gap-1">
          {[['7','7d'],['30','30d'],['90','90d'],['365','1 año']].map(([val, label]) => (
            <button key={val} onClick={() => setPeriodo(val)}
              className={`px-4 py-1.5 rounded-full text-xs font-semibold transition-all ${periodo === val ? 'bg-ink text-white shadow' : 'text-slate-400 hover:text-ink'}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* KPIs principales */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {[
          {
            label: 'Tasa de acierto',
            value: `${tasa}%`,
            sub: tendencia !== null ? (tendencia >= 0 ? `↑ +${tendencia}pp vs semana anterior` : `↓ ${tendencia}pp vs semana anterior`) : `${total} respondidas`,
            type: tendencia !== null ? (tendencia >= 0 ? 'up' : 'down') : 'neutral',
            highlight: true,
          },
          { label: 'Preguntas respondidas', value: total.toLocaleString('es-ES'), sub: `${correctas} correctas`, type: 'neutral' },
          { label: 'Días activos',          value: diasActivos,                    sub: `de ${periodo} días`,    type: diasActivos > parseInt(periodo)/2 ? 'up' : 'neutral' },
          { label: 'Tiempo total',          value: tiempoTotal >= 60 ? `${Math.round(tiempoTotal/60)}h` : `${tiempoTotal}min`, sub: `${sessFiltradas.length} sesiones`, type: 'neutral' },
        ].map(s => (
          <div key={s.label} className={`rounded-lg p-5 relative overflow-hidden group border ${s.highlight ? 'bg-ink border-ink' : 'bg-white border-border'}`}>
            <div className={`absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-sky-400 to-pulse ${s.highlight ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'} transition-opacity`} />
            <div className={`font-mono text-[0.65rem] font-semibold uppercase tracking-widest mb-2 ${s.highlight ? 'text-white/40' : 'text-slate-400'}`}>{s.label}</div>
            <div className={`font-display text-3xl font-bold leading-none mb-1.5 ${s.highlight ? 'text-pulse' : 'text-ink'}`}>{s.value}</div>
            <div className={`text-xs font-semibold ${s.highlight ? (s.type === 'up' ? 'text-pulse/80' : s.type === 'down' ? 'text-red-300' : 'text-white/40') : (s.type === 'up' ? 'text-pulse-dim' : s.type === 'down' ? 'text-red-400' : 'text-slate-400')}`}>
              {s.sub}
            </div>
          </div>
        ))}
      </div>

      {/* Gráfica de evolución */}
      <Card className="mb-5">
        <CardHeader
          title="Evolución diaria"
          subtitle={`Preguntas respondidas y tasa de acierto — últimos ${numDias} días`}
          action={
            <div className="flex items-center gap-3 text-xs text-slate-400">
              {mejorDia && <span className="text-pulse-dim font-semibold">Mejor: {mejorDia.tasa}% ({mejorDia.dia})</span>}
              {peorDia  && peorDia.dia !== mejorDia?.dia && <span className="text-red-400 font-semibold">Peor: {peorDia.tasa}% ({peorDia.dia})</span>}
            </div>
          }
        />
        {/* Barras de actividad */}
        <div className="flex items-end gap-1 mb-3" style={{ height: 80 }}>
          {evolucion.map((d, i) => {
            const h = d.total ? Math.max(4, (d.total / maxBarEvo) * 100) : 0;
            const color = d.tasa === null ? 'bg-sky-50' : d.tasa >= 65 ? 'bg-gradient-to-t from-sky-500 to-pulse' : d.tasa >= 50 ? 'bg-sky-300' : 'bg-amber-300';
            const isToday = i === evolucion.length - 1;
            return (
              <div key={i} className="flex-1 flex flex-col items-center justify-end" style={{ height: 80 }}>
                <div
                  title={d.total ? `${d.dia}: ${d.total} preguntas · ${d.tasa}%` : d.dia}
                  className={`w-full rounded-t-sm ${color} ${isToday ? 'ring-1 ring-pulse/40' : ''} transition-all duration-500 group relative`}
                  style={{ height: `${h}%` }}
                >
                  {d.tasa !== null && (
                    <div className="absolute -top-7 left-1/2 -translate-x-1/2 bg-ink text-white text-[0.6rem] font-mono px-1.5 py-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-10">
                      {d.tasa}%
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        {/* Etiquetas de fecha (cada 5 días) */}
        <div className="flex items-center" style={{ gap: 4/evolucion.length + '%' }}>
          {evolucion.map((d, i) => (
            <div key={i} className="flex-1 text-center">
              {(i === 0 || i === Math.floor(evolucion.length/2) || i === evolucion.length - 1) && (
                <span className="font-mono text-[0.6rem] text-slate-400">{d.dia}</span>
              )}
            </div>
          ))}
        </div>

        {/* Línea de tendencia de tasa */}
        <div className="mt-5 pt-5 border-t border-border">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-slate-400">Tendencia de acierto</span>
            <span className="font-mono text-xs text-slate-400">Corte MIR estimado: 65%</span>
          </div>
          <div className="relative h-12 bg-sky-50 rounded-lg overflow-hidden">
            {/* Línea de corte */}
            <div className="absolute left-0 right-0 border-t-2 border-dashed border-amber-400/60" style={{ top: '35%' }} />
            <span className="absolute right-2 text-[0.6rem] font-mono text-amber-500 font-semibold" style={{ top: '22%' }}>65%</span>
            {/* Puntos de tasa por día */}
            <svg className="absolute inset-0 w-full h-full" viewBox={`0 0 ${evolucion.length} 100`} preserveAspectRatio="none">
              <defs>
                <linearGradient id="lineGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#0EA5E9" stopOpacity="0.3" />
                  <stop offset="100%" stopColor="#0EA5E9" stopOpacity="0" />
                </linearGradient>
              </defs>
              {(() => {
                const puntos = evolucion.map((d, i) => d.tasa !== null ? `${i},${100 - d.tasa}` : null).filter(Boolean);
                if (puntos.length < 2) return null;
                const linea = 'M ' + puntos.join(' L ');
                const area  = linea + ` L ${evolucion.length - 1},100 L 0,100 Z`;
                return (
                  <>
                    <path d={area} fill="url(#lineGrad)" />
                    <path d={linea} fill="none" stroke="#0EA5E9" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </>
                );
              })()}
            </svg>
          </div>
        </div>
      </Card>

      {/* Grid especialidades + dificultad */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 mb-5">

        {/* Especialidades */}
        <div className="lg:col-span-2">
          <Card>
            {/* Tabs */}
            <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
              <div className="flex bg-surface border border-border rounded-full p-1 gap-1">
                {[['rendimiento','Rendimiento'],['volumen','Volumen'],['detalle','Detalle']].map(([k, label]) => (
                  <button key={k} onClick={() => setTabEsp(k)}
                    className={`px-3 py-1 rounded-full text-xs font-semibold transition-all ${tabEsp === k ? 'bg-ink text-white' : 'text-slate-400 hover:text-ink'}`}>
                    {label}
                  </button>
                ))}
              </div>
              <span className="text-xs text-slate-400 font-mono">{especialidades.length} especialidades</span>
            </div>

            {especialidades.length === 0 ? (
              <EmptyState icon="📊" title="Sin datos en este periodo" />
            ) : tabEsp === 'rendimiento' ? (
              <div className="flex flex-col gap-4">
                {especialidades.map(e => {
                  const color = e.pct >= 70 ? 'from-sky-400 to-pulse' : e.pct >= 50 ? 'from-sky-400 to-sky-500' : e.pct >= 30 ? 'from-amber-400 to-amber-500' : 'from-red-400 to-red-500';
                  const textC = e.pct >= 70 ? 'text-pulse-dim' : e.pct >= 50 ? 'text-sky-600' : e.pct >= 30 ? 'text-amber-500' : 'text-red-400';
                  return (
                    <div key={e.nombre}>
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-ink">{e.nombre}</span>
                          <span className="font-mono text-[0.6rem] text-slate-400">({e.total})</span>
                          {e.pct < 50 && <Badge variant="red">Repasar</Badge>}
                          {e.pct >= 80 && <Badge variant="pulse">Dominado</Badge>}
                        </div>
                        <span className={`font-mono text-sm font-bold ${textC}`}>{e.pct}%</span>
                      </div>
                      <div className="h-2.5 bg-sky-50 rounded-full overflow-hidden">
                        <div className={`h-full bg-gradient-to-r ${color} rounded-full transition-all duration-700`} style={{ width: `${e.pct}%` }} />
                      </div>
                      {/* Línea de corte */}
                      <div className="relative mt-0.5">
                        <div className="absolute border-l border-dashed border-amber-400/60 h-3" style={{ left: '65%' }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : tabEsp === 'volumen' ? (
              <div className="flex flex-col gap-3">
                {[...especialidades].sort((a,b) => b.total - a.total).map(e => {
                  const maxTotal = Math.max(...especialidades.map(x => x.total));
                  return (
                    <div key={e.nombre} className="flex items-center gap-3">
                      <span className="text-sm text-ink min-w-[120px] truncate">{e.nombre}</span>
                      <div className="flex-1 h-6 bg-sky-50 rounded-md overflow-hidden relative">
                        <div className="h-full bg-gradient-to-r from-sky-100 to-sky-200 rounded-md transition-all duration-700" style={{ width: `${(e.total/maxTotal)*100}%` }} />
                        <span className="absolute inset-0 flex items-center px-2.5 font-mono text-xs font-semibold text-sky-700">{e.total}</span>
                      </div>
                      <span className={`font-mono text-xs font-bold min-w-[40px] text-right ${e.pct >= 65 ? 'text-pulse-dim' : e.pct >= 50 ? 'text-amber-500' : 'text-red-400'}`}>{e.pct}%</span>
                    </div>
                  );
                })}
              </div>
            ) : (
              /* Detalle por dificultad */
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left pb-2 font-mono text-[0.65rem] uppercase tracking-wider text-slate-400">Especialidad</th>
                      <th className="text-center pb-2 font-mono text-[0.65rem] uppercase tracking-wider text-green-500">Fácil</th>
                      <th className="text-center pb-2 font-mono text-[0.65rem] uppercase tracking-wider text-amber-500">Media</th>
                      <th className="text-center pb-2 font-mono text-[0.65rem] uppercase tracking-wider text-red-400">Difícil</th>
                      <th className="text-center pb-2 font-mono text-[0.65rem] uppercase tracking-wider text-slate-400">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {especialidades.map(e => (
                      <tr key={e.nombre} className="border-b border-border last:border-0 hover:bg-sky-50 transition-colors">
                        <td className="py-2.5 text-ink font-medium">{e.nombre}</td>
                        {[
                          { pct: e.fPct, n: e.facil },
                          { pct: e.mPct, n: e.media },
                          { pct: e.dPct, n: e.dificil },
                        ].map((d, i) => (
                          <td key={i} className="py-2.5 text-center">
                            {d.n > 0
                              ? <span className={`font-mono text-xs font-bold ${d.pct >= 65 ? 'text-pulse-dim' : d.pct >= 50 ? 'text-amber-500' : 'text-red-400'}`}>{d.pct}%</span>
                              : <span className="text-slate-300 text-xs">—</span>
                            }
                          </td>
                        ))}
                        <td className="py-2.5 text-center font-mono text-xs font-semibold text-ink">{e.total}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>

        {/* Panel derecho */}
        <div className="flex flex-col gap-5">

          {/* Distribución por dificultad */}
          <Card>
            <CardHeader title="Por dificultad" subtitle="Tu tasa en cada nivel" />
            <div className="flex flex-col gap-4">
              {[
                { label: 'Fácil',   key: 'facil',   color: 'from-emerald-400 to-emerald-500', textColor: 'text-emerald-600', bg: 'bg-emerald-50' },
                { label: 'Media',   key: 'media',   color: 'from-amber-400 to-amber-500',     textColor: 'text-amber-600',   bg: 'bg-amber-50' },
                { label: 'Difícil', key: 'dificil', color: 'from-red-400 to-red-500',         textColor: 'text-red-500',     bg: 'bg-red-50' },
              ].map(d => {
                const t = difMap[d.key].t;
                const c = difMap[d.key].c;
                const p = t ? Math.round((c/t)*100) : 0;
                return (
                  <div key={d.label}>
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-2">
                        <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${d.bg} ${d.textColor}`}>{d.label}</span>
                        <span className="font-mono text-[0.6rem] text-slate-400">{t} preguntas</span>
                      </div>
                      <span className={`font-mono text-sm font-bold ${d.textColor}`}>{t ? `${p}%` : '—'}</span>
                    </div>
                    {t > 0 && (
                      <div className="h-2 bg-sky-50 rounded-full overflow-hidden">
                        <div className={`h-full bg-gradient-to-r ${d.color} rounded-full`} style={{ width: `${p}%` }} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </Card>

          {/* Indicador corte MIR */}
          <div className={`rounded-lg p-5 border ${tasa >= 65 ? 'bg-pulse-bg border-pulse-dim/30' : 'bg-amber-50 border-amber-200'}`}>
            <div className={`font-mono text-[0.65rem] font-semibold uppercase tracking-widest mb-2 ${tasa >= 65 ? 'text-pulse-dim' : 'text-amber-600'}`}>
              Corte MIR estimado
            </div>
            <div className="relative h-3 bg-white rounded-full overflow-hidden mb-2 border border-white/50">
              <div className={`h-full rounded-full transition-all duration-1000 ${tasa >= 65 ? 'bg-gradient-to-r from-sky-400 to-pulse' : 'bg-gradient-to-r from-amber-400 to-amber-500'}`} style={{ width: `${Math.min(tasa, 100)}%` }} />
              <div className="absolute top-0 bottom-0 border-l-2 border-dashed border-ink/30" style={{ left: '65%' }} />
            </div>
            <div className="flex justify-between text-xs font-mono">
              <span className={tasa >= 65 ? 'text-pulse-dim font-bold' : 'text-amber-600 font-bold'}>{tasa}% actual</span>
              <span className="text-slate-400">65% corte</span>
            </div>
            <p className={`text-xs mt-3 leading-relaxed ${tasa >= 65 ? 'text-pulse-dim' : 'text-amber-700'}`}>
              {tasa >= 65
                ? `¡Estás ${tasa - 65}pp por encima del corte! Mantén el ritmo.`
                : `Te faltan ${65 - tasa}pp para el corte. Enfócate en las especialidades con menor rendimiento.`}
            </p>
          </div>

          {/* Racha y constancia */}
          <Card>
            <CardHeader title="Constancia" subtitle="Tu racha y hábito de estudio" />
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-center">
                <div className="text-2xl mb-1">🔥</div>
                <div className="font-display font-bold text-xl text-ink">{racha}</div>
                <div className="text-xs text-amber-600">días de racha</div>
              </div>
              <div className="bg-sky-50 border border-sky-200 rounded-lg p-3 text-center">
                <div className="text-2xl mb-1">📅</div>
                <div className="font-display font-bold text-xl text-ink">{diasActivos}</div>
                <div className="text-xs text-sky-600">días activos</div>
              </div>
            </div>
            <div className="text-xs text-slate-400 text-center">
              {racha >= 7 ? '¡Racha increíble! La constancia es la clave del MIR.' :
               racha >= 3 ? 'Buen ritmo. Intenta mantener la racha diaria.' :
               'Estudia cada día aunque sean 10 minutos. La constancia supera a la intensidad.'}
            </div>
          </Card>
        </div>
      </div>

      {/* Tabla de sesiones */}
      <Card padding={false}>
        <div className="p-5 border-b border-border flex items-center justify-between">
          <div>
            <h3 className="font-display font-bold text-base text-ink">Historial de sesiones</h3>
            <p className="text-xs text-slate-400 mt-0.5">{sessFiltradas.length} sesiones en el periodo seleccionado</p>
          </div>
          <Link to="/app/practicar" className="inline-flex items-center gap-2 px-4 py-2 bg-ink text-white rounded-full text-xs font-semibold hover:opacity-90 transition-opacity">
            + Nueva sesión
          </Link>
        </div>
        {sessFiltradas.length === 0 ? (
          <EmptyState icon="📋" title="Sin sesiones en este periodo" subtitle="Cambia el periodo o empieza una nueva sesión." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-surface">
                  {['Fecha','Preguntas','Correctas','Tasa','Especialidades','Duración'].map(h => (
                    <th key={h} className="text-left px-5 py-3 font-mono text-[0.65rem] font-semibold uppercase tracking-wider text-slate-400">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sessFiltradas.map(s => {
                  const pct = s.total_preguntas ? Math.round((s.total_correctas / s.total_preguntas) * 100) : 0;
                  return (
                    <tr key={s.id} className="border-t border-border hover:bg-sky-50 transition-colors">
                      <td className="px-5 py-3.5 font-mono text-xs text-slate-400">
                        {new Date(s.created_at).toLocaleDateString('es-ES', {day:'2-digit',month:'short',year:'numeric'})}
                      </td>
                      <td className="px-5 py-3.5 font-mono font-semibold text-sm text-ink">{s.total_preguntas}</td>
                      <td className="px-5 py-3.5 font-mono font-semibold text-sm text-pulse-dim">{s.total_correctas}</td>
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-2">
                          <span className={`font-mono font-bold text-sm ${pct >= 65 ? 'text-pulse-dim' : pct >= 50 ? 'text-amber-500' : 'text-red-400'}`}>{pct}%</span>
                          <div className="w-16 h-1.5 bg-sky-100 rounded-full overflow-hidden">
                            <div className={`h-full rounded-full ${pct >= 65 ? 'bg-gradient-to-r from-sky-400 to-pulse' : pct >= 50 ? 'bg-amber-400' : 'bg-red-400'}`} style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-3.5 text-xs text-slate-400 max-w-[200px] truncate">
                        {(s.especialidades || []).join(', ') || '—'}
                      </td>
                      <td className="px-5 py-3.5 text-xs text-slate-400">
                        {s.duracion_minutos ? `${s.duracion_minutos} min` : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
