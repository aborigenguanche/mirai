import { useToastStore } from '../../store';

// ─── Button ────────────────────────────────────────────────
export function Button({ children, onClick, type='button', variant='primary', size='md',
  disabled=false, loading=false, className='', fullWidth=false }) {
  const base = 'inline-flex items-center justify-center gap-2 font-semibold rounded-full border-2 transition-all duration-200 whitespace-nowrap disabled:opacity-50 disabled:pointer-events-none select-none';
  const sizes = { sm:'px-4 py-1.5 text-xs', md:'px-5 py-2.5 text-sm', lg:'px-7 py-3 text-base' };
  const variants = {
    primary:   'bg-ink text-white border-ink hover:-translate-y-0.5 hover:shadow-lg hover:shadow-ink/20 hover:[box-shadow:0_6px_20px_rgba(4,11,22,.25),0_0_0_1px_rgba(0,229,199,.2)]',
    secondary: 'bg-white text-ink border-border hover:border-sky-300 hover:bg-sky-50 hover:-translate-y-0.5',
    pulse:     'bg-pulse text-ink border-pulse font-bold hover:brightness-110 hover:-translate-y-0.5',
    danger:    'bg-red-50 text-red-500 border-red-200 hover:bg-red-100',
    ghost:     'bg-transparent text-slate-500 border-transparent hover:bg-sky-50 hover:text-ink',
    amber:     'bg-amber-500 text-white border-amber-500 hover:brightness-110 hover:-translate-y-0.5',
  };
  return (
    <button type={type} onClick={onClick} disabled={disabled||loading}
      className={`${base} ${sizes[size]} ${variants[variant]} ${fullWidth?'w-full':''} ${className}`}>
      {loading ? <Spinner size="sm" light={variant==='primary'||variant==='pulse'||variant==='amber'} /> : children}
    </button>
  );
}

