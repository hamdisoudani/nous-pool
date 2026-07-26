import { ReactNode, useEffect, useState } from "react";
import { useNavigate, useLocation, Link } from "react-router-dom";
import { useAuth } from "../auth";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { ThemeToggle } from "./ThemeToggle";
import { Avatar, AvatarFallback } from "./ui/avatar";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "./ui/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
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
  Menu,
  NousMark,
} from "./icons";
import { cn } from "../lib/utils";

type NavLink = {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  description?: string;
};

const MAIN_LINKS: NavLink[] = [
  { to: "/dashboard", label: "Dashboard", icon: Home },
  { to: "/keys", label: "Keys", icon: KeyRound },
];

/** Admin items grouped behind the desktop "Manage" popover. */
const MANAGE_LINKS: NavLink[] = [
  {
    to: "/admin/users",
    label: "Users",
    icon: Users,
    description: "Promote, ban or restore accounts",
  },
  {
    to: "/admin/accounts",
    label: "Pool accounts",
    icon: Database,
    description: "Nous OAuth accounts serving requests",
  },
];

/** Analytics stays a top-level item on desktop — it's the most-visited admin
    page, so it shouldn't cost an extra click behind "Manage". */
const ANALYTICS_LINK: NavLink = {
  to: "/admin/analytics",
  label: "Analytics",
  icon: Activity,
  description: "Site-wide traffic and token usage",
};

/** The drawer lists every admin destination flat — no nested popovers on touch. */
const ADMIN_LINKS: NavLink[] = [...MANAGE_LINKS, ANALYTICS_LINK];

