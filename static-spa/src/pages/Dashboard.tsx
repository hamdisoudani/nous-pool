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
import { ComponentType, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, AppUser, AdminAnalytics, ModelInfo, MyUsage } from "@/auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CodeBlock } from "@/components/CodeBlock";
import { PageHeader, SectionLabel, StatTile } from "@/components/PageHeader";
import {
  StatTileSkeleton,
  StatGridSkeleton,
  DetailCardSkeleton,
  ModelCardsSkeleton,
} from "@/components/Skeletons";
import { formatNumber, formatTokens, percent } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  Users,
  Database,
  TrendingUp,
  Plus,
  Check,
  AlertCircle,
  Type,
  ImageIcon,
  Video,
  Audio,
  FileIcon,
  Sparkles,
  Wrench,
  Braces,
  Shield,
  ArrowRight,
} from "@/components/icons";

type UsageWindow = "24h" | "7d" | "30d";

/**
 * Model the quickstart snippet defaults to.
 *
 * Named rather than "whatever sorts first" because this one is a reasonable
 * general-purpose default. It is looked up in the live catalogue on every load
 * and silently falls back to the first available model when Nous retires it —
 * which is the whole reason the list is fetched instead of hardcoded.
 */
const PREFERRED_SNIPPET_MODEL = "stepfun/step-3.7-flash:free";

/** How many model cards to show before the "show all" toggle. */
const MODELS_COLLAPSED_COUNT = 6;

const MODALITY_META: Record<
  string,
  { icon: ComponentType<{ className?: string }>; label: string }
> = {
  text: { icon: Type, label: "Text" },
  image: { icon: ImageIcon, label: "Image" },
  video: { icon: Video, label: "Video" },
  audio: { icon: Audio, label: "Audio" },
  file: { icon: FileIcon, label: "File" },
};

/** One accepted/produced modality. Unknown values render as a plain label. */
function ModalityBadge({ modality }: { modality: string }) {
  const meta = MODALITY_META[modality];
  const Icon = meta?.icon;
  return (
    <span className="inline-flex items-center gap-1 rounded border border-border bg-background px-1.5 py-0.5 text-[10.5px] font-medium capitalize">
      {Icon && <Icon className="h-3 w-3 shrink-0 text-muted-foreground" />}
      {meta?.label ?? modality}
    </span>
  );
}

function CapabilityChip({
  icon: Icon,
  label,
  title,
  muted = false,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  title: string;
  muted?: boolean;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10.5px] font-medium",
        muted
          ? "bg-muted text-muted-foreground"
          : "bg-secondary text-secondary-foreground",
      )}
    >
      <Icon className="h-2.5 w-2.5 shrink-0" />
      {label}
    </span>
  );
}

/**
 * One model, with everything the caller needs to decide whether it fits:
 * what it accepts, what it emits, how much it can hold, and which API
 * features it honours.
 *
 * Clicking it retargets the quickstart snippet — a button rather than a card so
 * keyboard and screen-reader users get the affordance for free.
 */
