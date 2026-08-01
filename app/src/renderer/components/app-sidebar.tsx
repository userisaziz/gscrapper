import {
  ClipboardList,
  LayoutDashboard,
  LogOut,
  Map as MapIcon,
  MapPin,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
} from "lucide-react";
import { useState } from "react";
import { LicenseBadge } from "@/components/license-badge";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { useLicense } from "@/hooks/use-license";
import type { View } from "@/lib/navigation";
import { cn } from "@/lib/utils";

const NAV_ITEMS: { view: View; label: string; icon: typeof MapIcon }[] = [
  { view: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { view: "map", label: "New Scrape", icon: MapIcon },
  { view: "jobs", label: "Jobs", icon: ClipboardList },
  { view: "settings", label: "Settings", icon: Settings },
];

interface AppSidebarProps {
  active: View;
  onNavigate: (view: View) => void;
}

export function AppSidebar({ active, onNavigate }: AppSidebarProps) {
  const [collapsed, setCollapsed] = useState(false);
  const { logout } = useLicense();

  const handleLogout = async () => {
    if (window.confirm("Logout?")) await logout();
  };

  return (
    <aside
      className={cn(
        "flex h-full flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] duration-200",
        collapsed ? "w-14" : "w-52"
      )}
    >
      {/* Logo / brand */}
      <div className={cn("mac-drag-region flex items-center gap-2.5 px-3 py-4", collapsed && "justify-center px-0")}>
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <MapPin className="h-4.5 w-4.5" />
        </div>
        {!collapsed && (
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-sm font-semibold">Maps Scraper</span>
            <span className="rounded bg-primary px-1 py-px text-[9px] font-bold tracking-wider text-primary-foreground">
              PRO
            </span>
          </div>
        )}
      </div>

      <Separator />

      {/* Navigation */}
      <nav className="flex-1 space-y-1 overflow-y-auto px-2 py-3">
        {NAV_ITEMS.map(({ view, label, icon: Icon }) => (
          <button
            key={view}
            onClick={() => onNavigate(view)}
            title={collapsed ? label : undefined}
            className={cn(
              "flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-sm font-medium transition-colors cursor-pointer",
              collapsed && "justify-center px-0",
              active === view
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
            )}
          >
            <Icon className="h-4.5 w-4.5 shrink-0" />
            {!collapsed && <span className="truncate">{label}</span>}
          </button>
        ))}
      </nav>

      {/* Footer */}
      <div className="space-y-2 px-2 pb-3">
        <Separator />
        {!collapsed && (
          <div className="flex items-center justify-between px-1">
            <LicenseBadge />
            <ThemeToggle />
          </div>
        )}
        {collapsed && (
          <div className="flex justify-center">
            <ThemeToggle />
          </div>
        )}
        <div className={cn("flex items-center", collapsed && "justify-center")}>
          <Button
            variant="ghost"
            size={collapsed ? "icon" : "sm"}
            onClick={handleLogout}
            className={cn(
              "text-muted-foreground hover:text-destructive",
              !collapsed && "w-full justify-start gap-3 px-2.5"
            )}
            title="Logout"
          >
            <LogOut className="h-4 w-4" />
            {!collapsed && <span>Logout</span>}
          </Button>
        </div>
        <div className={cn("flex", collapsed && "justify-center")}>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setCollapsed((c) => !c)}
            className="h-7 w-7 text-muted-foreground"
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          </Button>
        </div>
      </div>
    </aside>
  );
}
