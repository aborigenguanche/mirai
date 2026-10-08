import { useState, useEffect } from 'react';
import { adminAnalytics, adminFunnel } from '../../lib/supabase';
import { toast } from '../../store';
import { Badge, EmptyState, LoadingScreen, Modal, Button, FormGroup, Input, Select, Pagination, Card, CardHeader } from '../../components/ui';

export function AnalyticsPage() {
  const [loading, setLoading] = useState(true);
  const [periodo, setPeriodo] = useState('30');
  const [data, setData]       = useState(null);

  useEffect(() => { load(); }, [periodo]);

  // Los agregados se calculan en la base de datos (RPC admin_analytics / admin_funnel):
  // antes se descargaban todas las filas al navegador y PostgREST las cortaba en 1.000.
  async function load() {
    setLoading(true);
    try {
      const [an, funnel] = await Promise.all([adminAnalytics(parseInt(periodo)), adminFunnel()]);
      const crecimiento = (an.crecimiento || []).map(d => ({
        dia: new Date(d.date).toLocaleDateString('es-ES', { day: '2-digit', month: 'short' }), nuevos: d.nuevos,
      }));
      setData({
        total: an.total, corr: an.corr, tasa: an.total ? Math.round((an.corr / an.total) * 100) : 0,
        avgTime: an.avgTime, uniqueUsers: an.uniqueUsers, avgQperSess: an.avgQperSess,
        retention: an.uniqueUsers ? Math.round((an.activeRecent / an.uniqueUsers) * 100) : 0,
        activeRecent: an.activeRecent, subs: an.subs, crecimiento, modos: an.modos || {},
        totalSess: an.totalSess, avgScore: an.avgScore, scoresCount: an.scoresCount, funnel,
      });
    } catch (e) { toast.error('No se pudieron cargar las analíticas: ' + e.message); }
    setLoading(false);
  }

  if (loading) return <LoadingScreen message="Calculando analytics..." />;
  if (!data) return <EmptyState icon="📉" title="No se pudieron cargar las analíticas" />;
  const { crecimiento } = data;
  const maxCr = Math.max(...crecimiento.map(d=>d.nuevos), 1);

  return (
    <div>
      <div className="flex items-start justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-2xl font-bold text-ink tracking-tight">Analytics avanzado</h1>
          <p className="text-sm text-slate-400 mt-1">Métricas de producto en profundidad</p>
        </div>
        <div className="flex bg-white border border-border rounded-full p-1 gap-1">
          {[['7','7d'],['30','30d'],['90','90d'],['365','1 año']].map(([v,l])=>(
            <button key={v} onClick={()=>setPeriodo(v)} className={`px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all ${periodo===v?'bg-ink text-white shadow':'text-slate-400 hover:text-ink'}`}>{l}</button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {[
          { label:'Preguntas respondidas', val:data.total.toLocaleString('es-ES'), change:`${data.corr} correctas · ${data.tasa}%`, type:'neutral', dark:true },
          { label:'Usuarios activos',      val:data.uniqueUsers, change:`${data.retention}% retención 7d`, type:data.retention>=50?'up':'neutral' },
          { label:'Sesiones totales',      val:data.totalSess,   change:`${data.avgQperSess} q/sesión media`, type:'neutral' },
          { label:'Tiempo medio/pregunta', val:`${data.avgTime}s`, change:'segundos por respuesta', type:'neutral' },
        ].map(s=>(
          <div key={s.label} className={`rounded-lg p-5 border relative overflow-hidden group ${s.dark?'bg-ink border-ink':'bg-white border-border'}`}>
            <div className={`absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-sky-400 to-pulse ${s.dark?'opacity-100':'opacity-0 group-hover:opacity-100'} transition-opacity`}/>
            <div className={`font-mono text-[0.65rem] font-semibold uppercase tracking-widest mb-2 ${s.dark?'text-white/40':'text-slate-400'}`}>{s.label}</div>
            <div className={`font-display text-3xl font-bold leading-none mb-1.5 ${s.dark?'text-pulse':'text-ink'}`}>{s.val}</div>
            <div className={`text-xs font-semibold ${s.dark?'text-white/40':s.type==='up'?'text-pulse-dim':'text-slate-400'}`}>{s.change}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 mb-5">
        <div className="lg:col-span-2">
          <Card>
            <CardHeader title="Nuevos usuarios por día" subtitle={`Últimos ${Math.min(parseInt(periodo),30)} días`} />
            <div className="flex items-end gap-1 mb-2" style={{height:80}}>
              {crecimiento.map((d,i)=>{
                const h=d.nuevos?Math.max(4,(d.nuevos/maxCr)*100):3;
                return (
                  <div key={i} className="flex-1 flex flex-col items-center justify-end group relative" style={{height:80}}>
                    {d.nuevos>0&&<div className="absolute -top-5 left-1/2 -translate-x-1/2 bg-ink text-white text-[0.55rem] font-mono px-1 py-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-10">{d.nuevos}</div>}
                    <div className={`w-full rounded-t-sm ${d.nuevos>0?'bg-gradient-to-t from-sky-500 to-pulse':'bg-sky-50'} ${i===crecimiento.length-1?'ring-1 ring-pulse/40':''} transition-all`} style={{height:`${h}%`}}/>
                  </div>
                );
              })}
            </div>
            <div className="flex">
              {crecimiento.map((d,i)=>(
                <div key={i} className="flex-1 text-center">
                  {(i===0||i===Math.floor(crecimiento.length/2)||i===crecimiento.length-1)&&<span className="font-mono text-[0.58rem] text-slate-400">{d.dia}</span>}
                </div>
              ))}
            </div>
          </Card>
        </div>

        <div className="flex flex-col gap-5">
          <Card>
            <CardHeader title="Distribución de usuarios" />
            <div className="flex flex-col gap-3">
              {[['Activos',data.subs.active,'from-sky-400 to-pulse','text-pulse-dim'],['En prueba',data.subs.trial,'from-sky-400 to-sky-500','text-sky-600'],['Vencidos',data.subs.expired,'from-amber-400 to-amber-500','text-amber-500']].map(([l,v,g,tc])=>{
                const total=data.subs.active+data.subs.trial+data.subs.expired||1;
                return (
                  <div key={l}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm text-ink">{l}</span>
                      <div className="flex items-center gap-2">
                        <span className={`font-mono font-bold text-sm ${tc}`}>{v}</span>
                        <span className="text-xs text-slate-400">({Math.round((v/total)*100)}%)</span>
                      </div>
                    </div>
                    <div className="h-2 bg-sky-100 rounded-full overflow-hidden">
                      <div className={`h-full bg-gradient-to-r ${g} rounded-full`} style={{width:`${(v/total)*100}%`}}/>
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>

          <Card>
            <CardHeader title="Modos más usados" />
            {Object.entries(data.modos).length===0 ? <p className="text-xs text-slate-400 text-center py-4">Sin datos</p> : (
              <div className="flex flex-col gap-3">
                {Object.entries(data.modos).sort((a,b)=>b[1]-a[1]).map(([mode,count])=>{
                  const total=Object.values(data.modos).reduce((a,b)=>a+b,0)||1;
                  return (
                    <div key={mode}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm text-ink capitalize">{mode}</span>
                        <span className="font-mono text-sm font-bold text-sky-600">{count}</span>
                      </div>
                      <div className="h-2 bg-sky-100 rounded-full overflow-hidden">
                        <div className="h-full bg-gradient-to-r from-sky-400 to-sky-500 rounded-full" style={{width:`${(count/total)*100}%`}}/>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>

          <Card>
            <CardHeader title="Score MIR global" subtitle="Media de todos los simulacros" />
            <div className="text-center py-4">
              <div className="font-display font-bold text-4xl text-ink mb-1">{data.avgScore}</div>
              <div className="text-sm text-slate-400 mb-3">puntos de media · {data.scoresCount} simulacros</div>
              <div className="h-2 bg-sky-100 rounded-full overflow-hidden">
                <div className="h-full bg-gradient-to-r from-sky-400 to-pulse rounded-full" style={{width:`${Math.min(100,(data.avgScore/630)*100)}%`}}/>
              </div>
              <div className="flex justify-between text-xs font-mono mt-1">
                <span className="text-slate-400">0</span>
                <span className="text-amber-500">↑ Corte ~400pts</span>
                <span className="text-slate-400">630</span>
              </div>
            </div>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader title="Métricas de retención y engagement" subtitle="Usuarios que vuelven a practicar" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
          {[
            { label:'Retención 7 días', val:`${data.retention}%`, desc:`${data.activeRecent} de ${data.uniqueUsers} usuarios volvieron esta semana`, ok:data.retention>=40 },
            { label:'Sesiones / usuario', val:data.uniqueUsers?Math.round(data.totalSess/data.uniqueUsers):0, desc:'sesiones de media por usuario activo', ok:true },
            { label:'Preguntas / sesión', val:data.avgQperSess, desc:'preguntas respondidas de media', ok:data.avgQperSess>=15 },
            { label:'Velocidad media', val:`${data.avgTime}s`, desc:'por pregunta · ideal < 45s', ok:data.avgTime<=45 },
          ].map(s=>(
            <div key={s.label} className="text-center">
              <div className={`font-display font-bold text-3xl mb-1 ${s.ok?'text-pulse-dim':'text-amber-500'}`}>{s.val}</div>
              <div className="font-semibold text-sm text-ink mb-1">{s.label}</div>
              <div className="text-xs text-slate-400 leading-relaxed">{s.desc}</div>
            </div>
          ))}
        </div>
      </Card>

      {/* Embudo de conversión */}
      <Card className="mt-5">
        <CardHeader title="Embudo de conversión" subtitle="Dónde se caen los usuarios, de registro a pago" />
        <div className="flex flex-col gap-3">
          {[['Registrados', data.funnel.registrados], ['Onboarding completado', data.funnel.onboarding],
            ['Primera sesión', data.funnel.primera_sesion], ['Volvieron (2+ días)', data.funnel.volvieron],
            ['Vieron el paywall', data.funnel.vieron_paywall], ['Pidieron un plan', data.funnel.pidieron_plan],
            ['De pago', data.funnel.de_pago]].map(([l, v]) => {
            const base = data.funnel.registrados || 1;
            return (
              <div key={l}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm text-ink">{l}</span>
                  <span className="font-mono text-sm font-bold text-sky-600">{v} <span className="text-slate-400 font-normal">({Math.round((v / base) * 100)}%)</span></span>
                </div>
                <div className="h-2 bg-sky-100 rounded-full overflow-hidden">
                  <div className="h-full bg-gradient-to-r from-sky-400 to-pulse rounded-full" style={{ width: `${Math.min(100, (v / base) * 100)}%` }}/>
                </div>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

export default AnalyticsPage;
