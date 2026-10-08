import { useState, useEffect } from 'react';
import { supabase, sendNotification } from '../../lib/supabase';
import { toast } from '../../store';
import { Badge, EmptyState, LoadingScreen, Modal, Button, FormGroup, Input, Select, Pagination, Card, CardHeader } from '../../components/ui';

export function NotificacionesPage() {
  const [profiles, setProfiles] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [sending, setSending]   = useState(false);
  const [sent, setSent]         = useState(false);
  const [form, setForm]         = useState({ title:'', body:'', type:'motivation', target:'all' });
  const [errors, setErrors]     = useState({});
  const [recent, setRecent]     = useState([]);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    const [{ data: ps }, { data: ns }] = await Promise.all([
      supabase.from('profiles').select('id, email, full_name, subscription_status, role'),
      supabase.from('notifications').select('*, profile:profiles(email,full_name)').order('sent_at',{ascending:false}).limit(20),
    ]);
    setProfiles(ps||[]);
    setRecent(ns||[]);
    setLoading(false);
  }

  function validate() {
    const e = {};
    if (!form.title.trim()) e.title = 'El título es obligatorio';
    if (!form.body.trim())  e.body  = 'El mensaje es obligatorio';
    return e;
  }

  async function handleSend() {
    const e = validate();
    if (Object.keys(e).length) { setErrors(e); return; }
    setSending(true);
    let userIds = [];
    if (form.target === 'all') userIds = [];
    else if (form.target === 'trial')   userIds = profiles.filter(p=>p.subscription_status==='trial').map(p=>p.id);
    else if (form.target === 'active')  userIds = profiles.filter(p=>p.subscription_status==='active').map(p=>p.id);
    else if (form.target === 'expired') userIds = profiles.filter(p=>p.subscription_status==='expired').map(p=>p.id);
    await sendNotification({ userIds, title:form.title, body:form.body, type:form.type });
    setSending(false); setSent(true);
    toast.success(`Notificación enviada a ${userIds.length===0?'todos los usuarios':userIds.length+' usuarios'}`);
    setForm({ title:'', body:'', type:'motivation', target:'all' });
    setTimeout(() => setSent(false), 3000);
    load();
  }

  const TARGET_COUNTS = {
    all:     profiles.length,
    trial:   profiles.filter(p=>p.subscription_status==='trial').length,
    active:  profiles.filter(p=>p.subscription_status==='active').length,
    expired: profiles.filter(p=>p.subscription_status==='expired').length,
  };

  if (loading) return <LoadingScreen message="Cargando..." />;

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-display text-2xl font-bold text-ink tracking-tight">Notificaciones</h1>
        <p className="text-sm text-slate-400 mt-1">Envía mensajes segmentados a tus usuarios</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Card>
          <CardHeader title="Nueva notificación" subtitle="Se entregará en tiempo real en la app" />
          <FormGroup label="Título" required error={errors.title}>
            <Input value={form.title} onChange={e=>setForm(p=>({...p,title:e.target.value}))} placeholder="Ej: ¡Nuevas preguntas de Cardiología!" error={errors.title}/>
          </FormGroup>
          <FormGroup label="Mensaje" required error={errors.body}>
            <textarea value={form.body} onChange={e=>setForm(p=>({...p,body:e.target.value}))}
              placeholder="Escribe el mensaje para los usuarios..." rows={4}
              className="w-full px-3.5 py-2.5 border border-border rounded-md text-sm text-ink bg-white outline-none focus:border-sky-400 focus:shadow-[0_0_0_3px_rgba(14,165,233,.1)] transition-all resize-none"/>
            {errors.body&&<p className="text-xs text-red-500 mt-1">{errors.body}</p>}
          </FormGroup>
          <div className="grid grid-cols-2 gap-4">
            <FormGroup label="Tipo">
              <Select value={form.type} onChange={e=>setForm(p=>({...p,type:e.target.value}))}>
                <option value="motivation">🔥 Motivación</option>
                <option value="new_questions">✨ Nuevas preguntas</option>
                <option value="trial_ending">⏳ Prueba finalizando</option>
                <option value="streak">🏆 Logro/Racha</option>
              </Select>
            </FormGroup>
            <FormGroup label="Destinatarios">
              <Select value={form.target} onChange={e=>setForm(p=>({...p,target:e.target.value}))}>
                <option value="all">Todos ({TARGET_COUNTS.all})</option>
                <option value="trial">En prueba ({TARGET_COUNTS.trial})</option>
                <option value="active">Activos ({TARGET_COUNTS.active})</option>
                <option value="expired">Vencidos ({TARGET_COUNTS.expired})</option>
              </Select>
            </FormGroup>
          </div>
          <div className="bg-surface border border-border rounded-xl p-4 mb-5">
            <div className="text-xs font-mono font-semibold uppercase tracking-wider text-slate-400 mb-3">Preview</div>
            <div className="flex items-start gap-3 p-3 bg-ink rounded-lg">
              <span className="text-xl">{form.type==='motivation'?'🔥':form.type==='new_questions'?'✨':form.type==='trial_ending'?'⏳':'🏆'}</span>
              <div>
                <div className="font-semibold text-white text-sm">{form.title||'Título de la notificación'}</div>
                <div className="text-white/60 text-xs mt-0.5 leading-relaxed">{form.body||'Mensaje de la notificación...'}</div>
              </div>
            </div>
          </div>
          <Button fullWidth onClick={handleSend} loading={sending} variant={sent?'pulse':'primary'}>
            {sent ? '✓ Enviada correctamente' : `Enviar a ${form.target==='all'?'todos los usuarios':TARGET_COUNTS[form.target]+' usuarios'}`}
          </Button>
        </Card>

        <div>
          <Card padding={false}>
            <div className="p-5 border-b border-border">
              <h3 className="font-display font-bold text-base text-ink">Notificaciones enviadas</h3>
              <p className="text-xs text-slate-400 mt-0.5">Últimas 20 notificaciones</p>
            </div>
            {recent.length===0 ? <EmptyState icon="🔔" title="Sin notificaciones enviadas" /> : (
              <div className="divide-y divide-border max-h-[600px] overflow-y-auto scrollbar-thin">
                {recent.map(n => (
                  <div key={n.id} className="p-4 hover:bg-sky-50 transition-colors">
                    <div className="flex items-start justify-between gap-3 mb-1">
                      <div className="font-semibold text-sm text-ink">{n.title}</div>
                      <Badge variant={n.type==='motivation'?'pulse':n.type==='new_questions'?'blue':n.type==='trial_ending'?'amber':'green'}>
                        {n.type.replace('_',' ')}
                      </Badge>
                    </div>
                    <p className="text-xs text-slate-500 leading-relaxed mb-2">{n.body}</p>
                    <div className="flex items-center gap-3 text-[0.65rem] text-slate-400 font-mono">
                      <span>{n.user_id?`→ ${n.profile?.email||n.user_id}` : '→ Todos los usuarios'}</span>
                      <span>·</span>
                      <span>{new Date(n.sent_at).toLocaleDateString('es-ES',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'})}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

export default NotificacionesPage;
