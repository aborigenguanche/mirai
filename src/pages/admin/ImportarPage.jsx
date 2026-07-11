import { useState, useRef } from 'react';
import { supabase, fetchSpecialties, insertQuestion, createImportLog, updateImportLog, getImportLogs } from '../../lib/supabase';
import { useAuthStore, toast } from '../../store';
import { Button, Badge, Card, CardHeader, EmptyState } from '../../components/ui';
import { useEffect } from 'react';

const REQUIRED_FIELDS = ['text','correct_option_letter','specialty_id','option_a','option_b','option_c','option_d'];
const SAMPLE_CSV = `text,specialty_id,correct_option_letter,difficulty,year_exam,explanation,option_a,option_b,option_c,option_d,option_e
"Mujer de 58 años con fiebre y tos. RX: condensación LID. ¿Germen más probable?",infec,c,3,2023,"S.pneumoniae es el más frecuente en NAC del adulto.",Legionella,Mycoplasma,"S. pneumoniae",Staphylococcus,Klebsiella`;

export default function ImportarPage() {
  const { profile }   = useAuthStore();
  const [specialties, setSpecialties] = useState([]);
  const [phase, setPhase]   = useState('upload'); // upload | preview | importing | done
  const [parsed, setParsed] = useState([]);
  const [errors, setErrors] = useState([]);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress]   = useState({ done:0, total:0, errors:[] });
  const [logs, setLogs]           = useState([]);
  const [dragOver, setDragOver]   = useState(false);
  const fileRef = useRef();

  useEffect(() => {
    fetchSpecialties().then(setSpecialties);
    getImportLogs().then(setLogs);
  }, []);

  // ─── Parse CSV ─────────────────────────────────────────
  function parseCSV(text) {
    const lines = text.trim().split('\n');
    if (lines.length < 2) return { rows:[], errors:['El archivo CSV está vacío o no tiene datos'] };
    const headers = parseCSVLine(lines[0]);
    const rows = [], errs = [];
    for (let i = 1; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      const vals = parseCSVLine(lines[i]);
      const row  = {};
      headers.forEach((h,j) => { row[h.trim()] = (vals[j]||'').trim(); });
      const missing = REQUIRED_FIELDS.filter(f => !row[f]);
      if (missing.length) { errs.push(`Fila ${i+1}: faltan campos ${missing.join(', ')}`); continue; }
      rows.push(normalizeRow(row, i+1));
    }
    return { rows, errors: errs };
  }

  function parseCSVLine(line) {
    const result = [], re = /("(?:[^"\\]|\\.)*"|[^,]*)/g;
    let m;
    while ((m = re.exec(line)) !== null) {
      if (m.index === re.lastIndex) re.lastIndex++;
      let val = m[1];
      if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1,-1).replace(/""/g,'"');
      result.push(val);
    }
    return result;
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

    return {
      _row: num,
      _valid: !!sp,
      _specName: sp?.name || row.specialty_id,
      text:                  row.text || row.enunciado,
      explanation:           row.explanation || row.explicacion || '',
      correct_option_letter: (row.correct_option_letter || row.respuesta_correcta || 'a').toLowerCase().charAt(0),
      specialty_id:          sp?.id || row.specialty_id,
      difficulty:            parseInt(row.difficulty || row.dificultad) || 3,
      year_exam:             row.year_exam || row.anyo_mir ? parseInt(row.year_exam||row.anyo_mir) : null,
      question_number:       row.question_number ? parseInt(row.question_number) : null,
      is_active:             row.is_active !== 'false',
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
      setPhase('preview');
    };
    reader.readAsText(file, 'UTF-8');
  }

  function handleDrop(e) {
    e.preventDefault(); setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }

  // ─── Importar ──────────────────────────────────────────
  async function handleImport() {
    const valid = parsed.filter(r => r._valid);
    if (!valid.length) { toast.error('No hay preguntas válidas para importar'); return; }

    setImporting(true);
    setPhase('importing');
    const log = await createImportLog(profile.id, 'importación', valid.length);
    const importErrors = [];
    let done = 0;

    for (const row of valid) {
      try {
        const { _row, _valid, _specName, options, ...qData } = row;
        await insertQuestion(qData, options);
        done++;
        setProgress({ done, total: valid.length, errors: importErrors });
      } catch (err) {
        importErrors.push(`Fila ${row._row}: ${err.message}`);
        setProgress({ done, total: valid.length, errors: importErrors });
      }
    }

    await updateImportLog(log.id, {
      imported: done, skipped: valid.length - done,
      errors: importErrors, status: 'done',
    });

    setProgress({ done, total: valid.length, errors: importErrors });
    setImporting(false);
    setPhase('done');
    getImportLogs().then(setLogs);
    toast.success(`${done} preguntas importadas correctamente`);
  }

  const validCount   = parsed.filter(r => r._valid).length;
  const invalidCount = parsed.filter(r => !r._valid).length;

  return (
    <div>
      <div className="flex items-start justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-2xl font-bold text-ink tracking-tight">Importar preguntas</h1>
          <p className="text-sm text-slate-400 mt-1">Carga tandas grandes de preguntas en CSV o JSON</p>
        </div>
        {phase !== 'upload' && (
          <Button variant="secondary" onClick={() => { setPhase('upload'); setParsed([]); setErrors([]); }}>
            ← Nuevo archivo
          </Button>
        )}
      </div>

      {/* Upload */}
      {phase === 'upload' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <div className="lg:col-span-2">
            <div
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => fileRef.current?.click()}
              className={`border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-all ${dragOver?'border-pulse bg-pulse-bg':'border-border hover:border-sky-300 hover:bg-sky-50'}`}>
              <input ref={fileRef} type="file" accept=".csv,.json" className="hidden"
                onChange={e => handleFile(e.target.files[0])} />
              <div className="text-4xl mb-4">📥</div>
              <h3 className="font-display font-bold text-lg text-ink mb-2">Arrastra tu archivo aquí</h3>
              <p className="text-sm text-slate-400 mb-4">o haz clic para seleccionarlo</p>
              <div className="flex gap-2 justify-center flex-wrap">
                {['.csv','UTF-8','.json','Hasta 5.000 preguntas'].map(t => (
                  <span key={t} className="text-xs bg-surface border border-border px-2.5 py-1 rounded-full text-slate-500">{t}</span>
                ))}
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-4">
            <Card>
              <CardHeader title="Formato CSV" subtitle="Columnas requeridas" />
              <div className="flex flex-col gap-1.5 text-xs font-mono text-slate-600 mb-3">
                {['text *','specialty_id *','correct_option_letter *','option_a *','option_b *','option_c *','option_d *','option_e','difficulty (1-5)','year_exam','explanation'].map(f => (
                  <div key={f} className={`flex items-center gap-2 ${f.includes('*')?'text-ink font-semibold':''}`}>
                    <span className={`w-2 h-2 rounded-full shrink-0 ${f.includes('*')?'bg-pulse-dim':'bg-slate-300'}`}/>
                    {f.replace(' *','')}
                    {f.includes('*') && <span className="text-red-400 ml-auto">req</span>}
                  </div>
                ))}
              </div>
              <button onClick={() => {
                const blob = new Blob([SAMPLE_CSV], { type:'text/csv' });
                const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
                a.download = 'miriai-preguntas-ejemplo.csv'; a.click();
              }} className="w-full text-center text-xs font-semibold text-sky-600 hover:text-sky-700 transition-colors">
                ↓ Descargar CSV de ejemplo
              </button>
            </Card>

            <Card>
              <CardHeader title="IDs de especialidades" subtitle="Usa estos valores en specialty_id" />
              <div className="flex flex-col gap-1 max-h-48 overflow-y-auto scrollbar-thin">
                {specialties.map(sp => (
                  <div key={sp.id} className="flex items-center justify-between text-xs">
                    <span className="text-slate-600">{sp.name}</span>
                    <code className="font-mono bg-surface border border-border px-1.5 py-0.5 rounded text-sky-700">{sp.id}</code>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        </div>
      )}

      {/* Preview */}
      {phase === 'preview' && (
        <div>
          {/* Resumen */}
          <div className="grid grid-cols-3 gap-4 mb-5">
            <div className="bg-white border border-border rounded-lg p-5 text-center">
              <div className="font-display font-bold text-3xl text-ink">{parsed.length}</div>
              <div className="text-xs text-slate-400 mt-1">Preguntas detectadas</div>
            </div>
            <div className="bg-pulse-bg border border-pulse-dim/20 rounded-lg p-5 text-center">
              <div className="font-display font-bold text-3xl text-pulse-dim">{validCount}</div>
              <div className="text-xs text-slate-400 mt-1">Listas para importar</div>
            </div>
            <div className={`rounded-lg p-5 text-center border ${invalidCount>0?'bg-red-50 border-red-200':'bg-surface border-border'}`}>
              <div className={`font-display font-bold text-3xl ${invalidCount>0?'text-red-400':'text-slate-300'}`}>{invalidCount}</div>
              <div className="text-xs text-slate-400 mt-1">Con errores</div>
            </div>
          </div>

          {/* Errores de parse */}
          {errors.length > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-5">
              <div className="font-mono text-xs font-bold text-red-600 uppercase tracking-wider mb-2">Errores de formato ({errors.length})</div>
              <div className="flex flex-col gap-1 max-h-32 overflow-y-auto">
                {errors.map((e,i) => <p key={i} className="text-xs text-red-600">{e}</p>)}
              </div>
            </div>
          )}

          {/* Preview tabla */}
          <Card padding={false} className="mb-5">
            <div className="p-4 border-b border-border flex items-center justify-between">
              <h3 className="font-display font-bold text-base text-ink">Preview de preguntas</h3>
              <span className="text-xs text-slate-400 font-mono">Mostrando {Math.min(10, parsed.length)} de {parsed.length}</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-surface border-b border-border">
                    {['#','Estado','Enunciado','Especialidad','Dificultad','Correc.'].map(h => (
                      <th key={h} className="text-left px-4 py-2.5 font-mono text-[0.65rem] font-semibold uppercase tracking-wider text-slate-400">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {parsed.slice(0,10).map(row => (
                    <tr key={row._row} className={`border-t border-border ${!row._valid?'bg-red-50':''}`}>
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
                          : <span className="text-xs text-red-500 font-mono">{row.specialty_id} (no existe)</span>
                        }
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-500">{row.difficulty}</td>
                      <td className="px-4 py-3 font-mono text-xs font-bold text-ink">{row.correct_option_letter?.toUpperCase()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {parsed.length > 10 && (
              <div className="px-4 py-3 border-t border-border text-xs text-slate-400 text-center">
                ... y {parsed.length - 10} más
              </div>
            )}
          </Card>

          <div className="flex gap-3 justify-end">
            <Button variant="secondary" onClick={() => { setPhase('upload'); setParsed([]); setErrors([]); }}>
              Cancelar
            </Button>
            <Button onClick={handleImport} disabled={validCount===0}>
              Importar {validCount} preguntas →
            </Button>
          </div>
        </div>
      )}

      {/* Importing */}
      {phase === 'importing' && (
        <Card className="text-center py-12">
          <div className="w-16 h-16 rounded-full border-4 border-sky-100 border-t-pulse animate-spin mx-auto mb-6"/>
          <h3 className="font-display font-bold text-xl text-ink mb-2">Importando preguntas...</h3>
          <p className="text-slate-400 text-sm mb-6">{progress.done} de {progress.total} completadas</p>
          <div className="max-w-md mx-auto">
            <div className="h-3 bg-sky-100 rounded-full overflow-hidden mb-2">
              <div className="h-full bg-gradient-to-r from-sky-400 to-pulse rounded-full transition-all duration-500"
                style={{width:`${progress.total?Math.round((progress.done/progress.total)*100):0}%`}}/>
            </div>
            <div className="text-xs text-slate-400 font-mono text-right">{progress.total?Math.round((progress.done/progress.total)*100):0}%</div>
          </div>
        </Card>
      )}

      {/* Done */}
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
              <div className="font-mono text-xs font-bold text-red-600 uppercase tracking-wider mb-2">Errores durante la importación</div>
              {progress.errors.slice(0,5).map((e,i) => <p key={i} className="text-xs text-red-600">{e}</p>)}
              {progress.errors.length > 5 && <p className="text-xs text-red-400 mt-1">...y {progress.errors.length-5} más</p>}
            </div>
          )}
          <div className="flex gap-3 justify-center">
            <Button onClick={() => { setPhase('upload'); setParsed([]); setErrors([]); }}>Importar más preguntas</Button>
            <Button variant="secondary" onClick={() => window.location.href='/admin/preguntas'}>Ver banco de preguntas</Button>
          </div>
        </Card>
      )}

      {/* Historial */}
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
