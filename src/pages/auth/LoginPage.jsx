import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { Button, Input, FormGroup } from '../../components/ui';

export default function LoginPage() {
  const navigate = useNavigate();
  const [tab, setTab]         = useState('login');
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');
  const [confirm, setConfirm] = useState(false);
  const [loginForm, setLoginForm] = useState({ email:'', password:'' });
  const [regForm,   setRegForm]   = useState({ name:'', email:'', password:'' });
  const [errs, setErrs]           = useState({});

  function clear() { setError(''); setErrs({}); }

  async function handleLogin(e) {
    e.preventDefault(); clear();
    const err = {};
    if (!/\S+@\S+\.\S+/.test(loginForm.email)) err.email = 'Email no válido';
    if (loginForm.password.length < 6)          err.pass  = 'Mínimo 6 caracteres';
    if (Object.keys(err).length) { setErrs(err); return; }
    setLoading(true);
    const { data, error: e2 } = await supabase.auth.signInWithPassword({ email: loginForm.email, password: loginForm.password });
    setLoading(false);
    if (e2) { setError(e2.message === 'Invalid login credentials' ? 'Email o contraseña incorrectos' : e2.message); return; }
    const { data: p } = await supabase.from('profiles').select('role,onboarding_completed').eq('id', data.user.id).single();
    navigate(p?.role === 'admin' ? '/admin' : p?.onboarding_completed ? '/app/plan' : '/auth/onboarding', { replace: true });
  }

  async function handleRegister(e) {
    e.preventDefault(); clear();
    const err = {};
    if (!regForm.name.trim())                    err.name  = 'Introduce tu nombre';
    if (!/\S+@\S+\.\S+/.test(regForm.email))     err.email = 'Email no válido';
    if (regForm.password.length < 8)             err.pass  = 'Mínimo 8 caracteres';
    if (Object.keys(err).length) { setErrs(err); return; }
    setLoading(true);
    const { data, error: e2 } = await supabase.auth.signUp({
      email: regForm.email, password: regForm.password,
      options: { data: { full_name: regForm.name } },
    });
    setLoading(false);
    if (e2) { setError(e2.message); return; }
    if (data.session) { navigate('/auth/onboarding', { replace: true }); }
    else              { setConfirm(true); }
  }

  async function handleGoogle() {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/app/plan` },
    });
  }

  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      {/* Left */}
      <div className="hidden lg:flex bg-ink flex-col p-10 relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_600px_500px_at_20%_80%,rgba(0,229,199,.12),transparent_70%),radial-gradient(ellipse_400px_300px_at_80%_10%,rgba(14,165,233,.08),transparent_70%)] pointer-events-none" />
        <div className="absolute inset-0 dot-pattern pointer-events-none opacity-50" />
        <div className="flex items-center gap-2.5 relative z-10">
          <div className="w-8 h-8 bg-white/8 border border-pulse/30 rounded-[9px] flex items-center justify-center">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M2 12h4l2-7 4 14 3-9 2 4h5" stroke="#00E5C7" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </div>
          <span className="font-display font-bold text-xl text-white">MIR<em className="text-pulse not-italic">ai</em></span>
        </div>
        <div className="flex-1 flex flex-col justify-center relative z-10 max-w-sm">
          <span className="flex items-center gap-2 font-mono text-[0.72rem] text-pulse mb-5 before:content-[''] before:w-4 before:h-0.5 before:bg-pulse-dim before:rounded">
            Preparación MIR con IA
          </span>
          <h1 className="font-display text-[2.4rem] font-bold text-white leading-[1.1] tracking-tight mb-5">
            Estudia con<br/><span className="text-pulse">inteligencia</span>,<br/>no con horas.
          </h1>
          <p className="text-white/60 leading-relaxed mb-9 text-base">
            Algoritmo SM-2, simulacro MIR real con predicción de plaza, análisis de errores y Coach IA que sabe exactamente qué necesitas estudiar hoy.
          </p>
          <div className="flex gap-8">
            {[['8.500+','Preguntas MIR'],['19','Especialidades'],['4.9★','Valoración']].map(([v,l]) => (
              <div key={l}><div className="font-display font-bold text-2xl text-pulse leading-none">{v}</div><div className="text-xs text-white/40 mt-0.5">{l}</div></div>
            ))}
          </div>
        </div>
        <div className="absolute bottom-16 left-0 right-0 h-14 opacity-25 pointer-events-none overflow-hidden">
          <svg viewBox="0 0 1400 60" preserveAspectRatio="none" style={{width:'200%',height:'100%',animation:'ecgScroll 11s linear infinite'}}>
            <path d="M0,30 L120,30 L150,30 L165,8 L180,52 L195,18 L210,30 L700,30 L720,30 L735,8 L750,52 L765,18 L780,30 L1400,30" fill="none" stroke="#00E5C7" strokeWidth="2" strokeLinecap="round"/>
          </svg>
        </div>
      </div>

      {/* Right */}
      <div className="flex items-center justify-center p-8 bg-white min-h-screen lg:min-h-0">
        <div className="w-full max-w-sm">
          {confirm ? (
            <div className="text-center">
              <div className="w-16 h-16 bg-pulse-bg border-2 border-pulse-dim/30 rounded-full flex items-center justify-center mx-auto mb-5 text-2xl">✓</div>
              <h2 className="font-display font-bold text-2xl text-ink mb-2">Revisa tu email</h2>
              <p className="text-slate-500 text-sm leading-relaxed mb-6">Enviamos un enlace de confirmación a <strong className="text-ink">{regForm.email}</strong>.</p>
              <button onClick={() => { setConfirm(false); setTab('login'); }} className="text-sky-600 font-semibold text-sm hover:text-sky-700">← Volver al inicio de sesión</button>
            </div>
          ) : (
            <>
              <h2 className="font-display font-bold text-2xl text-ink mb-1.5">{tab==='login'?'Bienvenido de nuevo':'Crea tu cuenta'}</h2>
              <p className="text-sm text-slate-500 mb-6">{tab==='login'?'Accede a tu plan de estudio personalizado':'7 días gratis, sin tarjeta de crédito'}</p>

              {/* Tabs */}
              <div className="flex bg-surface border border-border rounded-full p-1 mb-7 gap-1">
                {[['login','Iniciar sesión'],['register','Crear cuenta']].map(([t,l]) => (
                  <button key={t} onClick={() => { setTab(t); clear(); }}
                    className={`flex-1 py-2 rounded-full text-sm font-semibold transition-all ${tab===t?'bg-ink text-white shadow-md':'text-slate-500'}`}>{l}</button>
                ))}
              </div>

              {error && <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-500 mb-4">{error}</div>}

              {tab === 'login' ? (
                <form onSubmit={handleLogin} noValidate>
                  <FormGroup label="Email" error={errs.email}>
                    <Input type="email" placeholder="tu@email.com" autoComplete="email" value={loginForm.email}
                      onChange={e => setLoginForm(p=>({...p,email:e.target.value}))} error={errs.email} />
                  </FormGroup>
                  <FormGroup label="Contraseña" error={errs.pass}>
                    <Input type="password" placeholder="••••••••" autoComplete="current-password" value={loginForm.password}
                      onChange={e => setLoginForm(p=>({...p,password:e.target.value}))} error={errs.pass} />
                  </FormGroup>
                  <Button type="submit" fullWidth size="lg" loading={loading} className="mt-2">Entrar →</Button>
                </form>
              ) : (
                <form onSubmit={handleRegister} noValidate>
                  <FormGroup label="Nombre completo" error={errs.name}>
                    <Input type="text" placeholder="Ana García" autoComplete="name" value={regForm.name}
                      onChange={e => setRegForm(p=>({...p,name:e.target.value}))} error={errs.name} />
                  </FormGroup>
                  <FormGroup label="Email" error={errs.email}>
                    <Input type="email" placeholder="tu@email.com" autoComplete="email" value={regForm.email}
                      onChange={e => setRegForm(p=>({...p,email:e.target.value}))} error={errs.email} />
                  </FormGroup>
                  <FormGroup label="Contraseña" error={errs.pass}>
                    <Input type="password" placeholder="Mínimo 8 caracteres" autoComplete="new-password" value={regForm.password}
                      onChange={e => setRegForm(p=>({...p,password:e.target.value}))} error={errs.pass} />
                  </FormGroup>
                  <Button type="submit" fullWidth size="lg" loading={loading} className="mt-2">Crear cuenta gratis →</Button>
                </form>
              )}

              <div className="flex items-center gap-3 my-5 text-xs text-slate-400">
                <div className="flex-1 h-px bg-border"/>o<div className="flex-1 h-px bg-border"/>
              </div>
              <button onClick={handleGoogle}
                className="w-full flex items-center justify-center gap-2.5 py-2.5 border-[1.5px] border-border rounded-full text-sm font-semibold text-ink hover:border-sky-300 hover:bg-sky-50 transition-all">
                <svg width="18" height="18" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
                Continuar con Google
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
