import path from "path";
import { deviceName, hardwareId } from "./hardware";
import { clearLicenseCache, LicenseState, loadLicenseCache, saveLicenseCache } from "./crypto";

export interface LicenseManagerConfig {
  supabaseUrl: string;
  anonKey: string;
  cacheDir: string;
  gracePeriodMs: number;
}

export class LicenseManager {
  private supabaseUrl: string;
  private anonKey: string;
  private cachePath: string;
  private gracePeriodMs: number;
  private hwId: string;

  constructor(cfg: LicenseManagerConfig) {
    this.supabaseUrl = cfg.supabaseUrl;
    this.anonKey = cfg.anonKey;
    this.cachePath = path.join(cfg.cacheDir, "license.enc");
    this.gracePeriodMs = cfg.gracePeriodMs || 7 * 24 * 60 * 60 * 1000;
    this.hwId = hardwareId();
  }

  async login(email: string, password: string): Promise<LicenseState> {
    // Step 1: Authenticate with Supabase
    const { accessToken, refreshToken } = await this.supabaseSignIn(email, password);

    // Step 2: Validate license with Edge Function
    const state = await this.validateOnline(accessToken, email);
    state.refreshToken = refreshToken;

    // Step 3: Cache
    try {
      saveLicenseCache(state, this.cachePath);
    } catch { /* non-fatal */ }

    return state;
  }

  async validate(): Promise<LicenseState> {
    const cached = loadLicenseCache(this.cachePath);
    if (!cached || !cached.valid) {
      throw new Error("No valid license found, please login");
    }

    const now = Date.now();

    // Subscription expired
    if (cached.expiresAt.getTime() < now) {
      clearLicenseCache(this.cachePath);
      throw new Error(`Subscription expired on ${cached.expiresAt.toISOString().split("T")[0]}`);
    }

    // Within grace period
    if (cached.cachedAt.getTime() > now - this.gracePeriodMs) {
      return cached;
    }

    // Grace period elapsed — online re-validation mandatory
    if (!cached.refreshToken) {
      throw new Error("Offline grace period elapsed, please login again");
    }

    const { accessToken, refreshToken } = await this.refreshAccessToken(cached.refreshToken);
    const state = await this.validateOnline(accessToken, cached.email);
    state.refreshToken = refreshToken;

    try {
      saveLicenseCache(state, this.cachePath);
    } catch { /* non-fatal */ }

    return state;
  }

  logout(): void {
    clearLicenseCache(this.cachePath);
  }

  isLicensed(): boolean {
    try {
      const cached = loadLicenseCache(this.cachePath);
      if (!cached || !cached.valid) return false;
      return cached.expiresAt.getTime() > Date.now();
    } catch {
      return false;
    }
  }

  getCachedState(): LicenseState {
    const cached = loadLicenseCache(this.cachePath);
    if (!cached) {
      return {
        valid: false, email: "", plan: "",
        expiresAt: new Date(0), hardwareId: "", cachedAt: new Date(0), refreshToken: "",
      };
    }
    return cached;
  }

  // ─── Private ────────────────────────────────────────────────────────────────

  private async supabaseSignIn(email: string, password: string): Promise<{ accessToken: string; refreshToken: string }> {
    const url = `${this.supabaseUrl}/auth/v1/token?grant_type=password`;
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: this.anonKey },
      body: JSON.stringify({ email, password }),
    });

    const body = await resp.json() as any;
    if (!resp.ok) {
      const msg = body.msg || body.error_description || "Invalid credentials";
      throw new Error(msg);
    }
    if (!body.access_token) throw new Error("No access token in response");
    return { accessToken: body.access_token, refreshToken: body.refresh_token || "" };
  }

  private async refreshAccessToken(refreshToken: string): Promise<{ accessToken: string; refreshToken: string }> {
    const url = `${this.supabaseUrl}/auth/v1/token?grant_type=refresh_token`;
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: this.anonKey },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });

    if (!resp.ok) throw new Error(`Token refresh failed with status ${resp.status}`);
    const body = await resp.json() as any;
    if (!body.access_token) throw new Error("No access token in refresh response");
    return { accessToken: body.access_token, refreshToken: body.refresh_token || "" };
  }

  private async validateOnline(accessToken: string, email: string): Promise<LicenseState> {
    const url = `${this.supabaseUrl}/functions/v1/validate-license`;
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: this.anonKey,
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ hardware_id: this.hwId, device_name: deviceName() }),
    });

    const result = await resp.json() as any;

    if (!result.valid) {
      const reasons: Record<string, string> = {
        no_subscription: "No active subscription found, please contact support",
        subscription_expired: "Your subscription has expired, please renew",
        subscription_revoked: "Your subscription has been revoked, please contact support",
        max_devices_reached: "Maximum device limit reached, please contact support",
        invalid_token: "Session expired, please login again",
      };
      throw new Error(reasons[result.reason] || "License validation failed");
    }

    let expiresAt: Date;
    try {
      expiresAt = new Date(result.expires_at);
    } catch {
      expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    }

    return {
      valid: true,
      email: result.email || email,
      plan: result.plan || "pro",
      expiresAt,
      hardwareId: this.hwId,
      cachedAt: new Date(),
      refreshToken: "",
    };
  }
}
