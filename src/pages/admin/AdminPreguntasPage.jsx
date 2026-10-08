import { useState, useEffect, useRef } from 'react';
import { supabase } from '../../lib/supabase';
import { useAuthStore, toast } from '../../store';
import { Badge, EmptyState, LoadingScreen, Modal, Button, FormGroup, Input, Select, Textarea } from '../../components/ui';

const ESPECIALIDADES = [
  'Cardiología','Neumología','Digestivo','Nefrología','Neurología',
  'Endocrinología','Reumatología','Hematología','Oncología','Infecciosas',
  'Ginecología','Obstetricia','Pediatría','Psiquiatría','Dermatología',
  'Oftalmología','ORL','Traumatología','Urología','Cirugía General',
];

const EMPTY_FORM = {
  enunciado:'', opcion_a:'', opcion_b:'', opcion_c:'', opcion_d:'', opcion_e:'',
  respuesta_correcta:'a', especialidad:'', dificultad:'media',
  explicacion:'', referencia:'', anyo_mir:'', activa: true,
};

export default function AdminPreguntasPage() {
  const { usuario } = useAuthStore();
  const [preguntas, setPreguntas]   = useState([]);
  const [loading, setLoading]       = useState(true);
  const [modalOpen, setModalOpen]   = useState(false);
  const [deleteModal, setDeleteModal] = useState(null);
  const [editing, setEditing]       = useState(null);
  const [form, setForm]             = useState(EMPTY_FORM);
  const [errors, setErrors]         = useState({});
  const [saving, setSaving]         = useState(false);
  const [deleting, setDeleting]     = useState(false);
  const [filtros, setFiltros]       = useState({ especialidad:'', dificultad:'', activa:'', q:'' });
  const [pagina, setPagina]         = useState(1);
  const POR_PAGINA = 15;
  const searchRef = useRef();

  useEffect(() => { loadPreguntas(); }, []);

  async function loadPreguntas() {
    setLoading(true);
    const { data } = await supabase
      .from('preguntas')
      .select('*')
      .order('created_at', { ascending: false });
    setPreguntas(data || []);
    setLoading(false);
  }

  // Filtrado local
  const filtradas = preguntas.filter(p => {
    if (filtros.especialidad && p.especialidad !== filtros.especialidad) return false;
    if (filtros.dificultad  && p.dificultad  !== filtros.dificultad)   return false;
    if (filtros.activa === 'true'  && !p.activa) return false;
    if (filtros.activa === 'false' &&  p.activa) return false;
    if (filtros.q) {
      const q = filtros.q.toLowerCase();
      if (!p.enunciado.toLowerCase().includes(q) && !p.especialidad.toLowerCase().includes(q)) return false;
    }
    return true;
  });
  const totalPags = Math.ceil(filtradas.length / POR_PAGINA);
  const pagActual = filtradas.slice((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA);

  function openNew() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setErrors({});
    setModalOpen(true);
  }

  function openEdit(p) {
    setEditing(p);
    setForm({
      enunciado: p.enunciado, opcion_a: p.opcion_a, opcion_b: p.opcion_b,
      opcion_c: p.opcion_c,  opcion_d: p.opcion_d,  opcion_e: p.opcion_e || '',
      respuesta_correcta: p.respuesta_correcta, especialidad: p.especialidad,
      dificultad: p.dificultad, explicacion: p.explicacion,
      referencia: p.referencia || '', anyo_mir: p.anyo_mir || '', activa: p.activa,
    });
    setErrors({});
    setModalOpen(true);
  }

  function validate() {
    const e = {};
    if (!form.enunciado.trim())     e.enunciado   = 'El enunciado es obligatorio';
    if (!form.opcion_a.trim())      e.opcion_a    = 'Obligatorio';
    if (!form.opcion_b.trim())      e.opcion_b    = 'Obligatorio';
    if (!form.opcion_c.trim())      e.opcion_c    = 'Obligatorio';
    if (!form.opcion_d.trim())      e.opcion_d    = 'Obligatorio';
    if (!form.especialidad)         e.especialidad = 'Selecciona una especialidad';
    if (!form.explicacion.trim())   e.explicacion  = 'La explicación es obligatoria';
    if (form.anyo_mir && (isNaN(form.anyo_mir) || form.anyo_mir < 1990 || form.anyo_mir > 2030))
      e.anyo_mir = 'Año no válido (1990-2030)';
    return e;
  }

  async function handleSave() {
    const e = validate();
    if (Object.keys(e).length) { setErrors(e); return; }
    setSaving(true);
    const payload = {
      ...form,
      opcion_e:  form.opcion_e.trim() || null,
      referencia: form.referencia.trim() || null,
      anyo_mir:  form.anyo_mir ? parseInt(form.anyo_mir) : null,
      updated_at: new Date().toISOString(),
    };
    if (!editing) payload.created_by = usuario.id;

    const { error } = editing
      ? await supabase.from('preguntas').update(payload).eq('id', editing.id)
      : await supabase.from('preguntas').insert(payload);

    setSaving(false);
    if (error) { toast.error('Error al guardar la pregunta'); return; }
    toast.success(editing ? 'Pregunta actualizada' : 'Pregunta añadida correctamente');
    setModalOpen(false);
    loadPreguntas();
  }

  async function handleDelete() {
    if (!deleteModal) return;
    setDeleting(true);
    const { error } = await supabase.from('preguntas').delete().eq('id', deleteModal.id);
    setDeleting(false);
    if (error) { toast.error('Error al eliminar'); return; }
    toast.success('Pregunta eliminada');
    setDeleteModal(null);
    loadPreguntas();
  }

  async function toggleActiva(p) {
    await supabase.from('preguntas').update({ activa: !p.activa }).eq('id', p.id);
    setPreguntas(prev => prev.map(x => x.id === p.id ? { ...x, activa: !x.activa } : x));
    toast.success(p.activa ? 'Pregunta desactivada' : 'Pregunta activada');
  }

  const f = (k, v) => { setFiltros(prev => ({...prev, [k]: v})); setPagina(1); };

  if (loading) return <LoadingScreen message="Cargando preguntas..." />;

  return (
    <div>
      {/* Header */}
      <div className="flex items-start justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-2xl font-bold text-ink tracking-tight">Gestión de preguntas</h1>
          <p className="text-sm text-slate-400 mt-1">{preguntas.length} preguntas en el banco · {preguntas.filter(p=>p.activa).length} activas</p>
        </div>
        <Button onClick={openNew}>+ Nueva pregunta</Button>
      </div>

      {/* Filtros */}
      <div className="bg-white border border-border rounded-lg p-4 mb-5 flex flex-wrap gap-3 items-center">
        <input
          ref={searchRef}
          type="text"
          placeholder="Buscar por enunciado o especialidad..."
          value={filtros.q}
          onChange={e => f('q', e.target.value)}
          className="flex-1 min-w-[200px] px-3.5 py-2 border border-border rounded-md text-sm outline-none focus:border-sky-400 focus:shadow-[0_0_0_3px_rgba(14,165,233,.1)] transition-all"
        />
        <select value={filtros.especialidad} onChange={e => f('especialidad', e.target.value)}
          className="px-3 py-2 border border-border rounded-md text-sm text-slate-600 outline-none focus:border-sky-400 bg-white cursor-pointer">
          <option value="">Todas las especialidades</option>
          {ESPECIALIDADES.map(e => <option key={e} value={e}>{e}</option>)}
        </select>
        <select value={filtros.dificultad} onChange={e => f('dificultad', e.target.value)}
          className="px-3 py-2 border border-border rounded-md text-sm text-slate-600 outline-none focus:border-sky-400 bg-white cursor-pointer">
          <option value="">Todas las dificultades</option>
          <option value="facil">Fácil</option>
          <option value="media">Media</option>
          <option value="dificil">Difícil</option>
        </select>
        <select value={filtros.activa} onChange={e => f('activa', e.target.value)}
          className="px-3 py-2 border border-border rounded-md text-sm text-slate-600 outline-none focus:border-sky-400 bg-white cursor-pointer">
          <option value="">Todas</option>
          <option value="true">Activas</option>
          <option value="false">Inactivas</option>
        </select>
        {(filtros.q || filtros.especialidad || filtros.dificultad || filtros.activa) && (
          <button onClick={() => { setFiltros({especialidad:'',dificultad:'',activa:'',q:''}); setPagina(1); }}
            className="text-xs text-slate-400 hover:text-red-500 font-semibold transition-colors">
            ✕ Limpiar
          </button>
        )}
        <span className="ml-auto text-xs text-slate-400 font-mono">{filtradas.length} resultado{filtradas.length !== 1 ? 's' : ''}</span>
      </div>

      {/* Tabla */}
      <div className="bg-white border border-border rounded-lg overflow-hidden">
        {pagActual.length === 0 ? (
          <EmptyState icon="📋" title="Sin preguntas" subtitle="No hay preguntas que coincidan con los filtros." action={<Button onClick={openNew} size="sm">+ Añadir primera pregunta</Button>} />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-surface border-b border-border">
                    <th className="text-left px-5 py-3 font-mono text-[0.65rem] font-semibold uppercase tracking-wider text-slate-400 w-[40%]">Enunciado</th>
                    <th className="text-left px-4 py-3 font-mono text-[0.65rem] font-semibold uppercase tracking-wider text-slate-400">Especialidad</th>
                    <th className="text-left px-4 py-3 font-mono text-[0.65rem] font-semibold uppercase tracking-wider text-slate-400">Dificultad</th>
                    <th className="text-left px-4 py-3 font-mono text-[0.65rem] font-semibold uppercase tracking-wider text-slate-400">Año MIR</th>
                    <th className="text-left px-4 py-3 font-mono text-[0.65rem] font-semibold uppercase tracking-wider text-slate-400">Estado</th>
                    <th className="text-right px-5 py-3 font-mono text-[0.65rem] font-semibold uppercase tracking-wider text-slate-400">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {pagActual.map(p => (
                    <tr key={p.id} className="border-t border-border hover:bg-sky-50 transition-colors group">
                      <td className="px-5 py-3.5">
                        <p className="text-sm text-ink font-medium line-clamp-2 leading-snug">{p.enunciado}</p>
                        <p className="text-xs text-slate-400 mt-0.5 font-mono">Respuesta: {p.respuesta_correcta.toUpperCase()}</p>
                      </td>
                      <td className="px-4 py-3.5">
                        <Badge variant="blue">{p.especialidad}</Badge>
                      </td>
                      <td className="px-4 py-3.5">
                        <Badge variant={p.dificultad === 'facil' ? 'green' : p.dificultad === 'media' ? 'amber' : 'red'}>
                          {p.dificultad}
                        </Badge>
                      </td>
                      <td className="px-4 py-3.5 font-mono text-sm text-slate-500">{p.anyo_mir || '—'}</td>
                      <td className="px-4 py-3.5">
                        <button onClick={() => toggleActiva(p)}
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold transition-all ${p.activa ? 'bg-pulse-bg text-pulse-dim hover:bg-red-50 hover:text-red-500' : 'bg-surface text-slate-400 hover:bg-pulse-bg hover:text-pulse-dim'}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${p.activa ? 'bg-pulse-dim' : 'bg-slate-300'}`} />
                          {p.activa ? 'Activa' : 'Inactiva'}
                        </button>
                      </td>
                      <td className="px-5 py-3.5">
                        <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button onClick={() => openEdit(p)}
                            className="w-8 h-8 flex items-center justify-center rounded-md border border-border hover:border-sky-300 hover:bg-sky-50 text-slate-400 hover:text-sky-600 transition-all text-sm">✏️</button>
                          <button onClick={() => setDeleteModal(p)}
                            className="w-8 h-8 flex items-center justify-center rounded-md border border-border hover:border-red-200 hover:bg-red-50 text-slate-400 hover:text-red-500 transition-all text-sm">🗑</button>
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
                  Mostrando {(pagina-1)*POR_PAGINA+1}–{Math.min(pagina*POR_PAGINA, filtradas.length)} de {filtradas.length}
                </span>
                <div className="flex gap-1">
                  <button disabled={pagina === 1} onClick={() => setPagina(p=>p-1)}
                    className="w-8 h-8 flex items-center justify-center rounded-md border border-border text-sm text-slate-500 hover:border-sky-300 hover:bg-sky-50 disabled:opacity-40 disabled:pointer-events-none transition-all">←</button>
                  {Array.from({length: Math.min(5, totalPags)}, (_, i) => {
                    const p = Math.max(1, Math.min(pagina - 2, totalPags - 4)) + i;
                    return (
                      <button key={p} onClick={() => setPagina(p)}
                        className={`w-8 h-8 flex items-center justify-center rounded-md border text-sm font-mono transition-all ${pagina === p ? 'bg-ink text-white border-ink' : 'border-border text-slate-500 hover:border-sky-300 hover:bg-sky-50'}`}>
                        {p}
                      </button>
                    );
                  })}
                  <button disabled={pagina === totalPags} onClick={() => setPagina(p=>p+1)}
                    className="w-8 h-8 flex items-center justify-center rounded-md border border-border text-sm text-slate-500 hover:border-sky-300 hover:bg-sky-50 disabled:opacity-40 disabled:pointer-events-none transition-all">→</button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Modal crear/editar */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? 'Editar pregunta' : 'Nueva pregunta'}
        maxWidth="max-w-3xl"
        footer={
          <>
            <Button variant="secondary" onClick={() => setModalOpen(false)}>Cancelar</Button>
            <Button onClick={handleSave} loading={saving}>{editing ? 'Guardar cambios' : 'Añadir pregunta'}</Button>
          </>
        }
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-5">
          <div className="md:col-span-2">
            <FormGroup label="Enunciado de la pregunta" required error={errors.enunciado}>
              <Textarea value={form.enunciado} onChange={e => setForm(p=>({...p,enunciado:e.target.value}))} placeholder="Escribe el enunciado clínico completo..." error={errors.enunciado} />
            </FormGroup>
          </div>
          {['a','b','c','d'].map(l => (
            <FormGroup key={l} label={`Opción ${l.toUpperCase()}`} required error={errors[`opcion_${l}`]}>
              <Input value={form[`opcion_${l}`]} onChange={e => setForm(p=>({...p,[`opcion_${l}`]:e.target.value}))} placeholder={`Texto de la opción ${l.toUpperCase()}`} error={errors[`opcion_${l}`]} />
            </FormGroup>
          ))}
          <FormGroup label="Opción E" hint="Opcional">
            <Input value={form.opcion_e} onChange={e => setForm(p=>({...p,opcion_e:e.target.value}))} placeholder="Texto de la opción E (si aplica)" />
          </FormGroup>
          <FormGroup label="Respuesta correcta" required>
            <Select value={form.respuesta_correcta} onChange={e => setForm(p=>({...p,respuesta_correcta:e.target.value}))}>
              {['a','b','c','d','e'].map(l => <option key={l} value={l}>Opción {l.toUpperCase()}</option>)}
            </Select>
          </FormGroup>
          <FormGroup label="Especialidad" required error={errors.especialidad}>
            <Select value={form.especialidad} onChange={e => setForm(p=>({...p,especialidad:e.target.value}))} error={errors.especialidad}>
              <option value="">Selecciona especialidad...</option>
              {ESPECIALIDADES.map(e => <option key={e} value={e}>{e}</option>)}
            </Select>
          </FormGroup>
          <FormGroup label="Dificultad" required>
            <Select value={form.dificultad} onChange={e => setForm(p=>({...p,dificultad:e.target.value}))}>
              <option value="facil">Fácil</option>
              <option value="media">Media</option>
              <option value="dificil">Difícil</option>
            </Select>
          </FormGroup>
          <FormGroup label="Año MIR" hint="Déjalo vacío si es de elaboración propia" error={errors.anyo_mir}>
            <Input type="number" value={form.anyo_mir} onChange={e => setForm(p=>({...p,anyo_mir:e.target.value}))} placeholder="Ej: 2023" min="1990" max="2030" error={errors.anyo_mir} />
          </FormGroup>
          <div className="md:col-span-2">
            <FormGroup label="Explicación de la respuesta" required error={errors.explicacion}>
              <Textarea value={form.explicacion} onChange={e => setForm(p=>({...p,explicacion:e.target.value}))} placeholder="Explica por qué la respuesta es correcta y por qué las demás son incorrectas..." error={errors.explicacion} className="min-h-[120px]" />
            </FormGroup>
          </div>
          <div className="md:col-span-2">
            <FormGroup label="Referencia bibliográfica" hint="Ej: Harrison 21ª ed. Cap. 277">
              <Input value={form.referencia} onChange={e => setForm(p=>({...p,referencia:e.target.value}))} placeholder="Libro, edición, capítulo..." />
            </FormGroup>
          </div>
          <div className="md:col-span-2 flex items-center gap-3 mt-1">
            <button type="button" onClick={() => setForm(p=>({...p,activa:!p.activa}))}
              className={`relative w-10 h-5 rounded-full transition-colors ${form.activa ? 'bg-pulse-dim' : 'bg-slate-200'}`}>
              <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all ${form.activa ? 'left-5' : 'left-0.5'}`} />
            </button>
            <span className="text-sm font-medium text-ink">
              {form.activa ? 'Pregunta activa (visible para estudiantes)' : 'Pregunta inactiva (no visible)'}
            </span>
          </div>
        </div>
      </Modal>

      {/* Modal eliminar */}
      <Modal open={!!deleteModal} onClose={() => setDeleteModal(null)} title="Eliminar pregunta"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeleteModal(null)}>Cancelar</Button>
            <Button variant="danger" onClick={handleDelete} loading={deleting}>Eliminar definitivamente</Button>
          </>
        }
      >
        <div className="text-center py-2">
          <div className="text-4xl mb-4">🗑️</div>
          <p className="text-sm text-slate-500 leading-relaxed">
            ¿Seguro que quieres eliminar esta pregunta? Esta acción no se puede deshacer y se perderán todos los intentos asociados.
          </p>
          {deleteModal && (
            <div className="mt-4 p-3 bg-surface border border-border rounded-md text-left">
              <p className="text-sm text-ink font-medium line-clamp-3">{deleteModal.enunciado}</p>
              <div className="flex gap-2 mt-2">
                <Badge variant="blue">{deleteModal.especialidad}</Badge>
                <Badge variant={deleteModal.dificultad === 'facil' ? 'green' : deleteModal.dificultad === 'media' ? 'amber' : 'red'}>{deleteModal.dificultad}</Badge>
              </div>
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}
