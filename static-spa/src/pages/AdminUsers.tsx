/**
 * AdminUsers — server-side moderation table.
 *
 * Every action here calls a backend endpoint. The frontend NEVER touches
 * Supabase — even the "ban now" click goes through POST /admin/users/{id}/ban
 * which sets disabled_at server-side. (Banned users are blocked by the
 * auth/deps.py current_context middleware on EVERY subsequent request.)
 */
import { useEffect, useRef, useState } from "react";
import { api, AppUser, Role } from "@/auth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/PageHeader";
import { TableCardSkeleton } from "@/components/Skeletons";
import { formatDateTime, formatRelative } from "@/lib/format";
import {
  Table, TableHeader, TableRow, TableHead, TableBody, TableCell,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { RefreshCw, Ban, ShieldCheck } from "@/components/icons";

export function AdminUsers() {
  const [users, setUsers] = useState<AppUser[]>([]);
  const [me, setMe] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [banTarget, setBanTarget] = useState<AppUser | null>(null);
  const [banReason, setBanReason] = useState("");
  const cancelRef = useRef<HTMLButtonElement>(null);

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
      <PageHeader
        title="Users"
        description={
          loading
            ? "Loading accounts…"
            : `${users.length} account${users.length === 1 ? "" : "s"} · ` +
              `${users.filter((u) => !u.disabled_at).length} active · ` +
              `${users.filter((u) => u.disabled_at).length} banned`
        }
        actions={
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw
              className={`mr-1.5 h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`}
            />
            Refresh
          </Button>
        }
      />

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm">
          {error}
        </div>
      )}

      {loading ? (
        <TableCardSkeleton
          rows={8}
          widths={["55%", "42px", "48px", "56px", "56px", "150px"]}
        />
      ) : (
      <Card>
        <CardContent className="p-0">
          {users.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              No users yet.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="h-9 w-full text-[11px] uppercase tracking-[0.06em]">
                    Email
                  </TableHead>
                  <TableHead className="h-9 w-[92px] text-[11px] uppercase tracking-[0.06em]">
                    Role
                  </TableHead>
                  <TableHead className="h-9 w-[92px] text-[11px] uppercase tracking-[0.06em]">
                    Status
                  </TableHead>
                  <TableHead className="h-9 w-[104px] whitespace-nowrap text-[11px] uppercase tracking-[0.06em]">
                    Last login
                  </TableHead>
                  <TableHead className="h-9 w-[104px] whitespace-nowrap text-[11px] uppercase tracking-[0.06em]">
                    Created
                  </TableHead>
                  <TableHead className="h-9 w-[188px] text-right text-[11px] uppercase tracking-[0.06em]">
                    Actions
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((u) => {
                  const isMe = me?.id === u.id;
                  const isBanned = !!u.disabled_at;
                  return (
                    <TableRow key={u.id} className="h-11">
                      <TableCell className="max-w-0 py-1.5">
                        <div className="flex items-center gap-2">
                          <span className="truncate font-medium" title={u.email}>
                            {u.email}
                          </span>
                          {isMe && (
                            <Badge
                              variant="outline"
                              className="shrink-0 px-1 py-0 text-[10px]"
                            >
                              you
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="py-1.5">
                        <Badge
                          variant={u.role === "admin" ? "default" : "secondary"}
                          className="px-1.5 py-0 text-[10px] font-medium uppercase tracking-wide"
                        >
                          {u.role}
                        </Badge>
                      </TableCell>
                      <TableCell className="py-1.5">
                        {isBanned ? (
                          <Badge
                            variant="destructive"
                            className="px-1.5 py-0 text-[10px] font-medium uppercase tracking-wide"
                          >
                            banned
                          </Badge>
                        ) : (
                          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            <span className="h-1.5 w-1.5 rounded-full bg-success" />
                            active
                          </span>
                        )}
                      </TableCell>
                      <TableCell
                        className="whitespace-nowrap py-1.5 text-xs text-muted-foreground"
                        title={formatDateTime(u.last_login_at)}
                      >
                        {formatRelative(u.last_login_at)}
                      </TableCell>
                      <TableCell
                        className="whitespace-nowrap py-1.5 text-xs text-muted-foreground"
                        title={formatDateTime(u.created_at)}
                      >
                        {formatRelative(u.created_at)}
                      </TableCell>
                      <TableCell className="py-1.5 text-right">
                        {isMe ? (
                          <span className="text-xs text-muted-foreground">
                            —
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
                                    className="h-7 px-2 text-xs"
                                    onClick={() => setBanTarget(u)}
                                    disabled={pending === u.id}
                                  >
                                    <Ban className="mr-1 h-3 w-3" />
                                    Ban
                                  </Button>
                                </DialogTrigger>
                                <DialogContent
                                onOpenAutoFocus={(e) => {
                                  // Don't auto-focus the textarea on open
                                  // — that would make Enter immediately
                                  // submit the destructive Ban action.
                                  e.preventDefault();
                                  cancelRef.current?.focus();
                                }}
                              >
                                  <DialogHeader>
                                    <DialogTitle className="truncate">
                                      Ban {u.email}?
                                    </DialogTitle>
                                    <DialogDescription>
                                      All of their API keys will be revoked
                                      immediately and they won't be able to sign
                                      back in. You can unban them later, but the
                                      revoked keys stay revoked.
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
                                      onKeyDown={(e) => {
                                        // Enter inserts a newline; never submits
                                        // the destructive "Ban user" action.
                                        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                                          e.preventDefault();
                                          handleBan(u);
                                        }
                                      }}
                                      placeholder="e.g. abuse, spam, ToS violation"
                                      aria-label="Ban reason"
                                    />
                                  </div>
                                  <DialogFooter>
                                    <Button
                                      ref={cancelRef}
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
                                className="h-7 px-2 text-xs"
                                onClick={() => handleUnban(u)}
                                disabled={pending === u.id}
                              >
                                <ShieldCheck className="mr-1 h-3 w-3" />
                                Unban
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 px-2 text-xs"
                              onClick={() =>
                                handleRole(u, u.role === "admin" ? "user" : "admin")
                              }
                              disabled={pending === u.id}
                            >
                              {u.role === "admin" ? "Demote" : "Promote"}
                            </Button>
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
      )}
    </div>
  );
}

export default AdminUsers;
