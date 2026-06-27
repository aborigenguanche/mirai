import { useState, useEffect } from 'react';
import { supabase, fetchSpecialties } from '../../lib/supabase';
import { useAuthStore } from '../../store';
import { toast } from '../../store';
import { Badge, LoadingScreen, Button, FormGroup, Input, Card, CardHeader } from '../../components/ui';

const SUB_STATUS = {
  active:  { label:'Activa',  variant:'pulse' },
  trial:   { label:'Prueba',  variant:'blue' },
  expired: { label:'Vencida', variant:'amber' },
};

const SUB_PLAN = {
  monthly: 'Mensual',
  annual:  'Anual',
};

export default function PerfilPage() {
  const { profile, refreshProfile } = useAuthStore();
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);
  const [avatarUrl, setAvatarUrl] = useState(null);
  const [weakSpecNames, setWeakSpecNames] = useState([]);

  const [form, setForm] = useState({
    full_name:      '',
    fecha_mir:      '',
    baseline_score: '',
  });

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    const [{ data: { user } }, allSpecs] = await Promise.all([
      supabase.auth.getUser(),
      fetchSpecialties(),
    ]);

    setAvatarUrl(user?.user_metadata?.avatar_url || null);

    // Resolver nombres de especialidades débiles
    const ids = profile.weak_specialties || [];
    setWeakSpecNames(
      (allSpecs || []).filter(s => ids.includes(s.id)).map(s => s.name)
    );

    setForm({
      full_name:      profile.full_name      || '',
      // fecha_mir es tipo date en Supabase → no necesita split('T')
      fecha_mir:      profile.fecha_mir      || '',
      baseline_score: profile.baseline_score != null ? String(profile.baseline_score) : '',
    });

    setLoading(false);
  }

  async function handleSave() {
    setSaving(true);

    // Validación básica
    if (form.baseline_score && isNaN(parseFloat(form.baseline_score))) {
      toast.error('La puntuación base debe ser un número');
      setSaving(false);
      return;
    }

    const payload = {
      full_name:      form.full_name      || null,
      // fecha_mir es date, acepta 'YYYY-MM-DD' directamente sin conversión ISO
      fecha_mir:      form.fecha_mir      || null,
      baseline_score: form.baseline_score ? parseFloat(form.baseline_score) : null,
    };

    const { error } = await supabase
      .from('profiles')
      .update(payload)
      .eq('id', profile.id);

    if (error) {
      toast.error('Error al guardar: ' + error.message);
      setSaving(false);
      return;
    }

    // Refrescar el store para que el resto de la app (PlanDia, Coach IA...) 
    // use los datos actualizados inmediatamente
    if (typeof refreshProfile === 'function') await refreshProfile();

    toast.success('Perfil actualizado');
    setSaving(false);
  }

  const f = (k, v) => setForm(p => ({ ...p, [k]: v }));

  if (loading) return <LoadingScreen message="Cargando perfil..." />;

  const iniciales = (profile.full_name || profile.email || 'U')
    .split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();

  const statusInfo  = SUB_STATUS[profile.subscription_status] || { label: profile.subscription_status, variant: 'gray' };
  const planLabel   = SUB_PLAN[profile.subscription_plan] || null;
  const endsAt      = profile.subscription_ends_at
    ? new Date(profile.subscription_ends_at).toLocaleDateString('es-ES', { day:'2-digit', month:'long', year:'numeric' })
    : null;
  const createdAt   = new Date(profile.created_at).toLocaleDateString('es-ES', { day:'2-digit', month:'long', year:'numeric' });

  // Días al MIR
  const mirDate   = profile.fecha_mir ? new Date(profile.fecha_mir) : null;
  const diasAlMir = mirDate ? Math.max(0, Math.ceil((mirDate - new Date()) / 86400000)) : null;

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <h1 className="font-display text-2xl font-bold text-ink tracking-tight">Mi perfil</h1>
        <p className="text-sm text-slate-400 mt-1">Gestiona tus datos personales y configuración del MIR</p>
      </div>

      {/* Tarjeta de identidad */}
      <div className="bg-ink rounded-xl p-6 mb-6 flex items-center gap-5 relative overflow-hidden">
        <div className="absolute inset-0 dot-pattern opacity-20 pointer-events-none"/>
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_400px_200px_at_100%_150%,rgba(0,229,199,.12),transparent)] pointer-events-none"/>

        {/* Avatar */}
        <div className="relative shrink-0 z-10">
          {avatarUrl ? (
            <img src={avatarUrl} alt={iniciales}
              className="w-16 h-16 rounded-full border-2 border-pulse/30 object-cover"/>
          ) : (
            <div className="w-16 h-16 rounded-full bg-gradient-to-br from-sky-400 to-pulse flex items-center justify-center font-display text-xl font-bold text-white border-2 border-pulse/30">
              {iniciales}
            </div>
          )}
          <div className="absolute -bottom-1 -right-1 w-5 h-5 bg-pulse rounded-full border-2 border-ink flex items-center justify-center">
            <svg width="8" height="8" viewBox="0 0 24 24" fill="none"><path d="M20 6L9 17l-5-5" stroke="#0a0f1a" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </div>
        </div>

        {/* Info principal */}
        <div className="flex-1 min-w-0 z-10">
          <div className="font-display font-bold text-xl text-white leading-tight">
            {profile.full_name || <span className="italic text-white/40">Sin nombre configurado</span>}
          </div>
          <div className="text-sm text-white/50 font-mono mt-0.5">{profile.email}</div>
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            <Badge variant={profile.role === 'admin' ? 'ink' : 'gray'}>{profile.role}</Badge>
            <Badge variant={statusInfo.variant}>{statusInfo.label}</Badge>
            {planLabel && <Badge variant="gray">{planLabel}</Badge>}
          </div>
        </div>

        {/* Meta */}
        <div className="text-right text-xs text-white/30 shrink-0 z-10 hidden sm:block">
          <div>Miembro desde</div>
          <div className="font-mono font-semibold text-white/50 mt-0.5">{createdAt}</div>
        </div>
      </div>

      {/* Grid principal */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

        {/* Columna izquierda: formularios editables */}
        <div className="lg:col-span-2 flex flex-col gap-5">

          {/* Datos personales */}
          <Card>
            <CardHeader title="Datos personales" subtitle="Actualiza tu nombre visible en la app" />

            <FormGroup label="Nombre completo">
              <Input
                value={form.full_name}
                onChange={e => f('full_name', e.target.value)}
                placeholder="Nombre y apellidos"
              />
            </FormGroup>

            <FormGroup label="Email" hint="Asociado a tu cuenta de Google — no se puede cambiar">
              <Input
                value={profile.email}
                disabled
                className="bg-surface text-slate-400 cursor-not-allowed"
              />
            </FormGroup>

            <div className="flex items-center gap-2 p-3 bg-surface border border-border rounded-lg">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="shrink-0 text-slate-400"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 15v-4H7l5-8v4h4l-5 8z" fill="currentColor"/></svg>
              <span className="text-xs text-slate-500">Sesión iniciada con <strong className="text-ink">Google OAuth</strong></span>
            </div>
          </Card>

          {/* Configuración MIR */}
          <Card>
            <CardHeader title="Configuración MIR" subtitle="Datos clave para personalizar tu plan de estudio" />

            <FormGroup
              label="Fecha del examen MIR"
              hint="El Coach IA y la cuenta atrás usan esta fecha">
              <Input
                type="date"
                value={form.fecha_mir}
                onChange={e => f('fecha_mir', e.target.value)}
              />
            </FormGroup>

            {/* Preview de cuenta atrás */}
            {form.fecha_mir && (
              <div className={`flex items-center gap-3 p-4 rounded-lg border mb-4 ${
                diasAlMir !== null && diasAlMir < 30 ? 'bg-red-50 border-red-200' :
                diasAlMir !== null && diasAlMir < 90 ? 'bg-amber-50 border-amber-200' :
                'bg-sky-50 border-sky-200'}`}>
                <div className={`font-display font-bold text-3xl ${
                  diasAlMir !== null && diasAlMir < 30 ? 'text-red-500' :
                  diasAlMir !== null && diasAlMir < 90 ? 'text-amber-500' :
                  'text-sky-600'}`}>
                  {(() => {
                    const d = new Date(form.fecha_mir);
                    const diff = Math.max(0, Math.ceil((d - new Date()) / 86400000));
                    return diff;
                  })()}
                </div>
                <div>
                  <div className="text-sm font-semibold text-ink">días para el MIR</div>
                  <div className="text-xs text-slate-400">
                    {new Date(form.fecha_mir).toLocaleDateString('es-ES', { weekday:'long', day:'numeric', month:'long', year:'numeric' })}
                  </div>
                </div>
              </div>
            )}

            <FormGroup
              label="Puntuación base"
              hint="Tu score MIR actual o estimado (0–630). Ayuda al Coach IA a calibrar tus objetivos">
              <div className="relative">
                <Input
                  type="number"
                  min="0"
                  max="630"
                  value={form.baseline_score}
                  onChange={e => f('baseline_score', e.target.value)}
                  placeholder="Ej: 280"
                  className="pr-14"
                />
                <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs font-mono text-slate-400">/ 630</span>
              </div>
            </FormGroup>

            {form.baseline_score && !isNaN(parseFloat(form.baseline_score)) && (
              <div className="mb-4">
                <div className="h-2 bg-sky-100 rounded-full overflow-hidden relative">
                  <div
                    className="h-full bg-gradient-to-r from-sky-500 to-pulse rounded-full transition-all duration-500"
                    style={{ width:`${Math.min(100, (parseFloat(form.baseline_score) / 630) * 100)}%` }}
                  />
                  <div className="absolute top-0 bottom-0 border-l-2 border-dashed border-amber-400" style={{ left:'63.5%' }}/>
                </div>
                <div className="flex justify-between text-[0.6rem] font-mono mt-1">
                  <span className={parseFloat(form.baseline_score) >= 400 ? 'text-pulse-dim font-bold' : 'text-slate-400'}>
                    {form.baseline_score} pts
                  </span>
                  <span className="text-amber-500">~400 corte aprox.</span>
                  <span className="text-slate-400">630 máx</span>
                </div>
              </div>
            )}
          </Card>

          {/* Botón guardar */}
          <div className="flex justify-end">
            <Button onClick={handleSave} loading={saving}>
              Guardar cambios
            </Button>
          </div>
        </div>

        {/* Columna derecha: solo lectura */}
        <div className="flex flex-col gap-5">

          {/* Suscripción */}
          <Card>
            <CardHeader title="Suscripción" subtitle="Gestionada por el equipo de MIRai" />
            <div className="flex flex-col gap-4">

              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-500">Estado</span>
                <Badge variant={statusInfo.variant}>{statusInfo.label}</Badge>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-500">Plan</span>
                <span className="text-sm font-semibold text-ink">{planLabel || '—'}</span>
              </div>

              {endsAt && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-slate-500">Vence el</span>
                  <span className="text-sm font-mono font-semibold text-ink">{endsAt}</span>
                </div>
              )}

              {/* Barra de tiempo restante si hay fecha */}
              {profile.subscription_ends_at && profile.subscription_status === 'active' && (() => {
                const end   = new Date(profile.subscription_ends_at);
                const now   = new Date();
                const total = 30 * 24 * 3600 * 1000; // asume ciclo mensual aprox
                const left  = Math.max(0, end - now);
                const pct   = Math.min(100, (left / total) * 100);
                const dias  = Math.ceil(left / 86400000);
                return (
                  <div>
                    <div className="h-1.5 bg-sky-100 rounded-full overflow-hidden">
                      <div className="h-full bg-gradient-to-r from-sky-400 to-pulse rounded-full" style={{ width:`${pct}%` }}/>
                    </div>
                    <div className="text-[0.6rem] font-mono text-slate-400 mt-1">{dias} días restantes</div>
                  </div>
                );
              })()}

              <div className="pt-2 border-t border-border">
                <p className="text-xs text-slate-400 leading-relaxed">
                  Para cambiar tu plan o resolver incidencias contacta con{' '}
                  <a href="mailto:info@alisoralabs.com" className="text-sky-500 hover:underline font-medium">
                    info@alisoralabs.com
                  </a>
                </p>
              </div>
            </div>
          </Card>

          {/* Especialidades débiles */}
          <Card>
            <CardHeader
              title="Especialidades débiles"
              subtitle="Calculadas automáticamente según tu rendimiento"
            />
            {weakSpecNames.length === 0 ? (
              <div className="text-center py-6">
                <div className="text-3xl mb-2">📊</div>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Practica más preguntas para que el sistema identifique tus áreas de mejora
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {weakSpecNames.map((name, i) => (
                  <div key={name} className="flex items-center gap-3 p-3 rounded-lg bg-surface border border-border">
                    <div className={`w-6 h-6 rounded-full flex items-center justify-center font-mono text-xs font-bold text-white shrink-0 ${
                      i === 0 ? 'bg-red-400' : i === 1 ? 'bg-amber-400' : 'bg-sky-400'
                    }`}>{i + 1}</div>
                    <span className="flex-1 text-sm font-medium text-ink">{name}</span>
                    <span className="text-[0.6rem] font-mono text-slate-400 uppercase tracking-wider">
                      {i === 0 ? 'Prioritaria' : i === 1 ? 'Importante' : 'Mejorable'}
                    </span>
                  </div>
                ))}
                <p className="text-[0.65rem] text-slate-400 text-center mt-1">
                  Se actualizan automáticamente con tu actividad
                </p>
              </div>
            )}
          </Card>

          {/* Actividad rápida */}
          <Card>
            <CardHeader title="Tu cuenta" />
            <div className="flex flex-col gap-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Miembro desde</span>
                <span className="font-mono font-semibold text-ink text-xs">{createdAt}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Rol</span>
                <Badge variant={profile.role === 'admin' ? 'ink' : 'gray'}>{profile.role}</Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Onboarding</span>
                <span className={`text-xs font-semibold ${profile.onboarding_completed ? 'text-pulse-dim' : 'text-amber-500'}`}>
                  {profile.onboarding_completed ? '✓ Completado' : '⚠ Pendiente'}
                </span>
              </div>
            </div>
          </Card>

        </div>
      </div>
    </div>
  );
}
