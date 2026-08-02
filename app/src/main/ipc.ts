import { BrowserWindow, dialog, ipcMain, shell } from "electron";
import fs from "fs";
import os from "os";
import path from "path";
import { BUILD_SUPABASE_URL, BUILD_SUPABASE_ANON_KEY } from "./build-config";
import { LicenseManager } from "./license/manager";
import { ScraperEngine } from "./scraper/engine";
import { applyStrategy, isStrategy } from "./scraper/strategy";
import { SelectorTelemetry } from "./scraper/telemetry";
import { JobStore } from "./store/jobs";
import { ReviewStore } from "./store/reviews";
import { ScrapeStartSchema, LoginSchema, JobIdSchema, parseDuration } from "./schemas";
import { moduleLogger } from "./logger";

const log = moduleLogger("ipc");

const DATA_DIR = path.join(os.homedir(), ".gmaps-scraper");
const DATA_FOLDER = path.join(DATA_DIR, "data");
const DB_PATH = path.join(DATA_DIR, "jobs.db");
const TELEMETRY_DB_PATH = path.join(DATA_DIR, "telemetry.db");
const REVIEWS_DB_PATH = path.join(DATA_DIR, "reviews.db");

let licenseMgr: LicenseManager | null = null;
let jobStore: JobStore | null = null;
let telemetry: SelectorTelemetry | null = null;
let reviewStore: ReviewStore | null = null;
let engine: ScraperEngine | null = null;
let licensed = false;

function ensureDirs(): void {
  fs.mkdirSync(DATA_FOLDER, { recursive: true });
}

function emit(win: BrowserWindow | null, channel: string, data?: unknown): void {
  if (win && !win.isDestroyed()) {
    win.webContents.send(channel, data);
  }
}

