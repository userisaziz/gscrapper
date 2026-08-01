/**
 * Typed wrapper around the Electron preload API (window.api).
 * All frontend→main communication flows through this module.
 * Drop-in replacement for the Wails bindings.
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export interface LicenseResponse {
  valid: boolean;
  email: string;
  plan: string;
  expires_at: string;
  days_left: number;
  error?: string;
}

export interface JobData {
  keywords: string[];
  lang: string;
  zoom: number;
  lat: string;
  lon: string;
  depth: number;
  email: boolean;
  fast_mode: boolean;
  radius: number;
  max_time: number;
  proxies: string[];
  delay: number;
  /** Strategy preset the job was started with (absent for legacy jobs). */
  strategy?: string;
  monitor_reviews?: boolean;
  reviews_after?: string;
  reviews_before?: string;
}

export interface Job {
  id: string;
  name: string;
  date: string;
  status: string;
  data: JobData;
}

export interface ResultsTable {
  columns: string[];
  rows: string[][];
  total: number;
}

export interface ScrapeRequest {
  name: string;
  keywords: string;
  lang: string;
  zoom: number;
  lat: string;
  lon: string;
  depth: number;
  email: boolean;
  fast_mode: boolean;
  radius: number;
  max_time: string;
  proxies: string;
  delay: number;
  strategy: string;
  monitor_reviews: boolean;
  reviews_after?: string;
  reviews_before?: string;
}

export interface ProxyHealthInfo {
  total: number;
  healthy: number;
}

export interface SelectorStat {
  selector: string;
  hits: number;
  misses: number;
  last_seen: string;
  /** misses / (hits + misses), 0–1. */
  miss_rate: number;
}

export interface ReviewStats {
  total: number;
  by_status: Record<string, number>;
  by_rating: Record<string, number>;
}

// ─── Electron API accessor ──────────────────────────────────────────────────

/**
 * Resolve the real Electron preload bridge. Rejects immediately if the
 * preload script did not expose window.api (i.e. not running inside Electron).
 */
function callApi<T>(fn: (api: any) => T): Promise<T> {
  const electronApi = (window as any).api;
  if (!electronApi) {
    return Promise.reject(
      new Error(
        "Electron preload bridge not found (window.api is undefined). " +
          "This app must run inside the Electron shell — start it with `npm run dev`."
      )
    );
  }
  return Promise.resolve(fn(electronApi));
}

// ─── API ────────────────────────────────────────────────────────────────────

export const api = {
  checkLicense: (): Promise<LicenseResponse> => callApi((a) => a.checkLicense()),
  getLicenseStatus: (): Promise<LicenseResponse> => callApi((a) => a.getLicenseStatus()),
  login: (email: string, password: string): Promise<LicenseResponse> =>
    callApi((a) => a.login(email, password)),
  logout: (): Promise<void> => callApi((a) => a.logout()),

  startScrape: (req: ScrapeRequest): Promise<Job> => callApi((a) => a.startScrape(req)),
  getJobs: (): Promise<Job[]> => callApi((a) => a.getJobs()),
  deleteJob: (id: string): Promise<void> => callApi((a) => a.deleteJob(id)),
  getResults: (jobId: string): Promise<ResultsTable> => callApi((a) => a.getResults(jobId)),
  exportResults: (jobId: string): Promise<string> => callApi((a) => a.exportResults(jobId)),

  openDataFolder: (): Promise<void> => callApi((a) => a.openDataFolder()),
  getAppInfo: (): Promise<Record<string, string>> => callApi((a) => a.getAppInfo()),

  checkPlaywrightInstalled: (): Promise<boolean> => callApi((a) => a.checkPlaywrightInstalled()),
  installPlaywright: (): Promise<void> => callApi((a) => a.installPlaywright()),

  getSelectorHealth: (): Promise<SelectorStat[]> => callApi((a) => a.getSelectorHealth()),
  getReviewStats: (placeRef?: string): Promise<ReviewStats> =>
    callApi((a) => a.getReviewStats(placeRef)),
};

// ─── Events ─────────────────────────────────────────────────────────────────

export type WailsEvent =
  | "job:status"
  | "job:completed"
  | "job:cancelled"
  | "playwright:installing"
  | "playwright:installed"
  | "scrape:error"
  | "scrape:progress"
  | "scrape:entry"
  | "proxy:health"
  | "scrape:blocked"
  | "reviews:synced"
  | "license:expired";

/**
 * Subscribe to an Electron IPC event. Returns an unsubscribe function.
 * No-ops if the preload bridge is unavailable (e.g. HMR-only browser tab).
 */
export function onEvent(
  event: WailsEvent,
  callback: (...data: unknown[]) => void
): () => void {
  const electronApi = (window as any).api;
  if (!electronApi || typeof electronApi.onEvent !== "function") {
    return () => {};
  }
  return electronApi.onEvent(event, callback);
}
