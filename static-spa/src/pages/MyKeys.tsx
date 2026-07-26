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
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/PageHeader";
import { TableCardSkeleton } from "@/components/Skeletons";
import { formatNumber, formatDateTime, formatRelative } from "@/lib/format";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table, TableHeader, TableRow, TableHead, TableBody, TableCell,
} from "@/components/ui/table";
import {
  Copy, Check, Trash2, Plus, Loader2, KeyRound, RefreshCw,
} from "@/components/icons";

export function MyKeys() {
  const [keys, setKeys] = useState<ApiKeyOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [creating, setCreating] = useState(false);
  const [newlyCreated, setNewlyCreated] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function copyKey(key: string) {
    try {
      await navigator.clipboard.writeText(key);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Clipboard blocked — select the key and copy it manually.");
    }
  }

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
      <PageHeader
        title="API keys"
        description={
          loading
            ? "Loading keys…"
            : `${keys.filter((k) => k.is_active).length} active · ${
                keys.filter((k) => !k.is_active).length
              } revoked · full key shown once at creation`
        }
        actions={
          <>
            <Button variant="outline" size="sm" onClick={load} disabled={loading}>
              <RefreshCw
                className={`mr-1.5 h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`}
              />
              Refresh
            </Button>
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <DialogTrigger asChild>
                <Button size="sm">
                  <Plus className="mr-1.5 h-3.5 w-3.5" /> New key
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
                    {creating ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
                    Mint key
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </>
        }
      />

      {newlyCreated && (
        <div className="rounded-lg border border-warning/40 bg-warning/[0.07] p-3">
          <div className="mb-2 flex items-center gap-2 text-[13px] font-medium text-warning">
            <KeyRound className="h-3.5 w-3.5" />
            Copy this key now — it is never shown again
          </div>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded border border-border bg-background px-2.5 py-1.5 font-mono text-xs">
              {newlyCreated}
            </code>
            <Button
              size="sm"
              variant="outline"
              className="h-8 shrink-0"
              onClick={() => copyKey(newlyCreated)}
            >
              {copied ? (
                <>
                  <Check className="mr-1.5 h-3.5 w-3.5 text-success" /> Copied
                </>
              ) : (
                <>
                  <Copy className="mr-1.5 h-3.5 w-3.5" /> Copy
                </>
              )}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-8 shrink-0 text-muted-foreground"
              onClick={() => setNewlyCreated(null)}
            >
              Dismiss
            </Button>
          </div>
        </div>
      )}

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-[13px]">
          {error}
        </div>
      )}

      {loading ? (
        <TableCardSkeleton
          rows={3}
          widths={["45%", "70%", "50%", "40%", "55%", "55%", "24px"]}
        />
      ) : (
      <Card>
        <CardContent className="p-0">
          {keys.length === 0 ? (
            <div className="p-10 text-center">
              <KeyRound className="mx-auto mb-3 h-7 w-7 text-muted-foreground/50" />
              <div className="text-[13px] font-medium">No API keys yet</div>
              <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">
                Mint one to start calling the proxy from any OpenAI-compatible
                client.
              </p>
              <Button
                size="sm"
                className="mt-4"
                onClick={() => setDialogOpen(true)}
              >
                <Plus className="mr-1.5 h-3.5 w-3.5" /> New key
              </Button>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="h-9 w-full text-[11px] uppercase tracking-[0.06em]">
                    Label
                  </TableHead>
                  <TableHead className="h-9 w-[172px] text-[11px] uppercase tracking-[0.06em]">
                    Key
                  </TableHead>
                  <TableHead className="h-9 w-[88px] text-[11px] uppercase tracking-[0.06em]">
                    Status
                  </TableHead>
                  <TableHead className="h-9 w-[88px] text-right text-[11px] uppercase tracking-[0.06em]">
                    Requests
                  </TableHead>
                  <TableHead className="h-9 w-[96px] whitespace-nowrap text-[11px] uppercase tracking-[0.06em]">
                    Created
                  </TableHead>
                  <TableHead className="h-9 w-[96px] whitespace-nowrap text-[11px] uppercase tracking-[0.06em]">
                    Last used
                  </TableHead>
                  <TableHead className="h-9 w-10"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {keys.map((k) => (
                  <TableRow
                    key={k.id}
                    className={`h-11 ${k.is_active ? "" : "opacity-55"}`}
                  >
                    <TableCell className="max-w-0 py-1.5">
                      <span className="block truncate font-medium" title={k.label}>
                        {k.label}
                      </span>
                    </TableCell>
                    <TableCell className="py-1.5">
                      <code className="text-xs text-muted-foreground">
                        {k.key_prefix}…
                      </code>
                    </TableCell>
                    <TableCell className="py-1.5">
                      {k.is_active ? (
                        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <span className="h-1.5 w-1.5 rounded-full bg-success" />
                          active
                        </span>
                      ) : (
                        <Badge
                          variant="secondary"
                          className="px-1.5 py-0 text-[10px] font-medium uppercase tracking-wide"
                        >
                          revoked
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="py-1.5 text-right tabular-nums">
                      {formatNumber(k.total_requests || 0)}
                    </TableCell>
                    <TableCell
                      className="whitespace-nowrap py-1.5 text-xs text-muted-foreground"
                      title={formatDateTime(k.created_at)}
                    >
                      {formatRelative(k.created_at)}
                    </TableCell>
                    <TableCell
                      className="whitespace-nowrap py-1.5 text-xs text-muted-foreground"
                      title={formatDateTime(k.last_used_at)}
                    >
                      {formatRelative(k.last_used_at)}
                    </TableCell>
                    <TableCell className="py-1.5">
                      {k.is_active ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          title="Revoke this key"
                          aria-label={`Revoke ${k.label}`}
                          onClick={() => handleRevoke(k.id)}
                          disabled={revokingId === k.id}
                        >
                          {revokingId === k.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive" />
                          )}
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
      )}
    </div>
  );
}

export default MyKeys;
