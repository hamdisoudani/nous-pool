/**
 * AdminUsers — server-side moderation table.
 *
 * Every action here calls a backend endpoint. The frontend NEVER touches
 * Supabase — even the "ban now" click goes through POST /admin/users/{id}/ban
 * which sets disabled_at server-side. (Banned users are blocked by the
 * auth/deps.py current_context middleware on EVERY subsequent request.)
 */
import { useEffect, useState } from "react";
import { api, AppUser, Role } from "@/auth";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableHeader, TableRow, TableHead, TableBody, TableCell,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  ShieldAlert, RefreshCw, Users, Ban, ShieldCheck, Crown,
} from "lucide-react";

export function AdminUsers() {
  const [users, setUsers] = useState<AppUser[]>([]);
  const [me, setMe] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [banTarget, setBanTarget] = useState<AppUser | null>(null);
  const [banReason, setBanReason] = useState("");

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [u, m] = await Promise.all([api.listUsers(), api.me()]);
      setUsers(u.users);
      setMe(m);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function handleBan(u: AppUser) {
    setPending(u.id);
    try {
      await api.banUser(u.id, banReason || undefined);
      setBanTarget(null);
      setBanReason("");
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(null);
    }
  }

  async function handleUnban(u: AppUser) {
    setPending(u.id);
    try {
      await api.unbanUser(u.id);
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(null);
    }
  }

  async function handleRole(u: AppUser, role: Role) {
    if (role === u.role) return;
    setPending(u.id);
    try {
      await api.setUserRole(u.id, role);
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Users</h1>
          <p className="text-muted-foreground mt-1">
            All registered accounts. Ban/unban &amp; promote/demote via this table.
          </p>
        </div>
        <Button variant="outline" onClick={load}>
          <RefreshCw className="h-4 w-4 mr-1" /> Refresh
        </Button>
      </div>

      <Card className="border-amber-500/30 bg-amber-500/5">
        <CardContent className="p-4 flex items-start gap-3">
          <ShieldAlert className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
          <div className="text-sm space-y-1">
            <div className="font-medium">All actions here are server-side.</div>
            <p className="text-muted-foreground">
              Banning a user sets <code>disabled_at</code> via{" "}
              <code>POST /admin/users/{'{id}'}/ban</code>. The auth middleware{" "}
              <code>current_context</code> then returns{" "}
              <code>403 user_disabled</code> on every protected route, and{" "}
              <code>api_keys</code> for that user are revoked in the same
              transaction. The frontend never touches Supabase directly.
            </p>
          </div>
        </CardContent>
      </Card>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm">
          {error}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" /> {users.length} user{users.length === 1 ? "" : "s"}
          </CardTitle>
          <CardDescription>
            First user is auto-promoted to admin on signup.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-8 text-center text-muted-foreground">
              Loading…
            </div>
          ) : users.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              No users yet.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Last login</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((u) => {
                  const isMe = me?.id === u.id;
                  const isBanned = !!u.disabled_at;
                  return (
                    <TableRow key={u.id}>
                      <TableCell className="font-medium">
                        {u.email}
                        {isMe && (
                          <Badge variant="outline" className="ml-2 text-[10px]">
                            you
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        {isMe ? (
                          <Badge variant="default">
                            <Crown className="h-3 w-3 mr-1" /> {u.role}
                          </Badge>
                        ) : u.role === "admin" ? (
                          <Badge variant="default">{u.role}</Badge>
                        ) : (
                          <Badge variant="secondary">{u.role}</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        {isBanned ? (
                          <Badge variant="destructive">
                            <Ban className="h-3 w-3 mr-1" /> banned
                          </Badge>
                        ) : (
                          <Badge variant="secondary">active</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {u.last_login_at
                          ? new Date(u.last_login_at).toLocaleString()
                          : "never"}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {u.created_at
                          ? new Date(u.created_at).toLocaleString()
                          : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        {isMe ? (
                          <span className="text-xs text-muted-foreground">
                            (can't act on yourself)
                          </span>
                        ) : (
                          <div className="flex justify-end gap-2">
                            {!isBanned ? (
                              <Dialog
                                open={banTarget?.id === u.id}
                                onOpenChange={(o) => {
                                  if (!o) {
                                    setBanTarget(null);
                                    setBanReason("");
                                  }
                                }}
                              >
                                <DialogTrigger asChild>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => setBanTarget(u)}
                                    disabled={pending === u.id}
                                  >
                                    <Ban className="h-3 w-3 mr-1" />
                                    Ban
                                  </Button>
                                </DialogTrigger>
                                <DialogContent>
                                  <DialogHeader>
                                    <DialogTitle>Ban {u.email}?</DialogTitle>
                                    <DialogDescription>
                                      All their API keys will be revoked and they
                                      won't be able to log back in. This runs
                                      server-side via{" "}
                                      <code>POST /admin/users/{u.id.slice(0, 8)}…/ban</code>.
                                    </DialogDescription>
                                  </DialogHeader>
                                  <div className="space-y-2">
                                    <label className="text-sm font-medium">
                                      Reason (optional)
                                    </label>
                                    <textarea
                                      className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                                      value={banReason}
                                      onChange={(e) => setBanReason(e.target.value)}
                                      placeholder="e.g. abuse, spam, ToS violation"
                                    />
                                  </div>
                                  <DialogFooter>
                                    <Button
                                      variant="outline"
                                      onClick={() => {
                                        setBanTarget(null);
                                        setBanReason("");
                                      }}
                                    >
                                      Cancel
                                    </Button>
                                    <Button
                                      variant="destructive"
                                      onClick={() => handleBan(u)}
                                      disabled={pending === u.id}
                                    >
                                      <Ban className="h-4 w-4 mr-1" />
                                      Ban user
                                    </Button>
                                  </DialogFooter>
                                </DialogContent>
                              </Dialog>
                            ) : (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleUnban(u)}
                                disabled={pending === u.id}
                              >
                                <ShieldCheck className="h-3 w-3 mr-1" />
                                Unban
                              </Button>
                            )}
                            {u.role !== "admin" ? (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleRole(u, "admin")}
                                disabled={pending === u.id}
                              >
                                Promote
                              </Button>
                            ) : (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleRole(u, "user")}
                                disabled={pending === u.id}
                              >
                                Demote
                              </Button>
                            )}
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default AdminUsers;
