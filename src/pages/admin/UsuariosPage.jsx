import { useState, useEffect } from 'react';
import { supabase, adminUserStats } from '../../lib/supabase';
import { toast } from '../../store';
import { Badge, EmptyState, LoadingScreen, Modal, Button, FormGroup, Input, Select, Pagination, Card, CardHeader } from '../../components/ui';

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
    // FIX: Fetch sin orden server-side — el orden se aplica client-side
    // para que toggleSort funcione sin necesitar re-fetch
    const { data } = await supabase.from('profiles').select('*');
    setProfiles(data || []);
    setLoading(false);
  }

  // FIX: Ordenación aplicada client-side sobre los datos ya cargados
  // Así toggleSort funciona sin tener que volver a llamar a Supabase
  const filtrados = profiles
    .filter(p => {
      if (filtros.role                && p.role !== filtros.role) return false;
      if (filtros.subscription_status && p.subscription_status !== filtros.subscription_status) return false;
      if (filtros.q) {
        const q = filtros.q.toLowerCase();
        if (!p.email?.toLowerCase().includes(q) && !p.full_name?.toLowerCase().includes(q)) return false;
      }
      return true;
    })
    .sort((a, b) => {
      const av = a[sortBy] ?? '';
      const bv = b[sortBy] ?? '';
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return sortDir === 'asc' ? cmp : -cmp;
    });

  const pagActual = filtrados.slice((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA);
  const f = (k, v) => { setFiltros(p => ({ ...p, [k]: v })); setPagina(1); };

  function toggleSort(col) {
    if (sortBy === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortBy(col); setSortDir('desc'); }
    setPagina(1);
  }

  // Helper para abrir el modal de edición con todos los campos bien inicializados
  function openEditModal(p) {
    setEditProfile(p);
    setEditForm({
      full_name:            p.full_name            || '',
      role:                 p.role,
      subscription_status:  p.subscription_status,
      subscription_plan:    p.subscription_plan    || '',
      // FIX: preservar la fecha real del perfil, no dejarla vacía
      subscription_ends_at: p.subscription_ends_at ? p.subscription_ends_at.split('T')[0] : '',
    });
  }

  async function openDetail(p) {
    setSelected(p); setLoadingDetail(true); setDetailStats(null); setDetailSess([]);
    try {
      // Las estadísticas se agregan en la BD (antes se bajaban todas las respuestas, con tope de 1.000)
      const [st, { data: ss }] = await Promise.all([
        adminUserStats(p.id),
        supabase.from('exam_sessions').select('*').eq('user_id', p.id).not('finished_at','is',null).order('started_at',{ascending:false}).limit(8),
      ]);
      setDetailStats({ total: st.total, corr: st.corr, tasa: st.total ? Math.round((st.corr/st.total)*100) : 0,
        sesiones: ss?.length || 0, semana: st.semana, actividad: st.actividad });
      setDetailSess(ss || []);
    } catch (e) { toast.error('No se pudieron cargar las estadísticas'); }
    setLoadingDetail(false);
  }

  async function handleEdit() {
    setSaving(true);

    // FIX: Limpiar strings vacíos → null y convertir fecha a ISO 8601
    // Error 22007 (invalid_datetime_format): Supabase rechaza 'YYYY-MM-DD' en
    // columnas timestamp with time zone; necesita formato ISO completo
    const payload = {
      ...editForm,
      full_name:            editForm.full_name            || null,
      subscription_plan:    editForm.subscription_plan    || null,
      subscription_ends_at: editForm.subscription_ends_at
        ? new Date(editForm.subscription_ends_at).toISOString()
        : null,
    };

    const { data, error } = await supabase
      .from('profiles')
      .update(payload)
      .eq('id', editProfile.id)
      .select(); // FIX: necesario para detectar si RLS bloqueó silenciosamente

    if (error) {
      toast.error('Error al actualizar: ' + error.message);
      setSaving(false);
      return;
    }

    // FIX: data vacío = RLS bloqueó sin lanzar error
    if (!data || data.length === 0) {
      toast.error('Sin permisos para actualizar este usuario');
      setSaving(false);
      return;
    }

    toast.success('Usuario actualizado');
    setSaving(false);
    setEditProfile(null);
    load();
    if (selected?.id === editProfile.id) setSelected(p => ({ ...p, ...payload }));
  }

  async function handleDelete() {
    setDeleting(true);

    // Llama a la función SQL admin_delete_user (sql/04_admin_delete_user.sql)
    // que borra todo incluyendo auth.users — sin necesitar Edge Function.
    const { error } = await supabase.rpc('admin_delete_user', {
      target_user_id: deleteP.id,
    });

    if (error) {
      toast.error('Error al eliminar: ' + error.message);
      setDeleting(false);
      return;
    }

    toast.success('Usuario eliminado completamente');
    setDeleting(false);
    setDeleteP(null);
    setSelected(null);
    load();
  }

  async function handleCreate() {
    const e = {};
    if (!/\S+@\S+\.\S+/.test(createForm.email)) e.email = 'Email no válido';
    if (createForm.password.length < 8) e.password = 'Mínimo 8 caracteres';
    if (Object.keys(e).length) { setCreateErr(e); return; }
    setCreating(true);
    // Se crea en el servidor (Edge Function): supabase.auth.signUp desde el navegador
    // sustituiría la sesión del admin por la del usuario recién creado.
    const { data, error } = await supabase.functions.invoke('admin-create-user', {
      body: { email: createForm.email, password: createForm.password, full_name: createForm.full_name,
              role: createForm.role, subscription_status: createForm.subscription_status },
    });
    if (error || data?.error) { toast.error(data?.error || error.message); setCreating(false); return; }
    toast.success('Usuario creado');
    setCreating(false);
    setCreateModal(false);
    setCreateForm({ email:'', full_name:'', password:'', role:'user', subscription_status:'trial' });
    setCreateErr({});
    load();
  }

  async function resetStats(uid) {
    if (!confirm('¿Eliminar todas las estadísticas de este usuario?')) return;
    await Promise.all([
      supabase.from('exam_responses').delete().eq('user_id', uid),
      supabase.from('exam_sessions').delete().eq('user_id', uid),
      supabase.from('user_question_state').delete().eq('user_id', uid),
      supabase.from('weekly_ranking').delete().eq('user_id', uid),
    ]);
    toast.success('Estadísticas eliminadas');
    openDetail(selected);
  }

  const resumen = {
    total:    profiles.length,
    activos:  profiles.filter(p => p.subscription_status === 'active').length,
    prueba:   profiles.filter(p => p.subscription_status === 'trial').length,
    admins:   profiles.filter(p => p.role === 'admin').length,
  };

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
        {(filtros.q||filtros.role||filtros.subscription_status) && (
          <button onClick={()=>{setFiltros({q:'',role:'',subscription_status:''});setPagina(1);}} className="text-xs text-slate-400 hover:text-red-500 font-semibold transition-colors">✕ Limpiar</button>
        )}
        <span className="ml-auto text-xs text-slate-400 font-mono">{filtrados.length} usuarios</span>
      </div>

      <div className="bg-white border border-border rounded-lg overflow-hidden">
        {pagActual.length === 0 ? (
          <EmptyState icon="👥" title="Sin usuarios" action={<Button onClick={()=>setCreateModal(true)} size="sm">+ Crear usuario</Button>} />
        ) : (
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
                            {p.full_name ? <div className="text-sm font-semibold text-ink">{p.full_name}</div> : <div className="text-sm italic text-slate-400">Sin nombre</div>}
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
                          {/* FIX: usa openEditModal para inicializar correctamente todos los campos */}
                          <button onClick={()=>openEditModal(p)} className="w-7 h-7 flex items-center justify-center border border-border rounded-md hover:border-sky-300 hover:bg-sky-50 text-slate-400 hover:text-sky-600 transition-all text-sm">✏️</button>
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
        footer={
          <>
            <Button variant="danger" size="sm" onClick={()=>{setDeleteP(selected);setSelected(null);}}>Eliminar</Button>
            {/* FIX: usa openEditModal también desde aquí */}
            <Button variant="secondary" onClick={()=>openEditModal(selected)}>Editar</Button>
            <Button variant="secondary" onClick={()=>setSelected(null)}>Cerrar</Button>
          </>
        }>
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
                {detailSess.length > 0 && (
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
            <FormGroup label="Estado suscripción">
              <Select value={editForm.subscription_status} onChange={e=>setEditForm(p=>({...p,subscription_status:e.target.value}))}>
                <option value="active">Activa</option><option value="trial">Prueba</option><option value="expired">Vencida</option>
              </Select>
            </FormGroup>
            <FormGroup label="Plan">
              <Select value={editForm.subscription_plan} onChange={e=>setEditForm(p=>({...p,subscription_plan:e.target.value}))}>
                <option value="">Sin plan</option><option value="monthly">Mensual</option><option value="annual">Anual</option>
              </Select>
            </FormGroup>
          </div>
          <FormGroup label="Fin de suscripción" hint="Dejar vacío si no tiene fecha">
            <Input type="date" value={editForm.subscription_ends_at} onChange={e=>setEditForm(p=>({...p,subscription_ends_at:e.target.value}))}/>
          </FormGroup>
          <FormGroup label="Rol">
            <Select value={editForm.role} onChange={e=>setEditForm(p=>({...p,role:e.target.value}))}>
              <option value="user">Usuario</option><option value="admin">Admin</option>
            </Select>
          </FormGroup>
          {editForm.role==='admin' && (
            <div className="bg-amber-50 border border-amber-200 rounded-md px-4 py-3 text-xs text-amber-700">⚠️ El rol Admin da acceso completo al panel de administración.</div>
          )}
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
          {deleteP && (
            <div className="bg-surface border border-border rounded-lg p-3 text-left">
              <div className="text-sm font-semibold text-ink">{deleteP.full_name||<span className="italic text-slate-400">Sin nombre</span>}</div>
              <div className="text-xs text-slate-400 font-mono">{deleteP.email}</div>
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}

export default UsuariosPage;