function initialsFor(user: { display_name?: string | null; email: string }) {
  const source = user.display_name?.trim() || user.email;
  const parts = source.split(/[\s._-]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return source.slice(0, 2).toUpperCase();
}

/**
 * AppShell — the single shared layout for both regular users and admins.
 *
 * Responsive strategy (the standard shadcn site-header pattern):
 *   - < md : hamburger opens a Sheet with the full vertical nav, labels intact.
 *   - >= md: horizontal NavigationMenu, admin items behind a "Manage" popover.
 * The user cluster is a DropdownMenu at every width, so a long email never
 * competes with the nav for horizontal space.
 *
 * Role-gated ROUTES are enforced server-side at the API layer too, not just
 * by hiding links here.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const isAdmin = user?.role === "admin";
  const [mobileOpen, setMobileOpen] = useState(false);

  // Close the drawer whenever the route changes.
  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  function isActive(path: string): boolean {
    return (
      location.pathname === path ||
      (path !== "/" && location.pathname.startsWith(path))
    );
  }

  async function handleSignOut() {
    await logout();
    navigate("/login");
  }

  return (
    <div className="flex min-h-[100dvh] flex-col bg-background">
      {/* === Top Navigation Bar === */}
      <header className="sticky top-0 z-30 w-full border-b border-border bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-screen-2xl items-center gap-2 px-4 sm:px-6">
          {/* --- Mobile: hamburger + Sheet --- */}
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0 md:hidden"
                aria-label="Open navigation menu"
              >
                <Menu className="h-4 w-4" />
              </Button>
            </SheetTrigger>

            <SheetContent side="left" className="w-[280px] p-0">
              <SheetHeader className="border-b border-border px-4 py-3.5 text-left">
                <SheetTitle className="flex items-center gap-2 text-[13.5px] font-semibold">
                  <span className="flex h-6 w-6 items-center justify-center rounded bg-primary text-primary-foreground">
                    <NousMark className="h-4 w-4" />
                  </span>
                  Nous Pool
                </SheetTitle>
              </SheetHeader>

              <nav className="flex flex-col gap-0.5 p-2">
                {MAIN_LINKS.map(({ to, label, icon: Icon }) => (
                  <Link
                    key={to}
                    to={to}
                    className={cn(
                      "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] font-medium transition-colors hover:bg-accent",
                      isActive(to) && "bg-accent text-accent-foreground",
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                    {label}
                  </Link>
                ))}

                {isAdmin && (
                  <>
                    <div className="section-label px-2.5 pb-1 pt-4">Admin</div>
                    {ADMIN_LINKS.map(({ to, label, icon: Icon, description }) => (
                      <Link
                        key={to}
                        to={to}
                        className={cn(
                          "flex items-start gap-2.5 rounded-md px-2.5 py-2 transition-colors hover:bg-accent",
                          isActive(to) && "bg-accent text-accent-foreground",
                        )}
                      >
                        <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                        <span className="min-w-0">
                          <span className="block text-[13px] font-medium">
                            {label}
                          </span>
                          {description && (
                            <span className="block text-xs text-muted-foreground">
                              {description}
                            </span>
                          )}
                        </span>
                      </Link>
                    ))}
                  </>
                )}
              </nav>
            </SheetContent>
          </Sheet>

          {/* --- Brand --- */}
          <Link to="/" className="flex shrink-0 items-center gap-2 md:mr-4">
            <div className="flex h-6 w-6 items-center justify-center rounded bg-primary text-primary-foreground">
              <NousMark className="h-4 w-4" />
            </div>
            <span className="whitespace-nowrap text-[13.5px] font-semibold tracking-tight">
              Nous Pool
            </span>
          </Link>

          {/* --- Desktop nav --- */}
          <NavigationMenu className="hidden max-w-none flex-none justify-start md:flex">
            <NavigationMenuList className="gap-0.5">
              {MAIN_LINKS.map(({ to, label, icon: Icon }) => (
                <NavigationMenuItem key={to}>
                  <Link
                    to={to}
                    className={cn(
                      navigationMenuTriggerStyle(),
                      "h-8 px-2.5 text-[13px]",
                      isActive(to) && "bg-accent text-accent-foreground",
                    )}
                  >
                    <Icon className="mr-1.5 h-3.5 w-3.5" />
                    {label}
                  </Link>
                </NavigationMenuItem>
              ))}

              {isAdmin && (
                <>
                  <NavigationMenuItem>
                    <NavigationMenuTrigger
                      className={cn(
                        "h-8 px-2.5 text-[13px]",
                        MANAGE_LINKS.some((l) => isActive(l.to)) &&
                          "bg-accent text-accent-foreground",
                      )}
                    >
                      <Shield className="mr-1.5 h-3.5 w-3.5" />
                      Manage
                    </NavigationMenuTrigger>
                    <NavigationMenuContent>
                      <ul className="grid w-[280px] gap-0.5 p-1.5">
                        {MANAGE_LINKS.map(({ to, label, icon: Icon, description }) => (
                          <li key={to}>
                            <NavigationMenuLink asChild>
                              <Link
                                to={to}
                                className="flex items-start gap-2.5 rounded-md p-2.5 hover:bg-accent"
                              >
                                <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                                <div>
                                  <div className="text-[13px] font-medium">
                                    {label}
                                  </div>
                                  <p className="text-xs text-muted-foreground">
                                    {description}
                                  </p>
                                </div>
                              </Link>
                            </NavigationMenuLink>
                          </li>
                        ))}
                      </ul>
                    </NavigationMenuContent>
                  </NavigationMenuItem>

                  <NavigationMenuItem>
                    <Link
                      to={ANALYTICS_LINK.to}
                      className={cn(
                        navigationMenuTriggerStyle(),
                        "h-8 px-2.5 text-[13px]",
                        isActive(ANALYTICS_LINK.to) &&
                          "bg-accent text-accent-foreground",
                      )}
                    >
                      <ANALYTICS_LINK.icon className="mr-1.5 h-3.5 w-3.5" />
                      {ANALYTICS_LINK.label}
                    </Link>
                  </NavigationMenuItem>
                </>
              )}
            </NavigationMenuList>
          </NavigationMenu>

          {/* --- Right cluster --- */}
          <div className="ml-auto flex shrink-0 items-center gap-1">
            <ThemeToggle />

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  className="h-8 gap-2 px-1.5"
                  aria-label="Account menu"
                >
                  <Avatar className="h-6 w-6">
                    <AvatarFallback className="bg-secondary text-[10px] font-semibold">
                      {user ? initialsFor(user) : "?"}
                    </AvatarFallback>
                  </Avatar>
                  <span
                    className="hidden max-w-[160px] truncate text-[13px] font-normal text-muted-foreground lg:inline"
                    title={user?.email}
                  >
                    {user?.email}
                  </span>
                </Button>
              </DropdownMenuTrigger>

              <DropdownMenuContent align="end" className="w-[240px]">
                <DropdownMenuLabel className="font-normal">
                  <div className="flex flex-col gap-1.5">
                    <span
                      className="truncate text-[13px] font-medium"
                      title={user?.email}
                    >
                      {user?.display_name || user?.email.split("@")[0]}
                    </span>
                    <span
                      className="truncate text-xs text-muted-foreground"
                      title={user?.email}
                    >
                      {user?.email}
                    </span>
                    <Badge
                      variant={isAdmin ? "default" : "secondary"}
                      className="w-fit px-1.5 py-0 text-[10px] font-medium uppercase tracking-wide"
                    >
                      {user?.role}
                    </Badge>
                  </div>
                </DropdownMenuLabel>

                <DropdownMenuSeparator />

                <DropdownMenuItem onSelect={handleSignOut}>
                  <LogOut className="mr-2 h-3.5 w-3.5" />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      {/* === Page content === */}
      <main className="flex-1">
        <div className="mx-auto max-w-screen-2xl px-4 py-6 sm:px-6 sm:py-8">
          {children}
        </div>
      </main>

      {/* === Footer === */}
      <footer className="border-t border-border py-3">
        <div className="mx-auto flex max-w-screen-2xl items-center justify-between gap-4 px-4 text-xs text-muted-foreground sm:px-6">
          <span className="truncate">Nous Pool — OpenAI-compatible proxy</span>
          <span className="shrink-0">MIT licensed</span>
        </div>
      </footer>
    </div>
  );
}
