import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/PageHeader";
import { TableCardSkeleton } from "@/components/Skeletons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
  DialogFooter, DialogClose,
} from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  api, PoolAccountOut, InitiateOAuthResp, OAuthPollResp,
} from "@/auth";
import {
  Plus, RefreshCw, Trash2, Loader2, Copy, Check, AlertCircle, Database,
} from "@/components/icons";
import { formatNumber } from "@/lib/format";

export function AdminAccounts() {
  const [accounts, setAccounts] = useState<PoolAccountOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [addOpen, setAddOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [adding, setAdding] = useState(false);
  const [flow, setFlow] = useState<InitiateOAuthResp | null>(null);
  const [pollErr, setPollErr] = useState<string | null>(null);
  const [polling, setPolling] = useState(false);
  const [copied, setCopied] = useState(false);
  const [refreshId, setRefreshId] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    try {
      const r = await api.listAccounts();
      setAccounts(r.accounts);
      setError(null);
    } catch (e: any) {
      setError(e?.body?.error || e?.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  // Poll loop for active OAuth flow
  useEffect(() => {
    if (!flow || !polling) return;

    const expiresAt = Date.now() + flow.expires_in * 1000;
    let cancelled = false;
    const tick = async () => {
      if (cancelled || Date.now() >= expiresAt) {
        if (!cancelled) {
          setPollErr("Device code expired. Please try again.");
          setPolling(false);
        }
        return;
      }
      try {
        const r: OAuthPollResp = await api.pollFlow(flow.flow_id);
        if (cancelled) return;
        if (r.status === "success") {
          setPolling(false);
          setAddOpen(false);
          setFlow(null);
          setLabel("");
          await refresh();
          return;
        }
        if (r.status === "expired") {
          setPollErr("Device code expired. Please try again.");
          setPolling(false);
          return;
        }
        if (r.status === "error") {
          setPollErr(r.detail || "Polling failed.");
          setPolling(false);
          return;
        }
        // pending — schedule next tick
        setTimeout(tick, Math.max(1, r.interval) * 1000);
      } catch (e: any) {
        if (!cancelled) {
          setPollErr(e?.body?.error || e?.message);
          setPolling(false);
        }
      }
    };

    const timer = setTimeout(tick, Math.max(1, flow.interval) * 1000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [flow, polling]);

  async function onStartAdd(e: React.FormEvent) {
    e.preventDefault();
    setPollErr(null);
    setAdding(true);
    try {
      const r = await api.initiateAddAccount(label.trim());
      setFlow(r);
      setPolling(true);
    } catch (e: any) {
      setPollErr(e?.body?.error || e?.message);
    } finally {
      setAdding(false);
    }
  }

  async function onRefresh(id: string) {
    setRefreshId(id);
    try {
      const r = await api.refreshAccount(id);
      if (r.status === "still_dead") {
        setError("Account is dead and needs re-authorization.");
      }
      await refresh();
    } catch (e: any) {
      setError(e?.body?.error || e?.message);
    } finally {
      setRefreshId(null);
    }
  }

  async function onDelete(id: string) {
    if (!confirm("Remove this pool account? It will stop receiving requests.")) return;
    try {
      await api.deleteAccount(id);
      await refresh();
    } catch (e: any) {
      setError(e?.body?.error || e?.message);
    }
  }

  function copyCode() {
    if (!flow) return;
    navigator.clipboard.writeText(flow.user_code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <>
      <div className="space-y-6">
        <PageHeader
          title="Pool accounts"
          description={
            loading
              ? "Loading accounts…"
              : accounts.length === 0
                ? "No accounts yet — the proxy returns 503 until you add one."
                : `${accounts.length} account${accounts.length === 1 ? "" : "s"} · ` +
                  `${accounts.filter((a) => a.health_status === "healthy").length} healthy · ` +
                  "round-robin picks the least recently used"
          }
          actions={
            <Button size="sm" onClick={() => setAddOpen(true)}>
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              Add account
            </Button>
          }
        />

        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {loading ? (
          <TableCardSkeleton
            rows={3}
            widths={["140px", "60px", "45%", "40px", "30px", "50px", "50px"]}
          />
        ) : (
        <Card>
          <CardContent className="p-0">
            {accounts.length === 0 ? (
              <div className="p-10 text-center">
                <Database className="mx-auto mb-3 h-7 w-7 text-muted-foreground/50" />
                <div className="text-[13px] font-medium">No pool accounts</div>
                <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">
                  Authorize a Nous account via the device-code flow to start
                  serving traffic.
                </p>
                <Button
                  onClick={() => setAddOpen(true)}
                  variant="outline"
                  size="sm"
                  className="mt-4"
                >
                  <Plus className="mr-1.5 h-3.5 w-3.5" />
                  Add your first account
                </Button>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="h-9 min-w-[160px] text-[11px] uppercase tracking-[0.06em]">
                      Label
                    </TableHead>
                    <TableHead className="h-9 w-[96px] text-[11px] uppercase tracking-[0.06em]">
                      Status
                    </TableHead>
                    <TableHead className="h-9 w-full text-[11px] uppercase tracking-[0.06em]">
                      Models
                    </TableHead>
                    <TableHead className="h-9 w-[88px] text-right text-[11px] uppercase tracking-[0.06em]">
                      Requests
                    </TableHead>
                    <TableHead className="h-9 w-[76px] text-right text-[11px] uppercase tracking-[0.06em]">
                      Errors
                    </TableHead>
                    <TableHead className="h-9 w-[88px] text-right text-[11px] uppercase tracking-[0.06em]">
                      Tokens
                    </TableHead>
                    <TableHead className="h-9 w-[72px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {accounts.map((a) => {
                    const healthy = a.health_status === "healthy";
                    return (
                    <TableRow key={a.id} className="h-11">
                      <TableCell className="max-w-0 py-1.5">
                        <span
                          className="block truncate font-medium"
                          title={a.account_label}
                        >
                          {a.account_label}
                        </span>
                      </TableCell>
                      <TableCell className="py-1.5">
                        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <span
                            className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                              healthy
                                ? "bg-success"
                                : a.health_status === "degraded"
                                  ? "bg-warning"
                                  : "bg-destructive"
                            }`}
                          />
                          {a.health_status ?? "unknown"}
                        </span>
                      </TableCell>
                      <TableCell className="max-w-0 py-1.5">
                        <div className="flex gap-1 overflow-hidden">
                          {(a.supported_models ?? []).slice(0, 2).map((m) => (
                            <Badge
                              key={m}
                              variant="outline"
                              className="max-w-[240px] shrink-0 truncate px-1.5 py-0 font-mono text-[10px] font-normal"
                              title={m}
                            >
                              {m}
                            </Badge>
                          ))}
                          {(a.supported_models?.length ?? 0) > 2 && (
                            <Badge
                              variant="outline"
                              className="shrink-0 px-1.5 py-0 text-[10px] font-normal"
                              title={(a.supported_models ?? []).join("\n")}
                            >
                              +{(a.supported_models?.length ?? 0) - 2}
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="py-1.5 text-right tabular-nums">
                        {formatNumber(a.total_requests)}
                      </TableCell>
                      <TableCell className="py-1.5 text-right tabular-nums">
                        {a.total_errors > 0 ? (
                          <span className="text-destructive">{formatNumber(a.total_errors)}</span>
                        ) : (
                          <span className="text-muted-foreground">0</span>
                        )}
                      </TableCell>
                      <TableCell className="py-1.5 text-right tabular-nums">
                        {formatNumber(a.total_tokens)}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-0.5">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => onRefresh(a.id)}
                            disabled={refreshId === a.id}
                            title="Refresh token"
                            aria-label={`Refresh token for ${a.account_label}`}
                          >
                            {refreshId === a.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <RefreshCw className="h-3.5 w-3.5 text-muted-foreground" />
                            )}
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => onDelete(a.id)}
                            title="Remove account"
                            aria-label={`Remove ${a.account_label}`}
                          >
                            <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
        )}
      </div>

      {/* Add-account dialog */}
      <Dialog
        open={addOpen}
        onOpenChange={(v) => {
          if (!v) {
            setFlow(null);
            setPolling(false);
            setPollErr(null);
            setLabel("");
          }
          setAddOpen(v);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add pool account</DialogTitle>
            <DialogDescription>
              Authorize a new account via OAuth device flow.
            </DialogDescription>
          </DialogHeader>

          {!flow ? (
            <form onSubmit={onStartAdd} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="label">Label</Label>
                <Input
                  id="label"
                  placeholder="e.g. team-main, daemon-1"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  disabled={adding}
                  required
                />
                <p className="text-xs text-muted-foreground">
                  A human-readable name so you can identify this account later.
                </p>
              </div>

              {pollErr && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{pollErr}</AlertDescription>
                </Alert>
              )}

              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="outline" type="button">Cancel</Button>
                </DialogClose>
                <Button type="submit" disabled={adding}>
                  {adding ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Starting flow…
                    </>
                  ) : (
                    "Start device flow"
                  )}
                </Button>
              </DialogFooter>
            </form>
          ) : (
            <div className="space-y-4">
              <p className="text-sm">
                Open{" "}
                <a
                  href={flow.verification_uri}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-primary underline"
                >
                  {flow.verification_uri}
                </a>{" "}
                and enter the code below within{" "}
                <span className="font-mono">{Math.floor(flow.expires_in / 60)}m {flow.expires_in % 60}s</span>:
              </p>

              <div className="flex items-center gap-2">
                <code className="flex-1 text-center text-2xl font-mono tracking-widest p-4 bg-muted rounded-md select-all">
                  {flow.user_code}
                </code>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={copyCode}
                  title="Copy code"
                >
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>

              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Waiting for you to authorize on the provider website…
              </div>

              {pollErr && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{pollErr}</AlertDescription>
                </Alert>
              )}

              <DialogFooter>
                <Button variant="outline" onClick={() => { setFlow(null); setPolling(false); setPollErr(null); }}>
                  Cancel
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
