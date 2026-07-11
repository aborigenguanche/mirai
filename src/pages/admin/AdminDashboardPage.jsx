import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { Card, CardHeader, Badge, EmptyState, LoadingScreen } from '../../components/ui';

export default function AdminDashboardPage() {
  const [loading, setLoading]       = useState(true);
  const [stats, setStats]           = useState(null);
  const [usuarios, setUsuarios]     = useState([]);
  const [sesiones, setSesiones]     = useState([]);
  const [preguntas, setPreguntas]   = useState([]);
  const [evolucion, setEvolucion]   = useState([]);
  const [periodo, setPeriodo]       = useState('30');

  useEffect(() => { loadAll(); }, [periodo]);

  async function loadAll() {
    setLoading(true);
    const cutoff = new Date(Date.now() - parseInt(periodo) * 86400000).toISOString();

    const [
      { data: users },
      { data: sess },
      { data: intentos },
      { data: pregs },
      { data: sessRecientes },
    ] = await Promise.all([
      supabase.from('usuarios').select('*').order('created_at', { ascending: false }),
      supabase.from('sesiones').select('*').gte('created_at', cutoff),
      supabase.from('intentos').select('es_correcto, created_at').gte('created_at', cutoff),
      supabase.from('preguntas').select('especialidad, activa, dificultad'),
      supabase.from('sesiones').select('*, usuario:usuarios(email,nombre)').order('created_at', { ascending: false }).limit(8),
    ]);

    const hace30  = new Date(Date.now() - 30  * 86400000);
    const hace7   = new Date(Date.now() - 7   * 86400000);
    const activos = users?.filter(u => ['activa','prueba'].includes(u.suscripcion_estado)) || [];
    const nuevos  = users?.filter(u => new Date(u.created_at) > hace30) || [];
    const total   = intentos?.length || 0;
    const corr    = intentos?.filter(i => i.es_correcto).length || 0;

    // Usuarios activos en el periodo (con al menos 1 sesión)
    const uidsActivos = new Set(sess?.map(s => s.usuario_id));

    // Evolución diaria
    const dias = parseInt(periodo);
    const evo = Array.from({ length: Math.min(dias, 30) }, (_, i) => {
      const d = new Date(); d.setDate(d.getDate() - (Math.min(dias,30) - 1 - i));
      const dayStr = d.toDateString();
      const dayItns = intentos?.filter(it => new Date(it.created_at).toDateString() === dayStr) || [];
      const c = dayItns.filter(it => it.es_correcto).length;
      const t = dayItns.length;
      return { dia: d.toLocaleDateString('es-ES',{day:'2-digit',month:'short'}), total: t, correctas: c, tasa: t ? Math.round((c/t)*100) : null };
    });

    // Especialidades
    const espMap = {};
    pregs?.forEach(p => {
      if (!espMap[p.especialidad]) espMap[p.especialidad] = { total: 0, activas: 0 };
      espMap[p.especialidad].total++;
      if (p.activa) espMap[p.especialidad].activas++;
    });
    const porEsp = Object.entries(espMap)
      .map(([nombre, d]) => ({ nombre, ...d }))
      .sort((a, b) => b.total - a.total);

    setStats({
      totalUsuarios:    users?.length || 0,
      activos:          activos.length,
      nuevos30:         nuevos.length,
      usuariosActivos:  uidsActivos.size,
      totalSesiones:    sess?.length || 0,
      totalPreguntas:   total,
      tasaGlobal:       total ? Math.round((corr/total)*100) : 0,
      totalBanco:       pregs?.length || 0,
      bancActivas:      pregs?.filter(p=>p.activa).length || 0,
      conversionPct:    users?.length ? Math.round((activos.length/users.length)*100) : 0,
    });
    setUsuarios(users?.slice(0,6) || []);
    setSesiones(sessRecientes || []);
    setPreguntas(porEsp);
    setEvolucion(evo);
    setLoading(false);
  }

  if (loading) return <LoadingScreen message="Cargando panel..." />;

  const maxEvo = Math.max(...evolucion.map(d => d.total), 1);

  return (
    <div>
      {/* Header */}
      <div className="flex items-start justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-2xl font-bold text-ink tracking-tight">Panel de administración</h1>
          <p className="text-sm text-slate-400 mt-1">Visión global del producto en tiempo real</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex bg-white border border-border rounded-full p-1 gap-1">
            {[['7','7d'],['30','30d'],['90','90d']].map(([val,label]) => (
              <button key={val} onClick={() => setPeriodo(val)}
                className={`px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all ${periodo===val?'bg-ink text-white shadow':'text-slate-400 hover:text-ink'}`}>
                {label}
              </button>
            ))}
          </div>
          <Link to="/admin/preguntas"
            className="inline-flex items-center gap-2 px-4 py-2 bg-ink text-white rounded-full text-sm font-semibold hover:-translate-y-0.5 transition-all hover:shadow-lg">
            + Nueva pregunta
          </Link>
          <button onClick={loadAll}
            className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-border rounded-full text-sm font-semibold text-slate-500 hover:bg-sky-50 hover:border-sky-300 transition-all">
            ↻
          </button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Usuarios totales',     val: stats.totalUsuarios,    sub: `+${stats.nuevos30} este mes`,            type: 'up',      dark: false },
          { label: 'Suscriptores activos', val: `${stats.activos}`,     sub: `${stats.conversionPct}% conversión`,     type: stats.activos > 0 ? 'up' : 'neutral', dark: true },
          { label: 'Sesiones en periodo',  val: stats.totalSesiones,    sub: `${stats.usuariosActivos} usuarios únicos`, type: 'neutral', dark: false },
          { label: 'Tasa de acierto global',val:`${stats.tasaGlobal}%`, sub: `${stats.totalPreguntas.toLocaleString('es-ES')} respondidas`, type: stats.tasaGlobal>=65?'up':'neutral', dark: false },
        ].map(s => (
          <div key={s.label} className={`rounded-lg p-5 border relative overflow-hidden group ${s.dark ? 'bg-ink border-ink' : 'bg-white border-border'}`}>
            <div className={`absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-sky-400 to-pulse ${s.dark ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'} transition-opacity`} />
            <div className={`font-mono text-[0.65rem] font-semibold uppercase tracking-widest mb-2 ${s.dark?'text-white/40':'text-slate-400'}`}>{s.label}</div>
            <div className={`font-display text-3xl font-bold leading-none mb-1.5 ${s.dark?'text-pulse':'text-ink'}`}>{s.val}</div>
            <div className={`text-xs font-semibold ${s.dark?(s.type==='up'?'text-pulse/80':'text-white/40'):(s.type==='up'?'text-pulse-dim':s.type==='down'?'text-red-400':'text-slate-400')}`}>
              {s.sub}
            </div>
          </div>
        ))}
      </div>

      {/* Gráfica de actividad */}
      <Card className="mb-5">
        <CardHeader
          title="Actividad diaria"
          subtitle={`Preguntas respondidas en los últimos ${Math.min(parseInt(periodo),30)} días`}
          action={
            <div className="flex items-center gap-4 text-xs">
              <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-gradient-to-r from-sky-400 to-pulse inline-block" />≥65%</span>
              <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-sky-200 inline-block" />50–65%</span>
              <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-amber-300 inline-block" />&lt;50%</span>
            </div>
          }
        />
        <div className="flex items-end gap-1 mb-2" style={{ height: 80 }}>
          {evolucion.map((d, i) => {
            const h = d.total ? Math.max(4, (d.total/maxEvo)*100) : 3;
            const color = d.tasa===null?'bg-sky-50':d.tasa>=65?'bg-gradient-to-t from-sky-500 to-pulse':d.tasa>=50?'bg-sky-200':'bg-amber-300';
            const isToday = i === evolucion.length - 1;
            return (
              <div key={i} className="flex-1 flex flex-col items-center justify-end group relative" style={{height:80}}>
                <div title={d.total?`${d.dia}: ${d.total} preguntas · ${d.tasa}%`:d.dia}
                  className={`w-full rounded-t-sm ${color} ${isToday?'ring-1 ring-pulse/40':''} transition-all cursor-default`}
                  style={{height:`${h}%`}}>
                  {d.tasa!==null && (
                    <div className="absolute -top-6 left-1/2 -translate-x-1/2 bg-ink text-white text-[0.55rem] font-mono px-1.5 py-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-10">
                      {d.tasa}%
                    </div>
                  )}
                </div>
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

        {/* Stats de la gráfica */}
        <div className="grid grid-cols-3 gap-3 mt-5 pt-5 border-t border-border">
          {[
            { label: 'Días con actividad', val: evolucion.filter(d=>d.total>0).length },
            { label: 'Pico diario',        val: Math.max(...evolucion.map(d=>d.total)) + ' preguntas' },
            { label: 'Media diaria',       val: Math.round(evolucion.reduce((a,d)=>a+d.total,0)/evolucion.length) + ' preguntas' },
          ].map(s => (
            <div key={s.label} className="text-center">
              <div className="font-display font-bold text-lg text-ink">{s.val}</div>
              <div className="text-xs text-slate-400 mt-0.5">{s.label}</div>
            </div>
          ))}
        </div>
      </Card>

      {/* Grid medio */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 mb-5">

        {/* Usuarios recientes */}
        <div className="lg:col-span-2">
          <Card padding={false}>
            <div className="p-5 border-b border-border flex items-center justify-between">
              <div>
                <h3 className="font-display font-bold text-base text-ink">Usuarios recientes</h3>
                <p className="text-xs text-slate-400 mt-0.5">Últimos registros en la plataforma</p>
              </div>
              <Link to="/admin/usuarios" className="text-xs font-semibold text-sky-600 hover:text-sky-700">Ver todos →</Link>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-surface">
                    {['Usuario','Estado','Rol','Registro'].map(h => (
                      <th key={h} className="text-left px-5 py-3 font-mono text-[0.65rem] font-semibold uppercase tracking-wider text-slate-400">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {usuarios.length === 0
                    ? <tr><td colSpan={4}><EmptyState icon="👤" title="Sin usuarios todavía" /></td></tr>
                    : usuarios.map(u => (
                      <tr key={u.id} className="border-t border-border hover:bg-sky-50 transition-colors">
                        <td className="px-5 py-3.5">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-sky-400 to-pulse flex items-center justify-center font-display text-xs font-bold text-white shrink-0">
                              {(u.nombre||u.email||'U').charAt(0).toUpperCase()}
                            </div>
                            <div>
                              {u.nombre
                                ? <div className="text-sm font-semibold text-ink">{u.nombre}</div>
                                : <div className="text-sm italic text-slate-400">Sin nombre</div>
                              }
                              <div className="text-xs text-slate-400 font-mono truncate max-w-[160px]">{u.email}</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-5 py-3.5"><EstadoBadge estado={u.suscripcion_estado} /></td>
                        <td className="px-5 py-3.5"><Badge variant={u.rol==='admin'?'ink':'gray'}>{u.rol}</Badge></td>
                        <td className="px-5 py-3.5 font-mono text-xs text-slate-400">
                          {new Date(u.created_at).toLocaleDateString('es-ES',{day:'2-digit',month:'short'})}
                        </td>
                      </tr>
                    ))
                  }
                </tbody>
              </table>
            </div>
          </Card>
        </div>

        {/* Panel derecho */}
        <div className="flex flex-col gap-5">

          {/* Banco de preguntas */}
          <Card>
            <CardHeader title="Banco de preguntas" />
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div className="bg-surface rounded-lg p-3 text-center border border-border">
                <div className="font-display font-bold text-2xl text-ink">{stats.totalBanco}</div>
                <div className="text-xs text-slate-400 mt-0.5">Total</div>
              </div>
              <div className="bg-pulse-bg rounded-lg p-3 text-center border border-pulse-dim/20">
                <div className="font-display font-bold text-2xl text-pulse-dim">{stats.bancActivas}</div>
                <div className="text-xs text-slate-400 mt-0.5">Activas</div>
              </div>
            </div>
            <Link to="/admin/preguntas" className="flex items-center justify-between text-xs font-semibold text-sky-600 hover:text-sky-700">
              Gestionar preguntas <span>→</span>
            </Link>
          </Card>

          {/* Sesiones recientes */}
          <Card>
            <CardHeader title="Últimas sesiones" subtitle="Actividad reciente de estudiantes" />
            <div className="flex flex-col gap-3">
              {sesiones.length === 0
                ? <p className="text-xs text-slate-400 text-center py-3">Sin actividad todavía</p>
                : sesiones.slice(0,5).map(s => {
                  const pct = s.total_preguntas ? Math.round((s.total_correctas/s.total_preguntas)*100) : 0;
                  return (
                    <div key={s.id} className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="w-6 h-6 rounded-full bg-sky-100 flex items-center justify-center font-display text-[0.6rem] font-bold text-sky-700 shrink-0">
                          {(s.usuario?.nombre||s.usuario?.email||'?').charAt(0).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <div className="text-xs font-semibold text-ink truncate">
                            {(s.especialidades||[]).slice(0,2).join(', ') || 'Varias'}
                          </div>
                          <div className="text-[0.6rem] text-slate-400 font-mono truncate">
                            {s.usuario?.email} · {s.total_preguntas}q
                          </div>
                        </div>
                      </div>
                      <span className={`font-mono text-xs font-bold shrink-0 ${pct>=65?'text-pulse-dim':pct>=50?'text-amber-500':'text-red-400'}`}>
                        {pct}%
                      </span>
                    </div>
                  );
                })
              }
            </div>
          </Card>
        </div>
      </div>

      {/* Cobertura del temario */}
      <Card>
        <CardHeader
          title="Cobertura del temario MIR"
          subtitle="Distribución de preguntas por especialidad · objetivo mínimo: 50 preguntas por especialidad"
          action={
            <Link to="/admin/preguntas"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-ink text-white rounded-full text-xs font-semibold hover:opacity-90 transition-opacity">
              + Añadir preguntas
            </Link>
          }
        />
        {preguntas.length === 0 ? (
          <EmptyState icon="📚" title="Sin preguntas todavía" subtitle="Añade preguntas desde el panel de gestión para ver la cobertura del temario." />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-4">
            {preguntas.map(esp => {
              const pct = Math.min(100, Math.round((esp.total / 100) * 100));
              const color = esp.total >= 50 ? 'from-sky-500 to-pulse' : esp.total >= 20 ? 'from-sky-400 to-sky-500' : 'from-amber-400 to-amber-500';
              return (
                <div key={esp.nombre}>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-sm font-medium text-ink">{esp.nombre}</span>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-slate-400">{esp.activas}/{esp.total}</span>
                      {esp.total < 20 && <Badge variant="amber">Incompleta</Badge>}
                      {esp.total >= 50 && <Badge variant="pulse">OK</Badge>}
                    </div>
                  </div>
                  <div className="h-2 bg-sky-100 rounded-full overflow-hidden">
                    <div className={`h-full bg-gradient-to-r ${color} rounded-full transition-all duration-700`} style={{width:`${pct}%`}} />
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

function EstadoBadge({ estado }) {
  const map = {
    activa:    { label: 'Activa',    variant: 'pulse' },
    prueba:    { label: 'Prueba',    variant: 'blue' },
    inactiva:  { label: 'Inactiva',  variant: 'gray' },
    cancelada: { label: 'Cancelada', variant: 'red' },
    vencida:   { label: 'Vencida',   variant: 'amber' },
  };
  const { label, variant } = map[estado] || { label: estado, variant: 'gray' };
  return <Badge variant={variant}>{label}</Badge>;
}
