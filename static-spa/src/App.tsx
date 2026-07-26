import { Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, RequireAuth, useAuth } from "./auth";
import { LoginPage } from "./pages/LoginPage";
import { Dashboard } from "./pages/Dashboard";
import { MyKeys } from "./pages/MyKeys";
import { AdminUsers } from "./pages/AdminUsers";
import { AdminAccounts } from "./pages/AdminAccounts";
import { AnalyticsPage } from "./pages/AnalyticsPage";
import { AppShell } from "./components/Shell";

/**
 * AuthenticatedLayout — wraps every protected page in the AppShell
 * (top NavigationMenu, brand, role-aware items, user badge, signout).
 * Passes the resolved `user` to children so they don't have to
 * re-fetch /admin/me.
 */
function AuthenticatedLayout({ children }: { children: (u: any) => React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center text-muted-foreground">
        Loading…
      </div>
    );
  }
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  return (
    <AppShell>
      {children(user)}
    </AppShell>
  );
}

function RootRedirect() {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;
  // BOTH user and admin land on /dashboard — the Dashboard component
  // renders extra widgets if user.role === "admin".
  return <Navigate to="/dashboard" replace />;
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/" element={<RootRedirect />} />

        {/* Shared dashboard — same route, different widgets based on role */}
        <Route
          path="/dashboard"
          element={
            <AuthenticatedLayout>
              {(u) => <Dashboard user={u} />}
            </AuthenticatedLayout>
          }
        />

        {/* Shared /keys — every user manages their own keys */}
        <Route
          path="/keys"
          element={
            <AuthenticatedLayout>
              {() => <MyKeys />}
            </AuthenticatedLayout>
          }
        />

        {/* Admin-only routes — RequireAuth middleware on top of the
            server-side require_admin on the FastAPI endpoint, so even a
            tampered SPA cannot reach these without a real admin JWT. */}
        <Route
          path="/admin"
          element={
            <RequireAuth role="admin">
              <AppShell>
                <Navigate to="/dashboard" replace />
              </AppShell>
            </RequireAuth>
          }
        />
        <Route
          path="/admin/users"
          element={
            <RequireAuth role="admin">
              <AppShell>
                <AdminUsers />
              </AppShell>
            </RequireAuth>
          }
        />
        <Route
          path="/admin/accounts"
          element={
            <RequireAuth role="admin">
              <AppShell>
                <AdminAccounts />
              </AppShell>
            </RequireAuth>
          }
        />
        <Route
          path="/admin/analytics"
          element={
            <RequireAuth role="admin">
              <AppShell>
                <AnalyticsPage />
              </AppShell>
            </RequireAuth>
          }
        />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}