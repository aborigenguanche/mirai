import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { supabase, getSessionHistory, fetchSpecialties } from '../../lib/supabase';
import { useAuthStore } from '../../store';
import { calcMirScore, calcPercentile } from '../../lib/mir-scoring';
import { Card, CardHeader, StatCard, Tabs, EmptyState, LoadingScreen, ProgressBar } from '../../components/ui';

export default function EstadisticasPage() {
  const { profile } = useAuthStore();
  const [loading, setLoading]   = useState(true);
  const [periodo, setPeriodo]   = useState('30');
  const [tab, setTab]           = useState('global');
  const [data, setData]         = useState(null);

  useEffect(() => { load(); }, [periodo]);

  async function load() {
    setLoading(true);
    const uid    = profile.id;
    const cutoff = new Date(Date.now() - parseInt(periodo) * 86400000).toISOString();

    const [analytics, sessions, responses, specs] = await Promise.all([
      supabase.rpc('get_user_analytics', { p_user_id: uid, p_days: parseInt(periodo) }).then(r => r.data),
      getSessionHistory(uid, 100),
      supabase.from('exam_responses')
        .select('is_correct, time_taken_seconds, answered_at, question:questions(specialty_id, specialty:specialties(id,name,color,mir_weight))')
        .eq('user_id', uid).gte('answered_at', cutoff),
      fetchSpecialties(),
    ]);

    const rs = responses.data || [];

    // Evolución diaria
    const dias = Math.min(parseInt(periodo), 30);
    const evolucion = Array.from({ length: dias }, (_, i) => {
      const d = new Date(); d.setDate(d.getDate() - (dias - 1 - i));
      const dayStr = d.toDateString();
      const dayRs  = rs.filter(r => new Date(r.answered_at).toDateString() === dayStr);
      const c = dayRs.filter(r => r.is_correct).length;
      const t = dayRs.length;
      return { dia: d.toLocaleDateString('es-ES',{day:'2-digit',month:'short'}), total: t, correctas: c, tasa: t ? Math.round((c/t)*100) : null };
    });

    // Por especialidad
    const espMap = {};
    rs.forEach(r => {
      const sp = r.question?.specialty;
      if (!sp) return;
      if (!espMap[sp.id]) espMap[sp.id] = { ...sp, total:0, correctas:0 };
      espMap[sp.id].total++;
      if (r.is_correct) espMap[sp.id].correctas++;
    });
    const porEsp = Object.values(espMap)
      .map(e => ({ ...e, pct: Math.round((e.correctas/e.total)*100) }))
      .sort((a,b) => a.pct - b.pct);

    // Racha
    const allSess = await getSessionHistory(uid, 365);
    const diasSet = new Set(allSess.map(s => new Date(s.started_at).toDateString()));
    let racha = 0;
    for (let i = 0; i < 365; i++) {
      const d = new Date(); d.setDate(d.getDate()-i);
      if (diasSet.has(d.toDateString())) racha++; else if (i>0) break;
    }

    // Score MIR
    const c = parseInt(analytics?.total_correct || 0);
    const t = parseInt(analytics?.total_questions || 0);
    const w = t - c;
    const mirScore = calcMirScore({ correct: c, wrong: w, blank: 0 });
    const percentil = calcPercentile(mirScore);

    // Tendencia semana vs semana anterior
    const hace7  = new Date(Date.now() - 7  * 86400000).toISOString();
    const hace14 = new Date(Date.now() - 14 * 86400000).toISOString();
    const [semActual, semAnterior] = await Promise.all([
      supabase.from('exam_responses').select('is_correct').eq('user_id',uid).gte('answered_at', hace7),
      supabase.from('exam_responses').select('is_correct').eq('user_id',uid).gte('answered_at',hace14).lt('answered_at',hace7),
    ]);
    const tA = semActual.data || [], tB = semAnterior.data || [];
    const tasaA = tA.length ? Math.round((tA.filter(r=>r.is_correct).length/tA.length)*100) : null;
    const tasaB = tB.length ? Math.round((tB.filter(r=>r.is_correct).length/tB.length)*100) : null;
    const tendencia = tasaA !== null && tasaB !== null ? tasaA - tasaB : null;

    // Distribución de errores
    const errResp = await supabase.from('exam_responses')
      .select('is_correct, time_taken_seconds').eq('user_id', uid).gte('answered_at', cutoff).eq('is_correct', false);
    const errRs = errResp.data || [];
    const rapidas = errRs.filter(r => (r.time_taken_seconds||0) < 10).length;
    const normales = errRs.filter(r => (r.time_taken_seconds||0) >= 10).length;

    setData({ analytics, evolucion, porEsp, racha, mirScore, percentil, tendencia, sessFiltradas: sessions.filter(s => s.started_at >= cutoff), errores: { rapidas, normales, total: errRs.length } });
    setLoading(false);
  }

  if (loading) return <LoadingScreen message="Cargando estadísticas..." />;
  if (!data?.analytics?.total_questions) return (
    <EmptyState icon="📊" title="Sin estadísticas todavía"
      subtitle="Completa tu primera sesión de preguntas para ver aquí tu evolución completa."
      action={<Link to="/app/examen" className="inline-flex items-center gap-2 px-5 py-2.5 bg-ink text-white rounded-full text-sm font-bold hover:-translate-y-0.5 transition-all">Empezar a practicar →</Link>}
    />
  );

  const { analytics, evolucion, porEsp, racha, mirScore, percentil, tendencia, sessFiltradas, errores } = data;
  const tasa = parseInt(analytics.accuracy || 0);
  const maxEvo = Math.max(...evolucion.map(d => d.total), 1);

  return (
    <div>
      {/* Header */}
      <div className="flex items-start justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-2xl font-bold text-ink tracking-tight">Estadísticas avanzadas</h1>
          <p className="text-sm text-slate-400 mt-1">Análisis completo de tu rendimiento</p>
        </div>
        <div className="flex bg-white border border-border rounded-full p-1 gap-1">
          {[['7','7d'],['30','30d'],['90','90d'],['365','1 año']].map(([v,l]) => (
            <button key={v} onClick={() => setPeriodo(v)}
              className={`px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all ${periodo===v?'bg-ink text-white shadow':'text-slate-400 hover:text-ink'}`}>
              {l}
            </button>
          ))}
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard label="Tasa de acierto" value={`${tasa}%`}
          change={tendencia!==null?(tendencia>=0?`↑ +${tendencia}pp esta semana`:`↓ ${tendencia}pp esta semana`):`${analytics.total_questions} respondidas`}
          changeType={tendencia!==null?(tendencia>=0?'up':'down'):'neutral'} dark />
        <StatCard label="Preguntas respondidas" value={parseInt(analytics.total_questions||0).toLocaleString('es-ES')} change={`${analytics.total_correct} correctas`} />
        <StatCard label="Score MIR estimado"    value={Math.round(mirScore)} change={`Percentil ${percentil}`} changeType={mirScore>=400?'up':'neutral'} />
        <StatCard label="Tiempo total"          value={`${Math.round(analytics.total_time_minutes||0)}min`} change={`${analytics.total_sessions} sesiones`} />
      </div>

      {/* Gráfica evolución */}
      <Card className="mb-5">
        <CardHeader title="Evolución diaria"
          subtitle={`Últimos ${Math.min(parseInt(periodo),30)} días`}
          action={
            <div className="flex items-center gap-3 text-xs">
              {[['from-sky-400 to-pulse','≥65%'],['bg-sky-200','50-65%'],['bg-amber-300','<50%']].map(([c,l]) => (
                <span key={l} className="flex items-center gap-1.5">
                  <span className={`w-3 h-3 rounded-sm inline-block bg-gradient-to-r ${c}`}/>
                  {l}
                </span>
              ))}
            </div>
          }
        />
        <div className="flex items-end gap-1 mb-2" style={{height:80}}>
          {evolucion.map((d,i) => {
            const h = d.total ? Math.max(4,(d.total/maxEvo)*100) : 3;
            const color = d.tasa===null?'bg-sky-50':d.tasa>=65?'bg-gradient-to-t from-sky-500 to-pulse':d.tasa>=50?'bg-sky-200':'bg-amber-300';
            const isToday = i===evolucion.length-1;
            return (
              <div key={i} className="flex-1 flex flex-col items-center justify-end group relative" style={{height:80}}>
                {d.tasa!==null && (
                  <div className="absolute -top-6 left-1/2 -translate-x-1/2 bg-ink text-white text-[0.55rem] font-mono px-1.5 py-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-10">
                    {d.tasa}% · {d.total}q
                  </div>
                )}
                <div title={`${d.dia}: ${d.total} preguntas${d.tasa!==null?` · ${d.tasa}%`:''}`}
                  className={`w-full rounded-t-sm ${color} ${isToday?'ring-1 ring-pulse/40':''} transition-all cursor-default`}
                  style={{height:`${h}%`}}/>
              </div>
            );
          })}
        </div>
        <div className="flex">
          {evolucion.map((d,i) => (
            <div key={i} className="flex-1 text-center">
              {(i===0||i===Math.floor(evolucion.length/2)||i===evolucion.length-1) && (
                <span className="font-mono text-[0.58rem] text-slate-400">{d.dia}</span>
              )}
            </div>
          ))}
        </div>
        {/* Línea de tendencia */}
        <div className="mt-5 pt-5 border-t border-border">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-slate-400">Tendencia de acierto</span>
            <span className="font-mono text-xs text-slate-400">Corte MIR: 65%</span>
          </div>
          <div className="relative h-12 bg-sky-50 rounded-lg overflow-hidden">
            <div className="absolute left-0 right-0 border-t-2 border-dashed border-amber-400/60" style={{top:'35%'}}/>
            <span className="absolute right-2 text-[0.6rem] font-mono text-amber-500 font-semibold" style={{top:'18%'}}>65%</span>
            <svg className="absolute inset-0 w-full h-full" viewBox={`0 0 ${evolucion.length} 100`} preserveAspectRatio="none">
              <defs><linearGradient id="lg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#0EA5E9" stopOpacity="0.3"/><stop offset="100%" stopColor="#0EA5E9" stopOpacity="0"/></linearGradient></defs>
              {(() => {
                const pts = evolucion.map((d,i) => d.tasa!==null?`${i},${100-d.tasa}`:null).filter(Boolean);
                if (pts.length < 2) return null;
                const line = 'M '+pts.join(' L ');
                return (<><path d={line+` L ${evolucion.length-1},100 L 0,100 Z`} fill="url(#lg)"/><path d={line} fill="none" stroke="#0EA5E9" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></>);
              })()}
            </svg>
          </div>
          <div className="grid grid-cols-3 gap-3 mt-4">
            {[
              { label:'Días activos',  val:evolucion.filter(d=>d.total>0).length },
              { label:'Pico diario',   val:`${Math.max(...evolucion.map(d=>d.total))}q` },
              { label:'Media diaria',  val:`${Math.round(evolucion.reduce((a,d)=>a+d.total,0)/evolucion.length)}q` },
            ].map(s => (
              <div key={s.label} className="text-center">
                <div className="font-display font-bold text-lg text-ink">{s.val}</div>
                <div className="text-xs text-slate-400 mt-0.5">{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </Card>

      {/* Grid especialidades + análisis */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 mb-5">
        <div className="lg:col-span-2">
          <Card>
            <CardHeader title="Rendimiento por especialidad"
              action={<Tabs tabs={[{key:'pct',label:'% Acierto'},{key:'vol',label:'Volumen'}]} active={tab} onChange={setTab} />}
            />
            {porEsp.length === 0 ? (
              <EmptyState icon="📊" title="Sin datos en este periodo" />
            ) : tab === 'pct' ? (
              <div className="flex flex-col gap-4">
                {porEsp.map(e => {
                  const color = e.pct>=70?'pulse':e.pct>=50?'sky':e.pct>=30?'amber':'red';
                  const textC = e.pct>=70?'text-pulse-dim':e.pct>=50?'text-sky-600':e.pct>=30?'text-amber-500':'text-red-400';
                  return (
                    <div key={e.id}>
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center gap-2">
                          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{background:e.color||'#0EA5E9'}}/>
                          <span className="text-sm font-medium text-ink">{e.name}</span>
                          <span className="font-mono text-[0.6rem] text-slate-400">({e.total})</span>
                        </div>
                        <span className={`font-mono text-sm font-bold ${textC}`}>{e.pct}%</span>
                      </div>
                      <ProgressBar value={e.pct} color={color} />
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {[...porEsp].sort((a,b)=>b.total-a.total).map(e => {
                  const max = Math.max(...porEsp.map(x=>x.total));
                  return (
                    <div key={e.id} className="flex items-center gap-3">
                      <div className="flex items-center gap-2 min-w-[120px]">
                        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{background:e.color||'#0EA5E9'}}/>
                        <span className="text-xs font-medium text-ink truncate">{e.name}</span>
                      </div>
                      <div className="flex-1 h-6 bg-sky-50 rounded-md overflow-hidden relative">
                        <div className="h-full bg-gradient-to-r from-sky-100 to-sky-200 rounded-md" style={{width:`${(e.total/max)*100}%`}}/>
                        <span className="absolute inset-0 flex items-center px-2 font-mono text-xs font-semibold text-sky-700">{e.total}</span>
                      </div>
                      <span className={`font-mono text-xs font-bold min-w-[36px] text-right ${e.pct>=65?'text-pulse-dim':e.pct>=50?'text-amber-500':'text-red-400'}`}>{e.pct}%</span>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </div>

        <div className="flex flex-col gap-5">
          {/* Indicador corte MIR */}
          <div className={`rounded-lg p-5 border ${tasa>=65?'bg-pulse-bg border-pulse-dim/30':'bg-amber-50 border-amber-200'}`}>
            <div className={`font-mono text-[0.65rem] font-semibold uppercase tracking-widest mb-2 ${tasa>=65?'text-pulse-dim':'text-amber-600'}`}>
              Corte MIR estimado
            </div>
            <div className="relative h-3 bg-white rounded-full overflow-hidden mb-2 border border-white/50">
              <div className={`h-full rounded-full transition-all duration-1000 ${tasa>=65?'bg-gradient-to-r from-sky-400 to-pulse':'bg-gradient-to-r from-amber-400 to-amber-500'}`} style={{width:`${Math.min(tasa,100)}%`}}/>
              <div className="absolute top-0 bottom-0 border-l-2 border-dashed border-ink/30" style={{left:'65%'}}/>
            </div>
            <div className="flex justify-between text-xs font-mono">
              <span className={`font-bold ${tasa>=65?'text-pulse-dim':'text-amber-600'}`}>{tasa}% actual</span>
              <span className="text-slate-400">65% corte</span>
            </div>
            <p className={`text-xs mt-3 leading-relaxed ${tasa>=65?'text-pulse-dim':'text-amber-700'}`}>
              {tasa>=65?`✓ ${tasa-65}pp por encima del corte. Mantén el ritmo.`:`Necesitas ${65-tasa}pp más para el corte.`}
            </p>
          </div>

          {/* Score MIR */}
          <Card>
            <CardHeader title="Score MIR estimado" subtitle="Fórmula oficial (+3/-1/0)" />
            <div className="text-center py-2">
              <div className="font-display font-bold text-5xl text-ink mb-1">{Math.round(mirScore)}</div>
              <div className="text-sm text-slate-400 mb-3">de {630} puntos posibles</div>
              <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold border ${mirScore>=400?'bg-pulse-bg border-pulse-dim/30 text-pulse-dim':'bg-amber-50 border-amber-200 text-amber-600'}`}>
                Percentil {percentil} · Orden #{Math.round((1-percentil/100)*14832).toLocaleString('es-ES')}
              </div>
            </div>
          </Card>

          {/* Constancia */}
          <Card>
            <CardHeader title="Constancia" />
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-center">
                <div className="text-2xl mb-1">🔥</div>
                <div className="font-display font-bold text-xl text-ink">{racha}</div>
                <div className="text-xs text-amber-600">días de racha</div>
              </div>
              <div className="bg-sky-50 border border-sky-200 rounded-lg p-3 text-center">
                <div className="text-2xl mb-1">📅</div>
                <div className="font-display font-bold text-xl text-ink">{evolucion.filter(d=>d.total>0).length}</div>
                <div className="text-xs text-sky-600">días activos</div>
              </div>
            </div>
            <p className="text-xs text-slate-400 text-center">
              {racha>=7?'¡Racha increíble! La constancia es la clave del MIR.':racha>=3?'Buen ritmo. Sigue así.':'Estudia cada día aunque sean 10 minutos.'}
            </p>
          </Card>
        </div>
      </div>

      {/* Sesiones recientes */}
      <Card padding={false}>
        <div className="p-5 border-b border-border flex items-center justify-between">
          <div>
            <h3 className="font-display font-bold text-base text-ink">Historial de sesiones</h3>
            <p className="text-xs text-slate-400 mt-0.5">{sessFiltradas.length} sesiones en el periodo</p>
          </div>
          <Link to="/app/examen" className="inline-flex items-center gap-2 px-4 py-2 bg-ink text-white rounded-full text-xs font-semibold hover:opacity-90 transition-opacity">
            + Nueva sesión
          </Link>
        </div>
        {sessFiltradas.length === 0 ? (
          <EmptyState icon="📋" title="Sin sesiones en este periodo" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-surface">
                  {['Fecha','Modo','Preguntas','Correctas','Tasa','Duración'].map(h => (
                    <th key={h} className="text-left px-5 py-3 font-mono text-[0.65rem] font-semibold uppercase tracking-wider text-slate-400">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sessFiltradas.slice(0,20).map(s => {
                  const pct = s.num_correct&&s.total_questions ? Math.round((s.num_correct/s.total_questions)*100) : 0;
                  const mins = s.finished_at ? Math.round((new Date(s.finished_at)-new Date(s.started_at))/60000) : null;
                  return (
                    <tr key={s.id} className="border-t border-border hover:bg-sky-50 transition-colors">
                      <td className="px-5 py-3.5 font-mono text-xs text-slate-400">
                        {new Date(s.started_at).toLocaleDateString('es-ES',{day:'2-digit',month:'short',year:'numeric'})}
                      </td>
                      <td className="px-5 py-3.5">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-semibold font-mono ${s.mode==='simulacro'?'bg-ink text-pulse':s.mode==='exam'?'bg-sky-50 text-sky-700 border border-sky-200':'bg-surface text-slate-500 border border-border'}`}>
                          {s.mode==='simulacro'?'Simulacro':s.mode==='exam'?'Examen':'Estudio'}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 font-mono font-semibold text-sm text-ink">{s.total_questions}</td>
                      <td className="px-5 py-3.5 font-mono font-semibold text-sm text-pulse-dim">{s.num_correct||0}</td>
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-2">
                          <span className={`font-mono font-bold text-sm ${pct>=65?'text-pulse-dim':pct>=50?'text-amber-500':'text-red-400'}`}>{pct}%</span>
                          <div className="w-14 h-1.5 bg-sky-100 rounded-full overflow-hidden">
                            <div className="h-full rounded-full" style={{width:`${pct}%`,background:pct>=65?'linear-gradient(90deg,#0EA5E9,#00E5C7)':pct>=50?'#F59E0B':'#EF4444'}}/>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-3.5 text-xs text-slate-400">{mins?`${mins} min`:'—'}</td>
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
