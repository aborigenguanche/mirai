import { useState, useEffect } from 'react';
import { supabase, adminQuestionStats, reportError } from '../../lib/supabase';
import { useAuthStore, toast } from '../../store';
import { Card, CardHeader, Badge, Button, EmptyState, LoadingScreen } from '../../components/ui';

const REASONS = {
  wrong_answer: 'Respuesta incorrecta', unclear: 'Enunciado confuso', typo: 'Errata',
  outdated: 'Desactualizada', other: 'Otro',
};

export default function ModeracionPage() {
  const { profile } = useAuthStore();
  const [tab, setTab]         = useState('reportes');
  const [loading, setLoading] = useState(true);
  const [reports, setReports] = useState([]);
  const [stats, setStats]     = useState([]);
  const [open, setOpen]       = useState(null);     // { reportId | questionId, q }
  const [filter, setFilter]   = useState('open');

  useEffect(() => { load(); }, [filter]);

  async function load() {
    setLoading(true);
    try {
      const [r, st] = await Promise.all([
        supabase.from('question_reports')
          .select('*, question:questions(id, text, status, specialty_id), reporter:profiles!question_reports_user_id_fkey(email)')
          .eq('status', filter).order('created_at', { ascending: false }).limit(100),
        adminQuestionStats(20, 30),
      ]);
      if (r.error) throw r.error;
      setReports(r.data || []); setStats(st || []);
    } catch (e) { toast.error('No se pudo cargar la moderación'); reportError(e); }
    setLoading(false);
  }

  async function showQuestion(key, questionId) {
    if (open?.key === key) { setOpen(null); return; }
    const { data } = await supabase.rpc('admin_get_question', { p_id: questionId });
    if (data) setOpen({ key, q: { ...data, options: [...(data.options || [])].sort((a, b) => a.letter.localeCompare(b.letter)) } });
  }

  async function resolve(id, status) {
    const { error } = await supabase.from('question_reports')
      .update({ status, resolved_by: profile.id, resolved_at: new Date().toISOString() }).eq('id', id);
    if (error) return toast.error('No se pudo actualizar el reporte');
    toast.success(status === 'resolved' ? 'Reporte resuelto' : 'Reporte descartado');
    load();
  }
  async function setStatus(questionId, status) {
    const { error } = await supabase.from('questions')
      .update({ status, reviewed_by: profile.id, reviewed_at: new Date().toISOString() }).eq('id', questionId);
    if (error) return toast.error('No se pudo cambiar el estado');
    toast.success(status === 'draft' ? 'Pregunta despublicada' : 'Pregunta publicada');
    setOpen(null); load();
  }

  function QuestionDetail({ q }) {
    return (
      <div className="bg-surface border border-border rounded-lg p-4 mt-3">
        <p className="text-sm font-semibold text-ink mb-3">{q.text}</p>
        <div className="flex flex-col gap-1.5 mb-3">
          {q.options.map(o => (
            <div key={o.letter} className={`text-xs px-3 py-2 rounded-md border ${o.letter === q.correct_option_letter ? 'border-pulse-dim bg-pulse-bg font-semibold' : 'border-border bg-white'}`}>
              <span className="font-mono font-bold mr-2">{o.letter.toUpperCase()}</span>{o.text}
            </div>
          ))}
        </div>
        <p className="text-xs text-slate-500 mb-3"><strong>Explicación:</strong> {q.explanation || '—'}</p>
        <div className="flex items-center gap-2">
          <Badge variant={q.status === 'published' ? 'pulse' : 'amber'}>{q.status}</Badge>
          {q.status === 'published'
            ? <Button size="sm" variant="danger" onClick={() => setStatus(q.id, 'draft')}>Despublicar</Button>
            : <Button size="sm" onClick={() => setStatus(q.id, 'published')}>Publicar</Button>}
        </div>
      </div>
    );
  }

  if (loading) return <LoadingScreen message="Cargando moderación..." />;

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-display text-2xl font-bold text-ink tracking-tight">Moderación de contenido</h1>
        <p className="text-sm text-slate-400 mt-1">Reportes de usuarios y preguntas con peor rendimiento</p>
      </div>
      <div className="flex bg-white border border-border rounded-full p-1 gap-1 mb-5 w-fit">
        {[['reportes', 'Reportes'], ['calidad', 'Calidad de preguntas']].map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`px-4 py-1.5 rounded-full text-xs font-semibold transition-all ${tab === k ? 'bg-ink text-white shadow' : 'text-slate-400 hover:text-ink'}`}>{l}</button>
        ))}
      </div>

      {tab === 'reportes' && (
        <Card padding={false}>
          <div className="p-5 border-b border-border flex items-center justify-between">
            <CardHeader title="Reportes de usuarios" subtitle={`${reports.length} ${filter === 'open' ? 'pendientes' : filter === 'resolved' ? 'resueltos' : 'descartados'}`} />
            <select value={filter} onChange={e => setFilter(e.target.value)} className="px-3 py-1.5 border border-border rounded-md text-xs bg-white">
              <option value="open">Pendientes</option><option value="resolved">Resueltos</option><option value="dismissed">Descartados</option>
            </select>
          </div>
          {reports.length === 0 ? <EmptyState icon="✅" title="Sin reportes en esta lista" /> : (
            <div className="divide-y divide-border">
              {reports.map(r => (
                <div key={r.id} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <Badge variant="amber">{REASONS[r.reason] || r.reason}</Badge>
                        {r.question?.status !== 'published' && <Badge variant="gray">{r.question?.status}</Badge>}
                        <span className="text-[0.65rem] text-slate-400 font-mono">{r.reporter?.email} · {new Date(r.created_at).toLocaleDateString('es-ES')}</span>
                      </div>
                      <p className="text-sm text-ink line-clamp-2">{r.question?.text}</p>
                      {r.comment && <p className="text-xs text-slate-500 italic mt-1">“{r.comment}”</p>}
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <button onClick={() => showQuestion(r.id, r.question_id)} className="text-xs font-semibold text-sky-600 hover:underline">{open?.key === r.id ? 'Cerrar' : 'Ver'}</button>
                      {filter === 'open' && <>
                        <button onClick={() => resolve(r.id, 'resolved')} className="text-xs font-semibold text-pulse-dim hover:underline">Resuelto</button>
                        <button onClick={() => resolve(r.id, 'dismissed')} className="text-xs text-slate-400 hover:underline">Descartar</button>
                      </>}
                    </div>
                  </div>
                  {open?.key === r.id && <QuestionDetail q={open.q} />}
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {tab === 'calidad' && (
        <Card padding={false}>
          <div className="p-5 border-b border-border">
            <CardHeader title="Preguntas con menor tasa de acierto" subtitle="Mínimo 20 intentos. Un % muy bajo suele indicar un error en la pregunta o en la solución." />
          </div>
          {stats.length === 0 ? <EmptyState icon="📊" title="Aún no hay preguntas con suficientes intentos" /> : (
            <div className="divide-y divide-border">
              {stats.map(s => (
                <div key={s.id} className="p-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm text-ink line-clamp-2 min-w-0">{s.text}</p>
                    <div className="text-right shrink-0">
                      <div className={`font-display font-bold text-lg ${s.accuracy < 15 ? 'text-red-500' : s.accuracy < 35 ? 'text-amber-500' : 'text-ink'}`}>{s.accuracy}%</div>
                      <div className="text-[0.65rem] text-slate-400 font-mono">{s.attempts} intentos</div>
                    </div>
                    <button onClick={() => showQuestion('q' + s.id, s.id)} className="text-xs font-semibold text-sky-600 hover:underline shrink-0">{open?.key === 'q' + s.id ? 'Cerrar' : 'Revisar'}</button>
                  </div>
                  {open?.key === 'q' + s.id && <QuestionDetail q={open.q} />}
                </div>
              ))}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
