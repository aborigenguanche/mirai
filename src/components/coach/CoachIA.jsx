import { useState, useEffect, useRef } from 'react';

// Componente Coach IA con animación de "activación" del robot asistente.
// Úsalo en PlanDiaPage sustituyendo el bloque actual del Coach IA.
//
// <CoachIA message={coachMsg} type={coachType} />

const COACH_STYLE = {
  urgente:  { bg:'bg-red-50',   border:'border-red-200',       ring:'ring-red-300',   text:'text-red-600',   glow:'#EF4444' },
  alerta:   { bg:'bg-amber-50', border:'border-amber-200',     ring:'ring-amber-300', text:'text-amber-700', glow:'#F59E0B' },
  consejo:  { bg:'bg-sky-50',   border:'border-sky-200',       ring:'ring-sky-300',   text:'text-sky-700',   glow:'#38BDF8' },
  positivo: { bg:'bg-pulse-bg', border:'border-pulse-dim/30',  ring:'ring-pulse-dim/40', text:'text-pulse-dim', glow:'#00E5C7' },
  neutro:   { bg:'bg-surface',  border:'border-border',        ring:'ring-slate-300', text:'text-slate-600', glow:'#94A3B8' },
};

export default function CoachIA({ message, type = 'neutro' }) {
  const cs = COACH_STYLE[type] || COACH_STYLE.neutro;
  const [displayedText, setDisplayedText] = useState('');
  const [activated, setActivated]         = useState(false);
  const prevMessage = useRef('');

  // Activación inicial del robot al montar
  useEffect(() => {
    const t = setTimeout(() => setActivated(true), 150);
    return () => clearTimeout(t);
  }, []);

  // Efecto typing cuando el mensaje cambia
  useEffect(() => {
    if (message === prevMessage.current) return;
    prevMessage.current = message;
    setDisplayedText('');
    let i = 0;
    const speed = 12; // ms por carácter
    const interval = setInterval(() => {
      i++;
      setDisplayedText(message.slice(0, i));
      if (i >= message.length) clearInterval(interval);
    }, speed);
    return () => clearInterval(interval);
  }, [message]);

  return (
    <div className={`relative rounded-xl p-5 mb-6 border ${cs.bg} ${cs.border} flex items-start gap-4 overflow-hidden transition-all duration-500 ${activated ? 'opacity-100' : 'opacity-0 -translate-y-1'}`}>

      {/* Línea de escaneo — cruza el panel una vez al activarse */}
      <div
        className="absolute inset-y-0 w-24 pointer-events-none"
        style={{
          background: `linear-gradient(90deg, transparent, ${cs.glow}22, transparent)`,
          animation: activated ? 'coachScan 1.2s ease-out 0.2s' : 'none',
          left: '-6rem',
        }}
      />

      {/* Robot icon con anillos de activación */}
      <div className="relative shrink-0">
        {/* Anillos de pulso — solo durante la activación */}
        {activated && (
          <>
            <span
              className="absolute inset-0 rounded-full animate-ping"
              style={{ background: cs.glow, opacity: 0.35, animationDuration: '1.4s', animationIterationCount: 2 }}
            />
            <span
              className="absolute -inset-1 rounded-full animate-ping"
              style={{ background: cs.glow, opacity: 0.2, animationDuration: '1.4s', animationDelay: '0.15s', animationIterationCount: 2 }}
            />
          </>
        )}

        <div
          className={`relative w-10 h-10 bg-ink rounded-full flex items-center justify-center shrink-0 transition-transform duration-500 ${activated ? 'scale-100' : 'scale-75'}`}
          style={{ boxShadow: activated ? `0 0 16px ${cs.glow}55` : 'none' }}>
          <svg
            width="16" height="16" viewBox="0 0 24 24" fill="none"
            className={activated ? 'coach-icon-active' : ''}>
            <path d="M2 12h4l2-7 4 14 3-9 2 4h5" stroke="#00E5C7" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="font-mono text-[0.65rem] font-semibold uppercase tracking-widest text-slate-400">Coach IA</span>
          <span
            className="w-1.5 h-1.5 rounded-full"
            style={{ background: cs.glow, animation: 'pulseDot 1.8s ease-in-out infinite' }}
          />
        </div>
        <p className={`text-sm font-medium leading-relaxed ${cs.text} min-h-[1.5rem]`}>
          {displayedText}
          {displayedText.length < message.length && (
            <span className="inline-block w-[2px] h-4 ml-0.5 align-middle bg-current animate-pulse"/>
          )}
        </p>
      </div>

      <style>{`
        @keyframes coachScan {
          0%   { left: -6rem; }
          100% { left: 110%; }
        }
        @keyframes pulseDot {
          0%, 100% { opacity: 1; transform: scale(1); }
          50%      { opacity: 0.4; transform: scale(0.7); }
        }
        .coach-icon-active {
          animation: coachIconIn 0.6s cubic-bezier(.34,1.56,.64,1);
        }
        @keyframes coachIconIn {
          0%   { transform: scale(0.3) rotate(-15deg); opacity: 0; }
          60%  { transform: scale(1.15) rotate(5deg); opacity: 1; }
          100% { transform: scale(1) rotate(0deg); opacity: 1; }
        }
      `}</style>
    </div>
  );
}
