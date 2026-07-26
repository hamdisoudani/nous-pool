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
import { PageHeader, SectionLabel, StatTile } from "@/components/PageHeader";
import {
  StatTileSkeleton,
  StatGridSkeleton,
  DetailCardSkeleton,
  PillsSkeleton,
} from "@/components/Skeletons";
import { formatNumber, percent } from "@/lib/format";
import {
  Users,
  Database,
  TrendingUp,
  Plus,
  Check,
  AlertCircle,
} from "@/components/icons";

type UsageWindow = "24h" | "7d" | "30d";

/**
 * Which ':free' models the pool can serve, read live from the upstream Nous
 * catalogue rather than hardcoded — the free tier changes as Nous adds and
 * retires models, and a stale list means users paste a model id that 404s.
 */
function FreeModelsCard({
  models,
  loading,
  error,
}: {
  models: string[];
  loading: boolean;
  error: string | null;
}) {
  return (
    <Card className="lg:col-span-2">
      <CardHeader className="px-4 py-3">
        <CardTitle className="text-[13px] font-semibold">
          Supported models
        </CardTitle>
        <CardDescription className="text-xs">
          Free-tier models this pool can serve right now. Pass any of these as{" "}
          <code className="text-[11px]">model</code>.
        </CardDescription>
      </CardHeader>
      <CardContent className="px-4 pb-4 pt-0">
        {loading ? (
          <PillsSkeleton count={4} />
        ) : error ? (
          <div className="flex items-start gap-2 text-xs text-muted-foreground">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
            <span>
              Couldn't reach the model catalogue ({error}). The pool may have no
              healthy account.
            </span>
          </div>
        ) : models.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No free models reported by the upstream catalogue.
          </p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {models.map((m) => (
              <span
                key={m}
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2 py-1 font-mono text-[11px]"
              >
                <Check className="h-3 w-3 text-success" />
                {m}
              </span>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function PersonalUsageCard({ usage }: { usage: MyUsage }) {
  return (
    <Card>
      <CardHeader className="px-4 py-3">
        <CardTitle className="text-[13px] font-semibold">
          Your usage · 30 days
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1.5 px-4 pb-4 pt-0 text-[13px]">
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
          <span
            className={`font-medium tabular-nums ${
              usage.totals.errors > 0 ? "text-destructive" : ""
            }`}
          >
            {formatNumber(usage.totals.errors)}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

function AdminSiteAnalyticsCard({ a, window: w }: { a: AdminAnalytics; window: UsageWindow }) {
  const r = a.requests[w];
  const errRate = percent(r.errors, r.requests);
  return (
    <Card>
      <CardHeader className="px-4 py-3">
        <CardTitle className="flex items-center justify-between text-[13px] font-semibold">
          <span>Site traffic · {w}</span>
          <Badge
            variant={Number(errRate) > 5 ? "destructive" : "secondary"}
            className="px-1.5 py-0 text-[10px] font-medium"
          >
            {errRate}% err
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1.5 px-4 pb-4 pt-0 text-[13px]">
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
          <span
            className={`font-medium tabular-nums ${
              r.errors > 0 ? "text-destructive" : ""
            }`}
          >
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
      <CardHeader className="px-4 py-3">
        <CardTitle className="text-[13px] font-semibold">
          Top users · 30 days
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4 pt-0">
        {top.length === 0 ? (
          <div className="py-6 text-center text-[13px] text-muted-foreground">
            No traffic yet.
          </div>
        ) : (
          <ul className="space-y-1.5 text-[13px]">
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
  const [freeModels, setFreeModels] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Tracked per-resource so each panel can swap its own skeleton out as soon as
  // its data lands, instead of the whole page waiting on the slowest call.
  const [loadingUsage, setLoadingUsage] = useState(true);
  const [loadingAnalytics, setLoadingAnalytics] = useState(isAdmin);
  const [loadingModels, setLoadingModels] = useState(true);
  const [modelsError, setModelsError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    // Fired concurrently — the model catalogue call can take a second when the
    // upstream cache is cold and shouldn't hold up the usage numbers.
    api.myUsage()
      .then((u) => { if (!cancelled) setUsage(u); })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => { if (!cancelled) setLoadingUsage(false); });

    api.freeModels()
      .then((r) => { if (!cancelled) setFreeModels(r.models); })
      .catch((e) => {
        if (!cancelled) {
          setModelsError(e instanceof Error ? e.message : String(e));
        }
      })
      .finally(() => { if (!cancelled) setLoadingModels(false); });

    if (isAdmin) {
      api.getAnalytics()
        .then((a) => { if (!cancelled) setAnalytics(a); })
        .catch((e) => {
          if (!cancelled) setError(e instanceof Error ? e.message : String(e));
        })
        .finally(() => { if (!cancelled) setLoadingAnalytics(false); });
    }

    return () => { cancelled = true; };
  }, [isAdmin]);

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Welcome back, ${user.display_name || user.email.split("@")[0]}`}
        description={
          isAdmin
            ? "Operator dashboard — users, pool accounts and site-wide traffic."
            : "Mint keys, track usage, and point any OpenAI client at the proxy."
        }
        actions={
          <Button asChild size="sm">
            <Link to="/keys">
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              New API key
            </Link>
          </Button>
        }
      />

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-[13px]">
          {error}
        </div>
      )}

      {/* ===== Personal stats — visible to BOTH user and admin ===== */}
      <div>
        <SectionLabel>Your account</SectionLabel>
        <div className="grid gap-2.5 sm:grid-cols-3">
          {/* Role is known from the session, so it never needs a skeleton. */}
          <StatTile
            label="Role"
            value={user.role}
            hint={isAdmin ? "Full administrative access" : "Standard access"}
          />
          {loadingUsage ? (
            <>
              <StatTileSkeleton />
              <StatTileSkeleton />
            </>
          ) : (
            <>
              <StatTile
                label="Requests · 30d"
                value={usage ? formatNumber(usage.totals.requests) : "—"}
                hint={
                  usage && usage.totals.errors > 0
                    ? `${formatNumber(usage.totals.errors)} errors`
                    : "No errors"
                }
              />
              <StatTile
                label="Tokens · 30d"
                value={usage ? formatNumber(usage.totals.total_tokens) : "—"}
                hint={
                  usage
                    ? `${formatNumber(usage.totals.prompt_tokens)} prompt · ${formatNumber(usage.totals.completion_tokens)} completion`
                    : undefined
                }
              />
            </>
          )}
        </div>
      </div>

      {/* ===== Supported models — everyone needs to know what to call ===== */}
      <div>
        <SectionLabel>Models</SectionLabel>
        <div className="grid gap-2.5 lg:grid-cols-2">
          <FreeModelsCard
            models={freeModels}
            loading={loadingModels}
            error={modelsError}
          />
        </div>
      </div>

      {/* ===== Admin-only section ===== */}
      {isAdmin && loadingAnalytics && (
        <div className="space-y-2.5">
          <SectionLabel>Site overview</SectionLabel>
          <StatGridSkeleton count={4} />
          <div className="grid gap-2.5 md:grid-cols-3">
            <DetailCardSkeleton />
            <DetailCardSkeleton />
            <DetailCardSkeleton />
          </div>
        </div>
      )}

      {isAdmin && !loadingAnalytics && analytics && (
        <div className="space-y-2.5">
          <SectionLabel>Site overview</SectionLabel>

          <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile
              label="Total users"
              value={formatNumber(analytics.users.total)}
              hint={`${analytics.users.banned} banned · ${analytics.users.admins} admin`}
            />
            <StatTile
              label="Active API keys"
              value={formatNumber(analytics.api_keys.active)}
              hint={`${formatNumber(analytics.api_keys.revoked)} revoked`}
            />
            <StatTile
              label="Pool accounts"
              value={formatNumber(analytics.pool_accounts.total)}
              tone={analytics.pool_accounts.total === 0 ? "warning" : "default"}
              hint={
                analytics.pool_accounts.total === 0
                  ? "None yet — proxy returns 503"
                  : `${analytics.pool_accounts.active} healthy · ${analytics.pool_accounts.dead} dead`
              }
            />
            <StatTile
              label="Errors · 30d"
              value={formatNumber(analytics.requests["30d"].errors)}
              tone={analytics.requests["30d"].errors > 0 ? "destructive" : "default"}
              hint={`of ${formatNumber(analytics.requests["30d"].requests)} requests`}
            />
          </div>

          <div className="grid gap-2.5 md:grid-cols-3">
            <AdminSiteAnalyticsCard a={analytics} window="24h" />
            <AdminSiteAnalyticsCard a={analytics} window="7d" />
            <AdminSiteAnalyticsCard a={analytics} window="30d" />
          </div>

          <div className="grid gap-2.5 md:grid-cols-2 lg:grid-cols-3">
            <AdminTopUsersCard top={analytics.top_users_30d} />

            <Card>
              <CardHeader className="px-4 py-3">
                <CardTitle className="text-[13px] font-semibold">
                  Quick actions
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1.5 px-4 pb-4 pt-0">
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full justify-start text-[13px]"
                  asChild
                >
                  <Link to="/admin/users">
                    <Users className="mr-2 h-3.5 w-3.5" /> Manage users
                  </Link>
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full justify-start text-[13px]"
                  asChild
                >
                  <Link to="/admin/accounts">
                    <Database className="mr-2 h-3.5 w-3.5" /> Pool accounts
                  </Link>
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full justify-start text-[13px]"
                  asChild
                >
                  <Link to="/admin/analytics">
                    <TrendingUp className="mr-2 h-3.5 w-3.5" /> Site analytics
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
        <div className="grid gap-2.5 md:grid-cols-2 lg:grid-cols-3">
          <PersonalUsageCard usage={usage} />

          <Card className="lg:col-span-2">
            <CardHeader className="px-4 py-3">
              <CardTitle className="text-[13px] font-semibold">
                Get started
              </CardTitle>
              <CardDescription className="text-xs">
                Point any OpenAI-compatible client at this server.
              </CardDescription>
            </CardHeader>
            <CardContent className="px-4 pb-4 pt-0">
              <pre className="overflow-x-auto rounded-md border border-border bg-muted/50 p-3 text-xs leading-relaxed">
{`from openai import OpenAI

client = OpenAI(
    api_key="sk_live_YOUR_KEY",
    base_url="${window.location.origin}/v1",
)

resp = client.chat.completions.create(
    model="stepfun/step-3.7-flash:free",
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
