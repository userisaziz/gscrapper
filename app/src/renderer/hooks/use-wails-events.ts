import { useEffect } from "react";
import { toast } from "sonner";
import { onEvent, type ProxyHealthInfo } from "@/lib/wails";

/**
 * Global Wails event listeners: scrape errors and Playwright install
 * lifecycle. Proxy health is handled locally in the map config panel.
 */
export function useGlobalEvents() {
  useEffect(() => {
    const unsubs = [
      onEvent("scrape:error", (msg) => {
        toast.error(String(msg ?? "Scrape error"));
      }),
      onEvent("playwright:installing", () => {
        toast.info("Installing Playwright browsers…", { duration: Infinity, id: "pw-install" });
      }),
      onEvent("playwright:installed", () => {
        toast.success("Playwright browsers installed", { id: "pw-install" });
      }),
    ];
    return () => unsubs.forEach((fn) => fn());
  }, []);
}

/** Subscribe to proxy health-check results emitted during a run. */
export function useProxyHealth(onHealth: (info: ProxyHealthInfo) => void) {
  useEffect(() => {
    return onEvent("proxy:health", (info) => {
      if (info && typeof info === "object") {
        onHealth(info as ProxyHealthInfo);
      }
    });
  }, [onHealth]);
}
