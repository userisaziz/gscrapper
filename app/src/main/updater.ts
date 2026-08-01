/**
 * Auto-updater via electron-updater.
 * Checks for updates on launch and every 4 hours.
 * Downloads in background and prompts user to restart.
 */
import { app } from "electron";
import { autoUpdater } from "electron-updater";
import { moduleLogger } from "./logger";

const log = moduleLogger("updater");

const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours

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
  });

  autoUpdater.on("update-available", (info) => {
    log.info(`Update available: v${info.version}`);
  });

  autoUpdater.on("update-not-available", () => {
    log.info("No updates available");
  });

  autoUpdater.on("download-progress", (progress) => {
    log.debug(`Download progress: ${progress.percent.toFixed(1)}%`);
  });

  autoUpdater.on("update-downloaded", (info) => {
    log.info(`Update downloaded: v${info.version} — will install on quit`);
  });

  autoUpdater.on("error", (err) => {
    log.warn("Auto-updater error:", err.message);
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
