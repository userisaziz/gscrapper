import path from "path";
import fs from "fs";
import { app } from "electron";

/**
 * Point Playwright at the Chromium headless-shell bundled inside the packaged
 * app, so scraping works out-of-the-box with no separate browser download and
 * no Node.js on the user's machine.
 *
 * Playwright reads PLAYWRIGHT_BROWSERS_PATH when it resolves the executable,
 * so this MUST run before any module requires "playwright". Import this file
 * first in the main entry (see index.ts).
 *
 * In development the bundled folder does not exist under resourcesPath, so this
 * is a no-op and Playwright falls back to its normal user cache (~/.cache or
 * ~/Library/Caches/ms-playwright).
 */
if (app.isPackaged) {
  const bundled = path.join(process.resourcesPath, "playwright-browsers");
  if (fs.existsSync(bundled)) {
    process.env.PLAYWRIGHT_BROWSERS_PATH = bundled;
  }
}

export {};
