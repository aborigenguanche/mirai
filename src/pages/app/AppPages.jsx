// ═══════════════════════════════════════════════════════════
// ErroresPage
// ═══════════════════════════════════════════════════════════
import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { supabase, getMostFailed, countRepasoPendiente } from '../../lib/supabase';
import { useAuthStore } from '../../store';
import { classifyError } from '../../lib/mir-scoring';
import { Card, CardHeader, Badge, EmptyState, LoadingScreen, Tabs } from '../../components/ui';

const TIPO = {
  conceptual: { label:'Error conceptual', icon:'🧠', bg:'bg-red-50', border:'border-red-200', text:'text-red-600', bar:'bg-red-400',
    desc:'No tienes claro el concepto. Estudia el tema antes de seguir practicando.',
    consejo:'Lee el capítulo correspondiente antes de tu próxima sesión.' },
  confusion:  { label:'Error por confusión', icon:'🔀', bg:'bg-amber-50', border:'border-amber-200', text:'text-amber-600', bar:'bg-amber-400',
    desc:'Confundes opciones similares. Conoces el tema pero mezclas detalles.',
    consejo:'Descarta activamente cada opción incorrecta antes de marcar la tuya.' },
  careless:   { label:'Error por descuido', icon:'⚡', bg:'bg-sky-50', border:'border-sky-200', text:'text-sky-600', bar:'bg-sky-400',
    desc:'Vas demasiado rápido. Sabes la respuesta pero te precipitas.',
    consejo:'Lee el enunciado completo antes de mirar las opciones.' },
};

