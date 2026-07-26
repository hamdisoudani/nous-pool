/**
 * MyKeys — API key management (available to every user, including admins).
 *
 * This is the user-facing surface for /admin/me/api-keys:
 *   - GET    /admin/me/api-keys       (list)
 *   - POST   /admin/me/api-keys       (create, get full key once)
 *   - DELETE /admin/me/api-keys/{id}  (revoke)
 *
 * All requests go through the backend; the SPA never calls Supabase directly.
 */
import { useEffect, useState } from "react";
import { api, ApiKeyOut } from "@/auth";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table, TableHeader, TableRow, TableHead, TableBody, TableCell,
} from "@/components/ui/table";
import {
  KeyRound, Copy, Trash2, Plus, Loader2, AlertCircle, RefreshCw,
} from "lucide-react";

function formatDate(s: string) {
  return new Date(s).toLocaleString();
}

function formatNumber(n: number) {
  return new Intl.NumberFormat().format(n);
}

export function MyKeys() {
  const [keys, setKeys] = useState<ApiKeyOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [creating, setCreating] = useState(false);
  const [newlyCreated, setNewlyCreated] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const r = await api.listMyApiKeys();
      setKeys(r.keys);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function handleCreate() {
    if (!label.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const k = await api.createMyApiKey(label.trim());
      setNewlyCreated(k.sk_live_key || "(key copy failed)");
      setLabel("");
      setDialogOpen(false);
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  }

  async function handleRevoke(id: string) {
    if (!confirm("Revoke this API key immediately? Any apps using it will start receiving 401.")) return;
    setRevokingId(id);
    try {
      await api.revokeMyApiKey(id);
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRevokingId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">My API keys</h1>
          <p className="text-muted-foreground mt-1">
            Mint keys to call Nous Pool. Keys are shown in full <em>once</em> after creation — copy them then.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={load}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4 mr-1" /> New key
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>New API key</DialogTitle>
                <DialogDescription>
                  Choose a label to identify this key (e.g. "prod-server", "staging").
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-2">
                <Label htmlFor="label">Label</Label>
                <Input
                  id="label"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="e.g. my-app-prod"
                  autoFocus
                />
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setDialogOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={handleCreate} disabled={creating || !label.trim()}>
                  {creating ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}
                  Mint key
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {newlyCreated && (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-amber-600 dark:text-amber-400">
              <AlertCircle className="h-5 w-5" />
              Copy your new key — it won't be shown again
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <code className="flex-1 rounded-md bg-muted px-3 py-2 text-sm font-mono break-all">
                {newlyCreated}
              </code>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  navigator.clipboard.writeText(newlyCreated);
                }}
              >
                <Copy className="h-4 w-4 mr-1" /> Copy
              </Button>
            </div>
            <Button
              size="sm"
              variant="ghost"
              className="mt-2 text-muted-foreground"
              onClick={() => setNewlyCreated(null)}
            >
              I've saved it
            </Button>
          </CardContent>
        </Card>
      )}

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm">
          {error}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="h-5 w-5" />
            {keys.length} key{keys.length === 1 ? "" : "s"}
          </CardTitle>
          <CardDescription>
            Active keys authenticate requests to /v1/chat/completions.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-8 text-center text-muted-foreground">
              <Loader2 className="h-5 w-5 inline animate-spin mr-2" />
              Loading…
            </div>
          ) : keys.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              No keys yet. Click <strong>New key</strong> to mint your first one.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Label</TableHead>
                  <TableHead>Prefix</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Requests</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Last used</TableHead>
                  <TableHead className="w-12"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {keys.map((k) => (
                  <TableRow key={k.id}>
                    <TableCell className="font-medium">{k.label}</TableCell>
                    <TableCell>
                      <code className="text-xs text-muted-foreground">
                        {k.key_prefix}…
                      </code>
                    </TableCell>
                    <TableCell>
                      <Badge variant={k.is_active ? "default" : "secondary"}>
                        {k.is_active ? "active" : "revoked"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatNumber(k.total_requests || 0)}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {formatDate(k.created_at)}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {k.last_used_at ? formatDate(k.last_used_at) : "never"}
                    </TableCell>
                    <TableCell>
                      {k.is_active ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleRevoke(k.id)}
                          disabled={revokingId === k.id}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      ) : null}
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

export default MyKeys;
