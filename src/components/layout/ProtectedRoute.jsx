import { Navigate } from 'react-router-dom';
import { useAuthStore } from '../../store';
import { hasAccess, isAdmin, needsOnboarding } from '../../lib/supabase';
import { LoadingScreen } from '../ui';
import PaywallModal from './PaywallModal';

export function ProtectedRoute({ children, adminOnly = false }) {
  const { profile, loading } = useAuthStore();
  if (loading) return <LoadingScreen message="Verificando sesión..." />;
  if (!profile) return <Navigate to="/auth/login" replace />;
  if (adminOnly && !isAdmin(profile)) return <Navigate to="/app/plan" replace />;
  if (needsOnboarding(profile)) return <Navigate to="/auth/onboarding" replace />;

  // Trial expirado o suscripción vencida — muestra el paywall pero
  // mantiene la app visible detrás (blur), no redirige a otra página.
  // Esto reduce fricción: el usuario ve lo que se pierde, no un muro genérico.
  const blocked = !hasAccess(profile);

  return (
    <>
      <div className={blocked ? 'pointer-events-none select-none blur-sm' : ''}>
        {children}
      </div>
      <PaywallModal open={blocked} />
    </>
  );
}

export function PublicRoute({ children }) {
  const { profile, loading } = useAuthStore();
  if (loading) return <LoadingScreen />;
  if (profile) return <Navigate to={isAdmin(profile) ? '/admin' : '/app/plan'} replace />;
  return children;
}

// Ruta del onboarding: exige sesión y solo deja pasar a quien aún no lo completó.
export function OnboardingRoute({ children }) {
  const { profile, loading } = useAuthStore();
  if (loading) return <LoadingScreen />;
  if (!profile) return <Navigate to="/auth/login" replace />;
  if (!needsOnboarding(profile)) return <Navigate to="/app/plan" replace />;
  return children;
}
