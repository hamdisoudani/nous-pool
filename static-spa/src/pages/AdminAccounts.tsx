import { useEffect, useState } from "react";
import {
  Card, CardHeader, CardTitle, CardContent, CardDescription,
} from "@/components/ui/card";
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
  Plus, RefreshCw, Trash2, Loader2, Copy, Check, AlertCircle,
} from "lucide-react";
import { formatNumber } from "@/lib/utils";

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
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Pool Accounts</h1>
            <p className="text-muted-foreground mt-1">
              OAuth-authorized Nous/Hermes accounts used to handle requests.
            </p>
          </div>
          <Button onClick={() => setAddOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Add Account
          </Button>
        </div>

        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              {accounts.length} account{accounts.length === 1 ? "" : "s"}
            </CardTitle>
            <CardDescription>
              Round-robin dispatch picks the least-busy healthy account.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="p-8 flex items-center justify-center text-muted-foreground">
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Loading…
              </div>
            ) : accounts.length === 0 ? (
              <div className="p-12 text-center">
                <p className="text-muted-foreground">
                  No pool accounts yet. Add one to start serving requests.
                </p>
                <Button onClick={() => setAddOpen(true)} variant="outline" className="mt-4">
                  <Plus className="h-4 w-4 mr-2" />
                  Add your first account
                </Button>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Label</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Models</TableHead>
                    <TableHead className="text-right">Requests</TableHead>
                    <TableHead className="text-right">Errors</TableHead>
                    <TableHead className="text-right">Tokens</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {accounts.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell className="font-medium">{a.account_label}</TableCell>
                      <TableCell>
                        <Badge variant={a.health_status === "healthy" ? "success" : "destructive"}>
                          {a.health_status ?? "unknown"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {(a.supported_models ?? []).slice(0, 3).map((m) => (
                            <Badge key={m} variant="outline" className="text-xs">
                              {m}
                            </Badge>
                          ))}
                          {(a.supported_models?.length ?? 0) > 3 && (
                            <Badge variant="outline" className="text-xs">
                              +{(a.supported_models?.length ?? 0) - 3}
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{formatNumber(a.total_requests)}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {a.total_errors > 0 ? (
                          <span className="text-destructive">{formatNumber(a.total_errors)}</span>
                        ) : (
                          formatNumber(a.total_errors)
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{formatNumber(a.total_tokens)}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => onRefresh(a.id)}
                            disabled={refreshId === a.id}
                            title="Refresh token"
                          >
                            {refreshId === a.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <RefreshCw className="h-4 w-4" />
                            )}
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => onDelete(a.id)}
                            title="Remove account"
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
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
