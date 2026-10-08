import { useState, useRef, useEffect } from 'react';
import { supabase, fetchSpecialties, insertQuestion, createImportLog, updateImportLog, getImportLogs } from '../../lib/supabase';
import { useAuthStore, toast } from '../../store';
import { Button, Badge, Card, CardHeader, EmptyState } from '../../components/ui';
import { parseCSVRows } from '../../lib/csv';

const REQUIRED_FIELDS = ['text','correct_option_letter','specialty_id','option_a','option_b','option_c','option_d'];
const SAMPLE_CSV = `text,specialty_id,correct_option_letter,difficulty,year_exam,explanation,option_a,option_b,option_c,option_d,option_e,subtopic,source,status,image_url
"Mujer de 58 años con fiebre y tos. RX: condensación LID. ¿Germen más probable?",infec,c,3,2023,"S. pneumoniae es el más frecuente en NAC del adulto.",Legionella,Mycoplasma,"S. pneumoniae",Staphylococcus,Klebsiella,Neumonía,original,published,`;

// Umbral de similitud: >= 0.85 = duplicado, >= 0.65 = sospechoso
const DUP_HIGH  = 0.85;
const DUP_LOW   = 0.65;

export default function ImportarPage() {
  const { profile }    = useAuthStore();
  const [specialties, setSpecialties] = useState([]);
  const [phase, setPhase]     = useState('upload'); // upload | preview | checking | importing | done
  const [parsed, setParsed]   = useState([]);
  const [errors, setErrors]   = useState([]);
  const [checked, setChecked] = useState({}); // { rowIndex: bool } qué filas se van a importar
  const [dupProgress, setDupProgress] = useState({ done: 0, total: 0 });
  const [progress, setProgress]       = useState({ done: 0, total: 0, errors: [] });
  const [logs, setLogs]       = useState([]);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef();

  useEffect(() => {
    fetchSpecialties().then(setSpecialties);
    getImportLogs().then(setLogs);
  }, []);

  // ─── Parse CSV ─────────────────────────────────────────
  function parseCSV(text) {
    const all = parseCSVRows(text);
    if (all.length < 2) return { rows:[], errors:['El archivo CSV está vacío o no tiene datos'] };
    const headers = all[0].map(h => h.trim());
    const rows = [], errs = [];
    for (let i = 1; i < all.length; i++) {
      const vals = all[i];
      const row  = {};
      headers.forEach((h, j) => { row[h] = (vals[j] || '').trim(); });
      const missing = REQUIRED_FIELDS.filter(f => !row[f]);
      if (missing.length) { errs.push(`Fila ${i+1}: faltan campos ${missing.join(', ')}`); continue; }
      rows.push(normalizeRow(row, i+1));
    }
    return { rows, errors: errs };
  }

  // ─── Parse JSON ────────────────────────────────────────
  function parseJSON(text) {
    try {
      const data = JSON.parse(text);
      const arr  = Array.isArray(data) ? data : data.questions || [];
      const rows = [], errs = [];
      arr.forEach((item, i) => {
        const missing = REQUIRED_FIELDS.filter(f => !item[f]);
        if (missing.length) { errs.push(`Item ${i+1}: faltan campos ${missing.join(', ')}`); return; }
        rows.push(normalizeRow(item, i+1));
      });
      return { rows, errors: errs };
    } catch (e) {
      return { rows:[], errors:['JSON inválido: ' + e.message] };
    }
  }

  function normalizeRow(row, num) {
    const options = [
      { letter:'a', text: row.option_a || row.opcion_a || '' },
      { letter:'b', text: row.option_b || row.opcion_b || '' },
      { letter:'c', text: row.option_c || row.opcion_c || '' },
      { letter:'d', text: row.option_d || row.opcion_d || '' },
      { letter:'e', text: row.option_e || row.opcion_e || '' },
    ].filter(o => o.text.trim());

    const spId = row.specialty_id?.toLowerCase();
    const sp   = specialties.find(s => s.id===spId || s.name?.toLowerCase()===spId);

    // Validación: la letra correcta debe existir entre las opciones y deben ser al menos 2
    const correct = (row.correct_option_letter || row.respuesta_correcta || 'a').toLowerCase().charAt(0);
    let issue = null;
    if (!sp) issue = `especialidad desconocida: ${row.specialty_id}`;
    else if (options.length < 2) issue = 'menos de 2 opciones';
    else if (!options.some(o => o.letter === correct)) issue = `la correcta (${correct}) no está entre las opciones`;
    const SOURCES = ['official', 'original', 'adapted'], STATUSES = ['draft', 'reviewed', 'published'];

    return {
      _row:      num,
      _valid:    !issue,
      _issue:    issue,
      _specName: sp?.name || row.specialty_id,
      _dups:     null, // null = sin comprobar, [] = sin duplicados, [{...}] = duplicados
      text:                  row.text || row.enunciado,
      explanation:           row.explanation || row.explicacion || '',
      correct_option_letter: (row.correct_option_letter || row.respuesta_correcta || 'a').toLowerCase().charAt(0),
      specialty_id:          sp?.id || row.specialty_id,
      difficulty:            Math.min(5, Math.max(1, parseInt(row.difficulty || row.dificultad) || 3)),
      year_exam:             row.year_exam || row.anyo_mir ? parseInt(row.year_exam||row.anyo_mir) : null,
      question_number:       row.question_number ? parseInt(row.question_number) : null,
      is_active:             row.is_active !== 'false',
      image_url:             row.image_url?.trim() || null,
      subtopic:              row.subtopic?.trim() || null,
      source:                SOURCES.includes(row.source) ? row.source : 'original',
      status:                STATUSES.includes(row.status) ? row.status : 'published',
      options,
    };
  }

  function handleFile(file) {
    if (!file) return;
    const ext = file.name.split('.').pop().toLowerCase();
    const reader = new FileReader();
    reader.onload = e => {
      const text = e.target.result;
      const { rows, errors: errs } = ext === 'json' ? parseJSON(text) : parseCSV(text);
      setParsed(rows);
      setErrors(errs);
      // Inicializar todas las filas válidas como seleccionadas para importar
      const initial = {};
      rows.forEach((r, i) => { if (r._valid) initial[i] = true; });
      setChecked(initial);
      setPhase('preview');
    };
    reader.readAsText(file, 'UTF-8');
  }

  function handleDrop(e) {
    e.preventDefault(); setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }

  // ─── Comprobación de duplicados ────────────────────────
  async function handleCheckDuplicates() {
    const valid = parsed.filter(r => r._valid);
    setPhase('checking');
    setDupProgress({ done: 0, total: valid.length });

    const updated = [...parsed];
    let done = 0;

    for (let i = 0; i < updated.length; i++) {
      const row = updated[i];
      if (!row._valid) continue;

      try {
        const { data: similares } = await supabase.rpc('find_similar_questions', {
          query_text: row.text,
          threshold:  DUP_LOW,
        });
        updated[i] = { ...row, _dups: similares || [] };

        // Auto-desmarcar si es duplicado claro (>= 85%)
        const maxSim = similares?.length ? Math.max(...similares.map(s => s.sim)) : 0;
        if (maxSim >= DUP_HIGH) {
          setChecked(prev => ({ ...prev, [i]: false }));
        }
      } catch {
        updated[i] = { ...row, _dups: [] };
      }

      done++;
      setDupProgress({ done, total: valid.length });
      setParsed([...updated]);
    }

    setPhase('preview');
    const dupCount   = updated.filter(r => r._dups?.length && Math.max(...r._dups.map(s=>s.sim)) >= DUP_HIGH).length;
    const warnCount  = updated.filter(r => r._dups?.length && Math.max(...r._dups.map(s=>s.sim)) < DUP_HIGH).length;
    toast.success(`Comprobación lista — ${dupCount} duplicados, ${warnCount} sospechosas`);
  }

  // ─── Importar ──────────────────────────────────────────
  async function handleImport() {
    const toImport = parsed.filter((r, i) => r._valid && checked[i] !== false);
    if (!toImport.length) { toast.error('No hay preguntas seleccionadas para importar'); return; }

    setPhase('importing');
    const log = await createImportLog(profile.id, 'importación', toImport.length);
    const importErrors = [];
    let done = 0;

    for (const row of toImport) {
      try {
        const { _row, _valid, _issue, _specName, _dups, options, ...qData } = row;
        await insertQuestion(qData, options);
        done++;
        setProgress({ done, total: toImport.length, errors: importErrors });
      } catch (err) {
        importErrors.push(`Fila ${row._row}: ${err.message}`);
        setProgress({ done, total: toImport.length, errors: importErrors });
      }
    }

    await updateImportLog(log.id, {
      imported: done, skipped: toImport.length - done,
      errors: importErrors, status: 'done',
    });

    setPhase('done');
    getImportLogs().then(setLogs);
    toast.success(`${done} preguntas importadas correctamente`);
  }

  // ─── Helpers ───────────────────────────────────────────
  function getDupStatus(row, idx) {
    if (row._dups === null) return 'unchecked';
    if (!row._dups.length)  return 'new';
    const max = Math.max(...row._dups.map(s => s.sim));
    if (max >= DUP_HIGH)    return 'duplicate';
    return 'warning';
  }

  const validCount    = parsed.filter(r => r._valid).length;
  const invalidCount  = parsed.filter(r => !r._valid).length;
  const dupCount      = parsed.filter((r,i) => r._valid && getDupStatus(r,i) === 'duplicate').length;
  const warnCount     = parsed.filter((r,i) => r._valid && getDupStatus(r,i) === 'warning').length;
  const newCount      = parsed.filter((r,i) => r._valid && getDupStatus(r,i) === 'new').length;
  const selectedCount = parsed.filter((r, i) => r._valid && checked[i] !== false).length;
  const dupChecked    = parsed.some(r => r._dups !== null);

  function toggleRow(i) {
    setChecked(prev => ({ ...prev, [i]: !prev[i] }));
  }

  function selectAll(val) {
    const next = {};
    parsed.forEach((r, i) => { if (r._valid) next[i] = val; });
    setChecked(next);
  }

  return (
    <div>
      <div className="flex items-start justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-2xl font-bold text-ink tracking-tight">Importar preguntas</h1>
          <p className="text-sm text-slate-400 mt-1">Carga tandas grandes de preguntas en CSV o JSON</p>
        </div>
      </div>

      {/* ─── UPLOAD ─── */}
      {phase === 'upload' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <Card>
            <CardHeader title="Subir archivo" subtitle="CSV o JSON con las preguntas" />
            <div
              onDrop={handleDrop}
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              className={`border-2 border-dashed rounded-xl p-10 text-center transition-all cursor-pointer mb-4 ${dragOver?'border-pulse bg-pulse/5':'border-border hover:border-sky-300 hover:bg-sky-50'}`}
              onClick={() => fileRef.current?.click()}>
              <input ref={fileRef} type="file" accept=".csv,.json" className="hidden" onChange={e => handleFile(e.target.files[0])} />
              <div className="text-4xl mb-3">📂</div>
              <p className="font-semibold text-ink text-sm">Arrastra tu archivo aquí</p>
              <p className="text-xs text-slate-400 mt-1">o haz clic para seleccionar · CSV o JSON</p>
            </div>
          </Card>

          <Card>
            <CardHeader title="Formato esperado" subtitle="Descarga el ejemplo para empezar" />
            <div className="bg-surface rounded-lg p-4 font-mono text-xs text-slate-500 overflow-x-auto mb-4 border border-border">
              <pre>{SAMPLE_CSV}</pre>
            </div>
            <Button variant="secondary" fullWidth onClick={() => {
              const a = document.createElement('a');
              a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(SAMPLE_CSV);
              a.download = 'plantilla_mirai.csv';
              a.click();
            }}>
              Descargar plantilla CSV
            </Button>
          </Card>
        </div>
      )}

      {/* ─── CHECKING DUPLICATES ─── */}
      {phase === 'checking' && (
        <Card className="text-center py-12">
          <div className="w-16 h-16 rounded-full border-4 border-amber-100 border-t-amber-400 animate-spin mx-auto mb-6"/>
          <h3 className="font-display font-bold text-xl text-ink mb-2">Comprobando duplicados...</h3>
          <p className="text-slate-400 text-sm mb-6">
            Comparando {dupProgress.done} de {dupProgress.total} preguntas contra el banco existente
          </p>
          <div className="max-w-md mx-auto">
            <div className="h-3 bg-amber-100 rounded-full overflow-hidden mb-2">
              <div className="h-full bg-gradient-to-r from-amber-400 to-amber-500 rounded-full transition-all duration-300"
                style={{width:`${dupProgress.total ? Math.round((dupProgress.done/dupProgress.total)*100) : 0}%`}}/>
            </div>
            <div className="text-xs text-slate-400 font-mono text-right">
              {dupProgress.total ? Math.round((dupProgress.done/dupProgress.total)*100) : 0}%
            </div>
          </div>
        </Card>
      )}

      {/* ─── PREVIEW ─── */}
      {phase === 'preview' && (
        <div>
          {/* Stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
            <div className="bg-white border border-border rounded-lg p-4 text-center">
              <div className="font-display font-bold text-2xl text-ink">{parsed.length}</div>
              <div className="text-xs text-slate-400 mt-0.5">Detectadas</div>
            </div>
            <div className="bg-pulse-bg border border-pulse-dim/20 rounded-lg p-4 text-center">
              <div className="font-display font-bold text-2xl text-pulse-dim">{selectedCount}</div>
              <div className="text-xs text-slate-400 mt-0.5">Seleccionadas</div>
            </div>
            {dupChecked ? (
              <>
                <div className={`rounded-lg p-4 text-center border ${dupCount>0?'bg-red-50 border-red-200':'bg-surface border-border'}`}>
                  <div className={`font-display font-bold text-2xl ${dupCount>0?'text-red-400':'text-slate-300'}`}>{dupCount}</div>
                  <div className="text-xs text-slate-400 mt-0.5">Duplicadas</div>
                </div>
                <div className={`rounded-lg p-4 text-center border ${warnCount>0?'bg-amber-50 border-amber-200':'bg-surface border-border'}`}>
                  <div className={`font-display font-bold text-2xl ${warnCount>0?'text-amber-500':'text-slate-300'}`}>{warnCount}</div>
                  <div className="text-xs text-slate-400 mt-0.5">Sospechosas</div>
                </div>
              </>
            ) : (
              <div className={`rounded-lg p-4 text-center border ${invalidCount>0?'bg-red-50 border-red-200':'bg-surface border-border'} col-span-2`}>
                <div className={`font-display font-bold text-2xl ${invalidCount>0?'text-red-400':'text-slate-300'}`}>{invalidCount}</div>
                <div className="text-xs text-slate-400 mt-0.5">Con errores de formato</div>
              </div>
            )}
          </div>

          {/* Errores de parse */}
          {errors.length > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-5">
              <div className="font-mono text-xs font-bold text-red-600 uppercase tracking-wider mb-2">
                Errores de formato ({errors.length})
              </div>
              <div className="flex flex-col gap-1 max-h-32 overflow-y-auto">
                {errors.map((e,i) => <p key={i} className="text-xs text-red-600">{e}</p>)}
              </div>
            </div>
          )}

          {/* Leyenda si ya se comprobaron */}
          {dupChecked && (
            <div className="flex items-center gap-4 mb-4 flex-wrap">
              <span className="text-xs text-slate-400 font-semibold">Leyenda:</span>
              {[
                { color:'bg-pulse-dim', label:'Nueva' },
                { color:'bg-amber-400', label:'Sospechosa (similar)' },
                { color:'bg-red-400',   label:'Duplicada (auto-desmarcada)' },
              ].map(l => (
                <div key={l.label} className="flex items-center gap-1.5 text-xs text-slate-500">
                  <span className={`w-2.5 h-2.5 rounded-full ${l.color}`}/>
                  {l.label}
                </div>
              ))}
              <div className="ml-auto flex gap-2">
                <button onClick={() => selectAll(true)}
                  className="text-xs text-sky-600 hover:underline font-semibold">
                  Seleccionar todas
                </button>
                <span className="text-slate-300">·</span>
                <button onClick={() => selectAll(false)}
                  className="text-xs text-slate-400 hover:underline">
                  Deseleccionar todas
                </button>
              </div>
            </div>
          )}

          {/* Tabla preview */}
          <Card padding={false} className="mb-5">
            <div className="p-4 border-b border-border flex items-center justify-between">
              <h3 className="font-display font-bold text-base text-ink">Preview de preguntas</h3>
              <span className="text-xs text-slate-400 font-mono">
                Mostrando {Math.min(20, parsed.length)} de {parsed.length}
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-surface border-b border-border">
                    <th className="px-4 py-2.5 w-10"/>
                    <th className="text-left px-4 py-2.5 font-mono text-[0.65rem] font-semibold uppercase tracking-wider text-slate-400">#</th>
                    <th className="text-left px-4 py-2.5 font-mono text-[0.65rem] font-semibold uppercase tracking-wider text-slate-400">Estado</th>
                    <th className="text-left px-4 py-2.5 font-mono text-[0.65rem] font-semibold uppercase tracking-wider text-slate-400">Enunciado</th>
                    <th className="text-left px-4 py-2.5 font-mono text-[0.65rem] font-semibold uppercase tracking-wider text-slate-400">Especialidad</th>
                    <th className="text-left px-4 py-2.5 font-mono text-[0.65rem] font-semibold uppercase tracking-wider text-slate-400">Dif.</th>
                    {dupChecked && <th className="text-left px-4 py-2.5 font-mono text-[0.65rem] font-semibold uppercase tracking-wider text-slate-400">Duplicado</th>}
                  </tr>
                </thead>
                <tbody>
                  {parsed.slice(0, 20).map((row, i) => {
                    const status  = getDupStatus(row, i);
                    const maxSim  = row._dups?.length ? Math.max(...row._dups.map(s => s.sim)) : 0;
                    const isChecked = checked[i] !== false && row._valid;

                    return (
                      <tr key={row._row}
                        className={`border-t border-border transition-colors ${
                          !row._valid           ? 'bg-red-50 opacity-60' :
                          status==='duplicate'  ? 'bg-red-50' :
                          status==='warning'    ? 'bg-amber-50' :
                          isChecked             ? 'hover:bg-sky-50' : 'opacity-50'
                        }`}>
                        {/* Checkbox */}
                        <td className="px-4 py-3">
                          {row._valid && (
                            <input type="checkbox" checked={isChecked}
                              onChange={() => toggleRow(i)}
                              className="w-4 h-4 cursor-pointer accent-sky-500"/>
                          )}
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-slate-400">{row._row}</td>
                        <td className="px-4 py-3">
                          {row._valid
                            ? <span className="w-5 h-5 rounded-full bg-pulse-dim flex items-center justify-center text-white text-xs">✓</span>
                            : <span className="w-5 h-5 rounded-full bg-red-400 flex items-center justify-center text-white text-xs">✕</span>
                          }
                        </td>
                        <td className="px-4 py-3 max-w-xs">
                          <p className="text-xs text-ink line-clamp-2">{row.text}</p>
                        </td>
                        <td className="px-4 py-3">
                          {row._valid
                            ? <Badge variant="blue">{row._specName}</Badge>
                            : <span className="text-xs text-red-500 font-mono">{row._issue || row.specialty_id}</span>
                          }
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-slate-500">{row.difficulty}</td>
                        {dupChecked && (
                          <td className="px-4 py-3">
                            {row._dups === null ? (
                              <span className="text-xs text-slate-300">—</span>
                            ) : status === 'new' ? (
                              <span className="inline-flex items-center gap-1 text-xs font-semibold text-pulse-dim">
                                <span className="w-2 h-2 rounded-full bg-pulse-dim"/>Nueva
                              </span>
                            ) : status === 'duplicate' ? (
                              <div>
                                <span className="inline-flex items-center gap-1 text-xs font-semibold text-red-500">
                                  <span className="w-2 h-2 rounded-full bg-red-400"/>
                                  {Math.round(maxSim * 100)}% similar
                                </span>
                                <p className="text-[0.6rem] text-slate-400 mt-0.5 line-clamp-1">
                                  {row._dups[0]?.text}
                                </p>
                              </div>
                            ) : (
                              <div>
                                <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-500">
                                  <span className="w-2 h-2 rounded-full bg-amber-400"/>
                                  {Math.round(maxSim * 100)}% similar
                                </span>
                                <p className="text-[0.6rem] text-slate-400 mt-0.5 line-clamp-1">
                                  {row._dups[0]?.text}
                                </p>
                              </div>
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {parsed.length > 20 && (
              <div className="px-4 py-3 border-t border-border text-xs text-slate-400 text-center">
                ... y {parsed.length - 20} preguntas más
              </div>
            )}
          </Card>

          <div className="flex gap-3 justify-between flex-wrap">
            <Button variant="secondary" onClick={() => { setPhase('upload'); setParsed([]); setErrors([]); }}>
              ← Cancelar
            </Button>
            <div className="flex gap-3">
              {!dupChecked && (
                <Button variant="secondary" onClick={handleCheckDuplicates} disabled={validCount === 0}>
                  🔍 Comprobar duplicados
                </Button>
              )}
              {dupChecked && (
                <Button variant="secondary" onClick={handleCheckDuplicates}>
                  🔄 Recomprobar
                </Button>
              )}
              <Button onClick={handleImport} disabled={selectedCount === 0}>
                Importar {selectedCount} preguntas →
              </Button>
            </div>
          </div>

          {!dupChecked && (
            <p className="text-xs text-slate-400 text-right mt-2">
              💡 Recomendado: comprueba duplicados antes de importar para evitar preguntas repetidas
            </p>
          )}
        </div>
      )}

      {/* ─── IMPORTING ─── */}
      {phase === 'importing' && (
        <Card className="text-center py-12">
          <div className="w-16 h-16 rounded-full border-4 border-sky-100 border-t-pulse animate-spin mx-auto mb-6"/>
          <h3 className="font-display font-bold text-xl text-ink mb-2">Importando preguntas...</h3>
          <p className="text-slate-400 text-sm mb-6">{progress.done} de {progress.total} completadas</p>
          <div className="max-w-md mx-auto">
            <div className="h-3 bg-sky-100 rounded-full overflow-hidden mb-2">
              <div className="h-full bg-gradient-to-r from-sky-400 to-pulse rounded-full transition-all duration-500"
                style={{width:`${progress.total ? Math.round((progress.done/progress.total)*100) : 0}%`}}/>
            </div>
            <div className="text-xs text-slate-400 font-mono text-right">
              {progress.total ? Math.round((progress.done/progress.total)*100) : 0}%
            </div>
          </div>
        </Card>
      )}

      {/* ─── DONE ─── */}
      {phase === 'done' && (
        <Card className="text-center py-12">
          <div className="w-16 h-16 rounded-full bg-pulse-bg border-2 border-pulse-dim/30 flex items-center justify-center mx-auto mb-5 text-2xl">✓</div>
          <h3 className="font-display font-bold text-xl text-ink mb-2">Importación completada</h3>
          <div className="flex gap-4 justify-center mb-6">
            <div className="text-center">
              <div className="font-display font-bold text-3xl text-pulse-dim">{progress.done}</div>
              <div className="text-xs text-slate-400">importadas</div>
            </div>
            {progress.errors.length > 0 && (
              <div className="text-center">
                <div className="font-display font-bold text-3xl text-red-400">{progress.errors.length}</div>
                <div className="text-xs text-slate-400">con errores</div>
              </div>
            )}
          </div>
          {progress.errors.length > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-left mb-6 max-w-lg mx-auto">
              <div className="font-mono text-xs font-bold text-red-600 uppercase tracking-wider mb-2">
                Errores durante la importación
              </div>
              {progress.errors.slice(0,5).map((e,i) => <p key={i} className="text-xs text-red-600">{e}</p>)}
              {progress.errors.length > 5 && (
                <p className="text-xs text-red-400 mt-1">...y {progress.errors.length - 5} más</p>
              )}
            </div>
          )}
          <div className="flex gap-3 justify-center">
            <Button onClick={() => { setPhase('upload'); setParsed([]); setErrors([]); }}>
              Importar más preguntas
            </Button>
            <Button variant="secondary" onClick={() => window.location.href='/admin/preguntas'}>
              Ver banco de preguntas
            </Button>
          </div>
        </Card>
      )}

      {/* ─── Historial ─── */}
      {logs.length > 0 && phase === 'upload' && (
        <Card padding={false} className="mt-6">
          <div className="p-5 border-b border-border">
            <h3 className="font-display font-bold text-base text-ink">Historial de importaciones</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-surface">
                  {['Archivo','Total','Importadas','Errores','Estado','Fecha'].map(h => (
                    <th key={h} className="text-left px-5 py-3 font-mono text-[0.65rem] font-semibold uppercase tracking-wider text-slate-400">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {logs.map(l => (
                  <tr key={l.id} className="border-t border-border hover:bg-sky-50 transition-colors">
                    <td className="px-5 py-3.5 text-sm text-ink font-medium">{l.filename || '—'}</td>
                    <td className="px-5 py-3.5 font-mono text-sm text-slate-500">{l.total}</td>
                    <td className="px-5 py-3.5 font-mono text-sm text-pulse-dim font-semibold">{l.imported}</td>
                    <td className="px-5 py-3.5 font-mono text-sm text-red-400">{l.skipped || 0}</td>
                    <td className="px-5 py-3.5">
                      <Badge variant={l.status==='done'?'pulse':l.status==='error'?'red':'blue'}>{l.status}</Badge>
                    </td>
                    <td className="px-5 py-3.5 font-mono text-xs text-slate-400">
                      {new Date(l.created_at).toLocaleDateString('es-ES',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'})}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
