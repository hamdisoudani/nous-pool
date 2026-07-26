import { Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, RequireAuth, useAuth } from "./auth";
import { LoginPage } from "./pages/LoginPage";
import { UserDashboard } from "./pages/UserDashboard";
import { AdminOverview } from "./pages/AdminOverview";
import { AdminUsers } from "./pages/AdminUsers";
import { AdminAccounts } from "./pages/AdminAccounts";

function RootRedirect() {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;
  return <Navigate to={user.role === "admin" ? "/admin" : "/dashboard"} replace />;
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/" element={<RootRedirect />} />

        <Route
          path="/dashboard"
          element={
            <RequireAuth>
              <UserDashboard />
            </RequireAuth>
          }
        />
        <Route
          path="/admin"
          element={
            <RequireAuth role="admin">
              <AdminOverview />
            </RequireAuth>
          }
        />
        <Route
          path="/admin/users"
          element={
            <RequireAuth role="admin">
              <AdminUsers />
            </RequireAuth>
          }
        />
        <Route
          path="/admin/accounts"
          element={
            <RequireAuth role="admin">
              <AdminAccounts />
            </RequireAuth>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}