import {
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  Loader2,
  MapPin,
  PlayCircle,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useJobs } from "@/hooks/use-jobs";
import { useLicense } from "@/hooks/use-license";
import { api } from "@/lib/wails";
import type { View } from "@/lib/navigation";
import { relativeTime } from "@/lib/utils";

function StatCard({
  label,
  value,
  icon,
  accent,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  accent: string;
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${accent}`}>
          {icon}
        </div>
        <div>
          <p className="text-xl font-bold leading-none tabular-nums">{value}</p>
          <p className="mt-1 text-xs text-muted-foreground">{label}</p>
        </div>
      </CardContent>
    </Card>
  );
}

export function DashboardView({ onNavigate }: { onNavigate: (view: View) => void }) {
  const { data: jobs, isLoading } = useJobs(true);
  const { state } = useLicense();
  const [playwrightMissing, setPlaywrightMissing] = useState(false);

  useEffect(() => {
    api
      .checkPlaywrightInstalled()
      .then((installed) => setPlaywrightMissing(!installed))
      .catch(() => {});
  }, []);

  const total = jobs?.length ?? 0;
  const completed = jobs?.filter((j) => j.status === "completed").length ?? 0;
  const running = jobs?.filter((j) => j.status === "running" || j.status === "pending").length ?? 0;
  const recent = (jobs ?? []).slice(0, 5);

  const email = state.status === "authenticated" ? state.license.email : "";

  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-4xl px-6 py-6">
        {/* Greeting */}
        <div className="mb-6 flex items-end justify-between">
          <div>
            <h1 className="text-xl font-bold tracking-tight">Dashboard</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {email ? `Signed in as ${email}` : "Welcome back"}
            </p>
          </div>
          <Button onClick={() => onNavigate("map")}>
            <MapPin />
            New Scrape
          </Button>
        </div>

        {/* Playwright warning */}
        {playwrightMissing && (
          <div className="mb-5 flex items-center gap-3 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3">
            <AlertTriangle className="h-4 w-4 shrink-0 text-warning" />
            <p className="flex-1 text-xs text-foreground/80">
              Playwright browsers not detected. Install them now to avoid a delay on your first scrape.
            </p>
            <Button variant="outline" size="sm" onClick={() => onNavigate("settings")}>
              Install
            </Button>
          </div>
        )}

        {/* Stats */}
        <div className="mb-6 grid grid-cols-3 gap-4">
          <StatCard
            label="Total Jobs"
            value={total}
            icon={<ClipboardList className="h-4.5 w-4.5" />}
            accent="bg-muted text-foreground"
          />
          <StatCard
            label="Completed"
            value={completed}
            icon={<CheckCircle2 className="h-4.5 w-4.5" />}
            accent="bg-success/15 text-success"
          />
          <StatCard
            label="Running"
            value={running}
            icon={<PlayCircle className="h-4.5 w-4.5" />}
            accent="bg-warning/15 text-warning"
          />
        </div>

        {/* Recent jobs */}
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Recent Jobs</h2>
          <Button variant="ghost" size="sm" onClick={() => onNavigate("jobs")} className="text-xs">
            View all
          </Button>
        </div>

        {isLoading ? (
          <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
            <Loader2 className="mr-2 animate-spin" />
            Loading…
          </div>
        ) : recent.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-10 text-center">
              <MapPin className="mb-2 h-6 w-6 text-muted-foreground" />
              <p className="text-sm font-medium">No scrapes yet</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Pick a location on the map and start extracting data.
              </p>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="divide-y p-0">
              {recent.map((job) => (
                <div key={job.id} className="flex items-center justify-between px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{job.name || "Untitled"}</p>
                    <p className="text-xs text-muted-foreground">{relativeTime(job.date)}</p>
                  </div>
                  <Badge
                    variant={
                      job.status === "completed"
                        ? "success"
                        : job.status === "running" || job.status === "pending"
                          ? "warning"
                          : job.status === "failed" || job.status === "error"
                            ? "destructive"
                            : job.status === "cancelled"
                              ? "outline"
                              : "secondary"
                    }
                  >
                    {job.status}
                  </Badge>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
