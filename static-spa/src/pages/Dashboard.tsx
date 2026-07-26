/**
 * Dashboard — single shared view for both users and admins.
 *
 * - User sees: their own personal stats + key management
 * - Admin sees: PERSONAL stats + site-wide overview section + quick
 *   actions to navigate to /admin/users, /admin/accounts, /admin/analytics
 *
 * No difference in the page chrome (one AppShell, one route, one auth check).
 * The only differences are conditional widgets gated on `user.role === "admin"`.
 */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, AppUser, AdminAnalytics, MyUsage } from "@/auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  KeyRound,
  Activity,
  Users,
  Database,
  ShieldCheck,
  TrendingUp,
  AlertCircle,
  Zap,
  Plus,
  ShieldAlert,
} from "lucide-react";

function formatNumber(n: number) {
  return new Intl.NumberFormat().format(n);
}

type UsageWindow = "24h" | "7d" | "30d";

function Stat({
  label,
  value,
  hint,
  icon: Icon,
  trend,
}: {
  label: string;
  value: string | number;
  hint?: string;
  icon: React.ComponentType<{ className?: string }>;
  trend?: "up" | "down" | "flat";
}) {
  return (
    <Card>
      <CardContent className="p-6">
        <div className="flex items-start justify-between">
          <div className="space-y-1.5">
            <div className="text-sm font-medium text-muted-foreground">
              {label}
            </div>
            <div className="text-3xl font-bold tabular-nums">{value}</div>
            {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
          </div>
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-muted">
            <Icon className="h-5 w-5" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function PersonalUsageCard({ usage }: { usage: MyUsage }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Activity className="h-4 w-4" />
          Your usage — last 30 days
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Requests</span>
          <span className="font-medium tabular-nums">
            {formatNumber(usage.totals.requests)}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Total tokens</span>
          <span className="font-medium tabular-nums">
            {formatNumber(usage.totals.total_tokens)}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Errors</span>
          <span className="font-medium tabular-nums text-destructive">
            {formatNumber(usage.totals.errors)}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

function AdminSiteAnalyticsCard({ a, window: w }: { a: AdminAnalytics; window: UsageWindow }) {
  const r = a.requests[w];
  const errRate = r.requests > 0
    ? ((r.errors / r.requests) * 100).toFixed(1)
    : "0.0";
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between text-base">
          <span className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4" />
            Site traffic — {w}
          </span>
          <Badge variant="secondary">{errRate}% errors</Badge>
        </CardTitle>
        <CardDescription>
          Aggregated server-side from request_logs (Postgres + Python).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Requests</span>
          <span className="font-medium tabular-nums">{formatNumber(r.requests)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Total tokens</span>
          <span className="font-medium tabular-nums">{formatNumber(r.total_tokens)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Prompt / completion</span>
          <span className="font-medium tabular-nums">
            {formatNumber(r.prompt_tokens)} / {formatNumber(r.completion_tokens)}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Errors</span>
          <span className="font-medium tabular-nums text-destructive">
            {formatNumber(r.errors)}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

function AdminTopUsersCard({ top }: { top: AdminAnalytics["top_users_30d"] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Users className="h-4 w-4" />
          Top users (30d)
        </CardTitle>
      </CardHeader>
      <CardContent>
        {top.length === 0 ? (
          <div className="text-sm text-muted-foreground py-6 text-center">
            No traffic yet.
          </div>
        ) : (
          <ul className="space-y-1.5 text-sm">
            {top.map((u, i) => (
              <li
                key={u.user_id}
                className="flex items-center justify-between gap-3"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-muted-foreground tabular-nums w-6">
                    #{i + 1}
                  </span>
                  <span className="truncate">{u.email}</span>
                </div>
                <span className="font-medium tabular-nums">
                  {formatNumber(u.total_tokens)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export function Dashboard({ user }: { user: AppUser }) {
  const isAdmin = user.role === "admin";
  const [usage, setUsage] = useState<MyUsage | null>(null);
  const [analytics, setAnalytics] = useState<AdminAnalytics | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const u = await api.myUsage();
        if (!cancelled) setUsage(u);
        if (isAdmin) {
          const a = await api.getAnalytics();
          if (!cancelled) setAnalytics(a);
        }
      } catch (e: unknown) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
        }
      }
    })();
    return () => { cancelled = true; };
  }, [isAdmin]);

  return (
    <div className="space-y-8">
      {/* Greeting */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            Welcome back, {user.display_name || user.email.split("@")[0]}
          </h1>
          <p className="text-muted-foreground mt-1">
            {isAdmin
              ? "Operator dashboard — manage users, pool accounts, and view site-wide analytics."
              : "Your Nous Pool account. Mint keys, view usage, integrate with the API."}
          </p>
        </div>
        <div className="flex gap-2">
          <Button asChild>
            <Link to="/keys">
              <Plus className="h-4 w-4 mr-1" />
              New API key
            </Link>
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm">
          {error}
        </div>
      )}

      {/* ===== Personal stats — visible to BOTH user and admin ===== */}
      <div>
        <h2 className="text-sm font-semibold text-muted-foreground mb-3 uppercase tracking-wider">
          Your account
        </h2>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Stat
            label="Role"
            value={user.role}
            icon={isAdmin ? ShieldCheck : KeyRound}
            hint={isAdmin ? "Full administrative access" : "Standard access"}
          />
          <Stat
            label="Email"
            value={user.email.length > 22 ? user.email.slice(0, 22) + "…" : user.email}
            icon={Users}
          />
          <Stat
            label="Requests (30d)"
            value={usage ? formatNumber(usage.totals.requests) : "—"}
            icon={Activity}
          />
          <Stat
            label="Total tokens (30d)"
            value={usage ? formatNumber(usage.totals.total_tokens) : "—"}
            hint={usage ? `${formatNumber(usage.totals.prompt_tokens)} prompt · ${formatNumber(usage.totals.completion_tokens)} completion` : undefined}
            icon={Zap}
          />
        </div>
      </div>

      {/* ===== Admin-only section ===== */}
      {isAdmin && analytics && (
        <div>
          <h2 className="text-sm font-semibold text-muted-foreground mb-3 uppercase tracking-wider flex items-center gap-2">
            <ShieldAlert className="h-4 w-4" />
            Admin — site overview
          </h2>

          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 mb-4">
            <Stat
              label="Total users"
              value={formatNumber(analytics.users.total)}
              hint={`${analytics.users.banned} banned`}
              icon={Users}
            />
            <Stat
              label="Active API keys"
              value={formatNumber(analytics.api_keys.active)}
              hint={`${formatNumber(analytics.api_keys.revoked)} revoked`}
              icon={KeyRound}
            />
            <Stat
              label="Pool accounts"
              value={formatNumber(analytics.pool_accounts.total)}
              hint={`${analytics.pool_accounts.active} active · ${analytics.pool_accounts.dead} dead`}
              icon={Database}
            />
            <Stat
              label="Errors (30d)"
              value={formatNumber(analytics.requests["30d"].errors)}
              hint={`of ${formatNumber(analytics.requests["30d"].requests)} requests`}
              icon={AlertCircle}
            />
          </div>

          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <AdminSiteAnalyticsCard a={analytics} window="24h" />
            <AdminSiteAnalyticsCard a={analytics} window="7d" />
            <AdminSiteAnalyticsCard a={analytics} window="30d" />
          </div>

          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 mt-4">
            <AdminTopUsersCard top={analytics.top_users_30d} />

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Quick actions</CardTitle>
                <CardDescription>
                  Privileged operations — server-side enforced.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                <Button variant="outline" className="w-full justify-start" asChild>
                  <Link to="/admin/users">
                    <Users className="h-4 w-4 mr-2" /> Manage users
                  </Link>
                </Button>
                <Button variant="outline" className="w-full justify-start" asChild>
                  <Link to="/admin/accounts">
                    <Database className="h-4 w-4 mr-2" /> Pool accounts
                  </Link>
                </Button>
                <Button variant="outline" className="w-full justify-start" asChild>
                  <Link to="/admin/analytics">
                    <TrendingUp className="h-4 w-4 mr-2" /> Site analytics
                  </Link>
                </Button>
              </CardContent>
            </Card>

            {usage && <PersonalUsageCard usage={usage} />}
          </div>
        </div>
      )}

      {/* User gets their personal usage card right under their stats */}
      {!isAdmin && usage && (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <PersonalUsageCard usage={usage} />

          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="text-base">Get started</CardTitle>
              <CardDescription>
                Use your Nous Pool API key with any OpenAI SDK by pointing it at:
              </CardDescription>
            </CardHeader>
            <CardContent>
              <pre className="rounded-md bg-muted p-4 text-xs overflow-x-auto">
{`from openai import OpenAI

client = OpenAI(
    api_key="sk_live_YOUR_KEY",
    base_url="https://web-production-8dac4.up.railway.app/v1",
)

resp = client.chat.completions.create(
    model="hermes-3",
    messages=[{"role": "user", "content": "Hello!"}],
)`}
              </pre>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

export default Dashboard;
