import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { endpoints, ApiKeyOut, UserOut } from '../api';
import { Shell } from './UserDashboard';
import { relativeTime } from '../components/Charts';

export default function AdminUsers() {
  const { me, logout } = useAuth();
  const nav = useNavigate();
  const [users, setUsers] = useState<UserOut[]>([]);
  const [selected, setSelected] = useState<UserOut | null>(null);
  const [keys, setKeys] = useState<ApiKeyOut[]>([]);
  const [revealedKey, setRevealedKey] = useState<{ email: string; sk: string; prefix: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function loadUsers() {
    try {
      const u = await endpoints.listUsers();
      setUsers(u);
      setErr(null);
    } catch (e: any) {
      setErr(e.message);
    }
  }
  useEffect(() => { loadUsers(); }, []);

  async function selectUser(u: UserOut) {
    setSelected(u);
    try {
      const k = await endpoints.listKeys(u.id);
      setKeys(k);
    } catch (e: any) {
      setErr(e.message);
      setKeys([]);
    }
  }

  async function onMint() {
    if (!selected) return;
    const label = prompt(`Label for new key for ${selected.email}:`, 'default');
    if (label === null) return;
    try {
      const r = await endpoints.mintKey(selected.id, label);
      setRevealedKey({ email: selected.email, sk: r.sk_live_key, prefix: r.prefix });
      await selectUser(selected);
    } catch (e: any) {
      setErr(e.message);
    }
  }

  async function onRevoke(keyId: string) {
    if (!confirm('Revoke this API key? Requests using it will start failing immediately.')) return;
    try {
      await endpoints.revokeKey(keyId);
      if (selected) await selectUser(selected);
    } catch (e: any) {
      setErr(e.message);
    }
  }

  return (
    <Shell me={me!} onLogout={async () => { await logout(); nav('/login'); }}>
      <h1 className="text-xl font-semibold mb-1">Users</h1>
      <p className="text-muted text-sm mb-6">
        Read-only view. Promote roles and disable users in{' '}
        <a
          href={`https://supabase.com/dashboard/project/akmmalhluanjvqvgujch/database/public/app_users`}
          target="_blank"
          rel="noreferrer"
          className="text-accent2 hover:underline"
        >
          Supabase Studio →
        </a>
      </p>

      {err && (
        <div className="mb-4 text-sm text-bad bg-bad/10 border border-bad/20 rounded p-2">{err}</div>
      )}

      {revealedKey && (
        <div className="card mb-6 border-accent2/40 bg-accent2/5">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="text-sm text-muted mb-1">
                API key for <strong>{revealedKey.email}</strong> — copy now, it won't be shown again
              </div>
              <div className="font-mono text-xs break-all bg-bg border border-line rounded p-2">
                {revealedKey.sk}
              </div>
              <div className="text-xs text-muted mt-1">
                prefix: <code>{revealedKey.prefix}</code>
              </div>
            </div>
            <button
              className="btn btn-secondary text-sm whitespace-nowrap"
              onClick={() => {
                navigator.clipboard.writeText(revealedKey.sk);
                setRevealedKey(null);
              }}
            >
              Copy &amp; dismiss
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card">
          <h2 className="text-sm font-medium text-muted mb-3">All users</h2>
          {users.length === 0 ? (
            <div className="text-muted text-sm">no users yet — sign up via the login page</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-muted text-xs uppercase">
                <tr>
                  <th className="text-left py-2">email</th>
                  <th className="text-left py-2">role</th>
                  <th className="text-left py-2">last login</th>
                  <th className="text-right py-2">active keys</th>
                </tr>
              </thead>
              <tbody>
                {users.map(u => (
                  <tr
                    key={u.id}
                    className={`border-t border-line cursor-pointer hover:bg-line/30 ${selected?.id === u.id ? 'bg-line/40' : ''}`}
                    onClick={() => selectUser(u)}
                  >
                    <td className="py-2 font-mono text-xs">
                      <span className="mr-2">{u.role === 'admin' ? '👑' : '👤'}</span>
                      {u.email}
                      {u.disabled_at && <span className="ml-2 tag tag-bad">disabled</span>}
                    </td>
                    <td><span className={`tag ${u.role === 'admin' ? 'tag-info' : 'tag-muted'}`}>{u.role}</span></td>
                    <td className="text-muted text-xs">{relativeTime(u.last_login_at)}</td>
                    <td className="text-right">{u.active_keys_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="card">
          {!selected ? (
            <div className="text-muted text-sm">Click a user to see and manage their API keys.</div>
          ) : (
            <>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-medium">
                  Keys for <span className="font-mono">{selected.email}</span>
                </h2>
                <button className="btn btn-primary text-sm" onClick={onMint}>+ Mint key</button>
              </div>
              {keys.length === 0 ? (
                <div className="text-muted text-sm">no keys yet</div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="text-muted text-xs uppercase">
                    <tr>
                      <th className="text-left py-2">prefix</th>
                      <th className="text-left py-2">label</th>
                      <th className="text-left py-2">status</th>
                      <th className="text-left py-2">last used</th>
                      <th className="text-right py-2">requests</th>
                      <th className="text-right py-2">actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {keys.map(k => (
                      <tr key={k.id} className="border-t border-line">
                        <td className="py-2 font-mono text-xs">{k.key_prefix}</td>
                        <td className="text-xs">{k.key_label || '—'}</td>
                        <td>
                          <span className={`tag ${k.is_active ? 'tag-info' : 'tag-muted'}`}>
                            {k.is_active ? 'active' : 'revoked'}
                          </span>
                        </td>
                        <td className="text-muted text-xs">{relativeTime(k.last_used_at)}</td>
                        <td className="text-right">{k.total_requests}</td>
                        <td className="text-right">
                          {k.is_active && (
                            <button className="text-bad hover:underline text-xs" onClick={() => onRevoke(k.id)}>
                              revoke
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          )}
        </div>
      </div>
    </Shell>
  );
}