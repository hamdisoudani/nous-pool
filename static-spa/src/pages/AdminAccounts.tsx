import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { endpoints, InitiateOAuthResp, OAuthFlowOut, PoolAccountOut } from '../api';
import { Shell } from './UserDashboard';
import { relativeTime, HealthDot } from '../components/Charts';

export default function AdminAccounts() {
  const { me, logout } = useAuth();
  const nav = useNavigate();
  const [accounts, setAccounts] = useState<PoolAccountOut[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [label, setLabel] = useState('');
  const [initiating, setInitiating] = useState(false);
  const [flow, setFlow] = useState<InitiateOAuthResp | null>(null);
  const [flowStatus, setFlowStatus] = useState<OAuthFlowOut | null>(null);

  async function load() {
    try {
      const a = await endpoints.listAccounts();
      setAccounts(a);
      setErr(null);
    } catch (e: any) {
      setErr(e.message);
    }
  }
  useEffect(() => { load(); }, []);

  async function onStartFlow() {
    setInitiating(true);
    setErr(null);
    try {
      const r = await endpoints.startAddAccount(label.trim());
      setFlow(r);
      setFlowStatus(null);
      poll(r.flow_id);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setInitiating(false);
    }
  }

  async function poll(flowId: string) {
    let attempts = 0;
    const maxAttempts = 120; // 120 * 5s = 600s = 10min
    while (attempts < maxAttempts) {
      attempts++;
      try {
        // Single poll attempt
        const r = await endpoints.pollOAuthFlow(flowId);
        setFlowStatus(r);
        if (r.status !== 'pending') {
          await load();
          return;
        }
      } catch (e: any) {
        setFlowStatus({
          id: flowId, account_label: '', user_code: '', verification_uri: '',
          status: 'error', error_message: e.message,
          expires_at: '', pool_account_id: null, created_at: '',
        });
        return;
      }
      await new Promise(r => setTimeout(r, 5000));
    }
    setFlowStatus(prev => prev ? { ...prev, status: 'expired' } : null);
  }

  function onCopy(text: string) {
    navigator.clipboard.writeText(text);
  }

  async function onRefreshAll() {
    try {
      const r = await endpoints.refreshAllAccounts();
      setErr(
        `Refreshed ${r.refreshed} accounts, ${r.dead} dead, ${r.skipped} skipped (considered ${r.considered})`
      );
      await load();
    } catch (e: any) {
      setErr(e.message);
    }
  }

  async function onRefreshOne(id: string) {
    try {
      await endpoints.refreshAccount(id);
      await load();
    } catch (e: any) {
      setErr(e.message);
    }
  }

  async function onDeleteOne(id: string, label: string) {
    if (!confirm(`Delete pool account "${label}"?`)) return;
    try {
      await endpoints.deleteAccount(id);
      await load();
    } catch (e: any) {
      setErr(e.message);
    }
  }

  return (
    <Shell me={me!} onLogout={async () => { await logout(); nav('/login'); }}>
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-xl font-semibold">Pool accounts</h1>
        <div className="flex gap-2">
          <button className="btn btn-secondary" onClick={onRefreshAll}>Refresh all</button>
          <button className="btn btn-primary" onClick={() => setShowAdd(true)}>+ Add account</button>
        </div>
      </div>
      <p className="text-muted text-sm mb-6">
        NOUS / Hermes accounts that back the round-robin proxy. Add via device-code flow.
      </p>

      {err && (
        <div className="mb-4 text-sm text-bad bg-bad/10 border border-bad/20 rounded p-2">{err}</div>
      )}

      {showAdd && !flow && (
        <div className="card mb-6 space-y-4">
          <h2 className="text-sm font-medium">Add a pool account</h2>
          <div>
            <label className="label">Account label</label>
            <input
              className="input w-full"
              value={label}
              onChange={e => setLabel(e.target.value)}
              placeholder="e.g. mrhamdi291@gmail.com"
              autoFocus
            />
            <p className="text-xs text-muted mt-1">
              This becomes the account's display name in the dashboard.
            </p>
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => { setShowAdd(false); setLabel(''); }}
              disabled={initiating}
            >
              Cancel
            </button>
            <button
              className="btn btn-primary"
              onClick={onStartFlow}
              disabled={!label.trim() || initiating}
            >
              {initiating ? 'Starting…' : 'Start device-code flow'}
            </button>
          </div>
        </div>
      )}

      {flow && (
        <div className="card mb-6 border-accent2/40 bg-accent2/5">
          <h2 className="text-sm font-medium mb-3">Authorize this device-code</h2>
          <div className="text-sm space-y-3">
            <div>
              <div className="text-muted text-xs mb-1">1. Open this URL in your browser:</div>
              <div className="font-mono text-xs break-all bg-bg border border-line rounded p-2 flex items-center gap-2">
                <a
                  href={flow.verification_uri}
                  target="_blank"
                  rel="noreferrer"
                  className="text-accent2 underline"
                >
                  {flow.verification_uri}
                </a>
                <button
                  className="text-xs text-muted hover:text-ink"
                  onClick={() => onCopy(flow.verification_uri)}
                >
                  copy
                </button>
              </div>
            </div>
            <div>
              <div className="text-muted text-xs mb-1">2. Enter this code when prompted:</div>
              <div className="font-mono text-lg bg-bg border border-line rounded px-3 py-2 inline-flex items-center gap-2">
                {flow.user_code}
                <button
                  className="text-xs text-muted hover:text-ink"
                  onClick={() => onCopy(flow.user_code)}
                >
                  copy
                </button>
              </div>
            </div>
            <div className="text-xs text-muted">
              Code expires in {Math.floor(flow.expires_in / 60)}m.{' '}
              We'll detect the success automatically and add the account to the pool.
            </div>
            {flowStatus && (
              <div className="mt-2 p-2 border rounded bg-bg border-line">
                <div>
                  Status:{' '}
                  <span
                    className={
                      flowStatus.status === 'success' ? 'text-ok font-mono'
                      : flowStatus.status === 'pending' ? 'text-muted font-mono'
                      : 'text-bad font-mono'
                    }
                  >
                    {flowStatus.status}
                  </span>
                </div>
                {flowStatus.error_message && (
                  <div className="text-bad text-xs mt-1">{flowStatus.error_message}</div>
                )}
                {flowStatus.status === 'success' && flowStatus.pool_account_id && (
                  <div className="text-ok text-xs mt-1">
                    ✓ Account added (id={flowStatus.pool_account_id})
                  </div>
                )}
              </div>
            )}
            <button
              className="btn btn-secondary text-sm"
              onClick={() => { setFlow(null); setFlowStatus(null); setShowAdd(false); setLabel(''); }}
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      <div className="card">
        {accounts.length === 0 ? (
          <div className="text-muted text-sm">
            no accounts yet — click "+ Add account" to start the device-code flow
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-muted text-xs uppercase">
              <tr>
                <th className="text-left py-2">label</th>
                <th className="text-left py-2">health</th>
                <th className="text-left py-2">token expires</th>
                <th className="text-left py-2">last used</th>
                <th className="text-right py-2">requests</th>
                <th className="text-right py-2">errors</th>
                <th className="text-right py-2">tokens</th>
                <th className="text-right py-2">in flight</th>
                <th className="text-right py-2">actions</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map(a => (
                <tr key={a.id} className="border-t border-line align-top">
                  <td className="py-2 font-mono text-xs">{a.account_label}</td>
                  <td><HealthDot status={a.health_status} /></td>
                  <td className="text-muted text-xs">
                    {relativeTime(a.token_expires_at)}
                    {a.last_error_msg && (
                      <div className="text-bad text-[10px] mt-1 truncate max-w-xs" title={a.last_error_msg}>
                        {a.last_error_msg}
                      </div>
                    )}
                  </td>
                  <td className="text-muted text-xs">{relativeTime(a.last_used_at)}</td>
                  <td className="text-right">{a.total_requests}</td>
                  <td className="text-right">{a.total_errors}</td>
                  <td className="text-right">{a.total_tokens}</td>
                  <td className="text-right">{a.in_flight} / {a.max_concurrent}</td>
                  <td className="text-right whitespace-nowrap">
                    <button
                      className="text-accent2 hover:underline text-xs mr-3"
                      onClick={() => onRefreshOne(a.id)}
                    >
                      refresh
                    </button>
                    <button
                      className="text-bad hover:underline text-xs"
                      onClick={() => onDeleteOne(a.id, a.account_label)}
                    >
                      delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Shell>
  );
}