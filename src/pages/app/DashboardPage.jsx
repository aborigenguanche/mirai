import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useAuthStore } from '../../store';
import { Card, CardHeader, Badge, EmptyState, LoadingScreen, StatCard } from '../../components/ui';

export default function DashboardPage() {
  const { usuario } = useAuthStore();
  const [loading, setLoading]           = useState(true);
  const [intentos, setIntentos]         = useState([]);
  const [sesiones, setSesiones]         = useState([]);
  const [especialidades, setEspecialidades] = useState([]);
  const rafRef = useRef({});

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    setLoading(true);
    const uid = usuario.id;
    const [{ data: its }, { data: sess }, { data: itsEsp }] = await Promise.all([
      supabase.from('intentos').select('es_correcto, created_at').eq('usuario_id', uid),
      supabase.from('sesiones').select('*').eq('usuario_id', uid).order('created_at', { ascending: false }).limit(6),
      supabase.from('intentos').select('es_correcto, pregunta:preguntas(especialidad)').eq('usuario_id', uid),
    ]);
    setIntentos(its || []);
    setSesiones(sess || []);

    const espMap = {};
    itsEsp?.forEach(i => {
      const esp = i.pregunta?.especialidad;
      if (!esp) return;
      if (!espMap[esp]) espMap[esp] = { total: 0, correctas: 0 };
      espMap[esp].total++;
      if (i.es_correcto) espMap[esp].correctas++;
    });
    setEspecialidades(
      Object.entries(espMap)
        .map(([nombre, d]) => ({ nombre, pct: Math.round((d.correctas / d.total) * 100), total: d.total }))
        .sort((a, b) => a.pct - b.pct)
    );
    setLoading(false);
  }

  // Contador animado
  function AnimatedNum({ target, suffix = '' }) {
    const [val, setVal] = useState(0);
    const started = useRef(false);
    const ref = useRef();
    useEffect(() => {
      if (loading || started.current) return;
      started.current = true;
      const dur = 900;
      const start = performance.now();
      const step = (now) => {
        const p = Math.min((now - start) / dur, 1);
        const eased = 1 - Math.pow(1 - p, 3);
        setVal(Math.round(target * eased));
        if (p < 1) ref.current = requestAnimationFrame(step);
      };
      ref.current = requestAnimationFrame(step);
      return () => cancelAnimationFrame(ref.current);
    }, [loading, target]);
    return <>{val.toLocaleString('es-ES')}{suffix}</>;
  }

  if (loading) return <LoadingScreen message="Cargando tu dashboard..." />;

  const total      = intentos.length;
  const correctas  = intentos.filter(i => i.es_correcto).length;
  const tasa       = total ? Math.round((correctas / total) * 100) : 0;

  const hace7 = new Date(Date.now() - 7 * 86400000);
  const semana = intentos.filter(i => new Date(i.created_at) > hace7).length;

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
  const peor  = especialidades[0];
  const hora  = new Date().getHours();
  const saludo = hora < 14 ? 'Buenos días' : hora < 21 ? 'Buenas tardes' : 'Buenas noches';
  const nombre = (usuario.nombre || usuario.email || '').split(' ')[0];

  return (
    <div>
      {/* Header */}
      <div className="flex items-start justify-between mb-8 gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-2xl font-bold text-ink tracking-tight">
            {saludo}, {nombre} 👋
          </h1>
          <p className="text-sm text-slate-400 mt-1">Aquí tienes tu resumen de hoy</p>
        </div>
        <Link to="/app/practicar"
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-ink text-white rounded-full text-sm font-bold hover:-translate-y-0.5 transition-all hover:shadow-lg hover:shadow-ink/20 relative overflow-hidden group">
          <span className="absolute inset-0 bg-gradient-to-r from-transparent via-pulse/20 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-500" />
          <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5"><polygon points="5 3 19 12 5 21 5 3"/></svg>
          Practicar ahora
        </Link>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Preguntas totales',  val: total,     suffix: '',  change: `${correctas} correctas`,       type: 'neutral' },
          { label: 'Tasa de acierto',    val: tasa,      suffix: '%', change: tasa >= 65 ? '↑ Por encima del corte' : tasa >= 50 ? '→ Cerca del corte' : '↓ Por debajo del corte', type: tasa >= 65 ? 'up' : tasa >= 50 ? 'neutral' : 'down' },
          { label: 'Racha actual',       val: racha,     suffix: '',  change: 'días consecutivos',            type: racha >= 3 ? 'up' : 'neutral' },
          { label: 'Esta semana',        val: semana,    suffix: '',  change: 'últimos 7 días',               type: 'neutral' },
        ].map(s => (
          <div key={s.label} className="bg-white border border-border rounded-lg p-5 relative overflow-hidden group">
            <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-sky-400 to-pulse opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
            <div className="font-mono text-[0.65rem] font-semibold uppercase tracking-widest text-slate-400 mb-2">{s.label}</div>
            <div className="font-display text-3xl font-bold text-ink leading-none mb-1.5">
              <AnimatedNum target={s.val} suffix={s.suffix} />
            </div>
            <div className={`text-xs font-semibold ${s.type === 'up' ? 'text-pulse-dim' : s.type === 'down' ? 'text-red-400' : 'text-slate-400'}`}>
              {s.change}
            </div>
          </div>
        ))}
      </div>

      {/* Grid principal */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 mb-5">

        {/* Especialidades */}
        <div className="lg:col-span-2">
          <Card>
            <CardHeader
              title="Rendimiento por especialidad"
              subtitle="Tus últimas semanas · ordenado de menor a mayor"
              action={<Link to="/app/estadisticas" className="text-xs font-semibold text-sky-600 hover:text-sky-700">Ver todo →</Link>}
            />
            {especialidades.length === 0 ? (
              <EmptyState icon="📊" title="Sin datos todavía"
                subtitle="Completa tu primera sesión de preguntas para ver tu rendimiento por especialidad."
                action={<Link to="/app/practicar" className="inline-flex items-center gap-2 px-4 py-2 bg-ink text-white rounded-full text-sm font-semibold hover:opacity-90 transition-opacity">Empezar ahora →</Link>}
              />
            ) : (
              <div className="flex flex-col gap-4">
                {especialidades.slice(0, 8).map(e => {
                  const color = e.pct >= 70 ? 'from-sky-400 to-pulse' : e.pct >= 50 ? 'from-sky-400 to-sky-500' : e.pct >= 30 ? 'from-amber-400 to-amber-500' : 'from-red-400 to-red-500';
                  const textColor = e.pct >= 70 ? 'text-pulse-dim' : e.pct >= 50 ? 'text-sky-600' : e.pct >= 30 ? 'text-amber-500' : 'text-red-400';
                  return (
                    <div key={e.nombre}>
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-ink">{e.nombre}</span>
                          <span className="font-mono text-[0.65rem] text-slate-400">({e.total})</span>
                        </div>
                        <span className={`font-mono text-sm font-bold ${textColor}`}>{e.pct}%</span>
                      </div>
                      <div className="h-2 bg-sky-50 rounded-full overflow-hidden">
                        <div className={`h-full bg-gradient-to-r ${color} rounded-full transition-all duration-700`} style={{ width: `${e.pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </div>

        {/* Panel derecho */}
        <div className="flex flex-col gap-5">

          {/* Coach IA */}
          <div className="bg-ink rounded-lg p-5 relative overflow-hidden">
            <div className="absolute inset-0 dot-pattern pointer-events-none" />
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_300px_200px_at_80%_120%,rgba(0,229,199,.15),transparent)] pointer-events-none" />
            <div className="relative z-10">
              <div className="flex items-center gap-2 mb-3">
                <span className="w-2 h-2 rounded-full bg-pulse animate-pulse-dot" />
                <span className="font-mono text-[0.65rem] font-semibold uppercase tracking-widest text-pulse">Coach IA · Activo</span>
              </div>
              <h3 className="font-display font-bold text-white text-base mb-2 leading-snug">
                {peor ? `Trabaja ${peor.nombre} hoy` : '¡Empieza tu primera sesión!'}
              </h3>
              <p className="text-xs text-white/60 leading-relaxed mb-4">
                {peor
                  ? `Tu tasa en ${peor.nombre} es ${peor.pct}%. Un bloque de 20 preguntas puede subir 8–12 puntos en 3 semanas.`
                  : 'Responde tu primer bloque para que el Coach IA analice tu nivel y cree un plan personalizado.'}
              </p>
              <Link
                to={peor ? `/app/practicar?especialidad=${encodeURIComponent(peor.nombre)}` : '/app/practicar'}
                className="inline-flex items-center gap-2 px-4 py-2 bg-pulse text-ink rounded-full text-xs font-bold hover:brightness-110 transition-all">
                Empezar bloque →
              </Link>
            </div>
          </div>

          {/* Actividad semanal */}
          <Card>
            <CardHeader title="Actividad semanal" subtitle="Preguntas por día" />
            <div className="flex items-end gap-1.5 h-16">
              {Array.from({ length: 7 }, (_, i) => {
                const d = new Date(); d.setDate(d.getDate() - (6 - i));
                const count = intentos.filter(it => new Date(it.created_at).toDateString() === d.toDateString()).length;
                const max = 50;
                const h = Math.max(4, Math.min(100, (count / max) * 100));
                const isToday = i === 6;
                const dias = ['L','M','X','J','V','S','D'];
                const dow = d.getDay();
                return (
                  <div key={i} className="flex-1 flex flex-col items-center gap-1.5">
                    <div className="w-full relative flex items-end" style={{ height: 48 }}>
                      <div
                        title={`${count} preguntas`}
                        className={`w-full rounded-t-sm transition-all duration-500 ${isToday ? 'bg-gradient-to-t from-sky-500 to-pulse' : count > 0 ? 'bg-sky-200' : 'bg-sky-50'} ${isToday ? 'ring-1 ring-pulse/40' : ''}`}
                        style={{ height: `${h}%` }}
                      />
                    </div>
                    <span className={`font-mono text-[0.6rem] ${isToday ? 'text-sky-600 font-bold' : 'text-slate-400'}`}>
                      {dias[(dow + 6) % 7]}
                    </span>
                  </div>
                );
              })}
            </div>
          </Card>

          {/* Racha */}
          {racha > 0 && (
            <div className="bg-gradient-to-br from-amber-50 to-orange-50 border border-amber-200 rounded-lg p-4 flex items-center gap-4">
              <div className="text-3xl">🔥</div>
              <div>
                <div className="font-display font-bold text-lg text-ink">{racha} día{racha !== 1 ? 's' : ''} de racha</div>
                <div className="text-xs text-amber-700">¡Sigue así! La constancia es la clave del MIR.</div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Sesiones recientes */}
      <Card padding={false}>
        <div className="p-5 border-b border-border">
          <h3 className="font-display font-bold text-base text-ink">Sesiones recientes</h3>
          <p className="text-xs text-slate-400 mt-0.5">Tus últimas sesiones de estudio</p>
        </div>
        {sesiones.length === 0 ? (
          <EmptyState icon="📋" title="Sin sesiones todavía"
            subtitle="Completa tu primera sesión para verla aquí."
            action={<Link to="/app/practicar" className="inline-flex items-center gap-2 px-4 py-2 bg-ink text-white rounded-full text-sm font-semibold">Practicar ahora →</Link>}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-surface">
                  {['Fecha','Preguntas','Aciertos','Tasa','Especialidades','Duración'].map(h => (
                    <th key={h} className="text-left px-5 py-3 font-mono text-[0.65rem] font-semibold uppercase tracking-wider text-slate-400">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sesiones.map(s => {
                  const pct = s.total_preguntas ? Math.round((s.total_correctas / s.total_preguntas) * 100) : 0;
                  return (
                    <tr key={s.id} className="border-t border-border hover:bg-sky-50 transition-colors">
                      <td className="px-5 py-3.5 font-mono text-xs text-slate-400">
                        {new Date(s.created_at).toLocaleDateString('es-ES',{day:'2-digit',month:'short',year:'numeric'})}
                      </td>
                      <td className="px-5 py-3.5 font-mono font-semibold text-sm text-ink">{s.total_preguntas}</td>
                      <td className="px-5 py-3.5 font-mono font-semibold text-sm text-pulse-dim">{s.total_correctas}</td>
                      <td className="px-5 py-3.5">
                        <span className={`font-mono font-bold text-sm ${pct >= 65 ? 'text-pulse-dim' : pct >= 50 ? 'text-amber-500' : 'text-red-400'}`}>{pct}%</span>
                      </td>
                      <td className="px-5 py-3.5 text-xs text-slate-400 max-w-[180px] truncate">{(s.especialidades||[]).join(', ') || '—'}</td>
                      <td className="px-5 py-3.5 text-xs text-slate-400">{s.duracion_minutos ? `${s.duracion_minutos} min` : '—'}</td>
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
