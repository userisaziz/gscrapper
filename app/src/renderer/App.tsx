import { Loader2, MapPin } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { AppSidebar } from "@/components/app-sidebar";
import { LicenseProvider, useLicense } from "@/hooks/use-license";
import { useGlobalEvents } from "@/hooks/use-wails-events";
import type { View } from "@/lib/navigation";
import { DashboardView } from "@/views/dashboard-view";
import { JobsView } from "@/views/jobs-view";
import { LoginView } from "@/views/login-view";
import { MapView } from "@/views/map-view";
import { SettingsView } from "@/views/settings-view";

function SplashScreen() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3">
      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
        <MapPin className="h-6 w-6" />
      </div>
      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
    </div>
  );
}

function Shell() {
  const [view, setView] = useState<View>("dashboard");
  const isMac = useMemo(
    () => /Mac|iP(hone|ad|od)/.test(navigator.platform),
    []
  );

  // Flag the platform so CSS can compensate for macOS traffic lights.
  useEffect(() => {
    if (isMac) document.documentElement.classList.add("platform-mac");
  }, [isMac]);

  return (
    <div className="flex h-full overflow-hidden">
      <AppSidebar active={view} onNavigate={setView} />
      <main className="min-w-0 flex-1 overflow-hidden">
        {view === "dashboard" && <DashboardView onNavigate={setView} />}
        {view === "map" && <MapView onNavigate={setView} />}
        {view === "jobs" && <JobsView onNavigate={setView} />}
        {view === "settings" && <SettingsView />}
      </main>
    </div>
  );
}

function Gate() {
  const { state } = useLicense();
  useGlobalEvents();

  if (state.status === "checking") return <SplashScreen />;
  if (state.status === "unauthenticated") return <LoginView />;
  return <Shell />;
}

export default function App() {
  return (
    <LicenseProvider>
      <Gate />
    </LicenseProvider>
  );
}
