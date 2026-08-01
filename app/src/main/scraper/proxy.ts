/**
 * Proxy utilities — health-checking and randomized pacing.
 * Ported from desktop/proxy.go.
 */

// ─── Proxy health-checking ───────────────────────────────────────────────────

/**
 * Test every proxy concurrently and return only the ones that can
 * successfully reach Google, preserving the original order.
 * Dead proxies are dropped so the scraper does not waste retries on them.
 */
export async function filterHealthyProxies(
  proxies: string[],
  timeoutMs = 12000
): Promise<string[]> {
  const results = await Promise.all(
    proxies.map((p) => proxyAlive(p, timeoutMs))
  );

  return proxies.filter((_p, i) => results[i]);
}

/**
 * Report whether a single proxy can reach Google. Performs a real request
 * through the proxy (lightweight generate_204 endpoint) so the result
 * reflects whether the proxy actually works for scraping.
 *
 * Uses dynamic import of http/https to avoid top-level import issues
 * in the Electron main process bundler.
 */
async function proxyAlive(rawProxy: string, timeoutMs: number): Promise<boolean> {
  const normalized = normalizeProxyForCheck(rawProxy);

  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    return false;
  }

  // Only http/https proxies supported for health-check
  if (!parsed.protocol.startsWith("http")) return false;

  try {
    const { default: httpMod } = await import("http");

    return await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        req.destroy();
        resolve(false);
      }, timeoutMs);

      // Make a request through the proxy to Google's lightweight endpoint
      const req = httpMod.request(
        {
          host: parsed.hostname,
          port: parseInt(parsed.port, 10) || 80,
          path: "http://www.google.com/generate_204",
          method: "GET",
          headers: { Host: "www.google.com" },
          timeout: timeoutMs,
        },
        (res: { statusCode?: number; resume: () => void }) => {
          clearTimeout(timer);
          res.resume();
          resolve((res.statusCode || 500) < 500);
        }
      );

      req.on("error", () => {
        clearTimeout(timer);
        resolve(false);
      });

      req.on("timeout", () => {
        req.destroy();
        clearTimeout(timer);
        resolve(false);
      });

      req.end();
    });
  } catch {
    return false;
  }
}

/**
 * Normalize a proxy URL for use with Node.js http/https.
 * socks5h:// (remote DNS) is treated as socks5://.
 */
function normalizeProxyForCheck(p: string): string {
  p = p.trim();
  if (p.startsWith("socks5h://")) {
    return "socks5://" + p.slice("socks5h://".length);
  }
  return p;
}

// ─── Proxy rotation ──────────────────────────────────────────────────────────

/**
 * Round-robin proxy rotator. Each call to `next()` returns the next proxy in
 * the list, cycling back to the start after the last one. This spreads
 * requests across multiple IPs so no single proxy is hammered.
 *
 * Returns `null` when constructed with an empty list (direct connection).
 */
export class ProxyRotator {
  private readonly proxies: string[];
  private index = 0;

  constructor(proxies: string[]) {
    this.proxies = proxies;
  }

  /** Return the next proxy server string, or null for direct connection. */
  next(): string | null {
    if (this.proxies.length === 0) return null;
    const proxy = this.proxies[this.index % this.proxies.length]!;
    this.index++;
    return proxy;
  }

  /** Number of proxies in the rotation pool. */
  get size(): number {
    return this.proxies.length;
  }
}

// ─── Randomized pacing ───────────────────────────────────────────────────────

/**
 * Returns a random delay in [minMs, maxMs).
 * If maxMs <= minMs, returns minMs (fixed delay).
 */
export function randomDelay(minMs: number, maxMs: number): number {
  if (maxMs <= minMs) return minMs;
  return minMs + Math.floor(Math.random() * (maxMs - minMs));
}

/**
 * Sleep for a random duration between min and max seconds.
 * Used to pace searches so traffic looks more human.
 */
export async function pacedDelay(minSec: number, maxSec: number): Promise<void> {
  const ms = randomDelay(minSec * 1000, maxSec * 1000);
  return new Promise((resolve) => setTimeout(resolve, ms));
}
