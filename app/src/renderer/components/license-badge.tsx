import { Badge } from "@/components/ui/badge";
import { useLicense } from "@/hooks/use-license";
import type { LicenseResponse } from "@/lib/wails";
import { cn } from "@/lib/utils";

export function LicenseBadge({ compact = false }: { compact?: boolean }) {
  const { state } = useLicense();
  if (state.status !== "authenticated") return null;
  return <LicenseBadgeInner license={state.license} compact={compact} />;
}

function LicenseBadgeInner({
  license,
  compact,
}: {
  license: LicenseResponse;
  compact?: boolean;
}) {
  const days = license.days_left;
  const variant = days <= 3 ? "destructive" : days <= 7 ? "warning" : "success";
  const label = days <= 3 ? `${days}d!` : `${days}d left`;

  return (
    <Badge
      variant={variant}
      className={cn("tabular-nums", compact && "px-1.5 text-[10px]")}
      title={`${license.plan} · expires ${license.expires_at} · ${license.email}`}
    >
      {label}
    </Badge>
  );
}
