/**
 * Structured logging via electron-log.
 * Logs to file (~/Library/Logs/gmaps-scraper/main.log) and console.
 * Provides child loggers per module for traceability.
 */
import log from "electron-log/main";

// Configure file transport
log.transports.file.fileName = "main.log";
log.transports.file.maxSize = 5 * 1024 * 1024; // 5 MB rotation
log.transports.console.level = "debug";
log.transports.file.level = "info";

// Catch unhandled errors
log.errorHandler.startCatching({
  showDialog: false,
  onError({ error }) {
    log.error("Unhandled error:", error);
  },
});

export const logger = log;

/** Create a scoped child logger for a module. */
export function moduleLogger(module: string) {
  return log.scope(module);
}
