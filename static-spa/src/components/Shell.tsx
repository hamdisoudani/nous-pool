import { ReactNode } from "react";
import { useNavigate, useLocation, Link } from "react-router-dom";
import { useAuth } from "../auth";
import { Button } from "./ui/button";
import { Separator } from "./ui/separator";
import { Badge } from "./ui/badge";
import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuTrigger,
  navigationMenuTriggerStyle,
} from "./ui/navigation-menu";
import {
  LogOut,
  Home,
  KeyRound,
  Users,
  Database,
  Activity,
  Shield,
  ChevronDown,
} from "lucide-react";
import { cn } from "../lib/utils";

/**
 * AppShell — the single shared layout for both regular users and admins.
 *
 * - User sees:   Dashboard, My Keys
 * - Admin sees:  Dashboard (with extra widgets), Users (manage/ban/role),
 *                Pool Accounts, Analytics
 *
 * The view is identical — the only difference is which NavigationMenu items
 * render. Role-gated ROUTES are also enforced server-side at the API layer,
 * not just here.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const isAdmin = user?.role === "admin";

  function isActive(path: string): boolean {
    return location.pathname === path ||
      (path !== "/" && location.pathname.startsWith(path));
  }

  return (
    <div className="min-h-[100dvh] flex flex-col bg-background">
      {/* === Top Navigation Bar === */}
      <header className="sticky top-0 z-30 w-full border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="mx-auto flex h-14 max-w-screen-2xl items-center px-4 sm:px-6">
          {/* Brand */}
          <Link to="/" className="flex items-center gap-2 mr-6">
            <div className="h-7 w-7 rounded-md bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center text-white font-bold text-sm">
              N
            </div>
            <span className="font-semibold text-base hidden sm:inline">
              Nous Pool
            </span>
          </Link>

          {/* Main nav (shadcn NavigationMenu) */}
          <NavigationMenu className="max-w-none">
            <NavigationMenuList>
              {/* Dashboard — available to BOTH user and admin */}
              <NavigationMenuItem>
                <Link
                  to={isAdmin ? "/admin" : "/dashboard"}
                  className={cn(
                    navigationMenuTriggerStyle(),
                    isActive(isAdmin ? "/admin" : "/dashboard") &&
                      "bg-accent text-accent-foreground",
                  )}
                >
                  <Home className="h-4 w-4 mr-1.5" />
                  Dashboard
                </Link>
              </NavigationMenuItem>

              {/* My Keys — both user and admin can manage their own */}
              <NavigationMenuItem>
                <Link
                  to="/keys"
                  className={cn(
                    navigationMenuTriggerStyle(),
                    isActive("/keys") && "bg-accent text-accent-foreground",
                  )}
                >
                  <KeyRound className="h-4 w-4 mr-1.5" />
                  My Keys
                </Link>
              </NavigationMenuItem>

              {/* === Admin-only cluster === */}
              {isAdmin && (
                <>
                  <NavigationMenuItem>
                    <NavigationMenuTrigger
                      className={cn(
                        (isActive("/admin/users") || isActive("/admin/accounts")) &&
                          "bg-accent text-accent-foreground",
                      )}
                    >
                      <Shield className="h-4 w-4 mr-1.5" />
                      Manage
                    </NavigationMenuTrigger>
                    <NavigationMenuContent>
                      <ul className="grid gap-1 p-2 w-[280px]">
                        <li>
                          <NavigationMenuLink asChild>
                            <Link
                              to="/admin/users"
                              className="flex items-start gap-3 rounded-md p-3 hover:bg-accent/50"
                            >
                              <Users className="h-5 w-5 mt-0.5 text-muted-foreground" />
                              <div className="space-y-0.5">
                                <div className="font-medium text-sm">Users</div>
                                <p className="text-xs text-muted-foreground">
                                  Promote, demote, ban or restore users
                                </p>
                              </div>
                            </Link>
                          </NavigationMenuLink>
                        </li>
                        <li>
                          <NavigationMenuLink asChild>
                            <Link
                              to="/admin/accounts"
                              className="flex items-start gap-3 rounded-md p-3 hover:bg-accent/50"
                            >
                              <Database className="h-5 w-5 mt-0.5 text-muted-foreground" />
                              <div className="space-y-0.5">
                                <div className="font-medium text-sm">Pool Accounts</div>
                                <p className="text-xs text-muted-foreground">
                                  Nous OAuth accounts that serve requests
                                </p>
                              </div>
                            </Link>
                          </NavigationMenuLink>
                        </li>
                      </ul>
                    </NavigationMenuContent>
                  </NavigationMenuItem>

                  <NavigationMenuItem>
                    <Link
                      to="/admin/analytics"
                      className={cn(
                        navigationMenuTriggerStyle(),
                        isActive("/admin/analytics") &&
                          "bg-accent text-accent-foreground",
                      )}
                    >
                      <Activity className="h-4 w-4 mr-1.5" />
                      Analytics
                    </Link>
                  </NavigationMenuItem>
                </>
              )}
            </NavigationMenuList>
          </NavigationMenu>

          {/* Right side: user badge + role + logout */}
          <div className="ml-auto flex items-center gap-3">
            <div className="hidden md:flex flex-col items-end">
              <div className="text-sm font-medium leading-none">
                {user?.email}
              </div>
              <div className="mt-1">
                <Badge variant={isAdmin ? "default" : "secondary"}>
                  {user?.role}
                </Badge>
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={async () => {
                await logout();
                navigate("/login");
              }}
            >
              <LogOut className="h-4 w-4 mr-2" />
              <span className="hidden sm:inline">Sign out</span>
            </Button>
          </div>
        </div>
      </header>

      {/* === Page content === */}
      <main className="flex-1">
        <div className="mx-auto max-w-screen-2xl px-4 sm:px-6 py-6 sm:py-8">
          {children}
        </div>
      </main>

      {/* === Footer === */}
      <footer className="border-t py-3">
        <div className="mx-auto max-w-screen-2xl px-4 sm:px-6 flex items-center justify-between text-xs text-muted-foreground">
          <span>Nous Pool — OpenAI-compatible proxy</span>
          <span>MIT licensed</span>
        </div>
      </footer>
    </div>
  );
}

// Helper kept for backwards import compat — old name alias.
export const Shell = AppShell;