// ─── Badge ─────────────────────────────────────────────────
export function Badge({ children, variant='blue', dot=false, className='' }) {
  const variants = {
    ink:   'bg-ink text-white',
    pulse: 'bg-pulse-bg text-pulse-dim border border-pulse-dim/30',
    blue:  'bg-sky-50 text-sky-700 border border-sky-200',
    green: 'bg-emerald-50 text-emerald-700',
    amber: 'bg-amber-50 text-amber-800',
    red:   'bg-red-50 text-red-500',
    gray:  'bg-surface text-slate-500 border border-border',
  };
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full font-mono text-[0.68rem] font-semibold uppercase tracking-wider ${variants[variant]} ${className}`}>
      {dot && <span className="w-1.5 h-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

// ─── Card ──────────────────────────────────────────────────
export function Card({ children, className='', padding=true, hover=false }) {
  return (
    <div className={`bg-white border border-border rounded-lg ${padding?'p-6':''} ${hover?'hover:border-sky-200 hover:shadow-md transition-all':''} ${className}`}>
      {children}
    </div>
  );
}

export function CardHeader({ title, subtitle, action }) {
  return (
    <div className="flex items-start justify-between mb-5 gap-3">
      <div>
        <h3 className="font-display font-bold text-ink text-base leading-tight">{title}</h3>
        {subtitle && <p className="text-xs text-slate-400 mt-0.5">{subtitle}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

// ─── StatCard ──────────────────────────────────────────────
export function StatCard({ label, value, change, changeType='neutral', dark=false }) {
  const changeColors = { up:'text-pulse-dim', down:'text-red-400', neutral:'text-slate-400' };
  return (
    <div className={`rounded-lg p-5 border relative overflow-hidden group ${dark?'bg-ink border-ink':'bg-white border-border'}`}>
      <div className={`absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-sky-400 to-pulse ${dark?'opacity-100':'opacity-0 group-hover:opacity-100'} transition-opacity`} />
      <div className={`font-mono text-[0.65rem] font-semibold uppercase tracking-widest mb-2 ${dark?'text-white/40':'text-slate-400'}`}>{label}</div>
      <div className={`font-display text-3xl font-bold leading-none mb-1.5 ${dark?'text-pulse':'text-ink'}`}>{value}</div>
      {change && <div className={`text-xs font-semibold ${dark?(changeType==='up'?'text-pulse/80':'text-white/40'):changeColors[changeType]}`}>{change}</div>}
    </div>
  );
}

// ─── Spinner ───────────────────────────────────────────────
export function Spinner({ size='md', light=false }) {
  const sizes = { sm:'w-4 h-4 border-2', md:'w-5 h-5 border-2', lg:'w-8 h-8 border-[3px]' };
  return <div className={`rounded-full animate-spin shrink-0 ${sizes[size]} ${light?'border-white/30 border-t-white':'border-ink/15 border-t-ink'}`} />;
}

export function LoadingScreen({ message='Cargando...' }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen gap-4 bg-surface">
      <div className="relative">
        <div className="w-12 h-12 rounded-full border-2 border-sky-100 border-t-pulse animate-spin" />
        <div className="absolute inset-0 flex items-center justify-center">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <path d="M2 12h4l2-7 4 14 3-9 2 4h5" stroke="#00E5C7" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
      </div>
      <p className="text-sm text-slate-400 font-medium">{message}</p>
    </div>
  );
}

// ─── Toast ─────────────────────────────────────────────────
export function ToastContainer() {
  const { toasts, remove } = useToastStore();
  const icons    = { success:'✓', error:'✕', warning:'⚠', info:'i' };
  const borders  = { success:'border-l-pulse-dim', error:'border-l-red-500', warning:'border-l-amber-400', info:'border-l-sky-400' };
  return (
    <div className="fixed bottom-6 right-6 z-[900] flex flex-col gap-2.5 pointer-events-none">
      {toasts.map(t => (
        <div key={t.id} onClick={() => remove(t.id)}
          className={`flex items-center gap-3 px-4 py-3.5 bg-ink text-white rounded-lg shadow-xl text-sm font-medium max-w-sm pointer-events-auto cursor-pointer border-l-4 animate-[toastIn_.3s_ease_forwards] ${borders[t.type]}`}>
          <span className="shrink-0 font-bold">{icons[t.type]}</span>
          <span>{t.message}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Modal ─────────────────────────────────────────────────
export function Modal({ open, onClose, title, children, footer, maxWidth='max-w-lg', noPadding=false }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 bg-ink/60 backdrop-blur-sm z-[500] flex items-center justify-center p-5"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`bg-white rounded-xl w-full ${maxWidth} max-h-[92vh] overflow-y-auto shadow-2xl animate-[fadeIn_.2s_ease]`}>
        <div className={`flex items-center justify-between border-b border-border ${noPadding?'px-6 py-4':'px-6 py-5'}`}>
          <h2 className="font-display font-bold text-lg text-ink">{title}</h2>
          <button onClick={onClose}
            className="w-8 h-8 rounded-full bg-surface border border-border flex items-center justify-center text-slate-400 hover:bg-red-50 hover:text-red-500 hover:border-red-200 transition-colors text-sm">
            ✕
          </button>
        </div>
        <div className={noPadding?'':'p-6'}>{children}</div>
        {footer && (
          <div className="flex justify-end gap-2.5 px-6 py-4 border-t border-border">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── EmptyState ────────────────────────────────────────────
export function EmptyState({ icon, title, subtitle, action }) {
  return (
    <div className="text-center py-16 px-6">
      <div className="text-4xl mb-4">{icon}</div>
      <h3 className="font-display font-bold text-base text-ink mb-2">{title}</h3>
      {subtitle && <p className="text-sm text-slate-400 leading-relaxed max-w-xs mx-auto mb-5">{subtitle}</p>}
      {action}
    </div>
  );
}

// ─── Form ──────────────────────────────────────────────────
export function FormGroup({ label, required, hint, error, children }) {
  return (
    <div className="mb-4">
      {label && <label className="block text-sm font-semibold text-ink mb-1.5">{label}{required && <span className="text-red-400 ml-0.5">*</span>}</label>}
      {children}
      {hint && !error && <p className="text-xs text-slate-400 mt-1">{hint}</p>}
      {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
    </div>
  );
}

const inputBase = 'w-full px-3.5 py-2.5 border-[1.5px] rounded-md font-body text-sm text-ink bg-white outline-none transition-all';
const inputFocus = 'focus:border-sky-400 focus:shadow-[0_0_0_3px_rgba(14,165,233,.1)]';
const inputError = 'border-red-400 focus:border-red-400';
const inputNormal = 'border-border';

export function Input({ error, className='', ...props }) {
  return <input className={`${inputBase} ${error?inputError:inputNormal} ${inputFocus} ${className}`} {...props} />;
}

export function Select({ error, className='', children, ...props }) {
  return <select className={`${inputBase} ${error?inputError:inputNormal} ${inputFocus} cursor-pointer ${className}`} {...props}>{children}</select>;
}

export function Textarea({ error, className='', ...props }) {
  return <textarea className={`${inputBase} ${error?inputError:inputNormal} ${inputFocus} resize-y min-h-[100px] leading-relaxed ${className}`} {...props} />;
}

// ─── Toggle ────────────────────────────────────────────────
export function Toggle({ value, onChange, label, description }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        {label && <div className="text-sm font-semibold text-ink">{label}</div>}
        {description && <div className="text-xs text-slate-400 mt-0.5">{description}</div>}
      </div>
      <button type="button" onClick={() => onChange(!value)}
        className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ${value?'bg-pulse-dim':'bg-slate-200'}`}>
        <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all ${value?'left-[22px]':'left-0.5'}`} />
      </button>
    </div>
  );
}

// ─── Progress bar ──────────────────────────────────────────
export function ProgressBar({ value, max=100, color='sky', height='h-2', showLabel=false }) {
  const pct = Math.min(100, Math.round((value/max)*100));
  const colors = {
    sky:   'from-sky-400 to-sky-500',
    pulse: 'from-sky-400 to-pulse',
    amber: 'from-amber-400 to-amber-500',
    red:   'from-red-400 to-red-500',
    green: 'from-emerald-400 to-emerald-500',
  };
  return (
    <div className="w-full">
      <div className={`w-full bg-sky-100 rounded-full overflow-hidden ${height}`}>
        <div className={`h-full bg-gradient-to-r ${colors[color]||colors.sky} rounded-full transition-all duration-700`} style={{width:`${pct}%`}} />
      </div>
      {showLabel && <div className="text-xs font-mono text-slate-400 mt-1 text-right">{pct}%</div>}
    </div>
  );
}

// ─── Score ring ────────────────────────────────────────────
export function ScoreRing({ pct, size=120, strokeWidth=10, label='acierto' }) {
  const r   = (size - strokeWidth) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ - (circ * pct / 100);
  return (
    <div className="relative" style={{width:size, height:size}}>
      <svg width={size} height={size} style={{transform:'rotate(-90deg)'}}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#E0F2FE" strokeWidth={strokeWidth} />
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="url(#sg)" strokeWidth={strokeWidth}
          strokeLinecap="round" strokeDasharray={circ} strokeDashoffset={offset}
          style={{transition:'stroke-dashoffset 1.2s cubic-bezier(.22,1,.36,1)'}} />
        <defs>
          <linearGradient id="sg" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#0EA5E9" />
            <stop offset="100%" stopColor="#00E5C7" />
          </linearGradient>
        </defs>
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-display font-bold text-ink" style={{fontSize:size*0.22}}>{pct}%</span>
        <span className="text-slate-400" style={{fontSize:size*0.1}}>{label}</span>
      </div>
    </div>
  );
}

// ─── Tabs ──────────────────────────────────────────────────
export function Tabs({ tabs, active, onChange, pill=true }) {
  return (
    <div className={pill?'flex bg-surface border border-border rounded-full p-1 gap-1 w-fit':'flex border-b border-border gap-6'}>
      {tabs.map(t => (
        <button key={t.key} onClick={() => onChange(t.key)}
          className={pill
            ? `px-4 py-1.5 rounded-full text-xs font-semibold transition-all whitespace-nowrap ${active===t.key?'bg-ink text-white shadow':'text-slate-400 hover:text-ink'}`
            : `pb-3 text-sm font-semibold border-b-2 transition-all whitespace-nowrap ${active===t.key?'border-ink text-ink':'border-transparent text-slate-400 hover:text-ink'}`
          }>
          {t.label}
          {t.badge != null && (
            <span className={`ml-1.5 px-1.5 py-0.5 rounded-full text-[0.6rem] font-bold ${active===t.key?'bg-white/20 text-white':'bg-sky-100 text-sky-600'}`}>
              {t.badge}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

// ─── Table ─────────────────────────────────────────────────
export function Table({ columns, rows, onRowClick, emptyState }) {
  if (!rows.length && emptyState) return emptyState;
  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="bg-surface border-b border-border">
            {columns.map(c => (
              <th key={c.key} onClick={c.sortable ? () => c.onSort?.() : undefined}
                className={`text-left px-5 py-3 font-mono text-[0.65rem] font-semibold uppercase tracking-wider text-slate-400 ${c.sortable?'cursor-pointer hover:text-sky-600 select-none':''}`}>
                {c.label}{c.sorted && <span className="ml-1">{c.sortDir==='asc'?'↑':'↓'}</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={row.id||i}
              onClick={() => onRowClick?.(row)}
              className={`border-t border-border transition-colors ${onRowClick?'cursor-pointer hover:bg-sky-50':''}`}>
              {columns.map(c => (
                <td key={c.key} className="px-5 py-3.5">{c.render ? c.render(row) : row[c.key]}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Pagination ────────────────────────────────────────────
export function Pagination({ page, total, perPage=15, onChange }) {
  const totalPages = Math.ceil(total / perPage);
  if (totalPages <= 1) return null;
  const pages = Array.from({length: Math.min(5, totalPages)}, (_, i) =>
    Math.max(1, Math.min(page - 2, totalPages - 4)) + i
  );
  return (
    <div className="flex items-center justify-between px-5 py-3.5 border-t border-border bg-surface">
      <span className="text-xs text-slate-400">
        {(page-1)*perPage+1}–{Math.min(page*perPage,total)} de {total}
      </span>
      <div className="flex gap-1">
        <PagBtn disabled={page===1} onClick={() => onChange(page-1)}>←</PagBtn>
        {pages.map(p => <PagBtn key={p} active={p===page} onClick={() => onChange(p)}>{p}</PagBtn>)}
        <PagBtn disabled={page===totalPages} onClick={() => onChange(page+1)}>→</PagBtn>
      </div>
    </div>
  );
}
function PagBtn({ children, onClick, disabled, active }) {
  return (
    <button onClick={onClick} disabled={disabled}
      className={`w-8 h-8 flex items-center justify-center rounded-md border text-sm font-mono transition-all disabled:opacity-40 disabled:pointer-events-none ${active?'bg-ink text-white border-ink':'border-border text-slate-500 hover:border-sky-300 hover:bg-sky-50'}`}>
      {children}
    </button>
  );
}
