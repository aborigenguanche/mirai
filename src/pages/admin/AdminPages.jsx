// ═══════════════════════════════════════════════════════════
// Admin UsuariosPage
// ═══════════════════════════════════════════════════════════
import { useState, useEffect } from 'react';
import { supabase, sendNotification } from '../../lib/supabase';
import { toast } from '../../store';
import { Badge, EmptyState, LoadingScreen, Modal, Button, FormGroup, Input, Select, Pagination, Card, CardHeader } from '../../components/ui';

const SUB_MAP = { active:{label:'Activa',variant:'pulse'}, trial:{label:'Prueba',variant:'blue'}, expired:{label:'Vencida',variant:'amber'} };

export function UsuariosPage() {
  const [profiles, setProfiles]   = useState([]);
  const [loading, setLoading]     = useState(true);
  const [filtros, setFiltros]     = useState({ q:'', role:'', subscription_status:'' });
  const [pagina, setPagina]       = useState(1);
  const [sortBy, setSortBy]       = useState('created_at');
  const [sortDir, setSortDir]     = useState('desc');
  const POR_PAGINA = 15;
  const [selected, setSelected]   = useState(null);
  const [detailStats, setDetailStats] = useState(null);
  const [detailSess, setDetailSess]   = useState([]);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [editProfile, setEditProfile]     = useState(null);
  const [editForm, setEditForm]           = useState({});
  const [saving, setSaving]               = useState(false);
  const [deleteP, setDeleteP]             = useState(null);
  const [deleting, setDeleting]           = useState(false);
  const [createModal, setCreateModal]     = useState(false);
  const [createForm, setCreateForm]       = useState({ email:'', full_name:'', password:'', role:'user', subscription_status:'trial' });
  const [creating, setCreating]           = useState(false);
  const [createErr, setCreateErr]         = useState({});

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    const { data } = await supabase.from('profiles').select('*').order(sortBy, { ascending: sortDir==='asc' });
    setProfiles(data || []);
    setLoading(false);
  }

  const filtrados = profiles.filter(p => {
    if (filtros.role               && p.role !== filtros.role) return false;
    if (filtros.subscription_status && p.subscription_status !== filtros.subscription_status) return false;
    if (filtros.q) { const q = filtros.q.toLowerCase(); if (!p.email?.toLowerCase().includes(q) && !p.full_name?.toLowerCase().includes(q)) return false; }
    return true;
  });
  const totalPags = Math.ceil(filtrados.length / POR_PAGINA);
  const pagActual = filtrados.slice((pagina-1)*POR_PAGINA, pagina*POR_PAGINA);
  const f = (k,v) => { setFiltros(p=>({...p,[k]:v})); setPagina(1); };

  function toggleSort(col) {
    if (sortBy===col) setSortDir(d=>d==='asc'?'desc':'asc'); else { setSortBy(col); setSortDir('desc'); }
    setPagina(1);
  }

  async function openDetail(p) {
    setSelected(p); setLoadingDetail(true); setDetailStats(null); setDetailSess([]);
    const [{ data: rs }, { data: ss }] = await Promise.all([
      supabase.from('exam_responses').select('is_correct, answered_at').eq('user_id', p.id),
      supabase.from('exam_sessions').select('*').eq('user_id', p.id).not('finished_at','is',null).order('started_at',{ascending:false}).limit(8),
    ]);
    const total = rs?.length||0, corr = (rs||[]).filter(r=>r.is_correct).length;
    const hace7 = new Date(Date.now()-7*86400000);
    const semana = (rs||[]).filter(r=>new Date(r.answered_at)>hace7).length;
    const actividad = Array.from({length:30},(_,i)=>{
      const d=new Date(); d.setDate(d.getDate()-(29-i));
      return (rs||[]).filter(r=>new Date(r.answered_at).toDateString()===d.toDateString()).length;
    });
    setDetailStats({ total, corr, tasa:total?Math.round((corr/total)*100):0, sesiones:ss?.length||0, semana, actividad });
    setDetailSess(ss||[]);
    setLoadingDetail(false);
  }

  async function handleEdit() {
    setSaving(true);
    await supabase.from('profiles').update(editForm).eq('id', editProfile.id);
    toast.success('Usuario actualizado'); setSaving(false); setEditProfile(null); load();
    if (selected?.id===editProfile.id) setSelected(p=>({...p,...editForm}));
  }

  async function handleDelete() {
    setDeleting(true);
    await supabase.from('profiles').delete().eq('id', deleteP.id);
    toast.success('Usuario eliminado'); setDeleting(false); setDeleteP(null); setSelected(null); load();
  }

  async function handleCreate() {
    const e = {};
    if (!/\S+@\S+\.\S+/.test(createForm.email)) e.email = 'Email no válido';
    if (createForm.password.length < 8) e.password = 'Mínimo 8 caracteres';
    if (Object.keys(e).length) { setCreateErr(e); return; }
    setCreating(true);
    const { data, error } = await supabase.auth.signUp({ email: createForm.email, password: createForm.password, options:{ data:{ full_name: createForm.full_name } } });
    if (error) { toast.error(error.message); setCreating(false); return; }
    if (data.user) {
      await supabase.from('profiles').upsert({ id:data.user.id, email:createForm.email, full_name:createForm.full_name||null, role:createForm.role, subscription_status:createForm.subscription_status });
    }
    toast.success('Usuario creado'); setCreating(false); setCreateModal(false);
    setCreateForm({ email:'', full_name:'', password:'', role:'user', subscription_status:'trial' }); setCreateErr({});
    load();
  }

  async function resetStats(uid) {
    if (!confirm('¿Eliminar todas las estadísticas de este usuario?')) return;
    await Promise.all([supabase.from('exam_responses').delete().eq('user_id',uid), supabase.from('exam_sessions').delete().eq('user_id',uid)]);
    toast.success('Estadísticas eliminadas'); openDetail(selected);
  }

  const resumen = { total:profiles.length, activos:profiles.filter(p=>p.subscription_status==='active').length, prueba:profiles.filter(p=>p.subscription_status==='trial').length, admins:profiles.filter(p=>p.role==='admin').length };

  if (loading) return <LoadingScreen message="Cargando usuarios..." />;

  return (
    <div>
      <div className="flex items-start justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-2xl font-bold text-ink tracking-tight">Gestión de usuarios</h1>
          <p className="text-sm text-slate-400 mt-1">{profiles.length} usuarios registrados</p>
        </div>
        <Button onClick={() => setCreateModal(true)}>+ Crear usuario</Button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {[['Total',resumen.total,'bg-white','text-ink'],['Activos',resumen.activos,'bg-pulse-bg','text-pulse-dim'],['En prueba',resumen.prueba,'bg-sky-50','text-sky-600'],['Admins',resumen.admins,'bg-ink','text-pulse']].map(([l,v,bg,tc]) => (
          <div key={l} className={`${bg} border border-border rounded-lg p-4 text-center`}>
            <div className={`font-display font-bold text-2xl ${tc}`}>{v}</div>
            <div className="text-xs text-slate-400 mt-0.5">{l}</div>
          </div>
        ))}
      </div>

      <div className="bg-white border border-border rounded-lg p-4 mb-5 flex flex-wrap gap-3 items-center">
        <input type="text" placeholder="Buscar por nombre o email..." value={filtros.q} onChange={e=>f('q',e.target.value)}
          className="flex-1 min-w-[200px] px-3.5 py-2 border border-border rounded-md text-sm outline-none focus:border-sky-400 transition-all"/>
        <select value={filtros.role} onChange={e=>f('role',e.target.value)} className="px-3 py-2 border border-border rounded-md text-sm text-slate-600 outline-none bg-white cursor-pointer">
          <option value="">Todos los roles</option><option value="user">Usuario</option><option value="admin">Admin</option>
        </select>
        <select value={filtros.subscription_status} onChange={e=>f('subscription_status',e.target.value)} className="px-3 py-2 border border-border rounded-md text-sm text-slate-600 outline-none bg-white cursor-pointer">
          <option value="">Todos los estados</option><option value="active">Activa</option><option value="trial">Prueba</option><option value="expired">Vencida</option>
        </select>
        {(filtros.q||filtros.role||filtros.subscription_status) && <button onClick={()=>{setFiltros({q:'',role:'',subscription_status:''});setPagina(1);}} className="text-xs text-slate-400 hover:text-red-500 font-semibold transition-colors">✕ Limpiar</button>}
        <span className="ml-auto text-xs text-slate-400 font-mono">{filtrados.length} usuarios</span>
      </div>

      <div className="bg-white border border-border rounded-lg overflow-hidden">
        {pagActual.length===0 ? <EmptyState icon="👥" title="Sin usuarios" action={<Button onClick={()=>setCreateModal(true)} size="sm">+ Crear usuario</Button>} /> : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-surface border-b border-border">
                    {[['Usuario','email'],['Estado','subscription_status'],['Plan',null],['Rol','role'],['Registro','created_at'],['Acciones',null]].map(([l,col])=>(
                      <th key={l} onClick={()=>col&&toggleSort(col)} className={`text-left px-5 py-3 font-mono text-[0.65rem] font-semibold uppercase tracking-wider text-slate-400 ${col?'cursor-pointer hover:text-sky-600 select-none':''}`}>
                        {l}{col&&sortBy===col&&<span className="ml-1">{sortDir==='asc'?'↑':'↓'}</span>}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pagActual.map(p => (
                    <tr key={p.id} className="border-t border-border hover:bg-sky-50 transition-colors group">
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-full bg-gradient-to-br from-sky-400 to-pulse flex items-center justify-center font-display text-sm font-bold text-white shrink-0">
                            {(p.full_name||p.email||'U').charAt(0).toUpperCase()}
                          </div>
                          <div>
                            {p.full_name?<div className="text-sm font-semibold text-ink">{p.full_name}</div>:<div className="text-sm italic text-slate-400">Sin nombre</div>}
                            <div className="text-xs text-slate-400 font-mono truncate max-w-[180px]">{p.email}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-3.5"><Badge variant={(SUB_MAP[p.subscription_status]||{variant:'gray'}).variant}>{(SUB_MAP[p.subscription_status]||{label:p.subscription_status}).label}</Badge></td>
                      <td className="px-5 py-3.5 text-sm text-slate-500 capitalize">{p.subscription_plan||'—'}</td>
                      <td className="px-5 py-3.5"><Badge variant={p.role==='admin'?'ink':'gray'}>{p.role}</Badge></td>
                      <td className="px-5 py-3.5 font-mono text-xs text-slate-400">{new Date(p.created_at).toLocaleDateString('es-ES',{day:'2-digit',month:'short',year:'numeric'})}</td>
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button onClick={()=>openDetail(p)} className="px-2.5 py-1 text-xs font-semibold text-sky-600 border border-sky-200 rounded-full hover:bg-sky-50 transition-colors">Ver</button>
                          <button onClick={()=>{setEditProfile(p);setEditForm({full_name:p.full_name||'',role:p.role,subscription_status:p.subscription_status,subscription_plan:p.subscription_plan||'',subscription_ends_at:p.subscription_ends_at?p.subscription_ends_at.split('T')[0]:''});}}
                            className="w-7 h-7 flex items-center justify-center border border-border rounded-md hover:border-sky-300 hover:bg-sky-50 text-slate-400 hover:text-sky-600 transition-all text-sm">✏️</button>
                          <button onClick={()=>setDeleteP(p)} className="w-7 h-7 flex items-center justify-center border border-border rounded-md hover:border-red-200 hover:bg-red-50 text-slate-400 hover:text-red-500 transition-all text-sm">🗑</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={pagina} total={filtrados.length} perPage={POR_PAGINA} onChange={setPagina} />
          </>
        )}
      </div>

      {/* Modal detalle */}
      <Modal open={!!selected} onClose={()=>setSelected(null)} title="Detalle del usuario" maxWidth="max-w-2xl"
        footer={<><Button variant="danger" size="sm" onClick={()=>{setDeleteP(selected);setSelected(null);}}>Eliminar</Button><Button variant="secondary" onClick={()=>{setEditProfile(selected);setEditForm({full_name:selected?.full_name||'',role:selected?.role,subscription_status:selected?.subscription_status,subscription_plan:selected?.subscription_plan||'',subscription_ends_at:''});}}>Editar</Button><Button variant="secondary" onClick={()=>setSelected(null)}>Cerrar</Button></>}>
        {selected && (
          <div>
            <div className="flex items-center gap-4 pb-5 mb-5 border-b border-border">
              <div className="w-14 h-14 rounded-full bg-gradient-to-br from-sky-400 to-pulse flex items-center justify-center font-display text-2xl font-bold text-white shrink-0">
                {(selected.full_name||selected.email||'U').charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-display font-bold text-lg text-ink">{selected.full_name||<span className="italic text-slate-400">Sin nombre</span>}</div>
                <div className="text-sm text-slate-400 font-mono">{selected.email}</div>
                <div className="flex gap-2 mt-1.5 flex-wrap">
                  <Badge variant={(SUB_MAP[selected.subscription_status]||{variant:'gray'}).variant}>{(SUB_MAP[selected.subscription_status]||{label:selected.subscription_status}).label}</Badge>
                  <Badge variant={selected.role==='admin'?'ink':'gray'}>{selected.role}</Badge>
                </div>
              </div>
              <div className="text-right text-xs text-slate-400 shrink-0">
                <div>Registro</div>
                <div className="font-mono font-semibold text-ink">{new Date(selected.created_at).toLocaleDateString('es-ES',{day:'2-digit',month:'short',year:'numeric'})}</div>
              </div>
            </div>
            {loadingDetail ? (
              <div className="flex items-center justify-center py-12 gap-3">
                <div className="w-5 h-5 border-2 border-ink/15 border-t-ink rounded-full animate-spin"/>
                <span className="text-sm text-slate-400">Cargando estadísticas...</span>
              </div>
            ) : detailStats && (
              <>
                <div className="grid grid-cols-3 gap-3 mb-5">
                  {[['Preguntas',detailStats.total,'text-ink'],['Tasa acierto',`${detailStats.tasa}%`,detailStats.tasa>=65?'text-pulse-dim':detailStats.tasa>=50?'text-amber-500':'text-red-400'],['Sesiones',detailStats.sesiones,'text-sky-600'],['Esta semana',detailStats.semana,'text-ink'],['Aciertos',detailStats.corr,'text-pulse-dim'],['Días activos',new Set(detailStats.actividad.map((c,i)=>c>0?i:null).filter(x=>x!==null)).size,'text-ink']].map(([l,v,c])=>(
                    <div key={l} className="bg-surface border border-border rounded-lg p-3 text-center">
                      <div className={`font-display font-bold text-xl ${c}`}>{v}</div>
                      <div className="text-xs text-slate-400 mt-0.5">{l}</div>
                    </div>
                  ))}
                </div>
                <div className="mb-4">
                  <div className="text-xs font-mono font-semibold uppercase tracking-wider text-slate-400 mb-2">Actividad últimos 30 días</div>
                  <div className="flex items-end gap-0.5 h-10">
                    {detailStats.actividad.map((c,i)=>{
                      const max=Math.max(...detailStats.actividad,1);
                      return <div key={i} className={`flex-1 rounded-t-sm ${c>0?'bg-gradient-to-t from-sky-500 to-pulse':'bg-sky-100'}`} style={{height:`${c?Math.max(10,(c/max)*100):4}%`}}/>;
                    })}
                  </div>
                </div>
                {detailSess.length>0 && (
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <div className="text-xs font-mono font-semibold uppercase tracking-wider text-slate-400">Últimas sesiones</div>
                      <button onClick={()=>resetStats(selected.id)} className="text-xs text-red-400 hover:text-red-600 font-semibold transition-colors">Resetear estadísticas</button>
                    </div>
                    <div className="border border-border rounded-lg overflow-hidden">
                      <table className="w-full">
                        <thead><tr className="bg-surface">{['Fecha','Preguntas','Tasa','Modo'].map(h=><th key={h} className="text-left px-3 py-2 font-mono text-[0.6rem] font-semibold uppercase tracking-wider text-slate-400">{h}</th>)}</tr></thead>
                        <tbody>
                          {detailSess.map(s=>{
                            const pct=s.total_questions?Math.round(((s.num_correct||0)/s.total_questions)*100):0;
                            return <tr key={s.id} className="border-t border-border hover:bg-sky-50 transition-colors">
                              <td className="px-3 py-2 font-mono text-xs text-slate-400">{new Date(s.started_at).toLocaleDateString('es-ES',{day:'2-digit',month:'short'})}</td>
                              <td className="px-3 py-2 font-mono text-xs font-semibold text-ink">{s.total_questions}</td>
                              <td className="px-3 py-2 font-mono text-xs font-bold" style={{color:pct>=65?'#00B89F':pct>=50?'#F59E0B':'#EF4444'}}>{pct}%</td>
                              <td className="px-3 py-2"><Badge variant={s.mode==='simulacro'?'ink':s.mode==='exam'?'blue':'gray'}>{s.mode}</Badge></td>
                            </tr>;
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </Modal>

      {/* Modal editar */}
      <Modal open={!!editProfile} onClose={()=>setEditProfile(null)} title="Editar usuario"
        footer={<><Button variant="secondary" onClick={()=>setEditProfile(null)}>Cancelar</Button><Button onClick={handleEdit} loading={saving}>Guardar</Button></>}>
        {editProfile && <>
          <FormGroup label="Nombre completo"><Input value={editForm.full_name} onChange={e=>setEditForm(p=>({...p,full_name:e.target.value}))} placeholder="Nombre y apellidos"/></FormGroup>
          <div className="grid grid-cols-2 gap-4">
            <FormGroup label="Estado suscripción"><Select value={editForm.subscription_status} onChange={e=>setEditForm(p=>({...p,subscription_status:e.target.value}))}><option value="active">Activa</option><option value="trial">Prueba</option><option value="expired">Vencida</option></Select></FormGroup>
            <FormGroup label="Plan"><Select value={editForm.subscription_plan} onChange={e=>setEditForm(p=>({...p,subscription_plan:e.target.value}))}><option value="">Sin plan</option><option value="monthly">Mensual</option><option value="annual">Anual</option></Select></FormGroup>
          </div>
          <FormGroup label="Fin de suscripción" hint="Dejar vacío si no tiene fecha"><Input type="date" value={editForm.subscription_ends_at} onChange={e=>setEditForm(p=>({...p,subscription_ends_at:e.target.value}))}/></FormGroup>
          <FormGroup label="Rol"><Select value={editForm.role} onChange={e=>setEditForm(p=>({...p,role:e.target.value}))}><option value="user">Usuario</option><option value="admin">Admin</option></Select></FormGroup>
          {editForm.role==='admin'&&<div className="bg-amber-50 border border-amber-200 rounded-md px-4 py-3 text-xs text-amber-700">⚠️ El rol Admin da acceso completo al panel de administración.</div>}
        </>}
      </Modal>

      {/* Modal crear */}
      <Modal open={createModal} onClose={()=>{setCreateModal(false);setCreateErr({});}} title="Crear nuevo usuario"
        footer={<><Button variant="secondary" onClick={()=>{setCreateModal(false);setCreateErr({});}}>Cancelar</Button><Button onClick={handleCreate} loading={creating}>Crear usuario</Button></>}>
        <FormGroup label="Email" required error={createErr.email}><Input type="email" value={createForm.email} onChange={e=>setCreateForm(p=>({...p,email:e.target.value}))} placeholder="usuario@email.com" error={createErr.email}/></FormGroup>
        <FormGroup label="Nombre completo" hint="Opcional"><Input value={createForm.full_name} onChange={e=>setCreateForm(p=>({...p,full_name:e.target.value}))} placeholder="Nombre y apellidos"/></FormGroup>
        <FormGroup label="Contraseña" required error={createErr.password} hint="El usuario podrá cambiarla después"><Input type="password" value={createForm.password} onChange={e=>setCreateForm(p=>({...p,password:e.target.value}))} placeholder="Mínimo 8 caracteres" error={createErr.password}/></FormGroup>
        <div className="grid grid-cols-2 gap-4">
          <FormGroup label="Estado"><Select value={createForm.subscription_status} onChange={e=>setCreateForm(p=>({...p,subscription_status:e.target.value}))}><option value="trial">Prueba</option><option value="active">Activa</option><option value="expired">Vencida</option></Select></FormGroup>
          <FormGroup label="Rol"><Select value={createForm.role} onChange={e=>setCreateForm(p=>({...p,role:e.target.value}))}><option value="user">Usuario</option><option value="admin">Admin</option></Select></FormGroup>
        </div>
      </Modal>

      {/* Modal eliminar */}
      <Modal open={!!deleteP} onClose={()=>setDeleteP(null)} title="Eliminar usuario"
        footer={<><Button variant="secondary" onClick={()=>setDeleteP(null)}>Cancelar</Button><Button variant="danger" onClick={handleDelete} loading={deleting}>Eliminar definitivamente</Button></>}>
        <div className="text-center py-2">
          <div className="text-4xl mb-3">⚠️</div>
          <p className="text-sm text-slate-500 mb-4">¿Seguro que quieres eliminar este usuario? Se borrarán todos sus datos. <strong>Esta acción no se puede deshacer.</strong></p>
          {deleteP&&<div className="bg-surface border border-border rounded-lg p-3 text-left"><div className="text-sm font-semibold text-ink">{deleteP.full_name||<span className="italic text-slate-400">Sin nombre</span>}</div><div className="text-xs text-slate-400 font-mono">{deleteP.email}</div></div>}
        </div>
      </Modal>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// Admin NotificacionesPage
// ═══════════════════════════════════════════════════════════
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
    else if (form.target === 'trial') userIds = profiles.filter(p=>p.subscription_status==='trial').map(p=>p.id);
    else if (form.target === 'active') userIds = profiles.filter(p=>p.subscription_status==='active').map(p=>p.id);
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
        {/* Formulario */}
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

          {/* Preview */}
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

        {/* Historial */}
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

// ═══════════════════════════════════════════════════════════
// Admin AnalyticsPage
// ═══════════════════════════════════════════════════════════
export function AnalyticsPage() {
  const [loading, setLoading] = useState(true);
  const [periodo, setPeriodo] = useState('30');
  const [data, setData]       = useState(null);

  useEffect(() => { load(); }, [periodo]);

  async function load() {
    setLoading(true);
    const cutoff = new Date(Date.now() - parseInt(periodo)*86400000).toISOString();
    const [
      { data: profiles },
      { data: sessions },
      { data: responses },
      { data: rankings },
    ] = await Promise.all([
      supabase.from('profiles').select('id, created_at, subscription_status, role').order('created_at',{ascending:true}),
      supabase.from('exam_sessions').select('user_id, started_at, finished_at, total_questions, num_correct, mode').gte('started_at',cutoff).not('finished_at','is',null),
      supabase.from('exam_responses').select('is_correct, answered_at, time_taken_seconds').gte('answered_at',cutoff),
      supabase.from('weekly_ranking').select('score, percentile').not('score','is',null),
    ]);

    const rs = responses||[], ss = sessions||[], ps = profiles||[];
    const total = rs.length, corr = rs.filter(r=>r.is_correct).length;
    const avgTime = rs.length ? Math.round(rs.reduce((a,r)=>a+(r.time_taken_seconds||0),0)/rs.length) : 0;
    const uniqueUsers = new Set(ss.map(s=>s.user_id)).size;
    const avgQperSess = ss.length ? Math.round(ss.reduce((a,s)=>a+(s.total_questions||0),0)/ss.length) : 0;

    // Retención: usuarios con sesión en los últimos 7 días
    const hace7 = new Date(Date.now()-7*86400000).toISOString();
    const activeRecent = new Set((ss||[]).filter(s=>s.started_at>=hace7).map(s=>s.user_id)).size;
    const retention = uniqueUsers ? Math.round((activeRecent/uniqueUsers)*100) : 0;

    // Crecimiento diario de usuarios
    const dias = Math.min(parseInt(periodo), 30);
    const crecimiento = Array.from({length:dias},(_,i)=>{
      const d=new Date(); d.setDate(d.getDate()-(dias-1-i));
      const dayStr = d.toDateString();
      return { dia:d.toLocaleDateString('es-ES',{day:'2-digit',month:'short'}), nuevos: ps.filter(p=>new Date(p.created_at).toDateString()===dayStr).length };
    });

    // Distribución por modo
    const modos = ss.reduce((a,s)=>{ a[s.mode]=(a[s.mode]||0)+1; return a; }, {});

    // Score MIR distribution
    const scores = (rankings||[]).map(r=>parseFloat(r.score)||0);
    const avgScore = scores.length ? Math.round(scores.reduce((a,b)=>a+b,0)/scores.length) : 0;

    setData({ total, corr, tasa:total?Math.round((corr/total)*100):0, avgTime, uniqueUsers, avgQperSess, retention, activeRecent,
      subs:{ active:ps.filter(p=>p.subscription_status==='active').length, trial:ps.filter(p=>p.subscription_status==='trial').length, expired:ps.filter(p=>p.subscription_status==='expired').length },
      crecimiento, modos, totalSess:ss.length, avgScore, scoresCount:scores.length,
    });
    setLoading(false);
  }

  if (loading) return <LoadingScreen message="Calculando analytics..." />;
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

      {/* KPIs principales */}
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

      {/* Grid analytics */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 mb-5">
        {/* Crecimiento de usuarios */}
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

        {/* Panel derecho */}
        <div className="flex flex-col gap-5">
          {/* Distribución suscripciones */}
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

          {/* Modos de uso */}
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

          {/* Score MIR medio */}
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

      {/* Retención */}
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
    </div>
  );
}

// Re-exports para App.jsx
export default UsuariosPage;
