import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { useAuth } from './hooks/useAuth';
import { AppLayout } from './components/layout/AppLayout';
import { ProtectedRoute, PublicRoute } from './components/layout/ProtectedRoute';
import { ToastContainer, LoadingScreen } from './components/ui';
import { useEffect, useState } from 'react';

// Auth
import LoginPage from './pages/auth/LoginPage';
import OnboardingPage from './pages/auth/OnboardingPage';
import CheckoutPage from './pages/auth/CheckoutPage';

// App
import PlanDiaPage from './pages/app/PlanDiaPage';
import ExamenPage from './pages/app/ExamenPage';
import SimulacroPage from './pages/app/SimulacroPage';
import EstadisticasPage from './pages/app/EstadisticasPage';
import ErroresPage from './pages/app/ErroresPage';
import RankingPage from './pages/app/RankingPage';
import NotasPage from './pages/app/NotasPage';
import NotifPage from './pages/app/NotifPage';

// Admin
import AdminDashPage from './pages/admin/DashboardPage';
import AdminPregsPage from './pages/admin/PreguntasPage';
import AdminImportPage from './pages/admin/ImportarPage';
import AdminUsersPage from './pages/admin/UsuariosPage';
import AdminNotifPage from './pages/admin/NotificacionesPage';
import AdminAnalyticsPage from './pages/admin/AnalyticsPage';

function Layout() {
  return <AppLayout><Outlet /></AppLayout>;
}

export default function App() {
  const { loading } = useAuth();
  const [ready, setReady] = useState(false);

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
    <BrowserRouter>
      <Routes>

        <Route path="/" element={<Navigate to="/app/plan" replace />} />

        {/* Auth */}
        <Route path="/auth/login" element={<PublicRoute><LoginPage /></PublicRoute>} />
        <Route path="/auth/onboarding" element={<OnboardingPage />} />
        <Route path="/auth/checkout" element={<CheckoutPage />} />

        {/* App */}
        <Route path="/app" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
          <Route index element={<Navigate to="/app/plan" replace />} />
          <Route path="/app/perfil" element={<PerfilPage />} />
          <Route path="plan" element={<PlanDiaPage />} />
          <Route path="examen" element={<ExamenPage />} />
          <Route path="simulacro" element={<SimulacroPage />} />
          <Route path="estadisticas" element={<EstadisticasPage />} />
          <Route path="errores" element={<ErroresPage />} />
          <Route path="ranking" element={<RankingPage />} />
          <Route path="notas" element={<NotasPage />} />
          <Route path="notificaciones" element={<NotifPage />} />
        </Route>

        {/* Admin */}
        <Route path="/admin" element={<ProtectedRoute adminOnly><Layout /></ProtectedRoute>}>
          <Route index element={<AdminDashPage />} />
          <Route path="preguntas" element={<AdminPregsPage />} />
          <Route path="importar" element={<AdminImportPage />} />
          <Route path="usuarios" element={<AdminUsersPage />} />
          <Route path="notificaciones" element={<AdminNotifPage />} />
          <Route path="analytics" element={<AdminAnalyticsPage />} />
        </Route>

        <Route path="*" element={<Navigate to="/app/plan" replace />} />

      </Routes>

      <ToastContainer />
    </BrowserRouter>
  );
}