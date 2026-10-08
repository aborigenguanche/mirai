import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { toast } from '../../store';
import { Card, CardHeader, Button, FormGroup, Input, LoadingScreen } from '../../components/ui';

export default function AdminConfigPage() {
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);
  const [fechaMir, setFechaMir] = useState('');
  const [preview, setPreview]   = useState(null);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    const { data } = await supabase
      .from('app_config')
      .select('value')
      .eq('key', 'fecha_mir')
      .single();
    if (data?.value) {
      setFechaMir(data.value);
      setPreview(calcDias(data.value));
    }
    setLoading(false);
  }

  function calcDias(fecha) {
    if (!fecha) return null;
    return Math.max(0, Math.ceil((new Date(fecha) - new Date()) / 86400000));
  }

  async function handleSave() {
    if (!fechaMir) { toast.error('La fecha no puede estar vacía'); return; }
    setSaving(true);
    const { error } = await supabase
      .from('app_config')
      .upsert({ key: 'fecha_mir', value: fechaMir, updated_at: new Date().toISOString() },
        { onConflict: 'key' });
    if (error) {
      toast.error('Error al guardar: ' + error.message);
    } else {
      setPreview(calcDias(fechaMir));
      toast.success('Fecha MIR actualizada para todos los usuarios');
    }
    setSaving(false);
  }

  if (loading) return <LoadingScreen message="Cargando configuración..." />;

  const dias = preview;

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-display text-2xl font-bold text-ink tracking-tight">Configuración global</h1>
        <p className="text-sm text-slate-400 mt-1">Parámetros que afectan a todos los usuarios</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Card>
          <CardHeader
            title="Fecha del MIR"
            subtitle="Se muestra en el Plan de hoy y en la cuenta atrás de todos los usuarios"
          />

          <FormGroup label="Fecha de la convocatoria" hint="Formato: DD/MM/AAAA">
            <Input
              type="date"
              value={fechaMir}
              onChange={e => { setFechaMir(e.target.value); setPreview(calcDias(e.target.value)); }}
            />
          </FormGroup>

          {dias !== null && (
            <div className={`flex items-center gap-4 p-4 rounded-xl border mb-5 ${
              dias < 30  ? 'bg-red-50 border-red-200' :
              dias < 90  ? 'bg-amber-50 border-amber-200' :
              'bg-sky-50 border-sky-200'
            }`}>
              <div className={`font-display font-bold text-4xl ${
                dias < 30 ? 'text-red-500' : dias < 90 ? 'text-amber-500' : 'text-sky-600'
              }`}>
                {dias}
              </div>
              <div>
                <div className="font-semibold text-sm text-ink">días para el MIR</div>
                <div className="text-xs text-slate-400">
                  {new Date(fechaMir).toLocaleDateString('es-ES', {
                    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
                  })}
                </div>
                <div className={`text-xs font-semibold mt-0.5 ${
                  dias < 30 ? 'text-red-500' : dias < 90 ? 'text-amber-500' : 'text-sky-600'
                }`}>
                  {dias < 30 ? '🚨 Fase crítica' : dias < 90 ? '⚡ Fase final' : '📅 En preparación'}
                </div>
              </div>
            </div>
          )}

          <Button onClick={handleSave} loading={saving} fullWidth>
            Guardar fecha
          </Button>

          <p className="text-xs text-slate-400 text-center mt-3">
            El cambio se refleja inmediatamente en la app de todos los usuarios
          </p>
        </Card>

        {/* Futuras opciones de configuración */}
        <Card>
          <CardHeader title="Próximamente" subtitle="Más opciones de configuración global" />
          <div className="flex flex-col gap-3">
            {[
              { icon: '💳', label: 'Precio de suscripción', desc: 'Mensual y anual' },
              { icon: '⏱', label: 'Duración del trial', desc: 'Días de prueba gratuita' },
              { icon: '📢', label: 'Banner de aviso global', desc: 'Mensaje visible para todos' },
              { icon: '🔧', label: 'Modo mantenimiento', desc: 'Bloquear acceso temporal' },
            ].map(s => (
              <div key={s.label} className="flex items-center gap-3 p-3 bg-surface border border-border rounded-lg opacity-50">
                <span className="text-xl shrink-0">{s.icon}</span>
                <div>
                  <div className="text-sm font-semibold text-ink">{s.label}</div>
                  <div className="text-xs text-slate-400">{s.desc}</div>
                </div>
                <span className="ml-auto text-[0.6rem] font-mono font-semibold text-slate-300 uppercase tracking-wider">
                  Próximo
                </span>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
