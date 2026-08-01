import { contextBridge, ipcRenderer } from "electron";

export interface ApiInterface {
  login(email: string, password: string): Promise<any>;
  logout(): Promise<void>;
  checkLicense(): Promise<any>;
  getLicenseStatus(): Promise<any>;
  startScrape(req: any): Promise<any>;
  getJobs(): Promise<any[]>;
  deleteJob(id: string): Promise<void>;
  getResults(id: string): Promise<any>;
  exportResults(id: string): Promise<string>;
  checkPlaywrightInstalled(): Promise<boolean>;
  installPlaywright(): Promise<void>;
  openDataFolder(): Promise<void>;
  getAppInfo(): Promise<Record<string, string>>;
  getSelectorHealth(): Promise<any[]>;
  getReviewStats(placeRef?: string): Promise<any>;
  onEvent(event: string, callback: (...args: any[]) => void): () => void;
}

const api: ApiInterface = {
  login: (email, password) => ipcRenderer.invoke("license:login", email, password),
  logout: () => ipcRenderer.invoke("license:logout"),
  checkLicense: () => ipcRenderer.invoke("license:check"),
  getLicenseStatus: () => ipcRenderer.invoke("license:status"),

  startScrape: (req) => ipcRenderer.invoke("scrape:start", req),
  getJobs: () => ipcRenderer.invoke("scrape:jobs"),
  deleteJob: (id) => ipcRenderer.invoke("scrape:delete", id),
  getResults: (id) => ipcRenderer.invoke("scrape:results", id),
  exportResults: (id) => ipcRenderer.invoke("scrape:export", id),

  checkPlaywrightInstalled: () => ipcRenderer.invoke("playwright:check"),
  installPlaywright: () => ipcRenderer.invoke("playwright:install"),

  openDataFolder: () => ipcRenderer.invoke("app:openDataFolder"),
  getAppInfo: () => ipcRenderer.invoke("app:info"),

  getSelectorHealth: () => ipcRenderer.invoke("telemetry:stats"),
  getReviewStats: (placeRef) => ipcRenderer.invoke("reviews:stats", placeRef),

  onEvent: (event, callback) => {
    const handler = (_e: any, ...args: any[]) => callback(...args);
    ipcRenderer.on(event, handler);
    return () => {
      ipcRenderer.removeListener(event, handler);
    };
  },
};

contextBridge.exposeInMainWorld("api", api);
