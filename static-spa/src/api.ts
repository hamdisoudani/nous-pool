/** Tiny typed fetch wrapper. Throws on non-2xx. */
export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

const BASE = ''; // same-origin

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(BASE + path, {
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
    ...init,
  });
  const text = await res.text();
  let body: unknown = null;
  if (text) {
    try { body = JSON.parse(text); } catch { body = text; }
  }
  if (!res.ok) {
    const msg =
      body && typeof body === 'object' && 'detail' in body
        ? String((body as any).detail)
        : res.statusText;
    throw new ApiError(msg, res.status, body);
  }
  return body as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path, { method: 'GET' }),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: JSON.stringify(body ?? {}) }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};

// ===== Domain types =====

export interface Me {
  id: string;
  email: string;
  role: 'admin' | 'user';
  display_name?: string | null;
}

export interface UserOut {
  id: string;
  email: string;
  role: 'admin' | 'user';
  display_name?: string | null;
  created_at: string;
  last_login_at: string | null;
  disabled_at: string | null;
  active_keys_count: number;
}

export interface ApiKeyOut {
  id: string;
  user_id: string;
  key_prefix: string;
  key_label: string | null;
  is_active: boolean;
  last_used_at: string | null;
  total_requests: number;
  total_prompt_tokens: number;
  total_completion_tokens: number;
  created_at: string;
  expires_at: string | null;
}

export interface PoolAccountOut {
  id: string;
  account_label: string;
  health_status: 'healthy' | 'degraded' | 'dead' | 'refreshing';
  weight: number;
  total_requests: number;
  total_errors: number;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  in_flight: number;
  max_concurrent: number;
  last_used_at: string | null;
  last_error_at: string | null;
  last_error_msg: string | null;
  token_expires_at: string;
  supported_models: string[] | null;
  created_at: string;
  updated_at: string;
}

export interface OAuthFlowOut {
  id: string;
  account_label: string;
  user_code: string;
  verification_uri: string;
  status: 'pending' | 'success' | 'expired' | 'error' | 'cancelled';
  expires_at: string;
  error_message: string | null;
  pool_account_id: string | null;
  created_at: string;
}

export interface InitiateOAuthResp {
  flow_id: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

export interface MintKeyResp {
  id: string;
  sk_live_key: string;
  prefix: string;
  label: string;
  warning: string;
}

export interface MyUsage {
  user_id: string;
  email: string;
  total_requests_30d: number;
  successful_requests_30d: number;
  error_rate_pct: number;
  total_tokens_30d: number;
  prompt_tokens_30d: number;
  completion_tokens_30d: number;
  daily: Array<{ date: string; requests: number; tokens: number }>;
}

export interface AdminStats {
  users: {
    total: number;
    active: number;
    admins: number;
    disabled: number;
  };
  api_keys: {
    total: number;
    active: number;
    total_requests: number;
    total_prompt_tokens: number;
    total_completion_tokens: number;
  };
  pool: {
    total_accounts: number;
    healthy_accounts: number;
    dead_accounts: number;
    total_requests: number;
    total_errors: number;
    total_tokens: number;
    in_flight: number;
  };
  traffic_30d: {
    total_requests: number;
    successful_requests: number;
    error_rate_pct: number;
    total_tokens: number;
  };
  per_user: Array<{
    user_id: string;
    email: string;
    role: string;
    active_keys_count: number;
    last_login_at: string | null;
    disabled_at: string | null;
  }>;
}

// ===== Endpoint wrappers =====

export const endpoints = {
  // Auth
  login: (email: string, password: string) =>
    api.post<{ user: Me; expires_at: number }>(
      '/admin/auth/login',
      { email, password },
    ),
  logout: () => api.post<{ ok: boolean }>('/admin/auth/logout'),
  me: () => api.get<Me>('/admin/me'),

  // Users
  listUsers: () => api.get<UserOut[]>('/admin/users'),

  // API keys (admin)
  mintKey: (user_id: string, label: string = 'default') =>
    api.post<MintKeyResp>('/admin/api-keys', { user_id, label }),
  listKeys: (user_id: string) =>
    api.get<ApiKeyOut[]>(`/admin/api-keys?user_id=${user_id}`),
  revokeKey: (key_id: string) =>
    api.delete<{ ok: boolean }>(`/admin/api-keys/${key_id}`),

  // Pool accounts
  listAccounts: () => api.get<PoolAccountOut[]>('/admin/accounts'),
  startAddAccount: (label: string) =>
    api.post<InitiateOAuthResp>('/admin/accounts/add', { label }),
  getOAuthFlow: (flow_id: string) =>
    api.get<OAuthFlowOut>(`/admin/accounts/flow/${flow_id}`),
  pollOAuthFlow: (flow_id: string) =>
    api.post<OAuthFlowOut>(`/admin/accounts/flow/${flow_id}/poll`),
  refreshAccount: (id: string) =>
    api.post<{ status: string; reason?: string }>(
      `/admin/accounts/${id}/refresh`,
    ),
  refreshAllAccounts: () =>
    api.post<{ refreshed: number; dead: number; skipped: number; considered: number }>(
      '/admin/accounts/refresh-all',
    ),
  deleteAccount: (id: string) =>
    api.delete<{ ok: boolean }>(`/admin/accounts/${id}`),

  // Stats
  adminStats: () => api.get<AdminStats>('/admin/stats'),
  myUsage: () => api.get<MyUsage>('/me/usage'),
};