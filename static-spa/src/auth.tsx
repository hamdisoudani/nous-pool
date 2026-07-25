import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { endpoints, Me } from './api';

interface AuthState {
  me: Me | null;
  loading: boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    try {
      const m = await endpoints.me();
      setMe(m);
    } catch (e: any) {
      setMe(null);
    } finally {
      setLoading(false);
    }
  }

  async function logout() {
    try { await endpoints.logout(); } catch {}
    setMe(null);
  }

  useEffect(() => { refresh(); }, []);

  return (
    <AuthContext.Provider value={{ me, loading, refresh, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be inside <AuthProvider>');
  return ctx;
}