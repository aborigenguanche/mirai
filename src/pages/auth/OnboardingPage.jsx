import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase, fetchSpecialties } from '../../lib/supabase';
import { useAuthStore } from '../../store';

const PHASES = [
  {
    key:   'beginning',
    label: 'Acabo de empezar',
    desc:  'Menos de 3 meses preparando',
    icon:  '🌱',
    score: 0,
  },
  {
    key:   'middle',
    label: 'Llevo un tiempo',
    desc:  'Entre 3 y 6 meses preparando',
    icon:  '📚',
    score: 150,
  },
  {
    key:   'final',
    label: 'Fase final',
    desc:  'Menos de 3 meses para el MIR',
    icon:  '⚡',
    score: 300,
  },
  {
    key:   'repeat',
    label: 'Repitiendo MIR',
    desc:  'Ya me he presentado antes',
    icon:  '🎯',
    score: 250,
  },
];

export default function OnboardingPage() {
  const { profile, refreshProfile } = useAuthStore();
  const navigate                    = useNavigate();
  const [step, setStep]             = useState(1);
  const [phase, setPhase]           = useState(null);
  const [specialty, setSpecialty]   = useState(null);
  const [specialties, setSpecialties] = useState([]);
  const [saving, setSaving]         = useState(false);

  const nombre = (profile?.full_name || profile?.email || '').split(' ')[0];

  useEffect(() => { fetchSpecialties().then(setSpecialties); }, []);

  async function handleFinish() {
    setSaving(true);
    const selectedPhase = PHASES.find(p => p.key === phase);
    await supabase.from('profiles').update({
      onboarding_completed: true,
      baseline_score:       selectedPhase?.score ?? null,
      weak_specialties:     specialty ? [specialty] : [],
    }).eq('id', profile.id);
    if (typeof refreshProfile === 'function') await refreshProfile();
    navigate('/app/plan');
  }

  return (
    <div className="min-h-screen bg-ink flex flex-col items-center justify-center p-5 relative overflow-hidden">
      {/* Fondo decorativo */}
      <div className="absolute inset-0 dot-pattern opacity-30 pointer-events-none"/>
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_600px_400px_at_50%_120%,rgba(0,229,199,.12),transparent)] pointer-events-none"/>

      {/* Barra de progreso */}
      <div className="w-full max-w-lg mb-8 relative z-10">
        <div className="flex items-center gap-2">
          {[1, 2, 3].map(n => (
            <div key={n} className="flex-1 flex items-center gap-2">
              <div className={`h-1 flex-1 rounded-full transition-all duration-500 ${step >= n ? 'bg-pulse' : 'bg-white/10'}`}/>
            </div>
          ))}
        </div>
        <div className="text-right font-mono text-[0.65rem] text-white/30 mt-1.5">
          {step} de 3
        </div>
      </div>

      {/* ─── PASO 1: Bienvenida ─── */}
      {step === 1 && (
        <div className="w-full max-w-lg relative z-10 animate-[fadeIn_.4s_ease]">
          <div className="text-center mb-10">
            {/* Logo */}
            <div className="inline-flex items-center gap-2.5 mb-8">
              <div className="w-10 h-10 bg-white/8 border border-pulse/30 rounded-xl flex items-center justify-center">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                  <path d="M2 12h4l2-7 4 14 3-9 2 4h5" stroke="#00E5C7" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
              <span className="font-display font-bold text-2xl text-white">
                MIR<em className="text-pulse not-italic">ai</em>
              </span>
            </div>

            <h1 className="font-display font-bold text-4xl text-white mb-4 leading-tight">
              Bienvenido,<br/>
              <span className="text-pulse">{nombre}</span>
            </h1>
            <p className="text-white/50 text-lg leading-relaxed max-w-sm mx-auto">
              En 3 pasos personalizamos tu plan de estudio para que cada sesión cuente.
            </p>
          </div>

          <button onClick={() => setStep(2)}
            className="w-full py-4 bg-pulse text-ink font-display font-bold text-lg rounded-full hover:-translate-y-0.5 hover:brightness-110 transition-all flex items-center justify-center gap-3 relative overflow-hidden group">
            <span className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-500"/>
            Empezar personalización →
          </button>

          <p className="text-center text-white/20 text-xs mt-4">Tarda menos de 30 segundos</p>
        </div>
      )}

      {/* ─── PASO 2: Fase de preparación ─── */}
      {step === 2 && (
        <div className="w-full max-w-lg relative z-10 animate-[fadeIn_.4s_ease]">
          <div className="text-center mb-8">
            <div className="font-mono text-[0.65rem] font-semibold uppercase tracking-widest text-pulse/70 mb-3">
              Paso 1 de 2
            </div>
            <h2 className="font-display font-bold text-3xl text-white mb-3">
              ¿En qué momento estás?
            </h2>
            <p className="text-white/40 text-sm">
              Usamos esto para calibrar el nivel de las preguntas y el Coach IA
            </p>
          </div>

          <div className="flex flex-col gap-3 mb-8">
            {PHASES.map(p => (
              <button key={p.key} onClick={() => setPhase(p.key)}
                className={`flex items-center gap-4 p-4 rounded-xl border-2 text-left transition-all duration-200 group ${
                  phase === p.key
                    ? 'border-pulse bg-pulse/10 shadow-[0_0_0_4px_rgba(0,229,199,.1)]'
                    : 'border-white/10 hover:border-white/30 hover:bg-white/5'
                }`}>
                <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-2xl shrink-0 transition-all ${
                  phase === p.key ? 'bg-pulse/20 scale-110' : 'bg-white/5'
                }`}>
                  {p.icon}
                </div>
                <div className="flex-1">
                  <div className={`font-display font-bold text-base transition-colors ${
                    phase === p.key ? 'text-pulse' : 'text-white'
                  }`}>
                    {p.label}
                  </div>
                  <div className="text-white/40 text-xs mt-0.5">{p.desc}</div>
                </div>
                <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-all ${
                  phase === p.key
                    ? 'border-pulse bg-pulse'
                    : 'border-white/20'
                }`}>
                  {phase === p.key && (
                    <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                      <path d="M2 6l3 3 5-5" stroke="#0a0f1a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  )}
                </div>
              </button>
            ))}
          </div>

          <button onClick={() => setStep(3)} disabled={!phase}
            className="w-full py-4 bg-pulse text-ink font-display font-bold text-base rounded-full hover:-translate-y-0.5 hover:brightness-110 transition-all disabled:opacity-30 disabled:pointer-events-none">
            Continuar →
          </button>
        </div>
      )}

      {/* ─── PASO 3: Especialidad objetivo ─── */}
      {step === 3 && (
        <div className="w-full max-w-lg relative z-10 animate-[fadeIn_.4s_ease]">
          <div className="text-center mb-8">
            <div className="font-mono text-[0.65rem] font-semibold uppercase tracking-widest text-pulse/70 mb-3">
              Paso 2 de 2
            </div>
            <h2 className="font-display font-bold text-3xl text-white mb-3">
              ¿Cuál es tu especialidad objetivo?
            </h2>
            <p className="text-white/40 text-sm">
              El plan priorizará las preguntas de esta especialidad.
              Puedes cambiarlo después en tu perfil.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2 mb-8 max-h-72 overflow-y-auto scrollbar-thin pr-1">
            {specialties.map(sp => (
              <button key={sp.id} onClick={() => setSpecialty(sp.id)}
                className={`flex items-center gap-2.5 p-3 rounded-lg border text-left transition-all ${
                  specialty === sp.id
                    ? 'border-pulse bg-pulse/10 text-pulse'
                    : 'border-white/10 hover:border-white/25 hover:bg-white/5 text-white/70'
                }`}>
                <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: sp.color || '#00E5C7' }}/>
                <span className="text-xs font-medium truncate">{sp.name}</span>
                {specialty === sp.id && (
                  <span className="ml-auto text-pulse shrink-0">✓</span>
                )}
              </button>
            ))}
          </div>

          <button onClick={handleFinish} disabled={saving}
            className="w-full py-4 bg-pulse text-ink font-display font-bold text-base rounded-full hover:-translate-y-0.5 hover:brightness-110 transition-all disabled:opacity-50 disabled:pointer-events-none flex items-center justify-center gap-3 relative overflow-hidden group">
            <span className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-500"/>
            {saving ? (
              <>
                <div className="w-5 h-5 border-2 border-ink/30 border-t-ink rounded-full animate-spin"/>
                Configurando tu plan...
              </>
            ) : (
              'Comenzar mi preparación →'
            )}
          </button>

          <button onClick={() => setStep(2)} className="block w-full text-center text-white/25 text-xs mt-3 hover:text-white/50 transition-colors">
            ← Volver
          </button>
        </div>
      )}
    </div>
  );
}
