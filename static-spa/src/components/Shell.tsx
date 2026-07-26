import { ReactNode } from "react";
import { useNavigate, useLocation, Link } from "react-router-dom";
import { useAuth } from "../auth";
import { Button } from "./ui/button";
import { Separator } from "./ui/separator";
import { LogOut, Layers, Users, Database } from "lucide-react";
import { cn } from "../lib/utils";

export function Shell({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const isAdmin = user?.role === "admin";

  const navItems = isAdmin
    ? [
        { label: "Overview", to: "/admin", icon: Layers },
        { label: "Pool Accounts", to: "/admin/accounts", icon: Database },
        { label: "Users", to: "/admin/users", icon: Users },
      ]
    : [{ label: "My Dashboard", to: "/dashboard", icon: Layers }];

  return (
    <div className="h-[100dvh] flex bg-background overflow-hidden">
      <aside className="w-64 shrink-0 border-r bg-card flex flex-col overflow-y-auto">
        <div className="px-6 py-5">
          <Link to={isAdmin ? "/admin" : "/dashboard"} className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-md bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center text-white font-bold">
              N
            </div>
            <div>
              <div className="font-semibold text-sm">Nous Pool</div>
              <div className="text-xs text-muted-foreground">
                {isAdmin ? "Admin" : "User"}
              </div>
            </div>
          </Link>
        </div>

        <Separator />

        <nav className="px-3 py-4 space-y-1 flex-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active =
              location.pathname === item.to ||
              (item.to !== "/" && location.pathname.startsWith(item.to));
            return (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                  active
                    ? "bg-accent text-accent-foreground font-medium"
                    : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                )}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="p-3 border-t">
          <div className="px-3 py-2">
            <div className="text-xs text-muted-foreground">Signed in as</div>
            <div className="text-sm font-medium truncate">{user?.email}</div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start"
            onClick={async () => {
              await logout();
              navigate("/login");
            }}
          >
            <LogOut className="h-4 w-4 mr-2" />
            Sign out
          </Button>
        </div>
      </aside>

      <main className="flex-1 overflow-auto">
        <div className="max-w-6xl mx-auto px-8 py-8">{children}</div>
      </main>
    </div>
  );
}
