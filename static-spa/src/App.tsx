import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth';
import LoginPage from './pages/LoginPage';
import UserDashboard from './pages/UserDashboard';
import AdminOverview from './pages/AdminOverview';
import AdminUsers from './pages/AdminUsers';
import AdminAccounts from './pages/AdminAccounts';

function ProtectedRoute({ children, requireAdmin }: { children: JSX.Element; requireAdmin?: boolean }) {
  const { me, loading } = useAuth();
  const location = useLocation();
  if (loading) return <div className="min-h-screen flex items-center justify-center text-muted">loading…</div>;
  if (!me) return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  if (requireAdmin && me.role !== 'admin') return <Navigate to="/dashboard" replace />;
  return children;
}

function RoleRouter() {
  const { me, loading } = useAuth();
  if (loading) return <div className="min-h-screen flex items-center justify-center text-muted">loading…</div>;
  if (!me) return <Navigate to="/login" replace />;
  // Root route → role-routed default
  return <Navigate to={me.role === 'admin' ? '/admin' : '/dashboard'} replace />;
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/" element={<RoleRouter />} />
        <Route path="/dashboard" element={<ProtectedRoute><UserDashboard /></ProtectedRoute>} />
        <Route path="/admin" element={<ProtectedRoute requireAdmin><AdminOverview /></ProtectedRoute>} />
        <Route path="/admin/users" element={<ProtectedRoute requireAdmin><AdminUsers /></ProtectedRoute>} />
        <Route path="/admin/accounts" element={<ProtectedRoute requireAdmin><AdminAccounts /></ProtectedRoute>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}