function ModelCard({
  model,
  selected,
  onSelect,
}: {
  model: ModelInfo;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const { input_modalities: input, output_modalities: output } = model;
  return (
    <button
      type="button"
      onClick={() => onSelect(model.id)}
      aria-pressed={selected}
      title={model.description ?? model.id}
      className={cn(
        "flex min-w-0 flex-col gap-2 rounded-lg border p-3 text-left transition-colors",
        selected
          ? "border-primary bg-primary/[0.06] ring-1 ring-primary"
          : "border-border bg-muted/30 hover:border-input hover:bg-muted/60",
      )}
    >
      <span className="flex min-w-0 items-start gap-1.5">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium leading-tight">
            {model.name}
          </span>
          {/* break-all, not truncate: the id is the string users copy, and some
              run past 55 chars. Wrapping keeps it readable and — critically —
              stops it forcing the grid track wider than a phone viewport. */}
          <code className="mt-1 block break-all font-mono text-[10.5px] leading-snug text-muted-foreground">
            {model.id}
          </code>
        </span>
        {selected && (
          <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
        )}
      </span>

      {(input.length > 0 || output.length > 0) && (
        <span className="flex min-w-0 flex-wrap items-center gap-1">
          {input.map((m) => (
            <ModalityBadge key={`in-${m}`} modality={m} />
          ))}
          {input.length > 0 && output.length > 0 && (
            <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground" />
          )}
          {output.map((m) => (
            <ModalityBadge key={`out-${m}`} modality={m} />
          ))}
        </span>
      )}

      {/* Compact figures, exact integer one hover away — 262K is scannable but
          you occasionally need to know it's 262144 and not 262000. */}
      <span className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px]">
        <span
          className="whitespace-nowrap"
          title={
            model.context_length
              ? `${formatNumber(model.context_length)} tokens of context`
              : "Context window not reported upstream"
          }
        >
          <span className="text-muted-foreground">Context </span>
          <span className="font-medium tabular-nums">
            {formatTokens(model.context_length)}
          </span>
        </span>
        <span
          className="whitespace-nowrap"
          title={
            model.max_completion_tokens
              ? `${formatNumber(model.max_completion_tokens)} tokens max per completion`
              : "Completion cap not reported upstream"
          }
        >
          <span className="text-muted-foreground">Max output </span>
          <span className="font-medium tabular-nums">
            {formatTokens(model.max_completion_tokens)}
          </span>
        </span>
      </span>

      <span className="flex flex-wrap gap-1">
        {model.supports_reasoning && (
          <CapabilityChip
            icon={Sparkles}
            label={model.reasoning_required ? "Reasoning · always" : "Reasoning"}
            title={
              model.reasoning_required
                ? "Always reasons — thinking cannot be disabled"
                : "Supports reasoning / thinking effort"
            }
          />
        )}
        {model.supports_tools && (
          <CapabilityChip
            icon={Wrench}
            label="Tools"
            title="Supports function / tool calling"
          />
        )}
        {model.supports_structured_outputs && (
          <CapabilityChip
            icon={Braces}
            label="JSON schema"
            title="Supports structured outputs via response_format"
          />
        )}
        {model.is_moderated && (
          <CapabilityChip
            icon={Shield}
            label="Moderated"
            title="Requests pass through the provider's moderation filter"
            muted
          />
        )}
      </span>
    </button>
  );
}

/**
 * Which ':free' models the pool can serve, read live from the upstream Nous
 * catalogue rather than hardcoded — the free tier changes as Nous adds and
 * retires models, and a stale list means users paste a model id that 404s.
 */
