/**
 * AnalyticsPage — detailed site-wide analytics (admin only).
 *
 * Data flow: GET /admin/analytics -> JSON -> render.
 * The SPA NEVER calls Supabase directly; every aggregation is done
 * server-side by the FastAPI router.
 */
import { useEffect, useState } from "react";
import { api, AdminAnalytics } from "@/auth";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card";
import {
  Table, TableHeader, TableRow, TableHead, TableBody, TableCell,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  TrendingUp, Users, KeyRound, Database, RefreshCw,
} from "lucide-react";

function formatNumber(n: number) {
  return new Intl.NumberFormat().format(n);
}

export function AnalyticsPage() {
  const [a, setA] = useState<AdminAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const x = await api.getAnalytics();
      setA(x);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  if (loading) {
    return (
      <div className="p-8 text-center text-muted-foreground">
        Loading analytics…
      </div>
    );
  }
  if (error) {
    return (
      <div className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm">
        {error}
      </div>
    );
  }
  if (!a) return null;

  const err30 = a.requests["30d"].requests
    ? ((a.requests["30d"].errors / a.requests["30d"].requests) * 100).toFixed(1)
    : "0.0";

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Site analytics</h1>
          <p className="text-muted-foreground mt-1">
            Aggregate counts across all users, requests, errors. Server-side computed.
          </p>
        </div>
        <button
          onClick={load}
          className="inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
        >
          <RefreshCw className="h-4 w-4" /> Refresh
        </button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="p-6">
            <div className="text-sm font-medium text-muted-foreground">Users</div>
            <div className="text-3xl font-bold tabular-nums mt-1.5">
              {formatNumber(a.users.total)}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              {formatNumber(a.users.active)} active · {formatNumber(a.users.banned)} banned
              · {formatNumber(a.users.admins)} admins
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <div className="text-sm font-medium text-muted-foreground">Active API keys</div>
            <div className="text-3xl font-bold tabular-nums mt-1.5">
              {formatNumber(a.api_keys.active)}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              {formatNumber(a.api_keys.total)} total · {formatNumber(a.api_keys.revoked)} revoked
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <div className="text-sm font-medium text-muted-foreground">Pool accounts</div>
            <div className="text-3xl font-bold tabular-nums mt-1.5">
              {formatNumber(a.pool_accounts.total)}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              {formatNumber(a.pool_accounts.active)} active ·{" "}
              {formatNumber(a.pool_accounts.disabled)} disabled ·{" "}
              {formatNumber(a.pool_accounts.dead)} dead
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <div className="text-sm font-medium text-muted-foreground">Error rate (30d)</div>
            <div className="text-3xl font-bold tabular-nums mt-1.5">
              {a.requests["30d"].requests > 0
                ? <>{err30}<span className="text-base text-muted-foreground">%</span></>
                : <span className="text-muted-foreground">—</span>}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              {formatNumber(a.requests["30d"].errors)} of{" "}
              {formatNumber(a.requests["30d"].requests)}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Three time-windows */}
      <div className="grid gap-4 md:grid-cols-3">
        {(["24h", "7d", "30d"] as const).map((w) => {
          const r = a.requests[w];
          const err = r.requests ? ((r.errors / r.requests) * 100).toFixed(1) : "0.0";
          return (
            <Card key={w}>
              <CardHeader>
                <CardTitle className="flex items-center justify-between text-base">
                  <span className="flex items-center gap-2">
                    <TrendingUp className="h-4 w-4" /> {w}
                  </span>
                  <Badge variant={Number(err) > 5 ? "destructive" : "secondary"}>
                    {err}% errors
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1.5 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Requests</span>
                  <span className="tabular-nums">{formatNumber(r.requests)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Total tokens</span>
                  <span className="tabular-nums">{formatNumber(r.total_tokens)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Prompt</span>
                  <span className="tabular-nums">{formatNumber(r.prompt_tokens)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Completion</span>
                  <span className="tabular-nums">{formatNumber(r.completion_tokens)}</span>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Top users */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" /> Top users by tokens (30d)
          </CardTitle>
          <CardDescription>
            Aggregate from request_logs joined to app_users.email.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {a.top_users_30d.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              No traffic recorded yet.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">#</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead>User ID</TableHead>
                  <TableHead className="text-right">Total tokens</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {a.top_users_30d.map((u, i) => (
                  <TableRow key={u.user_id}>
                    <TableCell className="text-muted-foreground tabular-nums">#{i + 1}</TableCell>
                    <TableCell className="font-medium">{u.email}</TableCell>
                    <TableCell>
                      <code className="text-xs text-muted-foreground">
                        {u.user_id.slice(0, 8)}…
                      </code>
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-medium">
                      {formatNumber(u.total_tokens)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default AnalyticsPage;
