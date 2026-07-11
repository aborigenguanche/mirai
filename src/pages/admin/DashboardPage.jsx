import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { StatCard, Card, CardHeader, Badge, EmptyState, LoadingScreen } from '../../components/ui';

export default function AdminDashboardPage() {
  const [loading, setLoading] = useState(true);
  const [stats, setStats]     = useState(null);
  const [users, setUsers]     = useState([]);
  const [activity, setActivity] = useState([]);
  const [periodo, setPeriodo] = useState('30');

  useEffect(() => { load(); }, [periodo]);

  async function load() {
    setLoading(true);
    const cutoff = new Date(Date.now() - parseInt(periodo) * 86400000).toISOString();
    const [
      { data: profiles },
      { data: sessions },
      { data: responses },
      { data: questions },
      { data: recentSess },
    ] = await Promise.all([
      supabase.from('profiles').select('*').order('created_at', { ascending: false }),
      supabase.from('exam_sessions').select('user_id, started_at').gte('started_at', cutoff).not('finished_at','is',null),
      supabase.from('exam_responses').select('is_correct, answered_at').gte('answered_at', cutoff),
      supabase.from('questions').select('id, is_active, specialty_id, specialty:specialties(name)'),
      supabase.from('exam_sessions').select('*, profile:profiles(email,full_name)').not('finished_at','is',null).order('started_at',{ascending:false}).limit(8),
    ]);

    const hace30  = new Date(Date.now() - 30 * 86400000);
    const activos = (profiles||[]).filter(p => ['trial','active'].includes(p.subscription_status));
    const nuevos  = (profiles||[]).filter(p => new Date(p.created_at) > hace30);
    const total   = responses?.length || 0;
    const corr    = (responses||[]).filter(r => r.is_correct).length;
    const uActivos = new Set((sessions||[]).map(s => s.user_id)).size;

    // Evolución diaria
    const dias = Math.min(parseInt(periodo), 30);
    const evo = Array.from({ length: dias }, (_, i) => {
      const d = new Date(); d.setDate(d.getDate() - (dias-1-i));
      const ds = d.toDateString();
      const dayR = (responses||[]).filter(r => new Date(r.answered_at).toDateString() === ds);
      const c = dayR.filter(r => r.is_correct).length;
      return { dia: d.toLocaleDateString('es-ES',{day:'2-digit',month:'short'}), total: dayR.length, correctas: c, tasa: dayR.length ? Math.round((c/dayR.length)*100) : null };
    });

    // Por especialidad
    const espMap = {};
    (questions||[]).forEach(q => {
      const name = q.specialty?.name || q.specialty_id;
      if (!espMap[name]) espMap[name] = { total:0, activas:0 };
      espMap[name].total++;
      if (q.is_active) espMap[name].activas++;
    });

    setStats({
      totalUsuarios:   profiles?.length || 0,
      activos:         activos.length,
      nuevos30:        nuevos.length,
      uActivos,
      totalSesiones:   sessions?.length || 0,
      totalPreguntas:  total,
      tasaGlobal:      total ? Math.round((corr/total)*100) : 0,
      bancTotal:       questions?.length || 0,
      bancActivas:     (questions||[]).filter(q=>q.is_active).length,
      convPct:         profiles?.length ? Math.round((activos.length/profiles.length)*100) : 0,
      porEsp:          Object.entries(espMap).map(([n,d])=>({nombre:n,...d})).sort((a,b)=>b.total-a.total),
    });
    setUsers((profiles||[]).slice(0,6));
    setActivity(evo);
    setLoading(false);
  }

  if (loading) return <LoadingScreen message="Cargando panel..." />;
  const maxEvo = Math.max(...activity.map(d=>d.total), 1);

  return (
    <div>
      <div className="flex items-start justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-2xl font-bold text-ink tracking-tight">Panel de administración</h1>
          <p className="text-sm text-slate-400 mt-1">Visión global del producto en tiempo real</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex bg-white border border-border rounded-full p-1 gap-1">
            {[['7','7d'],['30','30d'],['90','90d']].map(([v,l]) => (
              <button key={v} onClick={() => setPeriodo(v)}
                className={`px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all ${periodo===v?'bg-ink text-white shadow':'text-slate-400 hover:text-ink'}`}>{l}</button>
            ))}
          </div>
          <Link to="/admin/preguntas" className="inline-flex items-center gap-2 px-4 py-2 bg-ink text-white rounded-full text-sm font-semibold hover:-translate-y-0.5 transition-all hover:shadow-lg">
            + Nueva pregunta
          </Link>
          <button onClick={load} className="w-9 h-9 flex items-center justify-center bg-white border border-border rounded-full text-slate-500 hover:bg-sky-50 hover:border-sky-300 transition-all">↻</button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard label="Usuarios totales"      value={stats.totalUsuarios}   change={`+${stats.nuevos30} este mes`}            changeType="up" />
        <StatCard label="Suscriptores activos"  value={stats.activos}         change={`${stats.convPct}% conversión`}           changeType={stats.activos>0?'up':'neutral'} dark />
        <StatCard label="Sesiones en periodo"   value={stats.totalSesiones}   change={`${stats.uActivos} usuarios únicos`}      changeType="neutral" />
        <StatCard label="Tasa acierto global"   value={`${stats.tasaGlobal}%`} change={`${stats.totalPreguntas.toLocaleString('es-ES')} respondidas`} changeType={stats.tasaGlobal>=65?'up':'neutral'} />
      </div>

      {/* Gráfica */}
      <Card className="mb-5">
        <CardHeader title="Actividad diaria" subtitle={`Preguntas respondidas · últimos ${Math.min(parseInt(periodo),30)} días`} />
        <div className="flex items-end gap-1 mb-2" style={{height:80}}>
          {activity.map((d,i) => {
            const h = d.total ? Math.max(4,(d.total/maxEvo)*100) : 3;
            const color = d.tasa===null?'bg-sky-50':d.tasa>=65?'bg-gradient-to-t from-sky-500 to-pulse':d.tasa>=50?'bg-sky-200':'bg-amber-300';
            return (
              <div key={i} className="flex-1 flex flex-col items-center justify-end group relative" style={{height:80}}>
                {d.tasa!==null && (
                  <div className="absolute -top-6 left-1/2 -translate-x-1/2 bg-ink text-white text-[0.55rem] font-mono px-1.5 py-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-10">
                    {d.tasa}% · {d.total}q
                  </div>
                )}
                <div className={`w-full rounded-t-sm ${color} ${i===activity.length-1?'ring-1 ring-pulse/40':''} transition-all`} style={{height:`${h}%`}}/>
              </div>
            );
          })}
        </div>
        <div className="flex">
          {activity.map((d,i) => (
            <div key={i} className="flex-1 text-center">
              {(i===0||i===Math.floor(activity.length/2)||i===activity.length-1) && (
                <span className="font-mono text-[0.58rem] text-slate-400">{d.dia}</span>
              )}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-3 gap-3 mt-5 pt-5 border-t border-border">
          {[
            { label:'Días con actividad', val: activity.filter(d=>d.total>0).length },
            { label:'Pico diario',        val: `${Math.max(...activity.map(d=>d.total))}q` },
            { label:'Media diaria',       val: `${Math.round(activity.reduce((a,d)=>a+d.total,0)/activity.length)}q` },
          ].map(s => <div key={s.label} className="text-center"><div className="font-display font-bold text-lg text-ink">{s.val}</div><div className="text-xs text-slate-400 mt-0.5">{s.label}</div></div>)}
        </div>
      </Card>

      {/* Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 mb-5">
        <div className="lg:col-span-2">
          <Card padding={false}>
            <div className="p-5 border-b border-border flex items-center justify-between">
              <h3 className="font-display font-bold text-base text-ink">Usuarios recientes</h3>
              <Link to="/admin/usuarios" className="text-xs font-semibold text-sky-600 hover:text-sky-700">Ver todos →</Link>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead><tr className="bg-surface">{['Usuario','Estado','Rol','Registro'].map(h=><th key={h} className="text-left px-5 py-3 font-mono text-[0.65rem] font-semibold uppercase tracking-wider text-slate-400">{h}</th>)}</tr></thead>
                <tbody>
                  {users.length===0?<tr><td colSpan={4}><EmptyState icon="👤" title="Sin usuarios" /></td></tr>:users.map(u=>(
                    <tr key={u.id} className="border-t border-border hover:bg-sky-50 transition-colors">
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-sky-400 to-pulse flex items-center justify-center font-display text-xs font-bold text-white shrink-0">
                            {(u.full_name||u.email||'U').charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <div className="text-sm font-semibold text-ink">{u.full_name||<span className="italic text-slate-400">Sin nombre</span>}</div>
                            <div className="text-xs text-slate-400 font-mono truncate max-w-[160px]">{u.email}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-3.5"><SubBadge status={u.subscription_status}/></td>
                      <td className="px-5 py-3.5"><Badge variant={u.role==='admin'?'ink':'gray'}>{u.role}</Badge></td>
                      <td className="px-5 py-3.5 font-mono text-xs text-slate-400">{new Date(u.created_at).toLocaleDateString('es-ES',{day:'2-digit',month:'short'})}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
        <div className="flex flex-col gap-5">
          <Card>
            <CardHeader title="Banco de preguntas" />
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div className="bg-surface rounded-lg p-3 text-center border border-border"><div className="font-display font-bold text-2xl text-ink">{stats.bancTotal}</div><div className="text-xs text-slate-400 mt-0.5">Total</div></div>
              <div className="bg-pulse-bg rounded-lg p-3 text-center border border-pulse-dim/20"><div className="font-display font-bold text-2xl text-pulse-dim">{stats.bancActivas}</div><div className="text-xs text-slate-400 mt-0.5">Activas</div></div>
            </div>
            <div className="flex gap-2">
              <Link to="/admin/preguntas" className="flex-1 text-center text-xs font-semibold text-sky-600 hover:text-sky-700">Gestionar →</Link>
              <Link to="/admin/importar"  className="flex-1 text-center text-xs font-semibold text-pulse-dim hover:text-pulse">Importar CSV →</Link>
            </div>
          </Card>
          <Card>
            <CardHeader title="Accesos rápidos" />
            <div className="flex flex-col gap-2">
              {[
                { to:'/admin/usuarios',     icon:'👥', label:'Gestionar usuarios' },
                { to:'/admin/notificaciones', icon:'🔔', label:'Enviar notificación' },
                { to:'/admin/analytics',    icon:'📈', label:'Ver analytics' },
                { to:'/admin/importar',     icon:'📥', label:'Importar preguntas' },
              ].map(item => (
                <Link key={item.to} to={item.to}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-border hover:border-sky-300 hover:bg-sky-50 transition-all text-sm font-medium text-ink">
                  <span>{item.icon}</span>{item.label}<span className="ml-auto text-slate-300 text-xs">→</span>
                </Link>
              ))}
            </div>
          </Card>
        </div>
      </div>

      {/* Cobertura temario */}
      <Card>
        <CardHeader title="Cobertura del temario MIR"
          action={<Link to="/admin/preguntas" className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-ink text-white rounded-full text-xs font-semibold hover:opacity-90 transition-opacity">+ Añadir</Link>}
        />
        {stats.porEsp.length===0 ? <EmptyState icon="📚" title="Sin preguntas todavía" />:(
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-4">
            {stats.porEsp.map(esp => {
              const pct = Math.min(100,Math.round((esp.total/100)*100));
              const color = esp.total>=50?'from-sky-500 to-pulse':esp.total>=20?'from-sky-400 to-sky-500':'from-amber-400 to-amber-500';
              return (
                <div key={esp.nombre}>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-sm font-medium text-ink">{esp.nombre}</span>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-slate-400">{esp.activas}/{esp.total}</span>
                      {esp.total<20&&<Badge variant="amber">Incompleta</Badge>}
                      {esp.total>=50&&<Badge variant="pulse">OK</Badge>}
                    </div>
                  </div>
                  <div className="h-2 bg-sky-100 rounded-full overflow-hidden">
                    <div className={`h-full bg-gradient-to-r ${color} rounded-full`} style={{width:`${pct}%`}}/>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}

function SubBadge({ status }) {
  const map = { active:{label:'Activa',variant:'pulse'}, trial:{label:'Prueba',variant:'blue'}, expired:{label:'Vencida',variant:'amber'} };
  const { label, variant } = map[status] || { label:status, variant:'gray' };
  return <Badge variant={variant}>{label}</Badge>;
}
