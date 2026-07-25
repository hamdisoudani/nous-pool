import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { endpoints, MyUsage } from '../api';
import { BarChart, formatNum } from '../components/Charts';

export default function UserDashboard() {
  const { me, logout } = useAuth();
  const nav = useNavigate();
  const [data, setData] = useState<MyUsage | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);

  async function load() {
    try {
      const d = await endpoints.myUsage();
      setData(d);
      setErr(null);
    } catch (e: any) {
      setErr(e.message);
    }
  }
  useEffect(() => { load(); }, []);
  useEffect(() => {
    if (!autoRefresh) return;
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [autoRefresh]);

  if (!data) {
    return (
      <Shell me={me!} onLogout={async () => { await logout(); nav('/login'); }}>
        <div className="text-muted">{err ? `error: ${err}` : 'loading…'}</div>
      </Shell>
    );
  }

  return (
    <Shell
      me={me!}
      onLogout={async () => { await logout(); nav('/login'); }}
      right={
        <label className="text-xs text-muted flex items-center gap-2">
          <input type="checkbox" checked={autoRefresh} onChange={e => setAutoRefresh(e.target.checked)} />
          auto-refresh
        </label>
      }
    >
      <h1 className="text-xl font-semibold mb-1">Your usage</h1>
      <p className="text-muted text-sm mb-6">{data.email}</p>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <Metric label="Total requests (30d)" value={formatNum(data.total_requests_30d)} />
        <Metric
          label="Total tokens (30d)"
          value={formatNum(data.total_tokens_30d)}
          sub={`↑ ${formatNum(data.prompt_tokens_30d)} prompt · ↓ ${formatNum(data.completion_tokens_30d)} completion`}
        />
        <Metric
          label="Success rate"
          value={`${data.error_rate_pct.toFixed(2)}% errors`}
          sub={`${data.successful_requests_30d} / ${data.total_requests_30d} successful`}
        />
        <Metric label="Daily avg" value={formatNum(Math.round(data.total_requests_30d / 30))} sub="requests/day" />
      </div>

      <div className="card">
        <h2 className="text-sm font-medium text-muted mb-3">Daily requests (last 7 days)</h2>
        <BarChart data={data.daily} fields={['requests']} colors={['#60a5fa']} />
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

export function Shell({ me, onLogout, right, children }: {
  me: { email: string; role: string };
  onLogout: () => void;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen">
      <header className="border-b border-line">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-accent to-accent2" />
            <div className="font-semibold">Nous Pool</div>
            {me.role === 'admin' && (
              <nav className="ml-6 flex gap-1 text-sm">
                <a href="/admin" className="px-3 py-1.5 rounded text-muted hover:text-ink hover:bg-line/40">overview</a>
                <a href="/admin/users" className="px-3 py-1.5 rounded text-muted hover:text-ink hover:bg-line/40">users</a>
                <a href="/admin/accounts" className="px-3 py-1.5 rounded text-muted hover:text-ink hover:bg-line/40">accounts</a>
              </nav>
            )}
          </div>
          <div className="flex items-center gap-4">
            {right}
            <div className="text-sm text-muted">{me.email}</div>
            <button className="btn btn-secondary text-sm" onClick={onLogout}>Sign out</button>
          </div>
        </div>
      </header>
      <main className="max-w-6xl mx-auto px-4 py-8">{children}</main>
    </div>
  );
}