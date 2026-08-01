// MUST be first: points Playwright at the bundled browser before any module
// (ipc -> engine -> playwright) loads the "playwright" package.
import "./playwright-env";
import { app, BrowserWindow, session, shell } from "electron";
import path from "path";
import { registerIpcHandlers } from "./ipc";
import { moduleLogger } from "./logger";
import { initAutoUpdater } from "./updater";

const log = moduleLogger("main");

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: "Google Maps Scraper",
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // Required for better-sqlite3 native module
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  });

  // Content Security Policy
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://*.tile.openstreetmap.org; connect-src 'self' https://nominatim.openstreetmap.org https://*.supabase.co; font-src 'self' data:",
        ],
      },
    });
  });

  // Open external links in default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  // Load the app
  if (process.env.NODE_ENV === "development" || !app.isPackaged) {
    mainWindow.loadURL("http://localhost:5173");
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// Enforce a single running instance. A second launch quits immediately after
// focusing the existing window. Without this, two instances would share the
// same SQLite jobs database and per-job CSV files, and their concurrent
// writes would corrupt both.
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    // Someone launched a second instance — surface the existing window.
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    log.info(`App starting: v${app.getVersion()} (${process.platform}/${process.arch})`);
    registerIpcHandlers(() => mainWindow);
    createWindow();
    initAutoUpdater();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });
}
