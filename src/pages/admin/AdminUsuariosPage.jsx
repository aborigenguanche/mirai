import { useState, useEffect, useRef } from 'react';
import { supabase } from '../../lib/supabase';
import { toast } from '../../store';
import { Badge, EmptyState, LoadingScreen, Modal, Button, FormGroup, Input, Select } from '../../components/ui';

const ESTADOS = ['activa','prueba','inactiva','cancelada','vencida'];
const PLANES  = ['','mensual','anual'];

export default function AdminUsuariosPage() {
  const [usuarios, setUsuarios]   = useState([]);
  const [loading, setLoading]     = useState(true);
  const [filtros, setFiltros]     = useState({ q:'', rol:'', estado:'' });
  const [pagina, setPagina]       = useState(1);
  const [sortBy, setSortBy]       = useState('created_at');
  const [sortDir, setSortDir]     = useState('desc');
  const POR_PAGINA = 15;

  // Modales
  const [detailUser, setDetailUser]   = useState(null);
  const [detailStats, setDetailStats] = useState(null);
  const [detailSess, setDetailSess]   = useState([]);
  const [detailEsp, setDetailEsp]     = useState([]);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const [editUser, setEditUser]   = useState(null);
  const [editForm, setEditForm]   = useState({});
  const [saving, setSaving]       = useState(false);

  const [createModal, setCreateModal] = useState(false);
  const [createForm, setCreateForm]   = useState({ email:'', nombre:'', password:'', rol:'usuario', suscripcion_estado:'prueba', suscripcion_plan:'' });
  const [creating, setCreating]       = useState(false);
  const [createErrors, setCreateErrors] = useState({});

  const [deleteUser, setDeleteUser] = useState(null);
  const [deleting, setDeleting]     = useState(false);

  const [statsModal, setStatsModal] = useState(false);

  useEffect(() => { loadUsuarios(); }, []);

  async function loadUsuarios() {
    setLoading(true);
    const { data } = await supabase
      .from('usuarios')
      .select('*')
      .order(sortBy, { ascending: sortDir === 'asc' });
    setUsuarios(data || []);
    setLoading(false);
  }

  // ─── Filtrado y ordenación ────────────────────────────────
  const filtrados = usuarios.filter(u => {
    if (filtros.rol    && u.rol !== filtros.rol)                   return false;
    if (filtros.estado && u.suscripcion_estado !== filtros.estado) return false;
    if (filtros.q) {
      const q = filtros.q.toLowerCase();
      if (!u.email?.toLowerCase().includes(q) && !u.nombre?.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  function toggleSort(col) {
    if (sortBy === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortBy(col); setSortDir('desc'); }
    setPagina(1);
  }

  const totalPags = Math.ceil(filtrados.length / POR_PAGINA);
  const pagActual = filtrados.slice((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA);
  const f = (k, v) => { setFiltros(p => ({...p, [k]: v})); setPagina(1); };

  // ─── Detalle usuario ─────────────────────────────────────
  async function openDetail(u) {
    setDetailUser(u);
    setLoadingDetail(true);
    setDetailStats(null); setDetailSess([]); setDetailEsp([]);

    const [{ data: its }, { data: sess }, { data: itsEsp }] = await Promise.all([
      supabase.from('intentos').select('es_correcto, created_at').eq('usuario_id', u.id).order('created_at', { ascending: true }),
      supabase.from('sesiones').select('*').eq('usuario_id', u.id).order('created_at', { ascending: false }).limit(10),
      supabase.from('intentos').select('es_correcto, pregunta:preguntas(especialidad)').eq('usuario_id', u.id),
    ]);

    const total     = its?.length || 0;
    const correctas = its?.filter(i => i.es_correcto).length || 0;
    const hace7     = new Date(Date.now() - 7 * 86400000);
    const semana    = its?.filter(i => new Date(i.created_at) > hace7).length || 0;

    // Racha
    function calcRacha(arr) {
      if (!arr?.length) return 0;
      const dias = new Set(arr.map(i => new Date(i.created_at).toDateString()));
      let r = 0;
      for (let i = 0; i < 365; i++) {
        const d = new Date(); d.setDate(d.getDate() - i);
        if (dias.has(d.toDateString())) r++; else if (i > 0) break;
      }
      return r;
    }

    // Actividad últimos 30 días
    const actividad = Array.from({ length: 30 }, (_, i) => {
      const d = new Date(); d.setDate(d.getDate() - (29 - i));
      const count = its?.filter(it => new Date(it.created_at).toDateString() === d.toDateString()).length || 0;
      return count;
    });

    // Especialidades
    const espMap = {};
    itsEsp?.forEach(i => {
      const esp = i.pregunta?.especialidad;
      if (!esp) return;
      if (!espMap[esp]) espMap[esp] = { total: 0, correctas: 0 };
      espMap[esp].total++;
      if (i.es_correcto) espMap[esp].correctas++;
    });
    const esps = Object.entries(espMap)
      .map(([nombre, d]) => ({ nombre, pct: Math.round((d.correctas/d.total)*100), total: d.total }))
      .sort((a, b) => a.pct - b.pct);

    setDetailStats({
      total, correctas,
      tasa: total ? Math.round((correctas/total)*100) : 0,
      sesiones: sess?.length || 0,
      racha: calcRacha(its),
      semana,
      actividad,
      diasActivos: new Set(its?.map(i => new Date(i.created_at).toDateString())).size,
    });
    setDetailSess(sess || []);
    setDetailEsp(esps);
    setLoadingDetail(false);
  }

  // ─── Editar usuario ───────────────────────────────────────
  function openEdit(u) {
    setEditUser(u);
    setEditForm({
      nombre:              u.nombre || '',
      rol:                 u.rol,
      suscripcion_estado:  u.suscripcion_estado,
      suscripcion_plan:    u.suscripcion_plan || '',
      suscripcion_fin:     u.suscripcion_fin ? u.suscripcion_fin.split('T')[0] : '',
    });
  }

  async function handleEdit() {
    setSaving(true);
    const payload = {
      nombre:             editForm.nombre.trim() || null,
      rol:                editForm.rol,
      suscripcion_estado: editForm.suscripcion_estado,
      suscripcion_plan:   editForm.suscripcion_plan || null,
      suscripcion_fin:    editForm.suscripcion_fin || null,
    };
    const { error } = await supabase.from('usuarios').update(payload).eq('id', editUser.id);
    setSaving(false);
    if (error) { toast.error('Error al actualizar'); return; }
    toast.success('Usuario actualizado');
    setEditUser(null);
    loadUsuarios();
    // Actualizar detalle si está abierto
    if (detailUser?.id === editUser.id) setDetailUser(prev => ({...prev, ...payload}));
  }

  // ─── Crear usuario ────────────────────────────────────────
  function validateCreate() {
    const e = {};
    if (!createForm.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(createForm.email)) e.email = 'Email no válido';
    if (!createForm.password || createForm.password.length < 8) e.password = 'Mínimo 8 caracteres';
    return e;
  }

  async function handleCreate() {
    const e = validateCreate();
    if (Object.keys(e).length) { setCreateErrors(e); return; }
    setCreating(true);

    // Crear en Supabase Auth (necesita service role en producción, aquí usamos signUp)
    const { data, error } = await supabase.auth.admin
      ? await supabase.auth.admin.createUser({
          email: createForm.email,
          password: createForm.password,
          email_confirm: true,
          user_metadata: { nombre: createForm.nombre },
        })
      : await supabase.auth.signUp({ email: createForm.email, password: createForm.password });

    if (error) {
      setCreating(false);
      toast.error(error.message === 'User already registered' ? 'Ya existe un usuario con ese email' : 'Error al crear el usuario');
      return;
    }

    const uid = data?.user?.id;
    if (uid) {
      await supabase.from('usuarios').upsert({
        id: uid,
        email: createForm.email,
        nombre: createForm.nombre.trim() || null,
        rol: createForm.rol,
        suscripcion_estado: createForm.suscripcion_estado,
        suscripcion_plan: createForm.suscripcion_plan || null,
      });
    }

    setCreating(false);
    toast.success('Usuario creado correctamente');
    setCreateModal(false);
    setCreateForm({ email:'', nombre:'', password:'', rol:'usuario', suscripcion_estado:'prueba', suscripcion_plan:'' });
    setCreateErrors({});
    loadUsuarios();
  }

  // ─── Resetear estadísticas ────────────────────────────────
  async function resetStats(uid) {
    if (!confirm('¿Eliminar todas las estadísticas de este usuario? Esta acción no se puede deshacer.')) return;
    await Promise.all([
      supabase.from('intentos').delete().eq('usuario_id', uid),
      supabase.from('sesiones').delete().eq('usuario_id', uid),
    ]);
    toast.success('Estadísticas eliminadas');
    if (detailUser?.id === uid) openDetail(detailUser);
  }

  // ─── Eliminar usuario ─────────────────────────────────────
  async function handleDelete() {
    setDeleting(true);
    // Borra el perfil (el trigger en cascade borra intentos/sesiones)
    await supabase.from('usuarios').delete().eq('id', deleteUser.id);
    setDeleting(false);
    toast.success('Usuario eliminado');
    setDeleteUser(null);
    setDetailUser(null);
    loadUsuarios();
  }

  // ─── Resumen global ───────────────────────────────────────
  const resumen = {
    total:    usuarios.length,
    activos:  usuarios.filter(u => u.suscripcion_estado === 'activa').length,
    prueba:   usuarios.filter(u => u.suscripcion_estado === 'prueba').length,
    inactivos:usuarios.filter(u => u.suscripcion_estado === 'inactiva').length,
    admins:   usuarios.filter(u => u.rol === 'admin').length,
  };

  if (loading) return <LoadingScreen message="Cargando usuarios..." />;

  return (
    <div>
      {/* Header */}
      <div className="flex items-start justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-2xl font-bold text-ink tracking-tight">Gestión de usuarios</h1>
          <p className="text-sm text-slate-400 mt-1">{usuarios.length} usuarios · control total sobre cuentas y acceso</p>
        </div>
        <Button onClick={() => setCreateModal(true)}>+ Crear usuario</Button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-6">
        {[
          { label: 'Total',      val: resumen.total,     bg: 'bg-white',      text: 'text-ink',       border: 'border-border' },
          { label: 'Activos',    val: resumen.activos,   bg: 'bg-pulse-bg',   text: 'text-pulse-dim', border: 'border-pulse-dim/20' },
          { label: 'En prueba',  val: resumen.prueba,    bg: 'bg-sky-50',     text: 'text-sky-600',   border: 'border-sky-200' },
          { label: 'Inactivos',  val: resumen.inactivos, bg: 'bg-surface',    text: 'text-slate-400', border: 'border-border' },
          { label: 'Admins',     val: resumen.admins,    bg: 'bg-ink',        text: 'text-pulse',     border: 'border-ink' },
        ].map(s => (
          <div key={s.label} className={`${s.bg} border ${s.border} rounded-lg p-4 text-center`}>
            <div className={`font-display font-bold text-2xl ${s.text}`}>{s.val}</div>
            <div className="text-xs text-slate-400 mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Filtros */}
      <div className="bg-white border border-border rounded-lg p-4 mb-5 flex flex-wrap gap-3 items-center">
        <input type="text" placeholder="Buscar por nombre o email..."
          value={filtros.q} onChange={e => f('q', e.target.value)}
          className="flex-1 min-w-[200px] px-3.5 py-2 border border-border rounded-md text-sm outline-none focus:border-sky-400 focus:shadow-[0_0_0_3px_rgba(14,165,233,.1)] transition-all" />
        <select value={filtros.rol} onChange={e => f('rol', e.target.value)}
          className="px-3 py-2 border border-border rounded-md text-sm text-slate-600 outline-none focus:border-sky-400 bg-white cursor-pointer">
          <option value="">Todos los roles</option>
          <option value="usuario">Usuario</option>
          <option value="admin">Admin</option>
        </select>
        <select value={filtros.estado} onChange={e => f('estado', e.target.value)}
          className="px-3 py-2 border border-border rounded-md text-sm text-slate-600 outline-none focus:border-sky-400 bg-white cursor-pointer">
          <option value="">Todos los estados</option>
          {ESTADOS.map(e => <option key={e} value={e}>{e.charAt(0).toUpperCase()+e.slice(1)}</option>)}
        </select>
        {(filtros.q || filtros.rol || filtros.estado) && (
          <button onClick={() => { setFiltros({q:'',rol:'',estado:''}); setPagina(1); }}
            className="text-xs text-slate-400 hover:text-red-500 font-semibold transition-colors">✕ Limpiar</button>
        )}
        <span className="ml-auto text-xs text-slate-400 font-mono">{filtrados.length} usuario{filtrados.length !== 1 ? 's' : ''}</span>
      </div>

      {/* Tabla */}
      <div className="bg-white border border-border rounded-lg overflow-hidden">
        {pagActual.length === 0 ? (
          <EmptyState icon="👥" title="Sin usuarios" subtitle="No hay usuarios que coincidan con los filtros."
            action={<Button onClick={() => setCreateModal(true)} size="sm">+ Crear usuario</Button>} />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-surface border-b border-border">
                    {[
                      { label: 'Usuario',     col: 'email' },
                      { label: 'Estado',      col: 'suscripcion_estado' },
                      { label: 'Plan',        col: 'suscripcion_plan' },
                      { label: 'Rol',         col: 'rol' },
                      { label: 'Registro',    col: 'created_at' },
                      { label: 'Acciones',    col: null },
                    ].map(({ label, col }) => (
                      <th key={label}
                        onClick={() => col && toggleSort(col)}
                        className={`text-left px-5 py-3 font-mono text-[0.65rem] font-semibold uppercase tracking-wider text-slate-400 ${col ? 'cursor-pointer hover:text-sky-600 select-none' : ''}`}>
                        {label}
                        {col && sortBy === col && <span className="ml-1">{sortDir === 'asc' ? '↑' : '↓'}</span>}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pagActual.map(u => (
                    <tr key={u.id} className="border-t border-border hover:bg-sky-50 transition-colors group">
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-full bg-gradient-to-br from-sky-400 to-pulse flex items-center justify-center font-display text-sm font-bold text-white shrink-0">
                            {(u.nombre || u.email || 'U').charAt(0).toUpperCase()}
                          </div>
                          <div>
                            {u.nombre
                              ? <div className="text-sm font-semibold text-ink">{u.nombre}</div>
                              : <div className="text-sm italic text-slate-400">Sin nombre</div>
                            }
                            <div className="text-xs text-slate-400 max-w-[200px] truncate font-mono">{u.email}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-3.5"><EstadoBadge estado={u.suscripcion_estado} /></td>
                      <td className="px-5 py-3.5 text-sm text-slate-500 capitalize">{u.suscripcion_plan || '—'}</td>
                      <td className="px-5 py-3.5"><Badge variant={u.rol === 'admin' ? 'ink' : 'gray'}>{u.rol}</Badge></td>
                      <td className="px-5 py-3.5 font-mono text-xs text-slate-400">
                        {new Date(u.created_at).toLocaleDateString('es-ES',{day:'2-digit',month:'short',year:'numeric'})}
                      </td>
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button onClick={() => openDetail(u)}
                            className="px-2.5 py-1 text-xs font-semibold text-sky-600 border border-sky-200 rounded-full hover:bg-sky-50 transition-colors whitespace-nowrap">
                            Ver detalle
                          </button>
                          <button onClick={() => openEdit(u)}
                            className="w-7 h-7 flex items-center justify-center text-sm border border-border rounded-md hover:border-sky-300 hover:bg-sky-50 text-slate-400 hover:text-sky-600 transition-all" title="Editar">
                            ✏️
                          </button>
                          <button onClick={() => setDeleteUser(u)}
                            className="w-7 h-7 flex items-center justify-center text-sm border border-border rounded-md hover:border-red-200 hover:bg-red-50 text-slate-400 hover:text-red-500 transition-all" title="Eliminar">
                            🗑
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Paginación */}
            {totalPags > 1 && (
              <div className="flex items-center justify-between px-5 py-3.5 border-t border-border bg-surface">
                <span className="text-xs text-slate-400">
                  {(pagina-1)*POR_PAGINA+1}–{Math.min(pagina*POR_PAGINA,filtrados.length)} de {filtrados.length}
                </span>
                <div className="flex gap-1">
                  <button disabled={pagina===1} onClick={()=>setPagina(p=>p-1)}
                    className="w-8 h-8 flex items-center justify-center rounded-md border border-border text-sm text-slate-500 hover:border-sky-300 disabled:opacity-40 disabled:pointer-events-none transition-all">←</button>
                  {Array.from({length:Math.min(5,totalPags)},(_,i)=>{
                    const p=Math.max(1,Math.min(pagina-2,totalPags-4))+i;
                    return <button key={p} onClick={()=>setPagina(p)}
                      className={`w-8 h-8 flex items-center justify-center rounded-md border text-sm font-mono transition-all ${pagina===p?'bg-ink text-white border-ink':'border-border text-slate-500 hover:border-sky-300 hover:bg-sky-50'}`}>{p}</button>;
                  })}
                  <button disabled={pagina===totalPags} onClick={()=>setPagina(p=>p+1)}
                    className="w-8 h-8 flex items-center justify-center rounded-md border border-border text-sm text-slate-500 hover:border-sky-300 disabled:opacity-40 disabled:pointer-events-none transition-all">→</button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* ─── MODAL DETALLE ─── */}
      <Modal open={!!detailUser} onClose={() => setDetailUser(null)} title="Perfil del usuario" maxWidth="max-w-2xl"
        footer={<>
          <Button variant="danger" size="sm" onClick={() => { setDeleteUser(detailUser); setDetailUser(null); }}>Eliminar</Button>
          <Button variant="secondary" onClick={() => { openEdit(detailUser); }}>Editar usuario</Button>
          <Button variant="secondary" onClick={() => setDetailUser(null)}>Cerrar</Button>
        </>}
      >
        {detailUser && (
          <div>
            {/* Cabecera */}
            <div className="flex items-center gap-4 pb-5 mb-5 border-b border-border">
              <div className="w-14 h-14 rounded-full bg-gradient-to-br from-sky-400 to-pulse flex items-center justify-center font-display text-2xl font-bold text-white shrink-0">
                {(detailUser.nombre || detailUser.email).charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                {detailUser.nombre
                  ? <div className="font-display font-bold text-lg text-ink">{detailUser.nombre}</div>
                  : <div className="font-display font-bold text-lg text-slate-400 italic">Sin nombre</div>
                }
                <div className="text-sm text-slate-400 font-mono truncate">{detailUser.email}</div>
                <div className="flex gap-2 mt-1.5 flex-wrap">
                  <EstadoBadge estado={detailUser.suscripcion_estado} />
                  <Badge variant={detailUser.rol === 'admin' ? 'ink' : 'gray'}>{detailUser.rol}</Badge>
                  {detailUser.suscripcion_plan && <Badge variant="blue">{detailUser.suscripcion_plan}</Badge>}
                </div>
              </div>
              <div className="text-right text-xs text-slate-400 shrink-0">
                <div>Registro</div>
                <div className="font-mono font-semibold text-ink">{new Date(detailUser.created_at).toLocaleDateString('es-ES',{day:'2-digit',month:'short',year:'numeric'})}</div>
              </div>
            </div>

            {loadingDetail ? (
              <div className="flex items-center justify-center py-12 gap-3">
                <div className="w-5 h-5 border-2 border-ink/15 border-t-ink rounded-full animate-spin-slow" />
                <span className="text-sm text-slate-400">Cargando estadísticas...</span>
              </div>
            ) : detailStats ? (
              <>
                {/* KPIs del usuario */}
                <div className="grid grid-cols-3 gap-3 mb-5">
                  {[
                    { label: 'Preguntas',    val: detailStats.total,                      color: 'text-ink' },
                    { label: 'Tasa acierto', val: `${detailStats.tasa}%`,                 color: detailStats.tasa >= 65 ? 'text-pulse-dim' : detailStats.tasa >= 50 ? 'text-amber-500' : 'text-red-400' },
                    { label: 'Sesiones',     val: detailStats.sesiones,                   color: 'text-sky-600' },
                    { label: 'Esta semana',  val: detailStats.semana,                     color: 'text-ink' },
                    { label: 'Días activos', val: detailStats.diasActivos,                color: 'text-ink' },
                    { label: 'Racha',        val: `${detailStats.racha}d 🔥`,             color: 'text-amber-500' },
                  ].map(s => (
                    <div key={s.label} className="bg-surface border border-border rounded-lg p-3 text-center">
                      <div className={`font-display font-bold text-xl ${s.color}`}>{s.val}</div>
                      <div className="text-xs text-slate-400 mt-0.5">{s.label}</div>
                    </div>
                  ))}
                </div>

                {/* Actividad 30 días */}
                <div className="mb-5">
                  <div className="text-xs font-mono font-semibold uppercase tracking-wider text-slate-400 mb-2">Actividad últimos 30 días</div>
                  <div className="flex items-end gap-0.5 h-10">
                    {detailStats.actividad.map((count, i) => {
                      const max = Math.max(...detailStats.actividad, 1);
                      const h = count ? Math.max(10, (count / max) * 100) : 4;
                      return (
                        <div key={i} title={`${count} preguntas`}
                          className={`flex-1 rounded-t-sm transition-all ${count > 0 ? 'bg-gradient-to-t from-sky-500 to-pulse' : 'bg-sky-100'}`}
                          style={{ height: `${h}%` }} />
                      );
                    })}
                  </div>
                </div>

                {/* Especialidades */}
                {detailEsp.length > 0 && (
                  <div className="mb-5">
                    <div className="text-xs font-mono font-semibold uppercase tracking-wider text-slate-400 mb-3">Rendimiento por especialidad</div>
                    <div className="flex flex-col gap-2.5 max-h-48 overflow-y-auto scrollbar-thin pr-1">
                      {detailEsp.map(e => {
                        const color = e.pct >= 65 ? 'from-sky-400 to-pulse' : e.pct >= 50 ? 'from-sky-300 to-sky-400' : e.pct >= 30 ? 'from-amber-400 to-amber-500' : 'from-red-400 to-red-500';
                        const textC = e.pct >= 65 ? 'text-pulse-dim' : e.pct >= 50 ? 'text-sky-600' : e.pct >= 30 ? 'text-amber-500' : 'text-red-400';
                        return (
                          <div key={e.nombre}>
                            <div className="flex justify-between mb-1">
                              <span className="text-xs font-medium text-ink">{e.nombre} <span className="text-slate-400">({e.total})</span></span>
                              <span className={`font-mono text-xs font-bold ${textC}`}>{e.pct}%</span>
                            </div>
                            <div className="h-1.5 bg-sky-50 rounded-full overflow-hidden">
                              <div className={`h-full bg-gradient-to-r ${color} rounded-full`} style={{ width: `${e.pct}%` }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Últimas sesiones */}
                {detailSess.length > 0 && (
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <div className="text-xs font-mono font-semibold uppercase tracking-wider text-slate-400">Últimas sesiones</div>
                      <button onClick={() => resetStats(detailUser.id)}
                        className="text-xs text-red-400 hover:text-red-600 font-semibold transition-colors">
                        Resetear estadísticas
                      </button>
                    </div>
                    <div className="border border-border rounded-lg overflow-hidden">
                      <table className="w-full">
                        <thead>
                          <tr className="bg-surface">
                            {['Fecha','Preguntas','Tasa','Duración'].map(h => (
                              <th key={h} className="text-left px-3 py-2 font-mono text-[0.6rem] font-semibold uppercase tracking-wider text-slate-400">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {detailSess.map(s => {
                            const pct = s.total_preguntas ? Math.round((s.total_correctas/s.total_preguntas)*100) : 0;
                            return (
                              <tr key={s.id} className="border-t border-border hover:bg-sky-50 transition-colors">
                                <td className="px-3 py-2 font-mono text-xs text-slate-400">{new Date(s.created_at).toLocaleDateString('es-ES',{day:'2-digit',month:'short'})}</td>
                                <td className="px-3 py-2 font-mono text-xs font-semibold text-ink">{s.total_preguntas}</td>
                                <td className="px-3 py-2 font-mono text-xs font-bold" style={{color: pct>=65?'var(--tw-color-pulse-dim, #00B89F)':pct>=50?'#F59E0B':'#EF4444'}}>{pct}%</td>
                                <td className="px-3 py-2 text-xs text-slate-400">{s.duracion_minutos ? `${s.duracion_minutos}min` : '—'}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {detailStats.total === 0 && (
                  <div className="text-center py-6">
                    <div className="text-3xl mb-2">📭</div>
                    <p className="text-sm text-slate-400">Este usuario aún no ha respondido ninguna pregunta.</p>
                  </div>
                )}
              </>
            ) : null}
          </div>
        )}
      </Modal>

      {/* ─── MODAL EDITAR ─── */}
      <Modal open={!!editUser} onClose={() => setEditUser(null)} title="Editar usuario"
        footer={<>
          <Button variant="secondary" onClick={() => setEditUser(null)}>Cancelar</Button>
          <Button onClick={handleEdit} loading={saving}>Guardar cambios</Button>
        </>}
      >
        {editUser && (
          <div>
            <div className="flex items-center gap-3 mb-5 pb-5 border-b border-border">
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-sky-400 to-pulse flex items-center justify-center font-display font-bold text-white text-sm">
                {(editUser.nombre || editUser.email).charAt(0).toUpperCase()}
              </div>
              <div>
                <div className="font-semibold text-ink text-sm">{editUser.nombre || <span className="italic text-slate-400">Sin nombre</span>}</div>
                <div className="text-xs text-slate-400 font-mono">{editUser.email}</div>
              </div>
            </div>
            <FormGroup label="Nombre completo" hint="Visible en el panel del estudiante">
              <Input value={editForm.nombre} onChange={e => setEditForm(p=>({...p,nombre:e.target.value}))} placeholder="Nombre y apellidos" />
            </FormGroup>
            <div className="grid grid-cols-2 gap-4">
              <FormGroup label="Estado de suscripción">
                <Select value={editForm.suscripcion_estado} onChange={e => setEditForm(p=>({...p,suscripcion_estado:e.target.value}))}>
                  {ESTADOS.map(e => <option key={e} value={e}>{e.charAt(0).toUpperCase()+e.slice(1)}</option>)}
                </Select>
              </FormGroup>
              <FormGroup label="Plan">
                <Select value={editForm.suscripcion_plan} onChange={e => setEditForm(p=>({...p,suscripcion_plan:e.target.value}))}>
                  <option value="">Sin plan</option>
                  <option value="mensual">Mensual</option>
                  <option value="anual">Anual</option>
                </Select>
              </FormGroup>
            </div>
            <FormGroup label="Fecha fin de suscripción" hint="Dejar vacío si no tiene fecha de vencimiento">
              <Input type="date" value={editForm.suscripcion_fin} onChange={e => setEditForm(p=>({...p,suscripcion_fin:e.target.value}))} />
            </FormGroup>
            <FormGroup label="Rol">
              <Select value={editForm.rol} onChange={e => setEditForm(p=>({...p,rol:e.target.value}))}>
                <option value="usuario">Usuario</option>
                <option value="admin">Admin</option>
              </Select>
            </FormGroup>
            {editForm.rol === 'admin' && (
              <div className="bg-amber-50 border border-amber-200 rounded-md px-4 py-3 text-xs text-amber-700">
                ⚠️ El rol Admin da acceso completo al panel de administración. Úsalo solo con personas de confianza.
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* ─── MODAL CREAR USUARIO ─── */}
      <Modal open={createModal} onClose={() => { setCreateModal(false); setCreateErrors({}); }} title="Crear nuevo usuario"
        footer={<>
          <Button variant="secondary" onClick={() => { setCreateModal(false); setCreateErrors({}); }}>Cancelar</Button>
          <Button onClick={handleCreate} loading={creating}>Crear usuario</Button>
        </>}
      >
        <FormGroup label="Email" required error={createErrors.email}>
          <Input type="email" value={createForm.email} onChange={e => setCreateForm(p=>({...p,email:e.target.value}))} placeholder="usuario@email.com" error={createErrors.email} />
        </FormGroup>
        <FormGroup label="Nombre completo" hint="Opcional, se puede añadir después">
          <Input value={createForm.nombre} onChange={e => setCreateForm(p=>({...p,nombre:e.target.value}))} placeholder="Nombre y apellidos" />
        </FormGroup>
        <FormGroup label="Contraseña temporal" required error={createErrors.password} hint="El usuario podrá cambiarla después">
          <Input type="password" value={createForm.password} onChange={e => setCreateForm(p=>({...p,password:e.target.value}))} placeholder="Mínimo 8 caracteres" error={createErrors.password} />
        </FormGroup>
        <div className="grid grid-cols-2 gap-4">
          <FormGroup label="Estado inicial">
            <Select value={createForm.suscripcion_estado} onChange={e => setCreateForm(p=>({...p,suscripcion_estado:e.target.value}))}>
              {ESTADOS.map(e => <option key={e} value={e}>{e.charAt(0).toUpperCase()+e.slice(1)}</option>)}
            </Select>
          </FormGroup>
          <FormGroup label="Plan">
            <Select value={createForm.suscripcion_plan} onChange={e => setCreateForm(p=>({...p,suscripcion_plan:e.target.value}))}>
              <option value="">Sin plan</option>
              <option value="mensual">Mensual</option>
              <option value="anual">Anual</option>
            </Select>
          </FormGroup>
        </div>
        <FormGroup label="Rol">
          <Select value={createForm.rol} onChange={e => setCreateForm(p=>({...p,rol:e.target.value}))}>
            <option value="usuario">Usuario</option>
            <option value="admin">Admin</option>
          </Select>
        </FormGroup>
        <div className="bg-sky-50 border border-sky-200 rounded-md px-4 py-3 text-xs text-sky-700 mt-1">
          💡 Se creará la cuenta y se enviará un email de confirmación al usuario con sus credenciales de acceso.
        </div>
      </Modal>

      {/* ─── MODAL ELIMINAR ─── */}
      <Modal open={!!deleteUser} onClose={() => setDeleteUser(null)} title="Eliminar usuario"
        footer={<>
          <Button variant="secondary" onClick={() => setDeleteUser(null)}>Cancelar</Button>
          <Button variant="danger" onClick={handleDelete} loading={deleting}>Eliminar definitivamente</Button>
        </>}
      >
        <div className="text-center py-2">
          <div className="text-4xl mb-3">⚠️</div>
          <p className="text-sm text-slate-600 leading-relaxed mb-4">
            ¿Seguro que quieres eliminar este usuario? Se borrarán todos sus datos: intentos, sesiones y estadísticas. <strong>Esta acción no se puede deshacer.</strong>
          </p>
          {deleteUser && (
            <div className="bg-surface border border-border rounded-lg p-3 text-left">
              <div className="text-sm font-semibold text-ink">{deleteUser.nombre || <span className="italic text-slate-400">Sin nombre</span>}</div>
              <div className="text-xs text-slate-400 font-mono">{deleteUser.email}</div>
            </div>
          )}
        </div>
      </Modal>
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
