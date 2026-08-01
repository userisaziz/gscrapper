import { useCallback, useState } from "react";
import { useProxyHealth } from "@/hooks/use-wails-events";
import type { ProxyHealthInfo } from "@/lib/wails";
import { cn } from "@/lib/utils";

interface ProxyIndicatorProps {
  proxyText: string;
}

/** Live proxy count / health status line shown under the proxy textarea. */
export function ProxyIndicator({ proxyText }: ProxyIndicatorProps) {
  const [health, setHealth] = useState<ProxyHealthInfo | null>(null);

  const count = proxyText
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean).length;

  const onHealth = useCallback((info: ProxyHealthInfo) => setHealth(info), []);
  useProxyHealth(onHealth);

  let text: string;
  let tone: "neutral" | "ok" | "warn" = "neutral";

  if (health && count > 0) {
    if (health.healthy === 0) {
      tone = "warn";
      text = `0/${health.total} proxies healthy — all failed the check.`;
    } else {
      tone = "ok";
      text = `${health.healthy}/${health.total} proxies healthy · dead proxies dropped for this run`;
    }
  } else if (count === 0) {
    text = "No proxies — scraping from your own IP.";
  } else {
    tone = "ok";
    text = `${count} prox${count === 1 ? "y" : "ies"} configured · rotated round-robin · health-checked before each run`;
  }

  return (
    <p
      className={cn(
        "mt-1.5 text-[11px] leading-snug",
        tone === "neutral" && "text-muted-foreground",
        tone === "ok" && "text-success",
        tone === "warn" && "text-destructive"
      )}
    >
      {text}
    </p>
  );
}
