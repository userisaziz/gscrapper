import {
  Check,
  Download,
  FolderOpen,
  Loader2,
  LogOut,
  Moon,
  Sun,
  User,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { LicenseBadge } from "@/components/license-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { useLicense } from "@/hooks/use-license";
import { useTheme } from "@/hooks/use-theme";
import { api } from "@/lib/wails";
import type { SelectorStat } from "@/lib/wails";
import { cn } from "@/lib/utils";

export function SettingsView() {
  const { theme, setTheme } = useTheme();
  const { state, logout } = useLicense();

  const [pwInstalled, setPwInstalled] = useState<boolean | null>(null);
  const [pwInstalling, setPwInstalling] = useState(false);
  const [selectorHealth, setSelectorHealth] = useState<SelectorStat[] | null>(null);

  useEffect(() => {
    api
      .checkPlaywrightInstalled()
      .then(setPwInstalled)
      .catch(() => setPwInstalled(null));
    api
      .getSelectorHealth()
      .then(setSelectorHealth)
      .catch(() => setSelectorHealth(null));
  }, []);

  const installPlaywright = async () => {
    setPwInstalling(true);
    try {
      await api.installPlaywright();
      setPwInstalled(true);
    } catch (err) {
      toast.error(`Playwright install failed: ${err}`);
    } finally {
      setPwInstalling(false);
    }
  };

  const openDataFolder = async () => {
    try {
      await api.openDataFolder();
    } catch (err) {
      toast.error(`Failed to open data folder: ${err}`);
    }
  };

  const handleLogout = async () => {
    if (window.confirm("Logout?")) await logout();
  };

  const license = state.status === "authenticated" ? state.license : null;

  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-2xl px-6 py-6">
        <h1 className="mb-6 text-xl font-bold tracking-tight">Settings</h1>

        <div className="space-y-5">
          {/* Appearance */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Appearance</CardTitle>
              <CardDescription className="text-xs">Choose your theme</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-3">
                {(["light", "dark"] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setTheme(t)}
                    className={cn(
                      "flex items-center gap-2.5 rounded-lg border px-4 py-3 text-sm font-medium transition-colors cursor-pointer",
                      theme === t
                        ? "border-primary bg-accent text-accent-foreground"
                        : "border-border text-muted-foreground hover:bg-muted/50"
                    )}
                  >
                    {t === "light" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                    <span className="capitalize">{t}</span>
                    {theme === t && <Check className="ml-auto h-4 w-4" />}
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Playwright */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Playwright Browsers</CardTitle>
              <CardDescription className="text-xs">
                Required for scraping. Install once — takes a couple of minutes.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm">
                {pwInstalled === null ? (
                  <span className="text-muted-foreground">Checking…</span>
                ) : pwInstalled ? (
                  <>
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-success/15">
                      <Check className="h-3.5 w-3.5 text-success" />
                    </span>
                    <span>Installed</span>
                  </>
                ) : (
                  <span className="text-warning">Not installed</span>
                )}
              </div>
              <Button size="sm" onClick={installPlaywright} disabled={pwInstalling || pwInstalled === true}>
                {pwInstalling ? <Loader2 className="animate-spin" /> : <Download />}
                {pwInstalling ? "Installing…" : "Install Now"}
              </Button>
            </CardContent>
          </Card>

          {/* Data */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Data</CardTitle>
              <CardDescription className="text-xs">Where your scraped results are stored</CardDescription>
            </CardHeader>
            <CardContent>
              <Button variant="outline" size="sm" onClick={openDataFolder}>
                <FolderOpen />
                Open Data Folder
              </Button>
            </CardContent>
          </Card>

          {/* Scraper Health */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Scraper Health</CardTitle>
              <CardDescription className="text-xs">
                Selector hit/miss rates — a high miss rate means Google changed its markup.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {selectorHealth === null ? (
                <p className="text-xs text-muted-foreground">No telemetry available.</p>
              ) : selectorHealth.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No data yet — run a scrape and check back.
                </p>
              ) : (
                <div className="space-y-1.5">
                  {selectorHealth.slice(0, 8).map((s) => {
                    const pct = Math.round(s.miss_rate * 100);
                    return (
                      <div key={s.selector} className="flex items-center justify-between gap-3 text-xs">
                        <code className="truncate rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]">
                          {s.selector}
                        </code>
                        <span
                          className={cn(
                            "shrink-0 tabular-nums",
                            pct >= 50 ? "text-destructive" : pct >= 20 ? "text-warning" : "text-muted-foreground"
                          )}
                        >
                          {pct}% miss · {s.hits + s.misses} seen
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Account */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Account</CardTitle>
              <CardDescription className="text-xs">Subscription and session</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {license && (
                <div className="flex items-center justify-between rounded-lg bg-muted/50 px-4 py-3">
                  <div className="flex items-center gap-2.5">
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground">
                      <User className="h-4 w-4" />
                    </span>
                    <div>
                      <p className="text-sm font-medium">{license.email}</p>
                      <p className="text-xs text-muted-foreground">
                        {license.plan} · expires {license.expires_at}
                      </p>
                    </div>
                  </div>
                  <LicenseBadge />
                </div>
              )}
              <Separator />
              <Button variant="outline" size="sm" onClick={handleLogout} className="text-destructive hover:text-destructive">
                <LogOut />
                Logout
              </Button>
            </CardContent>
          </Card>

          <p className="pb-2 text-center text-xs text-muted-foreground">
            Maps Scraper Pro · v2.0.0
          </p>
        </div>
      </div>
    </div>
  );
}
