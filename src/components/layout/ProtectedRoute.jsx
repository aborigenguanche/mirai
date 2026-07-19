import { Navigate } from 'react-router-dom';
import { useAuthStore } from '../../store';
import { hasAccess, isAdmin, needsOnboarding } from '../../lib/supabase';
import { LoadingScreen } from '../ui';

export function ProtectedRoute({ children, adminOnly = false }) {
  const { profile, loading } = useAuthStore();
  if (loading) return <LoadingScreen message="Verificando sesión..." />;
  if (!profile) return <Navigate to="/auth/login" replace />;
  if (adminOnly && !isAdmin(profile)) return <Navigate to="/app/plan" replace />;
  if (!hasAccess(profile)) return <Navigate to="/auth/checkout" replace />;
  if (needsOnboarding(profile)) return <Navigate to="/auth/onboarding" replace />;
  return children;
}

export function PublicRoute({ children }) {
  const { profile, loading } = useAuthStore();
  if (loading) return <LoadingScreen />;
  if (profile) return <Navigate to={isAdmin(profile) ? '/admin' : '/app/plan'} replace />;
  return children;
}
