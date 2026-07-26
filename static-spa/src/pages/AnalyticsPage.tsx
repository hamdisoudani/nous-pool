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
  Card, CardContent, CardHeader, CardTitle,
} from "@/components/ui/card";
import {
  Table, TableHeader, TableRow, TableHead, TableBody, TableCell,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { PageHeader, SectionLabel, StatTile } from "@/components/PageHeader";
import { StatGridSkeleton, TableCardSkeleton } from "@/components/Skeletons";
import { formatNumber, percent } from "@/lib/format";
import { RefreshCw } from "@/components/icons";

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
      <div className="space-y-6">
        <PageHeader
          title="Site analytics"
          description="Aggregate traffic across every user, key and pool account."
        />
        <div>
          <SectionLabel>Overview</SectionLabel>
          <StatGridSkeleton count={4} />
        </div>
        <div>
          <SectionLabel>Traffic by window</SectionLabel>
          <TableCardSkeleton
            rows={3}
            widths={["48px", "60px", "70px", "60px", "70px", "80px"]}
          />
        </div>
        <TableCardSkeleton rows={3} widths={["24px", "45%", "70px", "70px"]} />
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

  const err30 = percent(a.requests["30d"].errors, a.requests["30d"].requests);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Site analytics"
        description="Aggregate traffic across every user, key and pool account."
        actions={
          <Button variant="outline" size="sm" onClick={load}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Refresh
          </Button>
        }
      />

      <div>
        <SectionLabel>Overview</SectionLabel>
        <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile
            label="Users"
            value={formatNumber(a.users.total)}
            hint={`${a.users.active} active · ${a.users.banned} banned · ${a.users.admins} admin`}
          />
          <StatTile
            label="Active API keys"
            value={formatNumber(a.api_keys.active)}
            hint={`${a.api_keys.total} total · ${a.api_keys.revoked} revoked`}
          />
          <StatTile
            label="Pool accounts"
            value={formatNumber(a.pool_accounts.total)}
            tone={a.pool_accounts.total === 0 ? "warning" : "default"}
            hint={
              a.pool_accounts.total === 0
                ? "None yet — the proxy will return 503"
                : `${a.pool_accounts.active} healthy · ${a.pool_accounts.dead} dead`
            }
          />
          <StatTile
            label="Error rate (30d)"
            value={
              a.requests["30d"].requests > 0 ? (
                <>
                  {err30}
                  <span className="text-base font-normal text-muted-foreground">
                    %
                  </span>
                </>
              ) : (
                <span className="text-muted-foreground">—</span>
              )
            }
            tone={Number(err30) > 5 ? "destructive" : "default"}
            hint={`${formatNumber(a.requests["30d"].errors)} of ${formatNumber(
              a.requests["30d"].requests,
            )} requests`}
          />
        </div>
      </div>

      {/* Three time-windows, as one comparison table rather than three cards */}
      <div>
        <SectionLabel>Traffic by window</SectionLabel>
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="h-9 w-24 text-[11px] uppercase tracking-[0.06em]">
                    Window
                  </TableHead>
                  <TableHead className="h-9 text-right text-[11px] uppercase tracking-[0.06em]">
                    Requests
                  </TableHead>
                  <TableHead className="h-9 text-right text-[11px] uppercase tracking-[0.06em]">
                    Errors
                  </TableHead>
                  <TableHead className="h-9 text-right text-[11px] uppercase tracking-[0.06em]">
                    Prompt
                  </TableHead>
                  <TableHead className="h-9 text-right text-[11px] uppercase tracking-[0.06em]">
                    Completion
                  </TableHead>
                  <TableHead className="h-9 text-right text-[11px] uppercase tracking-[0.06em]">
                    Total tokens
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(["24h", "7d", "30d"] as const).map((w) => {
                  const r = a.requests[w];
                  const err = percent(r.errors, r.requests);
                  return (
                    <TableRow key={w} className="h-10">
                      <TableCell className="py-1.5 font-medium">{w}</TableCell>
                      <TableCell className="py-1.5 text-right tabular-nums">
                        {formatNumber(r.requests)}
                      </TableCell>
                      <TableCell
                        className={`py-1.5 text-right tabular-nums ${
                          r.errors > 0 ? "text-destructive" : "text-muted-foreground"
                        }`}
                      >
                        {formatNumber(r.errors)}
                        {r.requests > 0 && (
                          <span className="ml-1 text-xs text-muted-foreground">
                            ({err}%)
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="py-1.5 text-right tabular-nums text-muted-foreground">
                        {formatNumber(r.prompt_tokens)}
                      </TableCell>
                      <TableCell className="py-1.5 text-right tabular-nums text-muted-foreground">
                        {formatNumber(r.completion_tokens)}
                      </TableCell>
                      <TableCell className="py-1.5 text-right font-medium tabular-nums">
                        {formatNumber(r.total_tokens)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      {/* Top users */}
      <Card>
        <CardHeader className="px-4 py-3">
          <CardTitle className="text-[13px] font-semibold">
            Top users by tokens · 30 days
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {a.top_users_30d.length === 0 ? (
            <div className="border-t border-border p-8 text-center text-[13px] text-muted-foreground">
              No traffic recorded yet.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="h-9 w-10 text-[11px] uppercase tracking-[0.06em]">
                    #
                  </TableHead>
                  <TableHead className="h-9 text-[11px] uppercase tracking-[0.06em]">
                    User
                  </TableHead>
                  <TableHead className="h-9 w-28 text-[11px] uppercase tracking-[0.06em]">
                    ID
                  </TableHead>
                  <TableHead className="h-9 w-32 text-right text-[11px] uppercase tracking-[0.06em]">
                    Total tokens
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {a.top_users_30d.map((u, i) => (
                  <TableRow key={u.user_id} className="h-10">
                    <TableCell className="py-1.5 tabular-nums text-muted-foreground">
                      {i + 1}
                    </TableCell>
                    <TableCell className="max-w-0 py-1.5">
                      <span className="block truncate font-medium" title={u.email}>
                        {u.email}
                      </span>
                    </TableCell>
                    <TableCell className="py-1.5">
                      <code className="text-xs text-muted-foreground">
                        {u.user_id.slice(0, 8)}
                      </code>
                    </TableCell>
                    <TableCell className="py-1.5 text-right font-medium tabular-nums">
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
