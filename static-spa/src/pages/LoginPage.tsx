import { useState, useEffect } from "react";
import { useNavigate, useLocation, Navigate, Link } from "react-router-dom";
import { useAuth, ApiErrorClass, AppUser } from "@/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, LogIn, UserPlus, KeyRound } from "lucide-react";
import { cn } from "@/lib/utils";

type Mode = "signin" | "signup";

export function LoginPage() {
  const { user, login, signup } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from;

  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // If already signed in, redirect
  if (user) {
    return <Navigate to={from ?? (user.role === "admin" ? "/admin" : "/dashboard")} replace />;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (mode === "signup") {
      if (password.length < 8) {
        setError("Password must be at least 8 characters.");
        return;
      }
      if (password !== confirm) {
        setError("Passwords don't match.");
        return;
      }
    }

    setSubmitting(true);
    try {
      const u: AppUser =
        mode === "signin"
          ? await login(email.trim(), password)
          : await signup(email.trim(), password);

      const dest = from ?? (u.role === "admin" ? "/admin" : "/dashboard");
      navigate(dest, { replace: true });
    } catch (e: any) {
      const body = e?.body ?? {};
      const msg =
        (typeof body === "object" && (body as any).error) ||
        (e instanceof ApiErrorClass ? `Login failed (${e.status})` : e?.message) ||
        "Something went wrong";
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-background to-muted/40 p-6">
      <Card className="w-full max-w-md animate-fade-in">
        <CardHeader className="space-y-3 text-center pb-2">
          <div className="mx-auto h-12 w-12 rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center text-white font-bold text-xl">
            N
          </div>
          <CardTitle className="text-2xl">
            {mode === "signin" ? "Sign in to Nous Pool" : "Create your account"}
          </CardTitle>
          <CardDescription>
            {mode === "signin"
              ? "OpenAI-compatible proxy with pooled accounts"
              : "Sign up to get your Nous Pool API key"}
          </CardDescription>
        </CardHeader>

        <CardContent>
          <div className="grid grid-cols-2 mb-6 rounded-md border bg-muted p-1 text-sm">
            <button
              type="button"
              onClick={() => { setMode("signin"); setError(null); }}
              className={cn(
                "flex items-center justify-center gap-2 rounded-sm py-1.5 transition-colors",
                mode === "signin"
                  ? "bg-background shadow-sm text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <LogIn className="h-4 w-4" />
              Sign in
            </button>
            <button
              type="button"
              onClick={() => { setMode("signup"); setError(null); }}
              className={cn(
                "flex items-center justify-center gap-2 rounded-sm py-1.5 transition-colors",
                mode === "signup"
                  ? "bg-background shadow-sm text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <UserPlus className="h-4 w-4" />
              Sign up
            </button>
          </div>

          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                placeholder="[email protected]"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={submitting}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete={mode === "signup" ? "new-password" : "current-password"}
                placeholder={mode === "signup" ? "At least 8 characters" : "••••••••"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={submitting}
                required
              />
            </div>

            {mode === "signup" && (
              <div className="space-y-2">
                <Label htmlFor="confirm">Confirm password</Label>
                <Input
                  id="confirm"
                  type="password"
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  disabled={submitting}
                  required
                />
              </div>
            )}

            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  {mode === "signin" ? "Signing in…" : "Creating account…"}
                </>
              ) : (
                <>
                  {mode === "signin" ? "Sign in" : "Create account"}
                </>
              )}
            </Button>

            <p className="text-xs text-muted-foreground text-center pt-2">
              {mode === "signin" ? (
                <>New here?{" "}
                  <button
                    type="button"
                    onClick={() => { setMode("signup"); setError(null); }}
                    className="underline hover:text-foreground"
                  >
                    Create an account
                  </button>
                </>
              ) : (
                <>Already have an account?{" "}
                  <button
                    type="button"
                    onClick={() => { setMode("signin"); setError(null); }}
                    className="underline hover:text-foreground"
                  >
                    Sign in
                  </button>
                </>
              )}
            </p>
          </form>

          <div className="mt-6 pt-6 border-t">
            <div className="flex items-start gap-2 text-xs text-muted-foreground">
              <KeyRound className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <p>
                First user to sign up is promoted to admin. Subsequent users get
                the <code className="text-foreground">user</code> role.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