function FreeModelsCard({
  models,
  loading,
  error,
  selectedId,
  onSelect,
}: {
  models: ModelInfo[];
  loading: boolean;
  error: string | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const collapsible = models.length > MODELS_COLLAPSED_COUNT;
  const visible =
    collapsible && !expanded ? models.slice(0, MODELS_COLLAPSED_COUNT) : models;

  return (
    <Card className="min-w-0">
      <CardHeader className="px-4 py-3">
        <CardTitle className="flex flex-wrap items-center gap-2 text-[13px] font-semibold">
          Supported models
          {!loading && !error && models.length > 0 && (
            <Badge
              variant="secondary"
              className="px-1.5 py-0 text-[10px] font-medium tabular-nums"
            >
              {models.length} free
            </Badge>
          )}
        </CardTitle>
        <CardDescription className="text-xs">
          Everything the pool can serve right now, with what each one accepts.
          Select one to load it into the quickstart below.
        </CardDescription>
      </CardHeader>
      <CardContent className="px-4 pb-4 pt-0">
        {loading ? (
          <ModelCardsSkeleton count={4} />
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
          <>
            <div className="grid min-w-0 gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {visible.map((m) => (
                <ModelCard
                  key={m.id}
                  model={m}
                  selected={m.id === selectedId}
                  onSelect={onSelect}
                />
              ))}
            </div>
            {collapsible && (
              <Button
                variant="ghost"
                size="sm"
                className="mt-2 h-7 w-full text-xs text-muted-foreground"
                onClick={() => setExpanded((v) => !v)}
              >
                {expanded
                  ? "Show fewer"
                  : `Show all ${models.length} models`}
              </Button>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Copy-paste quickstart.
 *
 * `base_url` is built from `window.location.origin` so the snippet is correct
 * on localhost, on a preview deploy and in production without a build-time
 * constant. `model` comes from the live catalogue for the same reason.
 */
function QuickstartCard({
  modelId,
  className,
}: {
  modelId: string;
  className?: string;
}) {
  const snippet = useMemo(
    () => `from openai import OpenAI

client = OpenAI(
    api_key="sk_live_YOUR_KEY",
    base_url="${window.location.origin}/v1",
)

resp = client.chat.completions.create(
    model="${modelId}",
    messages=[{"role": "user", "content": "Hello!"}],
)

print(resp.choices[0].message.content)`,
    [modelId],
  );

  return (
    <Card className={cn("min-w-0", className)}>
      <CardHeader className="px-4 py-3">
        <CardTitle className="text-[13px] font-semibold">Quickstart</CardTitle>
        <CardDescription className="text-xs">
          Point any OpenAI-compatible client at this server.
        </CardDescription>
      </CardHeader>
      <CardContent className="min-w-0 px-4 pb-4 pt-0">
        <CodeBlock code={snippet} language="python" />
      </CardContent>
    </Card>
  );
}

function PersonalUsageCard({ usage }: { usage: MyUsage }) {
  return (
    <Card className="min-w-0">
      <CardHeader className="px-4 py-3">
        <CardTitle className="text-[13px] font-semibold">
          Your usage · 30 days
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1.5 px-4 pb-4 pt-0 text-[13px]">
        <div className="flex justify-between gap-2">
          <span className="text-muted-foreground">Requests</span>
          <span className="font-medium tabular-nums">
            {formatNumber(usage.totals.requests)}
          </span>
        </div>
        <div className="flex justify-between gap-2">
          <span className="text-muted-foreground">Total tokens</span>
          <span className="font-medium tabular-nums">
            {formatNumber(usage.totals.total_tokens)}
          </span>
        </div>
        <div className="flex justify-between gap-2">
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
    <Card className="min-w-0">
      <CardHeader className="px-4 py-3">
        <CardTitle className="flex items-center justify-between gap-2 text-[13px] font-semibold">
          <span className="truncate">Site traffic · {w}</span>
          <Badge
            variant={Number(errRate) > 5 ? "destructive" : "secondary"}
            className="shrink-0 px-1.5 py-0 text-[10px] font-medium"
          >
            {errRate}% err
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1.5 px-4 pb-4 pt-0 text-[13px]">
        <div className="flex justify-between gap-2">
          <span className="text-muted-foreground">Requests</span>
          <span className="font-medium tabular-nums">{formatNumber(r.requests)}</span>
        </div>
        <div className="flex justify-between gap-2">
          <span className="text-muted-foreground">Total tokens</span>
          <span className="font-medium tabular-nums">{formatNumber(r.total_tokens)}</span>
        </div>
        <div className="flex justify-between gap-2">
          <span className="shrink-0 text-muted-foreground">Prompt / completion</span>
          <span className="text-right font-medium tabular-nums">
            {formatNumber(r.prompt_tokens)} / {formatNumber(r.completion_tokens)}
          </span>
        </div>
        <div className="flex justify-between gap-2">
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
    <Card className="min-w-0">
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
                <span className="shrink-0 font-medium tabular-nums">
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
  const [freeModels, setFreeModels] = useState<ModelInfo[]>([]);
  const [error, setError] = useState<string | null>(null);

  // null until the catalogue lands; the snippet falls back to
  // PREFERRED_SNIPPET_MODEL so it is always copy-pasteable.
  const [selectedModel, setSelectedModel] = useState<string | null>(null);

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
      .then((r) => {
        if (cancelled) return;
        setFreeModels(r.models);
        const preferred = r.models.find((m) => m.id === PREFERRED_SNIPPET_MODEL);
        setSelectedModel((preferred ?? r.models[0])?.id ?? null);
      })
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
    <div className="min-w-0 space-y-6">
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
        <FreeModelsCard
          models={freeModels}
          loading={loadingModels}
          error={modelsError}
          selectedId={selectedModel}
          onSelect={setSelectedModel}
        />
      </div>

      {/* ===== Quickstart — admins run requests too, so this is unconditional ===== */}
      <div>
        <SectionLabel>Start building</SectionLabel>
        <div className="grid min-w-0 gap-2.5 lg:grid-cols-3">
          <QuickstartCard
            modelId={selectedModel ?? PREFERRED_SNIPPET_MODEL}
            className="lg:col-span-2"
          />
          {usage && <PersonalUsageCard usage={usage} />}
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

          <div className="grid gap-2.5 md:grid-cols-2">
            <AdminTopUsersCard top={analytics.top_users_30d} />

            <Card className="min-w-0">
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
          </div>
        </div>
      )}
    </div>
  );
}

export default Dashboard;
