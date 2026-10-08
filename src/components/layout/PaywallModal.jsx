import { useState, useEffect } from 'react';
import { supabase, signOut, track, reportError } from '../../lib/supabase';
import { useAuthStore, toast } from '../../store';

// ⚠ AJUSTA estos importes: son solo lo que se MUESTRA. Lo que se cobra lo fijan los precios
// creados en Stripe (STRIPE_PRICE_*); deben coincidir.
const PLANS = [
  { id: 'monthly', name: 'Mensual', price: '9,99€', period: '/mes', badge: null,
    features: ['Banco completo de preguntas', 'Repetición espaciada SM-2', 'Simulacros ilimitados', 'Coach IA personalizado'] },
  { id: 'annual', name: 'Hasta el MIR', price: '79€', period: 'pago único', sub: 'Acceso hasta el examen MIR',
    badge: 'Mejor precio', featured: true,
    features: ['Todo lo del plan mensual', 'Sin renovaciones ni sorpresas', 'Acceso hasta después del examen'] },
  { id: 'premium', name: 'Premium', price: '14,99€', period: '/mes', badge: 'Todo incluido',
    features: ['Todo lo del plan mensual', 'Analíticas avanzadas (próximamente)', 'Exportar progreso en PDF (próximamente)', 'Soporte prioritario'] },
];

export default function PaywallModal({ open }) {
  const { profile } = useAuthStore();
  const [selected, setSelected] = useState('annual');
  const [loading, setLoading]   = useState(false);

  useEffect(() => { if (open) track('paywall_shown'); }, [open]);
  if (!open) return null;

  async function handleUpgrade() {
    setLoading(true);
    track('plan_selected', { plan: selected });
    try {
      // 1) Stripe Checkout (si las funciones están desplegadas y configuradas)
      const { data, error } = await supabase.functions.invoke('create-checkout-session', { body: { plan: selected } });
      if (!error && data?.url) { window.location.href = data.url; return; }

      // 2) Respaldo: Stripe aún no está activo → se registra la solicitud para activarla a mano.
      //    NUNCA se escribe en profiles: esos campos los protege la BD.
      const { error: reqErr } = await supabase.from('subscription_requests').insert({ user_id: profile.id, plan: selected });
      if (reqErr) throw reqErr;
      track('plan_requested', { plan: selected });
      toast.success('¡Solicitud recibida! Te contactaremos para activar tu plan.');
    } catch (e) {
      reportError(e);
      toast.error('No se pudo procesar tu solicitud. Inténtalo de nuevo.');
    } finally { setLoading(false); }
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-ink/80 backdrop-blur-sm animate-[fadeIn_.25s_ease]">
      <div className="bg-white rounded-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto scrollbar-thin relative">
        <div className="bg-ink px-8 py-8 text-center relative overflow-hidden rounded-t-2xl">
          <div className="absolute inset-0 dot-pattern opacity-20 pointer-events-none"/>
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_400px_200px_at_50%_120%,rgba(0,229,199,.15),transparent)] pointer-events-none"/>
          <div className="relative z-10">
            <div className="inline-flex items-center gap-2 bg-white/8 border border-pulse/30 px-3 py-1.5 rounded-full font-mono text-[0.65rem] font-semibold text-pulse mb-4">
              ⏳ TU ACCESO HA TERMINADO
            </div>
            <h2 className="font-display font-bold text-2xl md:text-3xl text-white mb-2">Sigue preparando tu MIR sin interrupciones</h2>
            <p className="text-white/50 text-sm max-w-md mx-auto">Elige tu plan y conserva todo lo que ya has avanzado</p>
          </div>
        </div>

        <div className="p-6 md:p-8">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            {PLANS.map(plan => (
              <button key={plan.id} onClick={() => setSelected(plan.id)}
                className={`relative text-left p-5 rounded-xl border-2 transition-all duration-200 ${
                  selected === plan.id ? 'border-ink bg-ink shadow-lg scale-[1.02]'
                  : plan.featured ? 'border-pulse-dim/40 bg-pulse-bg hover:border-pulse-dim'
                  : 'border-border bg-white hover:border-sky-300'}`}>
                {plan.badge && (
                  <span className={`absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full text-[0.6rem] font-bold font-mono uppercase tracking-wider whitespace-nowrap ${
                    selected === plan.id ? 'bg-pulse text-ink' : 'bg-pulse-dim text-white'}`}>{plan.badge}</span>
                )}
                <div className={`font-display font-bold text-base mb-1 ${selected === plan.id ? 'text-white' : 'text-ink'}`}>{plan.name}</div>
                <div className="flex items-baseline gap-1 mb-1">
                  <span className={`font-display font-bold text-3xl ${selected === plan.id ? 'text-pulse' : 'text-ink'}`}>{plan.price}</span>
                  <span className={`text-xs ${selected === plan.id ? 'text-white/50' : 'text-slate-400'}`}>{plan.period}</span>
                </div>
                {plan.sub && <div className={`text-[0.65rem] font-mono mb-3 ${selected === plan.id ? 'text-white/40' : 'text-slate-400'}`}>{plan.sub}</div>}
                <div className="flex flex-col gap-1.5 mt-4">
                  {plan.features.map(f => (
                    <div key={f} className="flex items-start gap-1.5">
                      <span className={`text-xs mt-0.5 shrink-0 ${selected === plan.id ? 'text-pulse' : 'text-pulse-dim'}`}>✓</span>
                      <span className={`text-xs leading-snug ${selected === plan.id ? 'text-white/70' : 'text-slate-500'}`}>{f}</span>
                    </div>
                  ))}
                </div>
              </button>
            ))}
          </div>

          <button onClick={handleUpgrade} disabled={loading}
            className="w-full py-4 bg-ink text-white rounded-full font-display font-bold text-base hover:-translate-y-0.5 hover:shadow-xl transition-all disabled:opacity-60 flex items-center justify-center gap-3 relative overflow-hidden group">
            <span className="absolute inset-0 bg-gradient-to-r from-transparent via-pulse/20 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-500"/>
            {loading ? 'Procesando...' : `Continuar con el plan ${PLANS.find(p => p.id === selected)?.name} →`}
          </button>
          <p className="text-center text-xs text-slate-400 mt-4">Pago seguro con Stripe · Gestiona o cancela desde tu perfil</p>
          <button onClick={() => signOut()} className="block mx-auto mt-3 text-xs text-slate-400 hover:text-ink transition-colors">
            Cerrar sesión
          </button>
        </div>
      </div>
    </div>
  );
}
