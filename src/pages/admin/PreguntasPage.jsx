import { useState, useEffect } from 'react';
import { supabase, fetchAllQuestionsAdmin, fetchSpecialties, insertQuestion } from '../../lib/supabase';
import { useAuthStore, toast } from '../../store';
import { Badge, EmptyState, LoadingScreen, Modal, Button, FormGroup, Input, Select, Textarea, Pagination } from '../../components/ui';

export default function AdminPreguntasPage() {
  const { profile } = useAuthStore();
  const [questions, setQuestions] = useState([]);
  const [specialties, setSpecialties] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [deleteModal, setDeleteModal] = useState(null);
  const [editing, setEditing]   = useState(null);
  const [saving, setSaving]     = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [pagina, setPagina]     = useState(1);
  const POR_PAGINA = 15;

  const EMPTY = {
    text:'', explanation:'', correct_option_letter:'a', specialty_id:'',
    difficulty:3, year_exam:'', question_number:'', is_active:true,
    options:{ a:'', b:'', c:'', d:'', e:'' },
  };
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [filtros, setFiltros] = useState({ q:'', specialty_id:'', difficulty:'', is_active:'' });

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    const [qs, sps] = await Promise.all([fetchAllQuestionsAdmin(), fetchSpecialties()]);
    setQuestions(qs);
    setSpecialties(sps);
    setLoading(false);
  }

  const filtradas = questions.filter(q => {
    if (filtros.specialty_id && q.specialty?.id !== filtros.specialty_id) return false;
    if (filtros.difficulty   && q.difficulty !== parseInt(filtros.difficulty)) return false;
    if (filtros.is_active === 'true'  && !q.is_active) return false;
    if (filtros.is_active === 'false' &&  q.is_active) return false;
    if (filtros.q) {
      const s = filtros.q.toLowerCase();
      if (!q.text?.toLowerCase().includes(s) && !q.specialty?.name?.toLowerCase().includes(s)) return false;
    }
    return true;
  });
  const totalPags = Math.ceil(filtradas.length / POR_PAGINA);
  const pagActual = filtradas.slice((pagina-1)*POR_PAGINA, pagina*POR_PAGINA);
  const f = (k,v) => { setFiltros(p=>({...p,[k]:v})); setPagina(1); };

  function openNew() {
    setEditing(null);
    setForm(EMPTY);
    setErrors({});
    setModalOpen(true);
  }

  function openEdit(q) {
    setEditing(q);
    const opts = { a:'', b:'', c:'', d:'', e:'' };
    (q.options||[]).forEach(o => { opts[o.letter] = o.text; });
    setForm({
      text: q.text, explanation: q.explanation||'',
      correct_option_letter: q.correct_option_letter,
      specialty_id: q.specialty?.id || '',
      difficulty: q.difficulty || 3,
      year_exam: q.year_exam || '',
      question_number: q.question_number || '',
      is_active: q.is_active,
      options: opts,
    });
    setErrors({});
    setModalOpen(true);
  }

  function validate() {
    const e = {};
    if (!form.text.trim())        e.text        = 'El enunciado es obligatorio';
    if (!form.options.a.trim())   e.opt_a       = 'Obligatorio';
    if (!form.options.b.trim())   e.opt_b       = 'Obligatorio';
    if (!form.options.c.trim())   e.opt_c       = 'Obligatorio';
    if (!form.options.d.trim())   e.opt_d       = 'Obligatorio';
    if (!form.specialty_id)       e.specialty_id = 'Selecciona una especialidad';
    if (!form.explanation.trim()) e.explanation  = 'La explicación es obligatoria';
    return e;
  }

  async function handleSave() {
    const e = validate();
    if (Object.keys(e).length) { setErrors(e); return; }
    setSaving(true);

    const qPayload = {
      text:                  form.text.trim(),
      explanation:           form.explanation.trim(),
      correct_option_letter: form.correct_option_letter,
      specialty_id:          form.specialty_id,
      difficulty:            parseInt(form.difficulty),
      year_exam:             form.year_exam ? parseInt(form.year_exam) : null,
      question_number:       form.question_number ? parseInt(form.question_number) : null,
      is_active:             form.is_active,
    };

    const optPayload = Object.entries(form.options)
      .filter(([,text]) => text.trim())
      .map(([letter, text]) => ({ letter, text: text.trim() }));

    try {
      if (editing) {
        await supabase.from('questions').update(qPayload).eq('id', editing.id);
        await supabase.from('question_options').delete().eq('question_id', editing.id);
        await supabase.from('question_options').insert(optPayload.map(o => ({ ...o, question_id: editing.id })));
        toast.success('Pregunta actualizada');
      } else {
        await insertQuestion(qPayload, optPayload);
        toast.success('Pregunta añadida correctamente');
      }
      setModalOpen(false);
      load();
    } catch (err) {
      toast.error('Error al guardar: ' + err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    await supabase.from('questions').delete().eq('id', deleteModal.id);
    toast.success('Pregunta eliminada');
    setDeleteModal(null);
    load();
    setDeleting(false);
  }

  async function toggleActive(q) {
    await supabase.from('questions').update({ is_active: !q.is_active }).eq('id', q.id);
    setQuestions(prev => prev.map(x => x.id===q.id ? {...x,is_active:!x.is_active} : x));
    toast.success(q.is_active ? 'Pregunta desactivada' : 'Pregunta activada');
  }

  const DIFF_MAP = { 1:'Muy fácil', 2:'Fácil', 3:'Media', 4:'Difícil', 5:'Muy difícil' };
  const DIFF_VARIANT = { 1:'green', 2:'green', 3:'amber', 4:'red', 5:'red' };

  if (loading) return <LoadingScreen message="Cargando preguntas..." />;

  return (
    <div>
      <div className="flex items-start justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-2xl font-bold text-ink tracking-tight">Gestión de preguntas</h1>
          <p className="text-sm text-slate-400 mt-1">{questions.length} preguntas · {questions.filter(q=>q.is_active).length} activas</p>
        </div>
        <Button onClick={openNew}>+ Nueva pregunta</Button>
      </div>

      {/* Filtros */}
      <div className="bg-white border border-border rounded-lg p-4 mb-5 flex flex-wrap gap-3 items-center">
        <input type="text" placeholder="Buscar por enunciado o especialidad..." value={filtros.q}
          onChange={e => f('q',e.target.value)}
          className="flex-1 min-w-[200px] px-3.5 py-2 border border-border rounded-md text-sm outline-none focus:border-sky-400 focus:shadow-[0_0_0_3px_rgba(14,165,233,.1)] transition-all"/>
        <select value={filtros.specialty_id} onChange={e => f('specialty_id',e.target.value)}
          className="px-3 py-2 border border-border rounded-md text-sm text-slate-600 outline-none focus:border-sky-400 bg-white cursor-pointer">
          <option value="">Todas las especialidades</option>
          {specialties.map(sp => <option key={sp.id} value={sp.id}>{sp.name}</option>)}
        </select>
        <select value={filtros.difficulty} onChange={e => f('difficulty',e.target.value)}
          className="px-3 py-2 border border-border rounded-md text-sm text-slate-600 outline-none focus:border-sky-400 bg-white cursor-pointer">
          <option value="">Todas las dificultades</option>
          {[1,2,3,4,5].map(d => <option key={d} value={d}>{DIFF_MAP[d]}</option>)}
        </select>
        <select value={filtros.is_active} onChange={e => f('is_active',e.target.value)}
          className="px-3 py-2 border border-border rounded-md text-sm text-slate-600 outline-none focus:border-sky-400 bg-white cursor-pointer">
          <option value="">Todas</option>
          <option value="true">Activas</option>
          <option value="false">Inactivas</option>
        </select>
        {(filtros.q||filtros.specialty_id||filtros.difficulty||filtros.is_active) && (
          <button onClick={() => { setFiltros({q:'',specialty_id:'',difficulty:'',is_active:''}); setPagina(1); }}
            className="text-xs text-slate-400 hover:text-red-500 font-semibold transition-colors">✕ Limpiar</button>
        )}
        <span className="ml-auto text-xs text-slate-400 font-mono">{filtradas.length} resultado{filtradas.length!==1?'s':''}</span>
      </div>

      {/* Tabla */}
      <div className="bg-white border border-border rounded-lg overflow-hidden">
        {pagActual.length === 0
          ? <EmptyState icon="📋" title="Sin preguntas" subtitle="No hay preguntas con estos filtros."
              action={<Button onClick={openNew} size="sm">+ Añadir primera pregunta</Button>} />
          : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="bg-surface border-b border-border">
                      {['Enunciado','Especialidad','Dificultad','Año MIR','Estado','Acciones'].map(h => (
                        <th key={h} className="text-left px-5 py-3 font-mono text-[0.65rem] font-semibold uppercase tracking-wider text-slate-400">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {pagActual.map(q => (
                      <tr key={q.id} className="border-t border-border hover:bg-sky-50 transition-colors group">
                        <td className="px-5 py-3.5 max-w-xs">
                          <p className="text-sm text-ink font-medium line-clamp-2 leading-snug">{q.text}</p>
                          <p className="text-xs text-slate-400 mt-0.5 font-mono">Correcta: {q.correct_option_letter?.toUpperCase()}</p>
                        </td>
                        <td className="px-4 py-3.5">
                          {q.specialty && (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-sky-50 text-sky-700 border border-sky-200 font-mono text-[0.68rem] font-semibold">
                              {q.specialty.name}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3.5">
                          <Badge variant={DIFF_VARIANT[q.difficulty]||'gray'}>{DIFF_MAP[q.difficulty]||'—'}</Badge>
                        </td>
                        <td className="px-4 py-3.5 font-mono text-sm text-slate-500">{q.year_exam||'—'}</td>
                        <td className="px-4 py-3.5">
                          <button onClick={() => toggleActive(q)}
                            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold transition-all ${q.is_active?'bg-pulse-bg text-pulse-dim hover:bg-red-50 hover:text-red-500':'bg-surface text-slate-400 hover:bg-pulse-bg hover:text-pulse-dim'}`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${q.is_active?'bg-pulse-dim':'bg-slate-300'}`}/>
                            {q.is_active?'Activa':'Inactiva'}
                          </button>
                        </td>
                        <td className="px-5 py-3.5">
                          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button onClick={() => openEdit(q)}
                              className="w-8 h-8 flex items-center justify-center rounded-md border border-border hover:border-sky-300 hover:bg-sky-50 text-slate-400 hover:text-sky-600 transition-all text-sm">✏️</button>
                            <button onClick={() => setDeleteModal(q)}
                              className="w-8 h-8 flex items-center justify-center rounded-md border border-border hover:border-red-200 hover:bg-red-50 text-slate-400 hover:text-red-500 transition-all text-sm">🗑</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination page={pagina} total={filtradas.length} perPage={POR_PAGINA} onChange={setPagina} />
            </>
          )
        }
      </div>

      {/* Modal crear/editar */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)}
        title={editing ? 'Editar pregunta' : 'Nueva pregunta'} maxWidth="max-w-3xl"
        footer={<>
          <Button variant="secondary" onClick={() => setModalOpen(false)}>Cancelar</Button>
          <Button onClick={handleSave} loading={saving}>{editing?'Guardar cambios':'Añadir pregunta'}</Button>
        </>}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-5">
          <div className="md:col-span-2">
            <FormGroup label="Enunciado" required error={errors.text}>
              <Textarea value={form.text} onChange={e=>setForm(p=>({...p,text:e.target.value}))} placeholder="Escribe el enunciado clínico completo..." error={errors.text} />
            </FormGroup>
          </div>
          {['a','b','c','d'].map(l => (
            <FormGroup key={l} label={`Opción ${l.toUpperCase()}`} required error={errors[`opt_${l}`]}>
              <Input value={form.options[l]} onChange={e=>setForm(p=>({...p,options:{...p.options,[l]:e.target.value}}))} placeholder={`Texto opción ${l.toUpperCase()}`} error={errors[`opt_${l}`]}/>
            </FormGroup>
          ))}
          <FormGroup label="Opción E" hint="Opcional">
            <Input value={form.options.e} onChange={e=>setForm(p=>({...p,options:{...p.options,e:e.target.value}}))} placeholder="Texto opción E (si aplica)"/>
          </FormGroup>
          <FormGroup label="Respuesta correcta" required>
            <Select value={form.correct_option_letter} onChange={e=>setForm(p=>({...p,correct_option_letter:e.target.value}))}>
              {Object.entries(form.options).filter(([,t])=>t.trim()).map(([l])=>(
                <option key={l} value={l}>Opción {l.toUpperCase()}</option>
              ))}
            </Select>
          </FormGroup>
          <FormGroup label="Especialidad" required error={errors.specialty_id}>
            <Select value={form.specialty_id} onChange={e=>setForm(p=>({...p,specialty_id:e.target.value}))} error={errors.specialty_id}>
              <option value="">Selecciona especialidad...</option>
              {specialties.map(sp=><option key={sp.id} value={sp.id}>{sp.name}</option>)}
            </Select>
          </FormGroup>
          <FormGroup label="Dificultad" required>
            <Select value={form.difficulty} onChange={e=>setForm(p=>({...p,difficulty:parseInt(e.target.value)}))}>
              {[1,2,3,4,5].map(d=><option key={d} value={d}>{d} — {DIFF_MAP[d]}</option>)}
            </Select>
          </FormGroup>
          <FormGroup label="Año MIR" hint="Dejar vacío si es elaboración propia">
            <Input type="number" value={form.year_exam} onChange={e=>setForm(p=>({...p,year_exam:e.target.value}))} placeholder="Ej: 2024" min="1990" max="2030"/>
          </FormGroup>
          <FormGroup label="Nº pregunta en el examen" hint="Opcional">
            <Input type="number" value={form.question_number} onChange={e=>setForm(p=>({...p,question_number:e.target.value}))} placeholder="Ej: 42"/>
          </FormGroup>
          <div className="md:col-span-2">
            <FormGroup label="Explicación de la respuesta" required error={errors.explanation}>
              <Textarea value={form.explanation} onChange={e=>setForm(p=>({...p,explanation:e.target.value}))} placeholder="Explica por qué la respuesta es correcta..." error={errors.explanation} className="min-h-[120px]"/>
            </FormGroup>
          </div>
          <div className="md:col-span-2 flex items-center gap-3 mt-1">
            <button type="button" onClick={() => setForm(p=>({...p,is_active:!p.is_active}))}
              className={`relative w-10 h-5 rounded-full transition-colors ${form.is_active?'bg-pulse-dim':'bg-slate-200'}`}>
              <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all ${form.is_active?'left-5':'left-0.5'}`}/>
            </button>
            <span className="text-sm font-medium text-ink">{form.is_active?'Activa (visible para estudiantes)':'Inactiva (no visible)'}</span>
          </div>
        </div>
      </Modal>

      {/* Modal eliminar */}
      <Modal open={!!deleteModal} onClose={() => setDeleteModal(null)} title="Eliminar pregunta"
        footer={<>
          <Button variant="secondary" onClick={() => setDeleteModal(null)}>Cancelar</Button>
          <Button variant="danger" onClick={handleDelete} loading={deleting}>Eliminar definitivamente</Button>
        </>}>
        <div className="text-center py-2">
          <div className="text-4xl mb-3">🗑️</div>
          <p className="text-sm text-slate-500 leading-relaxed mb-4">¿Seguro que quieres eliminar esta pregunta? Esta acción no se puede deshacer.</p>
          {deleteModal && (
            <div className="bg-surface border border-border rounded-lg p-3 text-left">
              <p className="text-sm text-ink font-medium line-clamp-2">{deleteModal.text}</p>
              <div className="flex gap-2 mt-2">
                {deleteModal.specialty && <Badge variant="blue">{deleteModal.specialty.name}</Badge>}
                <Badge variant={DIFF_VARIANT[deleteModal.difficulty]||'gray'}>{DIFF_MAP[deleteModal.difficulty]||'—'}</Badge>
              </div>
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}
