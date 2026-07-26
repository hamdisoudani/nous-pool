import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Shell } from "@/components/Shell";
import { api, AppUser } from "@/auth";
import { Loader2, AlertCircle } from "lucide-react";
import { formatNumber } from "@/lib/utils";

export function AdminUsers() {
  const [users, setUsers] = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.listUsers()
      .then((r) => setUsers(r.users))
      .catch((e) => setError(e?.body?.error || e?.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <Shell>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Users</h1>
          <p className="text-muted-foreground mt-1">
            All registered accounts. Roles are now managed directly in Supabase
            via the <code className="text-foreground">app_users</code> table or{" "}
            <code className="text-foreground">app_users_helper</code> admin.
          </p>
        </div>

        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{users.length} user{users.length === 1 ? "" : "s"}</CardTitle>
            <CardDescription>
              Promote or demote by editing the Supabase{" "}
              <code>app_users</code> table directly.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="p-8 flex items-center justify-center text-muted-foreground">
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Loading…
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
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users.map((u) => (
                    <TableRow key={u.id}>
                      <TableCell className="font-medium">{u.email}</TableCell>
                      <TableCell>
                        <Badge variant={u.role === "admin" ? "default" : "secondary"}>
                          {u.role}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {u.disabledAt ? (
                          <Badge variant="destructive">disabled</Badge>
                        ) : (
                          <Badge variant="success">active</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {u.lastLoginAt
                          ? new Date(u.lastLoginAt).toLocaleString()
                          : "never"}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {new Date(u.createdAt).toLocaleString()}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </Shell>
  );
}
