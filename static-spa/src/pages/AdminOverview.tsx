import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Shell } from "@/components/Shell";
import { api, AdminStats } from "@/auth";
import {
  Activity, Users, Database, KeyRound, AlertTriangle,
  TrendingUp, Cpu
} from "lucide-react";
import { formatNumber } from "@/lib/utils";

function StatCard({
  icon, label, value, sub, variant = "default",
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: React.ReactNode;
  variant?: "default" | "success" | "destructive";
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm text-muted-foreground">{label}</p>
            <div className="text-3xl font-bold tabular-nums mt-2">{value}</div>
            {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
          </div>
          <div className={`h-10 w-10 rounded-md flex items-center justify-center ${
            variant === "destructive" ? "bg-red-500/10 text-red-500" :
            variant === "success" ? "bg-emerald-500/10 text-emerald-500" :
            "bg-primary/10 text-primary"
          }`}>
            {icon}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function AdminOverview() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.stats()
      .then(setStats)
      .catch((e) => setError(e?.body?.error || e?.message));
  }, []);

  if (error) {
    return (
      <Shell>
        <Card>
          <CardContent className="pt-6 text-center text-destructive">{error}</CardContent>
        </Card>
      </Shell>
    );
  }

  if (!stats) {
    return (
      <Shell>
        <div className="text-muted-foreground">Loading…</div>
      </Shell>
    );
  }

  const errorRate =
    stats.pool.total_requests === 0
      ? 0
      : (stats.pool.total_errors / stats.pool.total_requests) * 100;

  return (
    <Shell>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Overview</h1>
          <p className="text-muted-foreground mt-1">
            Live stats across all pool accounts and API keys.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            icon={<Activity className="h-5 w-5" />}
            label="Total Requests"
            value={formatNumber(stats.pool.total_requests)}
            sub={`${stats.pool.in_flight_requests} in-flight`}
          />
          <StatCard
            icon={<TrendingUp className="h-5 w-5" />}
            label="Total Tokens"
            value={formatNumber(stats.pool.total_tokens)}
            sub={`${formatNumber(stats.pool.prompt_tokens)} prompt / ${formatNumber(stats.pool.completion_tokens)} completion`}
          />
          <StatCard
            icon={<Database className="h-5 w-5" />}
            label="Pool Accounts"
            value={`${stats.pool.healthy_accounts} / ${stats.pool.total_accounts}`}
            sub={stats.pool.dead_accounts > 0 ? (
              <span className="text-destructive">{stats.pool.dead_accounts} dead</span>
            ) : (
              <span className="text-emerald-500">all healthy</span>
            )}
          />
          <StatCard
            icon={<Users className="h-5 w-5" />}
            label="Users"
            value={String(stats.users.total)}
            sub={`${stats.users.admins} admin${stats.users.admins === 1 ? "" : "s"}`}
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Error Rate</CardTitle>
              <CardDescription>Across the lifetime of the pool</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-4xl font-bold tabular-nums">
                {errorRate.toFixed(2)}
                <span className="text-base text-muted-foreground ml-1">%</span>
              </div>
              <div className="text-xs text-muted-foreground mt-2">
                {stats.pool.total_errors.toLocaleString()} errors out of{" "}
                {stats.pool.total_requests.toLocaleString()} requests
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Cpu className="h-4 w-4" />
                Models Served
              </CardTitle>
              <CardDescription>Models available through the pool</CardDescription>
            </CardHeader>
            <CardContent>
              {stats.pool.models_supported.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Add a pool account to discover supported models.
                </p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {stats.pool.models_supported.map((m) => (
                    <Badge key={m} variant="secondary">{m}</Badge>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {stats.pool.dead_accounts > 0 && (
          <Card className="border-destructive/30 bg-destructive/5">
            <CardContent className="pt-6 flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
              <div>
                <div className="font-semibold">
                  {stats.pool.dead_accounts} pool account{stats.pool.dead_accounts === 1 ? "" : "s"} need attention
                </div>
                <p className="text-sm text-muted-foreground mt-1">
                  These accounts are returning 400/401 on token refresh and need re-authorization.
                  Visit <span className="font-medium">Pool Accounts</span> to re-add them.
                </p>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </Shell>
  );
}
