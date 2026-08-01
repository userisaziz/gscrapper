import crypto from "crypto";
import fs from "fs";
import path from "path";
import { safeStorage } from "electron";
import { hardwareId } from "./hardware";

const PBKDF2_ITERATIONS = 100_000;
const FALLBACK_SECRET = "gmaps-scraper-license-v1-2f8a9c3e7b1d";

// First byte of the cache file identifies how the blob was sealed, so we can
// decrypt caches written by older builds and pick the right path on read.
const TAG_SAFE_STORAGE = 0x01; // sealed via Electron safeStorage (OS keychain)
const TAG_AES_GCM = 0x02; // sealed via AES-256-GCM with a PBKDF2-derived key

export interface LicenseState {
  valid: boolean;
  email: string;
  plan: string;
  expiresAt: Date;
  hardwareId: string;
  cachedAt: Date;
  refreshToken: string;
}

/**
 * Derive a STABLE AES key for the non-safeStorage fallback path (headless/CI).
 * PBKDF2 over a hardware-bound password is deterministic, so the same key is
 * produced on every run.
 *
 * NOTE: safeStorage.encryptString must NEVER be used as key material. It is an
 * encryption operation that embeds a random IV/salt on macOS (Keychain) and
 * Linux (libsecret), so it returns different bytes on every call — a key
 * derived from it cannot decrypt data sealed with a previous call. Instead we
 * use safeStorage to seal the whole blob directly (see saveLicenseCache).
 */
function deriveFallbackKey(hwId: string): Buffer {
  const salt = Buffer.from(FALLBACK_SECRET);
  const password = Buffer.from(`${hwId}:${FALLBACK_SECRET}`);
  return crypto.pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, 32, "sha256");
}

function encryptFallback(plaintext: Buffer, hwId: string): Buffer {
  const key = deriveFallbackKey(hwId);
  const iv = crypto.randomBytes(12); // GCM nonce
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Format: header (1) + iv (12) + tag (16) + ciphertext
  return Buffer.concat([Buffer.from([TAG_AES_GCM]), iv, tag, encrypted]);
}

function decryptFallback(data: Buffer, hwId: string): Buffer {
  const key = deriveFallbackKey(hwId);
  const iv = data.subarray(1, 13);
  const tag = data.subarray(13, 29);
  const ciphertext = data.subarray(29);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

/**
 * Decrypt a legacy (header-less) cache: iv (12) + tag (16) + ciphertext, keyed
 * by sha256(safeStorage.encryptString(hwId)). This scheme was broken on
 * macOS/Linux (non-deterministic key) but worked on Windows (DPAPI is
 * deterministic). We keep it only so existing Windows caches still load; the
 * next save re-seals them in the new tagged format.
 */
function decryptLegacy(data: Buffer, hwId: string): Buffer {
  let key: Buffer;
  if (safeStorage.isEncryptionAvailable()) {
    const masterKey = safeStorage.encryptString(hwId);
    key = crypto.createHash("sha256").update(masterKey).digest();
  } else {
    key = deriveFallbackKey(hwId);
  }
  const iv = data.subarray(0, 12);
  const tag = data.subarray(12, 28);
  const ciphertext = data.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

export function saveLicenseCache(state: LicenseState, cachePath: string): void {
  const json = JSON.stringify({
    ...state,
    expiresAt: state.expiresAt.toISOString(),
    cachedAt: state.cachedAt.toISOString(),
  });

  let sealed: Buffer;
  if (safeStorage.isEncryptionAvailable()) {
    // Preferred: let the OS keychain seal the blob. Decryption is reliable
    // because safeStorage.decryptString reverses encryptString on the same
    // machine, regardless of per-call randomness.
    sealed = Buffer.concat([
      Buffer.from([TAG_SAFE_STORAGE]),
      safeStorage.encryptString(json),
    ]);
  } else {
    sealed = encryptFallback(Buffer.from(json, "utf-8"), hardwareId());
  }

  fs.mkdirSync(path.dirname(cachePath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(cachePath, sealed, { mode: 0o600 });
}

export function loadLicenseCache(cachePath: string): LicenseState | null {
  try {
    const sealed = fs.readFileSync(cachePath);
    if (sealed.length < 1) return null;

    let json: string;
    const tag = sealed[0];
    if (tag === TAG_SAFE_STORAGE) {
      if (!safeStorage.isEncryptionAvailable()) return null;
      json = safeStorage.decryptString(sealed.subarray(1));
    } else if (tag === TAG_AES_GCM) {
      json = decryptFallback(sealed, hardwareId()).toString("utf-8");
    } else {
      // No recognized header — legacy format. Throws on macOS/Linux (expected,
      // those caches were never readable); succeeds on Windows.
      json = decryptLegacy(sealed, hardwareId()).toString("utf-8");
    }

    const raw = JSON.parse(json);
    return {
      ...raw,
      expiresAt: new Date(raw.expiresAt),
      cachedAt: new Date(raw.cachedAt),
    };
  } catch {
    return null;
  }
}

export function clearLicenseCache(cachePath: string): void {
  try {
    fs.unlinkSync(cachePath);
  } catch { /* ignore */ }
}
