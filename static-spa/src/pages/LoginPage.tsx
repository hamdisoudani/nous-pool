import { useEffect, useState } from 'react';
import { useNavigate, useLocation, Navigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { endpoints, ApiError } from '../api';

export default function LoginPage() {
  const { me, loading, refresh } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted">
        loading…
      </div>
    );
  }

  if (me) {
    return <Navigate to={me.role === 'admin' ? '/admin' : '/dashboard'} replace />;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const result = await endpoints.login(email.trim(), password);
      await refresh();
      navigate(result.user.role === 'admin' ? '/admin' : '/dashboard', { replace: true });
    } catch (e: any) {
      if (e instanceof ApiError) {
        if (e.status === 401) setError('Wrong email or password.');
        else if (e.status === 403) setError('Your account is disabled.');
        else setError(((e.body as any)?.error as string) || `Login failed (${e.status})`);
      } else {
        setError(String(e));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-block w-12 h-12 rounded-xl bg-gradient-to-br from-accent to-accent2 mb-3" />
          <h1 className="text-2xl font-semibold">Nous Pool</h1>
          <p className="text-muted text-sm mt-1">
            Sign in to continue
          </p>
        </div>

        <form className="card space-y-4" onSubmit={onSubmit}>
          <div>
            <label className="block text-xs text-muted mb-1">Email</label>
            <input
              type="email"
              autoFocus
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="input w-full"
              placeholder="[email protected]"
            />
          </div>

          <div>
            <label className="block text-xs text-muted mb-1">Password</label>
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="input w-full"
              placeholder="••••••••"
            />
          </div>

          <button
            type="submit"
            disabled={busy || !email || !password}
            className="btn btn-primary w-full"
          >
            {busy ? 'Signing in…' : 'Sign in'}
          </button>

          {error && (
            <div className="text-sm text-bad bg-bad/10 border border-bad/20 rounded p-2">
              {error}
            </div>
          )}

          <div className="pt-3 border-t border-line text-xs text-muted text-center space-y-1">
            <div>New user?</div>
            <div>
              Ask the admin to create your account, then sign in with the
              password they gave you.
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}