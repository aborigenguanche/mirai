import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { supabase, getRepasoPendiente, countRepasoPendiente, getMostFailed, fetchSpecialties } from '../../lib/supabase';
import { useAuthStore } from '../../store';
import { Card, CardHeader, StatCard, LoadingScreen } from '../../components/ui';

export default function PlanDiaPage() {
  const { profile }   = useAuthStore();
  const [loading, setLoading]       = useState(true);
  const [pendientes, setPendientes] = useState(0);
  // FIX 1: Separado en dos: total real de falladas (para cálculos)
  // y top falladas (para el link de refuerzo)
  const [totalFalladas, setTotalFalladas] = useState(0);
  // FIX 6: Simplificado — solo guardamos la tasa, no el objeto completo
  const [tasa, setTasa]             = useState(0);
  // FIX 7: Guardamos { id, name } para poder usar id en las URLs
  const [weakSpecs, setWeakSpecs]   = useState([]);
  const [horas, setHoras]           = useState(2);
  const [racha, setRacha]           = useState(0);
  const [diasAlMir, setDiasAlMir]   = useState(null);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    const uid = profile.id;

    const [pend, failed, analyticsData, sessHist, falladasCount] = await Promise.all([
      countRepasoPendiente(uid),
      getMostFailed(uid, 5),
      supabase.rpc('get_user_analytics', { p_user_id: uid, p_days: 30 }).then(r => r.data),
      // FIX 5: Aumentado limit a 120 para cubrir rachas largas con varias sesiones/día
      supabase.from('exam_sessions').select('started_at').eq('user_id', uid)
        .not('finished_at', 'is', null).order('started_at', { ascending: false }).limit(120).then(r => r.data || []),
      // FIX 1: Query separada para contar el total real de respuestas falladas
      supabase.from('exam_responses')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', uid)
        .eq('is_correct', false)
        .then(r => r.count || 0),
    ]);

    // Racha
    const dias = new Set(sessHist.map(s => new Date(s.started_at).toDateString()));
    let r = 0;
    for (let i = 0; i < 365; i++) {
      const d = new Date(); d.setDate(d.getDate() - i);
      if (dias.has(d.toDateString())) r++; else if (i > 0) break;
    }

    // Días al MIR
    const mirDate = profile.fecha_mir ? new Date(profile.fecha_mir) : null;
    const dMir = mirDate ? Math.max(0, Math.ceil((mirDate - new Date()) / 86400000)) : null;

    // FIX 7: Guardamos { id, name } en lugar de solo name
    const specs = profile.weak_specialties || [];
    const specDetails = await fetchSpecialties().then(all =>
      all.filter(s => specs.includes(s.id)).map(s => ({ id: s.id, name: s.name }))
    );

    setPendientes(pend);
    setTotalFalladas(falladasCount);
    // FIX 6: Solo extraemos la tasa del analytics
    setTasa(analyticsData?.accuracy || 0);
    setWeakSpecs(specDetails.slice(0, 3));
    setRacha(r);
    setDiasAlMir(dMir);
    setLoading(false);
  }

  if (loading) return <LoadingScreen message="Generando tu plan de hoy..." />;

  const pregsPerH = 25;
  const total     = Math.round(horas * pregsPerH);
  const repaso    = Math.min(pendientes, Math.round(total * 0.4));
  // FIX 2: Limitado al total real de falladas, no un porcentaje fijo
  const errores   = Math.min(totalFalladas, Math.round(total * 0.25));
  const nuevas    = Math.max(0, total - repaso - errores);
  const hora      = new Date().getHours();
  const saludo    = hora < 12 ? 'Buenos días' : hora < 20 ? 'Buenas tardes' : 'Buenas noches';
  const nombre    = (profile.full_name || profile.email || '').split(' ')[0];

  const URGENCIA = diasAlMir !== null
    ? diasAlMir < 30 ? 'critica' : diasAlMir < 90 ? 'alta' : 'media'
    : 'normal';

  const URGENCIA_STYLE = {
    critica: { bg:'bg-red-50',   border:'border-red-200',   text:'text-red-600',   label:'🚨 Fase crítica' },
    alta:    { bg:'bg-amber-50', border:'border-amber-200', text:'text-amber-600', label:'⚡ Fase final' },
    media:   { bg:'bg-sky-50',   border:'border-sky-200',   text:'text-sky-600',   label:'📅 Preparación' },
    normal:  { bg:'bg-surface',  border:'border-border',    text:'text-slate-500', label:'📚 En ruta' },
  };
  const us = URGENCIA_STYLE[URGENCIA];

  // Mensaje Coach IA
  let coachMsg = '';
  let coachType = 'neutro';
  if (diasAlMir !== null && diasAlMir < 30) {
    coachMsg = `Quedan ${diasAlMir} días. Cada sesión cuenta más que nunca. Prioriza repaso y simulacros.`;
    coachType = 'urgente';
  } else if (tasa < 50) {
    coachMsg = `Tu tasa es ${tasa}%. Dedica tiempo a entender los conceptos antes de seguir con preguntas nuevas.`;
    coachType = 'alerta';
  } else if (weakSpecs.length > 0) {
    coachMsg = `Tus especialidades más débiles son ${weakSpecs.map(s => s.name).join(', ')}. El plan de hoy las prioriza.`;
    coachType = 'consejo';
  } else if (racha >= 5) {
    coachMsg = `${racha} días de racha 🔥 La constancia es lo que más diferencia a quienes aprueban.`;
    coachType = 'positivo';
  } else {
    coachMsg = `Tasa actual: ${tasa}%. ${tasa >= 65 ? 'Estás por encima del corte. Mantén el ritmo.' : `Necesitas ${65 - tasa}pp más para el corte.`}`;
    coachType = tasa >= 65 ? 'positivo' : 'neutro';
  }

  const COACH_STYLE = {
    urgente:  { bg:'bg-red-50',   border:'border-red-200',       icon:'🚨', text:'text-red-600' },
    alerta:   { bg:'bg-amber-50', border:'border-amber-200',     icon:'⚠️', text:'text-amber-700' },
    consejo:  { bg:'bg-sky-50',   border:'border-sky-200',       icon:'💡', text:'text-sky-700' },
    positivo: { bg:'bg-pulse-bg', border:'border-pulse-dim/30',  icon:'✓',  text:'text-pulse-dim' },
    neutro:   { bg:'bg-surface',  border:'border-border',        icon:'📊', text:'text-slate-600' },
  };
  const cs = COACH_STYLE[coachType];

  // FIX 7: URL construida con id de especialidad en lugar del nombre
  const primeraSpec = weakSpecs[0];
  const examLinkNuevas = primeraSpec
    ? `/app/examen?especialidad=${primeraSpec.id}`
    : '/app/examen';

  return (
    <div>
      {/* Header */}
      <div className="flex items-start justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-2xl font-bold text-ink tracking-tight">{saludo}, {nombre} 👋</h1>
          <p className="text-sm text-slate-400 mt-1">{new Date().toLocaleDateString('es-ES',{weekday:'long',day:'numeric',month:'long'})}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-400 font-medium">Tiempo disponible:</span>
          <div className="flex bg-white border border-border rounded-full p-1 gap-1">
            {[1,2,3,4].map(h => (
              <button key={h} onClick={() => setHoras(h)}
                className={`px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all ${horas===h?'bg-ink text-white shadow':'text-slate-400 hover:text-ink'}`}>
                {h}h
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Coach IA */}
      <div className={`rounded-xl p-5 mb-6 border ${cs.bg} ${cs.border} flex items-start gap-4`}>
        <div className="w-10 h-10 bg-ink rounded-full flex items-center justify-center shrink-0">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M2 12h4l2-7 4 14 3-9 2 4h5" stroke="#00E5C7" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-mono text-[0.65rem] font-semibold uppercase tracking-widest text-slate-400">Coach IA</span>
            <span className="w-1.5 h-1.5 rounded-full bg-pulse animate-pulse-dot"/>
          </div>
          <p className={`text-sm font-medium leading-relaxed ${cs.text}`}>{cs.icon} {coachMsg}</p>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard label="Total hoy"        value={total}   change={`${horas}h disponibles`}            dark />
        <StatCard label="Repaso SM-2"       value={repaso}  change={`${pendientes} pendientes`} />
        {/* FIX 2: Muestra el número real basado en totalFalladas */}
        <StatCard label="Refuerzo errores"  value={errores} change={`${totalFalladas} preguntas falladas`} />
        <StatCard label="Preguntas nuevas"  value={nuevas}  change="temario nuevo" />
      </div>

      {/* Grid principal */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 mb-5">
        <div className="lg:col-span-2 flex flex-col gap-4">
          {[
            {
              icon:'🔁', title:'Repaso espaciado', desc:'Preguntas programadas por el algoritmo SM-2',
              count:repaso, color:'pulse', badge: pendientes > 0 ? `${pendientes} pendientes` : 'Al día ✓',
              link:'/app/examen?modo=repaso', btnLabel:'Empezar repaso →', btnVariant:'pulse',
              disabled: pendientes === 0,
            },
            {
              icon:'🎯', title:'Refuerzo de errores', desc:'Preguntas que has fallado más veces',
              // FIX 2: badge con el total real
              count:errores, color:'amber', badge:`${totalFalladas} preguntas falladas`,
              link:'/app/examen?modo=errores', btnLabel:'Practicar errores →', btnVariant:'amber',
              // FIX 3: Deshabilitado si no hay falladas reales
              disabled: totalFalladas === 0,
            },
            {
              icon:'✨', title:'Preguntas nuevas', desc: primeraSpec ? `Prioridad: ${primeraSpec.name}` : 'Todas las especialidades',
              count:nuevas, color:'sky', badge:'temario nuevo',
              // FIX 7: URL con id de especialidad
              link: examLinkNuevas,
              btnLabel: primeraSpec ? `Empezar con ${primeraSpec.name} →` : 'Empezar con nuevas preguntas →',
              btnVariant:'primary',
              disabled: false,
            },
          ].map(b => (
            <div key={b.title}
              className={`bg-white border border-border rounded-xl p-5 flex items-start gap-4 hover:shadow-md transition-all group ${b.disabled?'opacity-60':''}`}>
              <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-xl shrink-0 group-hover:scale-110 transition-transform ${
                b.color==='pulse'?'bg-pulse-bg border border-pulse-dim/20':
                b.color==='amber'?'bg-amber-50 border border-amber-200':
                'bg-sky-50 border border-sky-200'}`}>
                {b.icon}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
                  <div>
                    <h3 className="font-display font-bold text-base text-ink">{b.title}</h3>
                    <p className="text-xs text-slate-400">{b.desc}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className={`font-display font-bold text-2xl ${
                      b.color==='pulse'?'text-pulse-dim':b.color==='amber'?'text-amber-500':'text-sky-600'}`}>
                      {b.count}
                    </span>
                    <span className="text-xs text-slate-400">preguntas</span>
                  </div>
                </div>
                {!b.disabled ? (
                  <Link to={b.link}
                    className={`inline-flex items-center gap-2 mt-3 px-4 py-2 rounded-full text-xs font-bold hover:-translate-y-0.5 transition-all ${
                      b.btnVariant==='pulse'?'bg-pulse text-ink hover:brightness-110':
                      b.btnVariant==='amber'?'bg-amber-500 text-white hover:brightness-110':
                      'bg-ink text-white hover:shadow-lg'}`}>
                    {b.btnLabel}
                  </Link>
                ) : (
                  <span className="text-xs text-pulse-dim font-semibold mt-2 block">
                    {b.color === 'pulse' ? '✓ Sin repasos pendientes hoy' : '✓ Sin errores registrados aún'}
                  </span>
                )}
              </div>
            </div>
          ))}

          {/* Simulacro */}
          <div className="bg-ink rounded-xl p-5 flex items-center gap-4 relative overflow-hidden group">
            <div className="absolute inset-0 dot-pattern opacity-30 pointer-events-none"/>
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_300px_200px_at_80%_120%,rgba(0,229,199,.15),transparent)] pointer-events-none"/>
            <div className="w-12 h-12 bg-pulse/20 border border-pulse/30 rounded-xl flex items-center justify-center text-xl shrink-0 relative z-10 group-hover:scale-110 transition-transform">🎯</div>
            <div className="flex-1 relative z-10">
              <h3 className="font-display font-bold text-base text-white">Simulacro MIR</h3>
              <p className="text-xs text-white/60">210 preguntas · 3h55min · Puntuación oficial</p>
            </div>
            <Link to="/app/simulacro"
              className="shrink-0 relative z-10 px-4 py-2 bg-pulse text-ink rounded-full text-xs font-bold hover:brightness-110 transition-all">
              Hacer simulacro →
            </Link>
          </div>
        </div>

        {/* Panel derecho */}
        <div className="flex flex-col gap-5">
          {/* Estado MIR */}
          <div className={`rounded-xl p-5 border ${us.bg} ${us.border}`}>
            <div className={`font-mono text-[0.65rem] font-semibold uppercase tracking-widest mb-3 ${us.text}`}>{us.label}</div>
            {diasAlMir !== null ? (
              <>
                <div className={`font-display font-bold text-4xl mb-1 ${us.text}`}>{diasAlMir}</div>
                <div className="text-sm text-slate-500 mb-4">días para el MIR</div>
                <div className="flex flex-col gap-1.5 text-xs">
                  {[
                    { label:'Tasa actual',        val:`${tasa}%`,         ok: tasa >= 65 },
                    { label:'Racha',              val:`${racha} días 🔥`, ok: racha >= 3 },
                    { label:'Sesiones posibles',  val:`${diasAlMir} más`, ok: true },
                  ].map(s => (
                    <div key={s.label} className="flex items-center justify-between">
                      <span className="text-slate-500">{s.label}</span>
                      <span className={`font-mono font-semibold ${s.ok?us.text:'text-red-400'}`}>{s.val}</span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div>
                <p className="text-sm text-slate-500 mb-3">Configura tu fecha del MIR para ver la cuenta atrás.</p>
                {/* FIX 4: Ruta corregida a perfil, no a errores */}
                <Link to="/app/perfil" className={`text-xs font-semibold ${us.text} hover:underline`}>Configurar fecha →</Link>
              </div>
            )}
          </div>

          {/* Especialidades débiles */}
          <Card>
            <CardHeader title="Foco de hoy" subtitle="Especialidades más débiles" />
            {weakSpecs.length === 0 ? (
              <p className="text-xs text-slate-400 text-center py-4">Practica para ver recomendaciones</p>
            ) : (
              <div className="flex flex-col gap-2">
                {weakSpecs.map((spec, i) => (
                  // FIX 7: Link con spec.id en lugar del nombre
                  <Link key={spec.id} to={`/app/examen?especialidad=${spec.id}`}
                    className="flex items-center gap-3 p-3 rounded-lg border border-border hover:border-sky-300 hover:bg-sky-50 transition-all group/item">
                    <div className="w-6 h-6 rounded-full bg-ink flex items-center justify-center font-mono text-xs font-bold text-white shrink-0">{i+1}</div>
                    <span className="flex-1 text-sm font-medium text-ink">{spec.name}</span>
                    <span className="text-slate-300 group-hover/item:text-sky-500 transition-colors text-xs">→</span>
                  </Link>
                ))}
              </div>
            )}
          </Card>

          {/* Stats rápidas */}
          <Card>
            <CardHeader title="Tu progreso" />
            <div className="flex flex-col gap-3">
              {[
                { label:'Tasa de acierto', val:`${tasa}%`,        color: tasa>=65?'text-pulse-dim':tasa>=50?'text-amber-500':'text-red-400' },
                { label:'Racha actual',    val:`${racha} días`,   color: racha>=3?'text-amber-500':'text-slate-400' },
                { label:'Repasos hoy',     val: pendientes,       color: pendientes>0?'text-pulse-dim':'text-slate-300' },
              ].map(s => (
                <div key={s.label} className="flex items-center justify-between">
                  <span className="text-sm text-slate-500">{s.label}</span>
                  <span className={`font-mono font-bold text-sm ${s.color}`}>{s.val}</span>
                </div>
              ))}
              <div className="pt-2 border-t border-border">
                <div className="text-xs font-mono uppercase tracking-wider text-slate-400 mb-1.5">Corte MIR</div>
                <div className="h-2 bg-sky-100 rounded-full overflow-hidden relative">
                  <div className="h-full bg-gradient-to-r from-sky-500 to-pulse rounded-full transition-all duration-700" style={{width:`${Math.min(tasa,100)}%`}}/>
                  <div className="absolute top-0 bottom-0 border-l-2 border-dashed border-amber-400" style={{left:'65%'}}/>
                </div>
                <div className="flex justify-between text-[0.6rem] font-mono mt-1">
                  <span className={tasa>=65?'text-pulse-dim font-bold':'text-slate-400'}>{tasa}%</span>
                  <span className="text-amber-500">65% corte</span>
                </div>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}