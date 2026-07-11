import { NavLink, useNavigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { useAuthStore, useNotifStore } from '../../store';
import { signOut, getNotifications, markRead, isAdmin } from '../../lib/supabase';

const NAV_USER = [
  { to:'/app/plan',           label:'Plan de hoy',    icon:'📅' },
  { to:'/app/examen',         label:'Practicar',       icon:'📝' },
  { to:'/app/simulacro',      label:'Simulacro MIR',  icon:'🎯' },
  { to:'/app/estadisticas',   label:'Estadísticas',    icon:'📊' },
  { to:'/app/errores',        label:'Mis errores',     icon:'🧠' },
  { to:'/app/ranking',        label:'Ranking',         icon:'🏆' },
  { to:'/app/notas',          label:'Mis notas',       icon:'📓' },
];

const NAV_ADMIN = [
  { to:'/admin',              label:'Dashboard',       icon:'⚡' },
  { to:'/admin/preguntas',    label:'Preguntas',       icon:'📋' },
  { to:'/admin/importar',     label:'Importar',        icon:'📥' },
  { to:'/admin/usuarios',     label:'Usuarios',        icon:'👥' },
  { to:'/admin/notificaciones', label:'Notificaciones',icon:'🔔' },
  { to:'/admin/analytics',    label:'Analytics',       icon:'📈' },
];

export function AppLayout({ children }) {
  const { profile }    = useAuthStore();
  const notifStore     = useNotifStore();
  const navigate       = useNavigate();
  const [open, setOpen] = useState(false);

  const admin    = isAdmin(profile);
  const initials = (profile?.full_name || profile?.email || 'U')
    .split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);

  useEffect(() => {
    if (!profile?.id) return;
    getNotifications(profile.id).then(notifStore.set);
  }, [profile?.id]);

  async function handleLogout() {
    await signOut();
    navigate('/auth/login');
  }

  return (
    <div className="flex min-h-screen bg-surface">
      {open && <div className="fixed inset-0 bg-ink/50 z-[90] lg:hidden" onClick={() => setOpen(false)} />}

      {/* Sidebar */}
      <aside className={`fixed top-0 left-0 h-full w-64 bg-ink flex flex-col z-[100] transition-transform duration-300 dot-pattern ${open?'translate-x-0':'-translate-x-full'} lg:translate-x-0`}>
        {/* Logo */}
        <div className="flex items-center gap-2.5 px-5 py-6 border-b border-white/8 relative z-10 shrink-0">
          <div className="w-8 h-8 bg-white/8 border border-pulse/30 rounded-[8px] flex items-center justify-center shrink-0">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path d="M2 12h4l2-7 4 14 3-9 2 4h5" stroke="#00E5C7" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <span className="font-display font-bold text-xl text-white">MIR<em className="text-pulse not-italic">ai</em></span>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 flex flex-col gap-0.5 overflow-y-auto scrollbar-thin relative z-10">
          {admin && (
            <>
              <SectionLabel>Administración</SectionLabel>
              {NAV_ADMIN.map(item => <SLink key={item.to} item={item} onClick={() => setOpen(false)} />)}
              <SectionLabel className="mt-3">Estudiante</SectionLabel>
            </>
          )}
          {NAV_USER.map(item => <SLink key={item.to} item={item} onClick={() => setOpen(false)} />)}
        </nav>

        {/* Footer */}
        <div className="px-3 pb-4 pt-3 border-t border-white/8 relative z-10 shrink-0">
          {/* Notificaciones */}
          <NavLink to="/app/notificaciones" onClick={() => setOpen(false)}
            className="flex items-center gap-2.5 px-3 py-2.5 rounded-sm text-sm font-medium text-white/55 hover:bg-white/6 hover:text-white/90 transition-all mb-1 relative">
            🔔 Notificaciones
            {notifStore.unread > 0 && (
              <span className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 bg-pulse text-ink text-[0.6rem] font-bold rounded-full flex items-center justify-center">
                {notifStore.unread}
              </span>
            )}
          </NavLink>
          <button onClick={handleLogout}
            className="flex items-center gap-2.5 px-3 py-2.5 rounded-sm text-sm font-medium text-white/55 hover:bg-white/6 hover:text-white/90 transition-all w-full">
            → Cerrar sesión
          </button>
          {/* Avatar */}
          <div className="flex items-center gap-2.5 px-3 py-2.5 mt-1">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-sky-400 to-pulse flex items-center justify-center font-display text-xs font-bold text-white shrink-0">
              {initials}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-semibold text-white truncate">{profile?.full_name || profile?.email}</div>
              <div className="font-mono text-[0.6rem] text-white/40 uppercase tracking-wider">{profile?.role}</div>
            </div>
          </div>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 lg:ml-64 min-h-screen flex flex-col">
        {/* Mobile topbar */}
        <div className="lg:hidden flex items-center gap-3 px-4 py-3.5 bg-white border-b border-border sticky top-0 z-50">
          <button onClick={() => setOpen(true)}
            className="w-9 h-9 flex items-center justify-center border border-border rounded-md bg-white"
            aria-label="Abrir menú">
            <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>
            </svg>
          </button>
          <span className="font-display font-bold text-lg text-ink">MIR<em className="text-sky-500 not-italic">ai</em></span>
          {notifStore.unread > 0 && (
            <span className="ml-auto w-6 h-6 bg-pulse text-ink text-xs font-bold rounded-full flex items-center justify-center">
              {notifStore.unread}
            </span>
          )}
        </div>
        <div className="flex-1 p-5 lg:p-8">{children}</div>
      </main>
    </div>
  );
}

function SLink({ item, onClick }) {
  return (
    <NavLink to={item.to} end={item.to==='/admin'} onClick={onClick}
      className={({ isActive }) => `
        flex items-center gap-2.5 px-3 py-2.5 rounded-sm text-sm font-medium transition-all relative
        ${isActive
          ? 'bg-pulse/12 text-pulse font-semibold before:absolute before:left-0 before:top-1/2 before:-translate-y-1/2 before:w-0.5 before:h-5 before:bg-pulse before:rounded-r'
          : 'text-white/55 hover:bg-white/6 hover:text-white/90'
        }
      `}>
      <span className="text-base w-5 text-center shrink-0">{item.icon}</span>
      {item.label}
    </NavLink>
  );
}

function SectionLabel({ children, className='' }) {
  return (
    <span className={`font-mono text-[0.62rem] font-semibold tracking-widest uppercase text-white/30 px-2 py-1.5 ${className}`}>
      {children}
    </span>
  );
}