export function ErroresPage() {
  const { profile } = useAuthStore();
  const [loading, setLoading]     = useState(true);
  const [falladas, setFalladas]   = useState([]);
  const [errStats, setErrStats]   = useState({ conceptual:0, confusion:0, careless:0, total:0 });
  const [pendientes, setPendientes] = useState(0);
  const [tab, setTab]             = useState('resumen');
  const [expanded, setExpanded]   = useState(null);
  const [fechaMir, setFechaMir]   = useState(profile.fecha_mir || '');
  const [saving, setSaving]       = useState(false);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    const [failed, pend, errResp] = await Promise.all([
      getMostFailed(profile.id, 50),
      countRepasoPendiente(profile.id),
      supabase.from('exam_responses').select('is_correct,time_taken_seconds,question:questions(correct_option_letter)')
        .eq('user_id', profile.id).eq('is_correct', false),
    ]);

    const ers = errResp.data || [];
    let c=0, cf=0, ca=0;
    ers.forEach(r => {
      const t = r.time_taken_seconds||0;
      if      (t < 10) ca++;
      else if (t < 30) cf++; // simplificado sin letra
      else             c++;
    });

    setFalladas(failed);
    setPendientes(pend);
    setErrStats({ conceptual:c, confusion:cf, careless:ca, total:ers.length });
    setLoading(false);
  }

  async function saveFechaMir() {
    setSaving(true);
    await supabase.from('profiles').update({ fecha_mir: fechaMir||null }).eq('id', profile.id);
    setSaving(false);
  }

  if (loading) return <LoadingScreen message="Analizando errores..." />;

  const diasAlMir = fechaMir ? Math.max(0,Math.ceil((new Date(fechaMir)-new Date())/86400000)) : null;
  const tipoMas = Object.entries({conceptual:errStats.conceptual,confusion:errStats.confusion,careless:errStats.careless})
    .sort((a,b)=>b[1]-a[1])[0]?.[0];

  return (
    <div>
      <div className="flex items-start justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-2xl font-bold text-ink tracking-tight">Análisis de errores</h1>
          <p className="text-sm text-slate-400 mt-1">El Coach IA clasifica tus patrones de error</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {pendientes > 0 && (
            <Link to="/app/examen?modo=repaso"
              className="inline-flex items-center gap-2 px-4 py-2 bg-pulse text-ink rounded-full text-sm font-bold hover:-translate-y-0.5 transition-all">
              🔁 {pendientes} pendientes
            </Link>
          )}
          <Link to="/app/examen?modo=errores"
            className="inline-flex items-center gap-2 px-4 py-2 bg-ink text-white rounded-full text-sm font-semibold hover:-translate-y-0.5 transition-all">
            Practicar errores →
          </Link>
        </div>
      </div>

      {/* Cuenta atrás MIR */}
      <div className={`rounded-xl p-5 mb-6 bg-ink border border-ink relative overflow-hidden`}>
        <div className="absolute inset-0 dot-pattern opacity-30 pointer-events-none"/>
        <div className="relative z-10 flex items-center justify-between gap-4 flex-wrap">
          <div>
            <div className="font-mono text-[0.65rem] font-semibold uppercase tracking-widest text-white/40 mb-1">Cuenta atrás MIR</div>
            {diasAlMir !== null
              ? <div className="flex items-baseline gap-3">
                  <span className={`font-display font-bold text-4xl ${diasAlMir<30?'text-red-400':diasAlMir<90?'text-amber-400':'text-pulse'}`}>{diasAlMir}</span>
                  <span className="text-white/60 text-sm">días restantes</span>
                </div>
              : <div className="text-white/60 text-sm">Configura la fecha del MIR</div>
            }
          </div>
          <div className="flex items-center gap-2">
            <input type="date" value={fechaMir} onChange={e=>setFechaMir(e.target.value)}
              className="px-3 py-2 rounded-lg border border-white/20 bg-white/10 text-white text-sm outline-none focus:border-pulse/60"/>
            <button onClick={saveFechaMir} disabled={saving}
              className="px-4 py-2 bg-pulse text-ink rounded-lg text-sm font-bold hover:brightness-110 transition-all disabled:opacity-50">
              {saving?'...':'Guardar'}
            </button>
          </div>
        </div>
      </div>

      {errStats.total === 0 ? (
        <EmptyState icon="🎯" title="Sin errores registrados todavía"
          subtitle="Completa sesiones de práctica para que el Coach IA analice tus patrones de error."
          action={<Link to="/app/examen" className="inline-flex items-center gap-2 px-5 py-2.5 bg-ink text-white rounded-full text-sm font-bold">Empezar a practicar →</Link>}
        />
      ) : (
        <>
          {tipoMas && (
            <div className={`rounded-xl p-5 mb-6 border ${TIPO[tipoMas].bg} ${TIPO[tipoMas].border} flex items-start gap-4`}>
              <span className="text-3xl shrink-0">{TIPO[tipoMas].icon}</span>
              <div>
                <div className="font-mono text-[0.65rem] font-semibold uppercase tracking-widest text-slate-400 mb-1">Coach IA · Diagnóstico</div>
                <h3 className={`font-display font-bold text-base mb-1 ${TIPO[tipoMas].text}`}>Tu error más frecuente: {TIPO[tipoMas].label}</h3>
                <p className="text-sm text-slate-600 mb-2">{TIPO[tipoMas].desc}</p>
                <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold border ${TIPO[tipoMas].bg} ${TIPO[tipoMas].text} ${TIPO[tipoMas].border}`}>
                  💡 {TIPO[tipoMas].consejo}
                </div>
              </div>
            </div>
          )}

          <Tabs tabs={[{key:'resumen',label:'Resumen'},{key:'tipos',label:'Por tipo'},{key:'preguntas',label:'Preguntas falladas'},{key:'repaso',label:'Plan repaso'}]} active={tab} onChange={setTab} />
          <div className="mt-5">
            {tab === 'resumen' && (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
                <div className="lg:col-span-2">
                  <Card>
                    <CardHeader title="Distribución de errores" subtitle={`${errStats.total} errores analizados`} />
                    <div className="flex flex-col gap-5">
                      {Object.entries(TIPO).map(([tipo, info]) => {
                        const n = errStats[tipo]||0;
                        const pct = errStats.total ? Math.round((n/errStats.total)*100) : 0;
                        return (
                          <div key={tipo}>
                            <div className="flex items-center justify-between mb-2">
                              <div className="flex items-center gap-2.5">
                                <span className="text-lg">{info.icon}</span>
                                <div>
                                  <div className={`text-sm font-semibold ${info.text}`}>{info.label}</div>
                                  <div className="text-xs text-slate-400">{info.desc.split('.')[0]}.</div>
                                </div>
                              </div>
                              <div className="text-right shrink-0">
                                <div className={`font-display font-bold text-xl ${info.text}`}>{n}</div>
                                <div className="text-xs text-slate-400">{pct}%</div>
                              </div>
                            </div>
                            <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
                              <div className={`h-full ${info.bar} rounded-full transition-all duration-700`} style={{width:`${pct}%`}}/>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </Card>
                </div>
                <div>
                  <Card>
                    <CardHeader title="Repaso pendiente" />
                    <div className="text-center py-6">
                      <div className={`font-display font-bold text-5xl mb-2 ${pendientes>0?'text-pulse-dim':'text-slate-300'}`}>{pendientes}</div>
                      <div className="text-sm text-slate-400 mb-4">{pendientes===0?'Al día ✓':`pregunta${pendientes!==1?'s':''} pendiente${pendientes!==1?'s':''}`}</div>
                      {pendientes > 0 && (
                        <Link to="/app/examen?modo=repaso"
                          className="inline-flex items-center gap-2 px-5 py-2 bg-pulse text-ink rounded-full text-sm font-bold hover:brightness-110 transition-all">
                          🔁 Repasar ahora
                        </Link>
                      )}
                    </div>
                  </Card>
                </div>
              </div>
            )}

            {tab === 'tipos' && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                {Object.entries(TIPO).map(([tipo, info]) => (
                  <div key={tipo} className={`rounded-xl border p-5 ${info.bg} ${info.border}`}>
                    <div className="flex items-center gap-3 mb-4">
                      <span className="text-3xl">{info.icon}</span>
                      <div>
                        <div className={`font-display font-bold text-base ${info.text}`}>{info.label}</div>
                        <div className="font-mono text-xs text-slate-400">{errStats[tipo]||0} errores</div>
                      </div>
                    </div>
                    <p className="text-xs text-slate-600 leading-relaxed mb-3">{info.desc}</p>
                    <div className={`text-xs font-semibold px-3 py-2 rounded-lg border ${info.border} ${info.text}`}>💡 {info.consejo}</div>
                  </div>
                ))}
              </div>
            )}

            {tab === 'preguntas' && (
              <Card padding={false}>
                <div className="p-5 border-b border-border flex items-center justify-between">
                  <h3 className="font-display font-bold text-base text-ink">Preguntas más falladas ({falladas.length})</h3>
                  <Link to="/app/examen?modo=errores" className="text-xs font-semibold text-sky-600 hover:text-sky-700">Practicar todas →</Link>
                </div>
                {falladas.length === 0
                  ? <EmptyState icon="🎯" title="Sin preguntas falladas" />
                  : (
                    <div className="divide-y divide-border">
                      {falladas.map(item => {
                        const q = item.question;
                        if (!q) return null;
                        const isOpen = expanded === item.question_id;
                        const tasaAc = item.times_correct+item.times_wrong > 0
                          ? Math.round((item.times_correct/(item.times_correct+item.times_wrong))*100) : 0;
                        return (
                          <div key={item.question_id}>
                            <button onClick={() => setExpanded(isOpen?null:item.question_id)}
                              className="w-full text-left p-4 hover:bg-sky-50 transition-colors flex items-start gap-4 group">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-1 flex-wrap">
                                  {q.specialty && <Badge variant="blue">{q.specialty.name}</Badge>}
                                  {item.last_error_type && (
                                    <span className={`text-[0.65rem] font-semibold px-2 py-0.5 rounded-full border ${TIPO[item.last_error_type]?.bg} ${TIPO[item.last_error_type]?.text} ${TIPO[item.last_error_type]?.border}`}>
                                      {TIPO[item.last_error_type]?.icon} {TIPO[item.last_error_type]?.label}
                                    </span>
                                  )}
                                </div>
                                <p className="text-sm text-ink font-medium line-clamp-2">{q.text}</p>
                              </div>
                              <div className="shrink-0 text-right">
                                <div className="font-display font-bold text-lg text-red-400">{item.times_wrong}✕</div>
                                <div className={`text-xs font-mono font-semibold ${tasaAc>=65?'text-pulse-dim':tasaAc>=50?'text-amber-500':'text-red-400'}`}>{tasaAc}%</div>
                                <div className="text-[0.6rem] text-slate-400 mt-0.5">{isOpen?'▲':'▼'}</div>
                              </div>
                            </button>
                            {isOpen && (
                              <div className="px-4 pb-4 animate-[slideDown_.2s_ease]">
                                <div className="bg-surface border border-border rounded-lg p-4">
                                  <p className="text-sm font-semibold text-ink mb-3">{q.text}</p>
                                  <div className="flex flex-col gap-1.5 mb-4">
                                    {q.options?.map(opt => (
                                      <div key={opt.letter}
                                        className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs border ${opt.letter===q.correct_option_letter?'border-pulse-dim bg-pulse-bg font-semibold text-emerald-800':'border-border text-slate-500'}`}>
                                        <span className={`w-5 h-5 rounded-full flex items-center justify-center font-mono font-bold text-[0.65rem] shrink-0 ${opt.letter===q.correct_option_letter?'bg-pulse-dim text-white':'bg-surface border border-border text-slate-400'}`}>
                                          {opt.letter.toUpperCase()}
                                        </span>
                                        {opt.text}
                                        {opt.letter===q.correct_option_letter && <span className="ml-auto text-pulse-dim">✓</span>}
                                      </div>
                                    ))}
                                  </div>
                                  {q.explanation && (
                                    <div className="bg-white border-l-4 border-pulse-dim rounded-r-lg p-3">
                                      <div className="font-mono text-[0.65rem] font-bold text-pulse-dim uppercase tracking-wider mb-1">Explicación</div>
                                      <p className="text-xs text-slate-600 leading-relaxed">{q.explanation}</p>
                                    </div>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )
                }
              </Card>
            )}

            {tab === 'repaso' && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                <Card>
                  <CardHeader title="Cómo funciona el repaso inteligente" />
                  <div className="flex flex-col gap-4">
                    {[
                      ['🎯','Responde preguntas','El algoritmo SM-2 registra si aciertas y cuánto tardas.'],
                      ['🧮','Calcula el intervalo','Las que fallas vuelven mañana. Las que dominas, en días o semanas.'],
                      ['📅','Programa el repaso','Cada día verás cuántas preguntas necesitas repasar.'],
                      ['📈','Mejora la retención','Con repetición espaciada retienes el 90% con la mitad del tiempo.'],
                    ].map(([icon,title,desc]) => (
                      <div key={title} className="flex items-start gap-3">
                        <span className="text-xl shrink-0">{icon}</span>
                        <div><div className="text-sm font-semibold text-ink">{title}</div><div className="text-xs text-slate-400 mt-0.5 leading-relaxed">{desc}</div></div>
                      </div>
                    ))}
                  </div>
                </Card>
                {diasAlMir !== null && (
                  <Card>
                    <CardHeader title="Proyección hasta el MIR" subtitle={`${diasAlMir} días restantes`} />
                    <div className="grid grid-cols-2 gap-3">
                      {[
                        { label:'Sesiones posibles', val:diasAlMir, desc:'1 sesión/día' },
                        { label:'Preguntas posibles', val:(diasAlMir*20).toLocaleString('es-ES'), desc:'20 preguntas/sesión' },
                        { label:'Ritmo recomendado', val:diasAlMir<60?'30/día':'20/día', desc:'para cubrir el temario' },
                        { label:'Errores acumulados', val:errStats.total, desc:errStats.total>50?'⚠️ Muchos':'✓ Controlados' },
                      ].map(s => (
                        <div key={s.label} className="bg-surface border border-border rounded-lg p-4 text-center">
                          <div className="font-display font-bold text-xl text-ink mb-1">{s.val}</div>
                          <div className="text-xs font-semibold text-ink mb-0.5">{s.label}</div>
                          <div className="text-[0.65rem] text-slate-400">{s.desc}</div>
                        </div>
                      ))}
                    </div>
                  </Card>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// RankingPage
// ═══════════════════════════════════════════════════════════
import { getWeeklyRanking, getUserRank } from '../../lib/supabase';

export function RankingPage() {
  const { profile } = useAuthStore();
  const [loading, setLoading]   = useState(true);
  const [ranking, setRanking]   = useState([]);
  const [myRank, setMyRank]     = useState(null);
  const [myPos, setMyPos]       = useState(null);

  useEffect(() => { load(); }, []);
  async function load() {
    setLoading(true);
    const [rank, mine] = await Promise.all([getWeeklyRanking(50), getUserRank(profile.id)]);
    setRanking(rank);
    setMyRank(mine);
    const pos = rank.findIndex(r => r.user_id === profile.id);
    setMyPos(pos >= 0 ? pos + 1 : null);
    setLoading(false);
  }

  if (loading) return <LoadingScreen message="Cargando ranking..." />;

  const weekLabel = new Date().toLocaleDateString('es-ES',{day:'numeric',month:'long'});

  return (
    <div>
      <div className="flex items-start justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-2xl font-bold text-ink tracking-tight">Ranking semanal</h1>
          <p className="text-sm text-slate-400 mt-1">Semana del {weekLabel} · Se resetea cada lunes</p>
        </div>
        <Link to="/app/examen" className="inline-flex items-center gap-2 px-4 py-2 bg-ink text-white rounded-full text-sm font-semibold hover:-translate-y-0.5 transition-all">
          Practicar ahora →
        </Link>
      </div>

      {/* Tu posición */}
      {myRank && (
        <div className="bg-ink rounded-xl p-5 mb-6 relative overflow-hidden">
          <div className="absolute inset-0 dot-pattern opacity-30 pointer-events-none"/>
          <div className="relative z-10 flex items-center justify-between flex-wrap gap-4">
            <div>
              <div className="font-mono text-[0.65rem] font-semibold uppercase tracking-widest text-white/40 mb-1">Tu posición esta semana</div>
              <div className="flex items-baseline gap-3">
                <span className="font-display font-bold text-4xl text-pulse">#{myPos || '—'}</span>
                <span className="text-white/60 text-sm">de {ranking.length} estudiantes</span>
              </div>
            </div>
            <div className="flex gap-6">
              {[
                { label:'Preguntas', val:myRank.questions },
                { label:'Correctas',  val:myRank.correct },
                { label:'Score MIR',  val:Math.round(myRank.score||0) },
                { label:'Percentil',  val:`${myRank.percentile||0}%` },
              ].map(s => (
                <div key={s.label} className="text-center">
                  <div className="font-display font-bold text-xl text-pulse">{s.val}</div>
                  <div className="text-xs text-white/40">{s.label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {ranking.length === 0 ? (
        <EmptyState icon="🏆" title="Sin datos esta semana"
          subtitle="El ranking se actualiza en tiempo real. Practica para aparecer en la tabla."
          action={<Link to="/app/examen" className="inline-flex items-center gap-2 px-5 py-2.5 bg-ink text-white rounded-full text-sm font-bold">Practicar ahora →</Link>}
        />
      ) : (
        <Card padding={false}>
          <div className="p-5 border-b border-border">
            <h3 className="font-display font-bold text-base text-ink">Top estudiantes · Esta semana</h3>
            <p className="text-xs text-slate-400 mt-0.5">El ranking es anónimo — solo se muestra la posición</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-surface">
                  {['Posición','Preguntas','Correctas','Score MIR','Percentil'].map(h => (
                    <th key={h} className="text-left px-5 py-3 font-mono text-[0.65rem] font-semibold uppercase tracking-wider text-slate-400">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ranking.map((r, i) => {
                  const isMe = r.user_id === profile.id;
                  const medal = i===0?'🥇':i===1?'🥈':i===2?'🥉':null;
                  return (
                    <tr key={r.user_id} className={`border-t border-border transition-colors ${isMe?'bg-pulse-bg hover:bg-pulse-bg':'hover:bg-sky-50'}`}>
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-2">
                          {medal ? <span className="text-lg">{medal}</span> : <span className="font-mono font-bold text-slate-400 w-6 text-center">#{i+1}</span>}
                          {isMe && <span className="text-xs font-semibold text-pulse-dim bg-pulse-bg border border-pulse-dim/20 px-2 py-0.5 rounded-full">Tú</span>}
                        </div>
                      </td>
                      <td className="px-5 py-3.5 font-mono font-semibold text-sm text-ink">{r.questions}</td>
                      <td className="px-5 py-3.5 font-mono font-semibold text-sm text-pulse-dim">{r.correct}</td>
                      <td className="px-5 py-3.5 font-mono font-bold text-sm text-ink">{Math.round(r.score||0)}</td>
                      <td className="px-5 py-3.5">
                        <span className={`font-mono text-sm font-bold ${(r.percentile||0)>=65?'text-pulse-dim':(r.percentile||0)>=50?'text-amber-500':'text-red-400'}`}>
                          {r.percentile||0}%
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// NotasPage
// ═══════════════════════════════════════════════════════════
import { getUserNotes, upsertNote, supabase as sb } from '../../lib/supabase';

export function NotasPage() {
  const { profile } = useAuthStore();
  const [loading, setLoading] = useState(true);
  const [notas, setNotas]     = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [editContent, setEditContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');

  useEffect(() => { load(); }, []);
  async function load() {
    setLoading(true);
    const n = await getUserNotes(profile.id);
    setNotas(n);
    setLoading(false);
  }

  async function handleSave(userId, questionId) {
    setSaving(true);
    await upsertNote(userId, questionId, editContent);
    setSaving(false);
    setEditingId(null);
    load();
  }

  async function handleDelete(userId, questionId) {
    if (!confirm('¿Eliminar esta nota?')) return;
    await sb.from('notes').delete().eq('user_id', userId).eq('question_id', questionId);
    load();
  }

  const filtered = notas.filter(n =>
    !search || n.content?.toLowerCase().includes(search.toLowerCase()) ||
    n.question?.text?.toLowerCase().includes(search.toLowerCase())
  );

  if (loading) return <LoadingScreen message="Cargando notas..." />;

  return (
    <div>
      <div className="flex items-start justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-2xl font-bold text-ink tracking-tight">Mis notas</h1>
          <p className="text-sm text-slate-400 mt-1">{notas.length} notas personales · se muestran en cada pregunta</p>
        </div>
      </div>

      {notas.length === 0 ? (
        <EmptyState icon="📓" title="Sin notas todavía"
          subtitle="Añade notas personales en cualquier pregunta durante la práctica. Aparecerán aquí y en la pregunta cada vez que la veas."
          action={<Link to="/app/examen" className="inline-flex items-center gap-2 px-5 py-2.5 bg-ink text-white rounded-full text-sm font-bold">Practicar y añadir notas →</Link>}
        />
      ) : (
        <>
          <div className="mb-5">
            <input type="text" placeholder="Buscar en notas..." value={search} onChange={e=>setSearch(e.target.value)}
              className="w-full max-w-md px-4 py-2.5 border border-border rounded-full text-sm outline-none focus:border-sky-400 focus:shadow-[0_0_0_3px_rgba(14,165,233,.1)] transition-all"/>
          </div>
          <div className="flex flex-col gap-4">
            {filtered.map(n => (
              <Card key={`${n.user_id}-${n.question_id}`} hover>
                <div className="flex items-start gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-xs font-mono text-slate-400">{new Date(n.updated_at).toLocaleDateString('es-ES',{day:'2-digit',month:'short',year:'numeric'})}</span>
                      {n.question?.specialty && <Badge variant="blue">{n.question.specialty.name}</Badge>}
                    </div>
                    <p className="text-sm text-slate-500 line-clamp-2 mb-2">{n.question?.text}</p>
                    {editingId === `${n.user_id}-${n.question_id}` ? (
                      <div>
                        <textarea value={editContent} onChange={e=>setEditContent(e.target.value)} rows={3}
                          className="w-full px-3 py-2 border border-amber-300 rounded-lg text-sm bg-amber-50 outline-none focus:border-amber-400 resize-none"/>
                        <div className="flex gap-2 mt-2">
                          <button onClick={() => handleSave(n.user_id, n.question_id)} disabled={saving}
                            className="text-xs font-semibold text-pulse-dim hover:text-pulse transition-colors">
                            {saving?'Guardando...':'✓ Guardar'}
                          </button>
                          <button onClick={() => setEditingId(null)} className="text-xs text-slate-400 hover:text-red-500 transition-colors">Cancelar</button>
                        </div>
                      </div>
                    ) : (
                      <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-sm text-amber-900">{n.content}</div>
                    )}
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <button onClick={() => { setEditingId(`${n.user_id}-${n.question_id}`); setEditContent(n.content); }}
                      className="w-8 h-8 flex items-center justify-center border border-border rounded-md hover:border-sky-300 hover:bg-sky-50 text-slate-400 hover:text-sky-600 transition-all text-sm">✏️</button>
                    <button onClick={() => handleDelete(n.user_id, n.question_id)}
                      className="w-8 h-8 flex items-center justify-center border border-border rounded-md hover:border-red-200 hover:bg-red-50 text-slate-400 hover:text-red-500 transition-all text-sm">🗑</button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// NotifPage
// ═══════════════════════════════════════════════════════════
import { getNotifications, markRead } from '../../lib/supabase';
import { useNotifStore } from '../../store';

export function NotifPage() {
  const { profile }  = useAuthStore();
  const notifStore   = useNotifStore();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getNotifications(profile.id).then(ns => {
      notifStore.set(ns);
      setLoading(false);
    });
  }, []);

  async function handleRead(id) {
    await markRead(id);
    notifStore.markRead(id);
  }

  if (loading) return <LoadingScreen message="Cargando notificaciones..." />;

  const { notifications } = notifStore;

  const TYPE_STYLE = {
    trial_ending:  { icon:'⏳', bg:'bg-amber-50', border:'border-amber-200', text:'text-amber-700' },
    new_questions: { icon:'✨', bg:'bg-sky-50',   border:'border-sky-200',   text:'text-sky-700' },
    motivation:    { icon:'🔥', bg:'bg-pulse-bg', border:'border-pulse-dim/30', text:'text-pulse-dim' },
    streak:        { icon:'🏆', bg:'bg-emerald-50', border:'border-emerald-200', text:'text-emerald-700' },
  };

  return (
    <div>
      <div className="flex items-start justify-between mb-6 gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-ink tracking-tight">Notificaciones</h1>
          <p className="text-sm text-slate-400 mt-1">{notifStore.unread} sin leer</p>
        </div>
        {notifStore.unread > 0 && (
          <button onClick={() => notifications.forEach(n => { if(!n.read) handleRead(n.id); })}
            className="text-xs font-semibold text-sky-600 hover:text-sky-700 transition-colors">
            Marcar todas como leídas
          </button>
        )}
      </div>

      {notifications.length === 0 ? (
        <EmptyState icon="🔔" title="Sin notificaciones" subtitle="Aquí aparecerán los mensajes del equipo MIRai sobre tu progreso, nuevas preguntas y más." />
      ) : (
        <div className="flex flex-col gap-3">
          {notifications.map(n => {
            const s = TYPE_STYLE[n.type] || { icon:'📢', bg:'bg-surface', border:'border-border', text:'text-slate-600' };
            return (
              <div key={n.id} onClick={() => !n.read && handleRead(n.id)}
                className={`flex items-start gap-4 p-4 rounded-xl border transition-all ${s.bg} ${s.border} ${!n.read?'cursor-pointer hover:shadow-sm':''} ${n.read?'opacity-60':''}`}>
                <span className="text-2xl shrink-0">{s.icon}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-1 gap-2">
                    <h3 className={`font-display font-bold text-sm ${s.text}`}>{n.title}</h3>
                    {!n.read && <span className="w-2 h-2 rounded-full bg-pulse shrink-0"/>}
                  </div>
                  <p className="text-sm text-slate-600 leading-relaxed">{n.body}</p>
                  <span className="text-xs text-slate-400 mt-1 block font-mono">
                    {new Date(n.sent_at).toLocaleDateString('es-ES',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'})}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Re-exports para App.jsx
export default ErroresPage;
