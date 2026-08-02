/**
 * Auto-updater via electron-updater.
 * Checks for updates on launch and every 4 hours.
 * Downloads in background and prompts user to restart.
 * Also exposes a manual checkForUpdate() for the Settings UI.
 */
import { app } from "electron";
import { autoUpdater } from "electron-updater";
import { moduleLogger } from "./logger";

const log = moduleLogger("updater");

const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours

export type UpdateStatus =
  | { status: "checking" }
  | { status: "available"; version: string }
  | { status: "not-available" }
  | { status: "downloading"; percent: number }
  | { status: "downloaded"; version: string }
  | { status: "error"; message: string };

type StatusCallback = (s: UpdateStatus) => void;
let onStatus: StatusCallback | null = null;

export function setUpdateStatusCallback(cb: StatusCallback): void {
  onStatus = cb;
}

function emitStatus(s: UpdateStatus): void {
  onStatus?.(s);
}

export function initAutoUpdater(): void {
  // Skip in development
  if (!app.isPackaged) {
    log.info("Auto-updater disabled in development");
    return;
  }

  autoUpdater.logger = log;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("checking-for-update", () => {
    log.info("Checking for updates…");
    emitStatus({ status: "checking" });
  });

  autoUpdater.on("update-available", (info) => {
    log.info(`Update available: v${info.version}`);
    emitStatus({ status: "available", version: info.version });
  });

  autoUpdater.on("update-not-available", () => {
    log.info("No updates available");
    emitStatus({ status: "not-available" });
  });

  autoUpdater.on("download-progress", (progress) => {
    log.debug(`Download progress: ${progress.percent.toFixed(1)}%`);
    emitStatus({ status: "downloading", percent: progress.percent });
  });

  autoUpdater.on("update-downloaded", (info) => {
    log.info(`Update downloaded: v${info.version} — will install on quit`);
    emitStatus({ status: "downloaded", version: info.version });
  });

  autoUpdater.on("error", (err) => {
    log.warn("Auto-updater error:", err.message);
    emitStatus({ status: "error", message: err.message });
  });

  // Initial check (delayed to avoid startup contention)
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((err) => {
      log.warn("Update check failed:", err.message);
    });
  }, 10_000);

  // Periodic checks
  setInterval(() => {
    autoUpdater.checkForUpdates().catch(() => {});
  }, CHECK_INTERVAL_MS);
}

/**
 * Manual update check triggered from the Settings UI.
 * Returns immediately; progress is reported via the status callback.
 */
export async function checkForUpdateManual(): Promise<{ triggered: boolean }> {
  if (!app.isPackaged) {
    return { triggered: false };
  }
  try {
    await autoUpdater.checkForUpdates();
    return { triggered: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Update check failed";
    emitStatus({ status: "error", message: msg });
    return { triggered: false };
  }
}

/** Install the downloaded update immediately (quit & install). */
export function quitAndInstall(): void {
  autoUpdater.quitAndInstall();
}
