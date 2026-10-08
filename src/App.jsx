import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { useAuth } from './hooks/useAuth';
import { AppLayout } from './components/layout/AppLayout';
import { ProtectedRoute, PublicRoute, OnboardingRoute } from './components/layout/ProtectedRoute';
import { ToastContainer, LoadingScreen } from './components/ui';
import { useEffect, useState, lazy, Suspense } from 'react';
import ErrorBoundary from './components/ErrorBoundary';
import { installGlobalErrorHandlers } from './lib/supabase';

// Auth
import LoginPage      from './pages/auth/LoginPage';
import OnboardingPage from './pages/auth/OnboardingPage';
import CheckoutPage   from './pages/auth/CheckoutPage';

// App
import PlanDiaPage      from './pages/app/PlanDiaPage';
import ExamenPage       from './pages/app/ExamenPage';
const SimulacroPage = lazy(() => import('./pages/app/SimulacroPage'));
import EstadisticasPage from './pages/app/EstadisticasPage';
import ErroresPage      from './pages/app/ErroresPage';
import RankingPage      from './pages/app/RankingPage';
import NotasPage        from './pages/app/NotasPage';
import NotifPage        from './pages/app/NotifPage';
import PerfilPage       from './pages/app/PerfilPage';

// Admin
const AdminDashPage = lazy(() => import('./pages/admin/DashboardPage'));
const AdminPregsPage = lazy(() => import('./pages/admin/PreguntasPage'));
const AdminImportPage = lazy(() => import('./pages/admin/ImportarPage'));
const AdminUsersPage = lazy(() => import('./pages/admin/UsuariosPage'));
const AdminNotifPage = lazy(() => import('./pages/admin/NotificacionesPage'));
const AdminAnalyticsPage = lazy(() => import('./pages/admin/AnalyticsPage'));
const AdminConfigPage = lazy(() => import('./pages/admin/ConfigPage'));
const AdminModeracionPage = lazy(() => import('./pages/admin/ModeracionPage'));

function Layout() {
  return <AppLayout><ErrorBoundary><Outlet /></ErrorBoundary></AppLayout>;
}

export default function App() {
  const { loading } = useAuth();
  const [ready, setReady] = useState(false);
  useEffect(() => { installGlobalErrorHandlers(); }, []);

  useEffect(() => {
    const hash = window.location.hash;
    if (hash?.includes('access_token')) {
      window.history.replaceState({}, document.title, '/app/plan');
    }
    setReady(true);
  }, []);

  if (!ready || loading) {
    return <LoadingScreen message="Iniciando MIRai..." />;
  }

  return (
    <ErrorBoundary>
    <BrowserRouter>
      <Suspense fallback={<LoadingScreen message="Cargando..." />}>
      <Routes>

        <Route path="/" element={<Navigate to="/app/plan" replace />} />

        {/* Auth */}
        <Route path="/auth/login"       element={<PublicRoute><LoginPage /></PublicRoute>} />
        <Route path="/auth/onboarding"  element={<OnboardingRoute><OnboardingPage /></OnboardingRoute>} />
        <Route path="/auth/checkout"    element={<CheckoutPage />} />

        {/* App */}
        <Route path="/app" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
          <Route index                  element={<Navigate to="/app/plan" replace />} />
          <Route path="plan"            element={<PlanDiaPage />} />
          <Route path="examen"          element={<ExamenPage />} />
          <Route path="simulacro"       element={<SimulacroPage />} />
          <Route path="estadisticas"    element={<EstadisticasPage />} />
          <Route path="errores"         element={<ErroresPage />} />
          <Route path="ranking"         element={<RankingPage />} />
          <Route path="notas"           element={<NotasPage />} />
          <Route path="notificaciones"  element={<NotifPage />} />
          <Route path="perfil"          element={<PerfilPage />} />
        </Route>

        {/* Admin */}
        <Route path="/admin" element={<ProtectedRoute adminOnly><Layout /></ProtectedRoute>}>
          <Route index                  element={<AdminDashPage />} />
          <Route path="preguntas"       element={<AdminPregsPage />} />
          <Route path="importar"        element={<AdminImportPage />} />
          <Route path="usuarios"        element={<AdminUsersPage />} />
          <Route path="notificaciones"  element={<AdminNotifPage />} />
          <Route path="analytics"       element={<AdminAnalyticsPage />} />
          <Route path="config"          element={<AdminConfigPage />} />
          <Route path="moderacion"      element={<AdminModeracionPage />} />
        </Route>

        <Route path="*" element={<Navigate to="/app/plan" replace />} />

      </Routes>
      </Suspense>

      <ToastContainer />
    </BrowserRouter>
    </ErrorBoundary>
  );
}
