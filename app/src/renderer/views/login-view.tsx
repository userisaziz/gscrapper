import { AlertTriangle, Check, Loader2, MapPin } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useLicense } from "@/hooks/use-license";

const FEATURES = ["Unlimited scrapes", "Email extraction", "CSV export"];

export function LoginView() {
  const { state, login } = useLicense();
  const expired = state.status === "unauthenticated" && state.expired;

  const [mode, setMode] = useState<"form" | "expired">(expired ? "expired" : "form");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Sync when the provider flips to expired (e.g. license:expired event).
  // Keyed on `expired` so an explicit "Back to Login" isn't immediately reverted.
  useEffect(() => {
    if (expired) setMode("expired");
  }, [expired]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) {
      setError("Enter email and password.");
      return;
    }
    setError(null);
    setLoading(true);
    try {
      await login(email.trim(), password);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("expired")) {
        setMode("expired");
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex h-full items-center justify-center bg-gradient-to-br from-background via-background to-muted/60 p-6">
      <div className="w-full max-w-sm">
        <Card className="border-border/60 shadow-lg">
          <CardContent className="pt-8">
            {/* Brand */}
            <div className="mb-6 flex flex-col items-center text-center">
              <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-md">
                <MapPin className="h-6 w-6" />
              </div>
              <h1 className="text-xl font-bold tracking-tight">Maps Scraper Pro</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Sign in with your subscription credentials
              </p>
            </div>

            {mode === "expired" ? (
              <div className="flex flex-col items-center py-4 text-center">
                <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-warning/15">
                  <AlertTriangle className="h-6 w-6 text-warning" />
                </div>
                <h2 className="text-base font-semibold">Subscription Expired</h2>
                <p className="mt-1.5 text-sm text-muted-foreground">
                  Your monthly subscription has ended. Contact support to renew access.
                </p>
                <Button
                  variant="outline"
                  className="mt-5 w-full"
                  onClick={() => {
                    setMode("form");
                    setPassword("");
                  }}
                >
                  Back to Login
                </Button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="login-email">Email</Label>
                  <Input
                    id="login-email"
                    type="email"
                    placeholder="you@company.com"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    disabled={loading}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="login-password">Password</Label>
                  <Input
                    id="login-password"
                    type="password"
                    placeholder="Enter password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={loading}
                  />
                </div>

                {error && (
                  <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
                    {error}
                  </p>
                )}

                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? (
                    <>
                      <Loader2 className="animate-spin" />
                      Validating license…
                    </>
                  ) : (
                    "Sign In"
                  )}
                </Button>
              </form>
            )}

            {/* Feature bullets */}
            <div className="mt-6 flex items-center justify-center gap-4 border-t pt-4">
              {FEATURES.map((f) => (
                <span key={f} className="flex items-center gap-1 text-[11px] text-muted-foreground">
                  <Check className="h-3 w-3 text-success" />
                  {f}
                </span>
              ))}
            </div>
          </CardContent>
        </Card>

        <p className="mt-4 text-center text-xs text-muted-foreground">
          Active subscription required · v2.0.1
        </p>
      </div>
    </div>
  );
}