export function registerIpcHandlers(getWindow: () => BrowserWindow | null): void {
  ensureDirs();

  // Initialize services
  jobStore = new JobStore(DB_PATH);
  telemetry = new SelectorTelemetry(TELEMETRY_DB_PATH);
  reviewStore = new ReviewStore(REVIEWS_DB_PATH);
  // Jobs left pending/running from a previous session will never finish —
  // mark them failed so the list doesn't show stale "pending" rows forever.
  jobStore.resetStaleJobs();
  engine = new ScraperEngine(
    DATA_FOLDER,
    (channel, data) => {
      emit(getWindow(), channel, data);
    },
    jobStore,
    telemetry,
    reviewStore
  );

  // Resolve Supabase config: runtime env vars override build-time embedded values.
  const sbUrl = process.env.GMAPS_SUPABASE_URL || BUILD_SUPABASE_URL;
  const sbKey = process.env.GMAPS_SUPABASE_ANON_KEY || BUILD_SUPABASE_ANON_KEY;

  if (sbUrl && sbKey) {
    licenseMgr = new LicenseManager({
      supabaseUrl: sbUrl,
      anonKey: sbKey,
      cacheDir: DATA_DIR,
      gracePeriodMs: 7 * 24 * 60 * 60 * 1000,
    });
    licensed = licenseMgr.isLicensed();
  }

  // ─── License ────────────────────────────────────────────────────────────────

  ipcMain.handle("license:login", async (_e, email: string, password: string) => {
    if (!licenseMgr) return { valid: false, error: "License system not configured" };
    const parsed = LoginSchema.safeParse({ email, password });
    if (!parsed.success) return { valid: false, error: parsed.error.issues[0]?.message || "Invalid input" };
    try {
      const state = await licenseMgr.login(parsed.data.email, parsed.data.password);
      licensed = true;
      const daysLeft = Math.floor((state.expiresAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
      log.info(`License login success: ${state.email}`);
      return {
        valid: true,
        email: state.email,
        plan: state.plan,
        expires_at: state.expiresAt.toISOString().split("T")[0],
        days_left: daysLeft,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Login failed";
      log.warn(`License login failed: ${msg}`);
      return { valid: false, error: msg };
    }
  });

  ipcMain.handle("license:check", async () => {
    if (!licenseMgr) return { valid: false, error: "License system not configured" };
    try {
      const state = await licenseMgr.validate();
      licensed = state.valid;
      const daysLeft = Math.floor((state.expiresAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
      return {
        valid: state.valid,
        email: state.email,
        plan: state.plan,
        expires_at: state.expiresAt.toISOString().split("T")[0],
        days_left: daysLeft,
      };
    } catch (err: unknown) {
      licensed = false;
      const msg = err instanceof Error ? err.message : "Validation failed";
      return { valid: false, error: msg };
    }
  });

  ipcMain.handle("license:status", () => {
    if (!licenseMgr) return { valid: false };
    const state = licenseMgr.getCachedState();
    const daysLeft = Math.max(0, Math.floor((state.expiresAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000)));
    return {
      valid: state.valid && state.expiresAt.getTime() > Date.now(),
      email: state.email,
      plan: state.plan,
      expires_at: state.expiresAt.toISOString().split("T")[0],
      days_left: daysLeft,
    };
  });

  ipcMain.handle("license:logout", () => {
    licensed = false;
    if (licenseMgr) licenseMgr.logout();
  });

  // ─── Scraping ───────────────────────────────────────────────────────────────

  ipcMain.handle("scrape:start", async (_e, req) => {
    if (!licensed) throw new Error("Active subscription required, please login");
    if (!engine || !jobStore) throw new Error("Service not initialized");

    const parsed = ScrapeStartSchema.safeParse(req);
    if (!parsed.success) {
      const msg = parsed.error.issues.map((i) => i.message).join("; ");
      throw new Error(msg);
    }
    const input = parsed.data;

    const keywords = input.keywords.split("\n").map((k) => k.trim()).filter(Boolean);
    if (keywords.length === 0) throw new Error("At least one keyword is required");

    const maxTimeSec = parseDuration(input.max_time);
    if (maxTimeSec < 180) throw new Error("Max time must be at least 3m");

    const proxies = input.proxies.split("\n").map((p) => p.trim()).filter(Boolean);

    // Resolve the strategy preset against the user's base settings. The
    // preset overrides zoom/depth/fast_mode and scales the radius; unknown
    // strategy values fall back to "standard" (schema already defaults it).
    const strategy = isStrategy(input.strategy) ? input.strategy : "standard";
    const resolved = applyStrategy(strategy, {
      zoom: input.zoom,
      depth: input.depth,
      radius: input.radius,
      fastMode: input.fast_mode,
    });

    // Fail fast with a clear, actionable message if the browser is missing,
    // instead of creating a job that is guaranteed to crash on launch.
    if (!engine.isBrowserReady()) {
      throw new Error(
        "Playwright browsers are not installed. Open Settings → Playwright Browsers and click Install Now, then try again."
      );
    }

    const jobId = crypto.randomUUID();
    const job = {
      id: jobId,
      name: input.name,
      date: new Date().toISOString(),
      status: "pending",
      data: {
        keywords,
        lang: input.lang,
        zoom: resolved.zoom,
        lat: input.lat,
        lon: input.lon,
        depth: resolved.depth,
        email: input.email,
        fast_mode: resolved.fastMode,
        radius: resolved.radius,
        max_time: maxTimeSec,
        proxies,
        delay: input.delay,
        strategy,
        monitor_reviews: input.monitor_reviews,
        reviews_after: input.reviews_after,
        reviews_before: input.reviews_before,
      },
    };

    jobStore.create(job);
    log.info(`Job ${jobId} created: "${job.name}" (${keywords.length} keywords)`);

    // Start scraping in background
    engine.run(job).catch((err) => {
      log.error(`Job ${jobId} unhandled error:`, err);
      emit(getWindow(), "scrape:error", err instanceof Error ? err.message : "Unknown error");
    });

    return job;
  });

  ipcMain.handle("scrape:jobs", () => {
    if (!jobStore) return [];
    return jobStore.all();
  });

  ipcMain.handle("scrape:delete", (_e, id: string) => {
    if (!jobStore) return;
    const parsed = JobIdSchema.safeParse(id);
    if (!parsed.success) throw new Error("Invalid job ID");
    if (engine) engine.cancel(id);
    jobStore.delete(id);
    // Remove CSV
    const csvPath = path.join(DATA_FOLDER, `${id}.csv`);
    if (fs.existsSync(csvPath)) fs.unlinkSync(csvPath);
    log.info(`Job ${id} deleted`);
  });

  ipcMain.handle("scrape:results", (_e, id: string) => {
    if (!licensed) throw new Error("Active subscription required, please login");
    const csvPath = path.join(DATA_FOLDER, `${id}.csv`);
    if (!fs.existsSync(csvPath)) throw new Error("No results found");

    const content = fs.readFileSync(csvPath, "utf-8");
    const lines = content.split("\n").filter(Boolean);
    if (lines.length === 0) return { columns: [], rows: [], total: 0 };

    const columns = parseCsvLine(lines[0]!);
    const rows = lines.slice(1).map(parseCsvLine);
    return { columns, rows, total: rows.length };
  });

  ipcMain.handle("scrape:export", async (_e, id: string) => {
    if (!licensed) throw new Error("Active subscription required, please login");
    const win = getWindow();
    if (!win) return "";

    const csvPath = path.join(DATA_FOLDER, `${id}.csv`);
    if (!fs.existsSync(csvPath)) throw new Error("No results found");

    const { filePath } = await dialog.showSaveDialog(win, {
      title: "Export Results",
      defaultPath: `results-${id.slice(0, 8)}.csv`,
      filters: [
        { name: "CSV Files", extensions: ["csv"] },
        { name: "All Files", extensions: ["*"] },
      ],
    });

    if (!filePath) return "";
    fs.copyFileSync(csvPath, filePath);
    return filePath;
  });

  // ─── Playwright ─────────────────────────────────────────────────────────────

  ipcMain.handle("playwright:check", () => {
    // Precise check: does the exact Chromium executable Playwright will
    // launch actually exist on disk?
    if (engine) return engine.isBrowserReady();
    return false;
  });

  ipcMain.handle("playwright:install", async () => {
    const win = getWindow();
    emit(win, "playwright:installing", null);
    try {
      const { execSync } = require("child_process");
      execSync("npx playwright install chromium", { stdio: "pipe", timeout: 300000 });
      emit(win, "playwright:installed", null);
      log.info("Playwright browsers installed");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      log.error(`Playwright install failed: ${msg}`);
      throw new Error(`Playwright install failed: ${msg}`);
    }
  });

  // ─── App ────────────────────────────────────────────────────────────────────

  ipcMain.handle("telemetry:stats", () => {
    if (!telemetry) return [];
    return telemetry.stats();
  });

  ipcMain.handle("reviews:stats", (_e, placeRef?: string) => {
    if (!reviewStore) return { total: 0, by_status: {}, by_rating: {} };
    return reviewStore.stats(placeRef);
  });

  ipcMain.handle("app:openDataFolder", () => {
    shell.openPath(DATA_FOLDER);
  });

  ipcMain.handle("app:info", () => {
    return { version: "2.0.1", dataFolder: DATA_FOLDER };
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        result.push(current);
        current = "";
      } else {
        current += ch;
      }
    }
  }
  result.push(current);
  return result;
}
