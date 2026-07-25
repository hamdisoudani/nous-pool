import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { endpoints, AdminStats } from '../api';
import { formatNum, relativeTime, HealthDot } from '../components/Charts';
import { Shell } from './UserDashboard';

export default function AdminOverview() {
  const { me, logout } = useAuth();
  const nav = useNavigate();
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    try {
      const s = await endpoints.adminStats();
      setStats(s);
      setErr(null);
    } catch (e: any) {
      setErr(e.message);
    }
  }
  useEffect(() => { load(); }, []);

  if (err) {
    return (
      <Shell me={me!} onLogout={async () => { await logout(); nav('/login'); }}>
        <div className="text-bad">{err}</div>
      </Shell>
    );
  }
  if (!stats) {
    return (
      <Shell me={me!} onLogout={async () => { await logout(); nav('/login'); }}>
        <div className="text-muted">loading…</div>
      </Shell>
    );
  }

  const u = stats.users;
  const a = stats.api_keys;
  const p = stats.pool;
  const t = stats.traffic_30d;

  return (
    <Shell me={me!} onLogout={async () => { await logout(); nav('/login'); }}>
      <h1 className="text-xl font-semibold mb-1">Overview</h1>
      <p className="text-muted text-sm mb-6">Whole-pool aggregate (last 30 days)</p>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
        <Metric label="Users" value={formatNum(u.total)} sub={`${u.admins} admin · ${u.disabled} disabled`} />
        <Metric label="Pool accounts" value={formatNum(p.total_accounts)} sub={`${p.healthy_accounts} healthy · ${p.dead_accounts} dead`} />
        <Metric label="Active API keys" value={formatNum(a.active)} sub={`${formatNum(a.total)} total`} />
        <Metric label="Total requests (30d)" value={formatNum(t.total_requests)} sub={`${t.error_rate_pct.toFixed(2)}% errors`} />
        <Metric label="Total tokens (30d)" value={formatNum(t.total_tokens)} sub={`↑ ${formatNum(a.total_prompt_tokens)} prompt · ↓ ${formatNum(a.total_completion_tokens)}`} />
      </div>

      <div className="card mb-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-medium text-muted">All users</h2>
          <a href="/admin/users" className="text-xs text-accent hover:underline">manage users →</a>
        </div>
        {stats.per_user.length === 0 ? (
          <div className="text-muted text-sm">no users yet — sign up via the login page</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-muted text-xs uppercase">
              <tr>
                <th className="text-left py-2">email</th>
                <th className="text-left py-2">role</th>
                <th className="text-left py-2">last seen</th>
                <th className="text-right py-2">active keys</th>
              </tr>
            </thead>
            <tbody>
              {stats.per_user.map(row => (
                <tr key={row.user_id} className="border-t border-line">
                  <td className="py-2 font-mono text-xs">
                    <span className="mr-2">{row.role === 'admin' ? '👑' : '👤'}</span>
                    {row.email}
                    {row.disabled_at && <span className="ml-2 tag tag-bad">disabled</span>}
                  </td>
                  <td className="text-xs text-muted">{row.role}</td>
                  <td className="text-muted text-xs">{relativeTime(row.last_login_at)}</td>
                  <td className="text-right">{row.active_keys_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-medium text-muted">Pool accounts</h2>
          <a href="/admin/accounts" className="text-xs text-accent hover:underline">manage accounts →</a>
        </div>
        {p.total_accounts === 0 ? (
          <div className="text-muted text-sm">no accounts in the pool yet — add one in the Accounts tab</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-muted text-xs uppercase">
              <tr>
                <th className="text-left py-2">account</th>
                <th className="text-left py-2">health</th>
                <th className="text-left py-2">last used</th>
                <th className="text-right py-2">requests</th>
                <th className="text-right py-2">errors</th>
                <th className="text-right py-2">tokens</th>
              </tr>
            </thead>
            <tbody>
              {p.total_accounts && Array.from({length: p.total_accounts}).map((_, i) => (
                <tr key={i} className="border-t border-line text-muted text-xs">
                  <td colSpan={6} className="py-2">See Accounts page for details</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Shell>
  );
}

function Metric({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card">
      <div className="metric-sub mb-1">{label}</div>
      <div className="metric">{value}</div>
      {sub && <div className="metric-sub mt-1">{sub}</div>}
    </div>
  );
}