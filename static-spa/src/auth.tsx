import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { useNavigate, useLocation } from "react-router-dom";

// ---------- Backend API ----------
export type Role = "user" | "admin";

export type AppUser = {
  id: string;
  email: string;
  role: Role;
  display_name: string | null;
  avatar_url: string | null;
  disabled_at: string | null;
  last_login_at: string | null;
  created_at: string | null;
  active_api_keys_count?: number;
};

class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const r = await fetch(path, {
    credentials: "include",
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers as Record<string, string> | undefined),
    },
  });
  if (!r.ok) {
    const body = await r.json().catch(() => ({ error: r.statusText }));
    throw new ApiError(`HTTP ${r.status}`, r.status, body);
  }
  return r.json();
}

export type InitiateOAuthResp = {
  flow_id: string;
  user_code: string;
  verification_uri: string;
  interval: number;
  expires_in: number;
};

export type OAuthPollResp =
  | { status: "pending"; interval: number; expires_in: number }
  | { status: "success"; pool_account_id: string; account_label: string }
  | { status: "expired" }
  | { status: "error"; detail: string };

export type PoolAccountOut = {
  id: string;
  account_label: string;
  health_status: string | null;
  weight: number | null;
  supported_models: string[] | null;
  total_requests: number;
  total_errors: number;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  in_flight: number;
  max_concurrent: number | null;
  last_used_at: string | null;
  last_error_at: string | null;
  last_error_msg: string | null;
  token_expires_at: string | null;
  created_at: string;
  updated_at: string | null;
};

export type ApiKeyOut = {
  id: string;
  user_id: string;
  key_prefix: string;
  sk_live_key?: string;  // only returned on creation
  label: string;
  is_active: boolean;
  created_at: string;
  last_used_at: string | null;
  total_requests: number;
};

export type AdminAnalytics = {
  ts: string;
  users: {
    total: number;
    active: number;
    banned: number;
    admins: number;
  };
  api_keys: {
    total: number;
    active: number;
    revoked: number;
  };
  pool_accounts: {
    total: number;
    active: number;
    disabled: number;
    dead: number;
  };
  requests: {
    "24h": {
      requests: number;
      errors: number;
      prompt_tokens: number;
      completion_tokens: number;
      total_tokens: number;
    };
    "7d": {
      requests: number;
      errors: number;
      prompt_tokens: number;
      completion_tokens: number;
      total_tokens: number;
    };
    "30d": {
      requests: number;
      errors: number;
      prompt_tokens: number;
      completion_tokens: number;
      total_tokens: number;
    };
  };
  top_users_30d: Array<{
    user_id: string;
    email: string;
    total_tokens: number;
  }>;
};

export type MyUsage = {
  period: { days: number };
  totals: {
    requests: number;
    errors: number;
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  by_day: Array<{ date: string; requests: number; tokens: number }>;
  recent: Array<{
    id: string;
    model: string;
    created_at: string;
    status_code: number;
    tokens: number;
  }>;
};

export const ApiErrorClass = ApiError;
export const api = {
  me: () => apiFetch<AppUser>("/admin/me"),
  login: (email: string, password: string) =>
    apiFetch<{ user: AppUser }>("/admin/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  signup: (email: string, password: string) =>
    apiFetch<{ user: AppUser }>("/admin/auth/signup", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  logout: () => apiFetch<{ ok: true }>("/admin/auth/logout", { method: "POST" }),
  myUsage: () => apiFetch<MyUsage>("/admin/me/usage"),
  listAccounts: () =>
    apiFetch<{ accounts: PoolAccountOut[] }>("/admin/accounts"),
  initiateAddAccount: (label: string) =>
    apiFetch<InitiateOAuthResp>("/admin/accounts/add", {
      method: "POST",
      body: JSON.stringify({ label }),
    }),
  pollFlow: (flowId: string) =>
    apiFetch<OAuthPollResp>(`/admin/accounts/flow/${flowId}/poll`, {
      method: "POST",
    }),
  refreshAccount: (id: string) =>
    apiFetch<{ status: string }>(`/admin/accounts/${id}/refresh`, {
      method: "POST",
    }),
  deleteAccount: (id: string) =>
    apiFetch<{ ok: true }>(`/admin/accounts/${id}`, { method: "DELETE" }),
  listUsers: () => apiFetch<{ users: AppUser[] }>("/admin/users"),
  setUserRole: (userId: string, role: Role) =>
    apiFetch<{ ok: true; user_id: string; role: Role }>(
      `/admin/users/${userId}/role`,
      { method: "PATCH", body: JSON.stringify({ role }) },
    ),
  banUser: (userId: string, reason?: string) =>
    apiFetch<{ ok: true; user_id: string; disabled_at: string; reason?: string }>(
      `/admin/users/${userId}/ban`,
      { method: "POST", body: JSON.stringify({ reason: reason ?? null }) },
    ),
  unbanUser: (userId: string) =>
    apiFetch<{ ok: true; user_id: string; disabled_at: null }>(
      `/admin/users/${userId}/unban`,
      { method: "POST" },
    ),
  getAnalytics: () => apiFetch<AdminAnalytics>("/admin/analytics"),
  listMyApiKeys: () =>
    apiFetch<{ keys: ApiKeyOut[] }>("/admin/me/api-keys"),
  createMyApiKey: (label: string) =>
    apiFetch<ApiKeyOut>(`/admin/me/api-keys`, {
      method: "POST",
      body: JSON.stringify({ label }),
    }),
  revokeMyApiKey: (id: string) =>
    apiFetch<{ ok: true }>(`/admin/me/api-keys/${id}`, { method: "DELETE" }),
};

// ---------- Auth context ----------

type AuthCtx = {
  user: AppUser | null;
  loading: boolean;
  refresh: () => Promise<void>;
  login: (email: string, password: string) => Promise<AppUser>;
  signup: (email: string, password: string) => Promise<AppUser>;
  logout: () => Promise<void>;
};

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    setLoading(true);
    try {
      const me = await api.me();
      setUser(me);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        setUser(null);
      } else {
        console.error("auth/me failed", e);
        setUser(null);
      }
    } finally {
      setLoading(false);
    }
  }

  async function login(email: string, password: string): Promise<AppUser> {
    const r = await api.login(email, password);
    setUser(r.user);
    return r.user;
  }

  async function signup(email: string, password: string): Promise<AppUser> {
    const r = await api.signup(email, password);
    setUser(r.user);
    return r.user;
  }

  async function logout() {
    try {
      await api.logout();
    } catch {
      /* ignore */
    }
    setUser(null);
  }

  useEffect(() => {
    refresh();
  }, []);

  return (
    <Ctx.Provider value={{ user, loading, refresh, login, signup, logout }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}

// Convenience guard component
export function RequireAuth({ children, role }: { children: ReactNode; role?: Role }) {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (loading) return;
    if (!user) {
      navigate("/login", { replace: true, state: { from: location.pathname } });
      return;
    }
    if (role && user.role !== role) {
      // Bounce non-admins away from /admin
      navigate(user.role === "admin" ? "/admin" : "/dashboard", {
        replace: true,
      });
    }
  }, [user, loading, role, navigate, location.pathname]);

  if (loading) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center text-muted-foreground">
        Loading…
      </div>
    );
  }
  if (!user) return null;
  if (role && user.role !== role) return null;
  return <>{children}</>;
}
