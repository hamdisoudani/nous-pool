import { useEffect, useState } from "react";
import {
  Card, CardHeader, CardTitle, CardDescription, CardContent,
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
import { Shell } from "@/components/Shell";
import {
  api, ApiKeyOut, MyUsage,
} from "@/auth";
import {
  KeyRound, Plus, Trash2, Copy, Check, Loader2, AlertCircle,
  Activity, Cpu
} from "lucide-react";
import { formatNumber } from "@/lib/utils";

export function UserDashboard() {
  const [usage, setUsage] = useState<MyUsage | null>(null);
  const [keys, setKeys] = useState<ApiKeyOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [revokeId, setRevokeId] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    try {
      const [u, k] = await Promise.all([api.myUsage(), api.listMyApiKeys()]);
      setUsage(u);
      setKeys(k.keys);
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

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    try {
      const k = await api.createMyApiKey(label.trim());
      setCreated(k.sk_live_key ?? "");
      setLabel("");
      await refresh();
    } catch (e: any) {
      setError(e?.body?.error || e?.message);
    } finally {
      setCreating(false);
    }
  }

  async function onRevoke(id: string) {
    if (!confirm("Revoke this API key? Any clients using it will get 401.")) return;
    setRevokeId(id);
    try {
      await api.revokeMyApiKey(id);
      await refresh();
    } catch (e: any) {
      setError(e?.body?.error || e?.message);
    } finally {
      setRevokeId(null);
    }
  }

  function copyCreated() {
    if (!created) return;
    navigator.clipboard.writeText(created);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <Shell>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">My Dashboard</h1>
          <p className="text-muted-foreground mt-1">
            Your personal stats and API keys.
          </p>
        </div>

        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <CardContent className="pt-6">
              <p className="text-sm text-muted-foreground">Total requests</p>
              <div className="text-3xl font-bold tabular-nums mt-2">
                {usage ? formatNumber(usage.totals.requests) : "—"}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Last {usage?.period.days ?? 30} days
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <p className="text-sm text-muted-foreground">Total tokens</p>
              <div className="text-3xl font-bold tabular-nums mt-2">
                {usage ? formatNumber(usage.totals.total_tokens) : "—"}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                prompt {usage ? formatNumber(usage.totals.prompt_tokens) : "—"} · completion {usage ? formatNumber(usage.totals.completion_tokens) : "—"}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6 flex items-start justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Active API keys</p>
                <div className="text-3xl font-bold tabular-nums mt-2">
                  {keys.filter((k) => !k.last_used_at || k.last_used_at).length}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {keys.length} total
                </p>
              </div>
              <div className="h-10 w-10 rounded-md bg-primary/10 text-primary flex items-center justify-center">
                <KeyRound className="h-5 w-5" />
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <KeyRound className="h-4 w-4" />
                API Keys
              </CardTitle>
              <CardDescription>
                Mint new keys and use them as{" "}
                <code>Authorization: Bearer nous_pk_…</code>
              </CardDescription>
            </div>
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              New key
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            {loading && !keys.length ? (
              <div className="p-8 flex items-center justify-center text-muted-foreground">
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Loading…
              </div>
            ) : keys.length === 0 ? (
              <div className="p-12 text-center">
                <p className="text-muted-foreground">
                  No keys yet. Create one to start using the API.
                </p>
                <Button onClick={() => setCreateOpen(true)} variant="outline" className="mt-4">
                  <Plus className="h-4 w-4 mr-2" />
                  Create your first key
                </Button>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Label</TableHead>
                    <TableHead>Prefix</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead>Last used</TableHead>
                    <TableHead className="text-right">Requests</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {keys.map((k) => (
                    <TableRow key={k.id}>
                      <TableCell className="font-medium">{k.label}</TableCell>
                      <TableCell>
                        <code className="text-xs px-2 py-1 bg-muted rounded">
                          {k.key_prefix}…
                        </code>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {new Date(k.created_at).toLocaleString()}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {k.last_used_at
                          ? new Date(k.last_used_at).toLocaleString()
                          : "never"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatNumber(k.total_requests)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => onRevoke(k.id)}
                          disabled={revokeId === k.id}
                          title="Revoke"
                        >
                          {revokeId === k.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Trash2 className="h-4 w-4 text-destructive" />
                          )}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {usage?.recent && usage.recent.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Activity className="h-4 w-4" />
                Recent requests
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>When</TableHead>
                    <TableHead>Model</TableHead>
                    <TableHead className="text-right">Tokens</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {usage.recent.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="text-muted-foreground text-sm">
                        {new Date(r.created_at).toLocaleString()}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          <Cpu className="h-3 w-3 mr-1" />
                          {r.model}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatNumber(r.tokens)}
                      </TableCell>
                      <TableCell>
                        <Badge variant={r.status_code < 400 ? "success" : "destructive"}>
                          {r.status_code}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Create-key dialog */}
      <Dialog
        open={createOpen}
        onOpenChange={(v) => {
          if (!v) setCreated(null);
          setCreateOpen(v);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create API key</DialogTitle>
            <DialogDescription>
              Use this key as{" "}
              <code>Authorization: Bearer nous_pk_…</code>
            </DialogDescription>
          </DialogHeader>

          {created ? (
            <div className="space-y-4">
              <Alert>
                <AlertDescription>
                  Save this key now — you won&apos;t see it again.
                </AlertDescription>
              </Alert>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-xs font-mono p-3 bg-muted rounded-md overflow-x-auto">
                  {created}
                </code>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={copyCreated}
                  title="Copy"
                >
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
              <DialogFooter>
                <DialogClose asChild>
                  <Button>Done</Button>
                </DialogClose>
              </DialogFooter>
            </div>
          ) : (
            <form onSubmit={onCreate} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="keylabel">Label</Label>
                <Input
                  id="keylabel"
                  placeholder="e.g. my laptop, prod-bot, test"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  disabled={creating}
                  required
                />
              </div>
              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="outline" type="button">Cancel</Button>
                </DialogClose>
                <Button type="submit" disabled={creating}>
                  {creating ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Creating…
                    </>
                  ) : (
                    "Create"
                  )}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </Shell>
  );
}
