/**
 * Anti-detection resilience helpers — user-agent rotation, Google block
 * detection and rate-limit cooldowns. Keeps long scraping jobs alive when
 * Google pushes back with CAPTCHAs or consent walls.
 */
import type { Page } from "playwright";
import { moduleLogger } from "../logger";

const log = moduleLogger("resilience");

/**
 * Pool of realistic, recent Chrome user agents. Rotating between contexts
 * avoids the "same UA on every request" fingerprint that makes bulk
 * scraping trivially detectable.
 */
export const USER_AGENTS: string[] = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 Edg/128.0.0.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36 OPR/113.0.0.0",
];

/** Pick a random user agent from the pool. */
export function randomUserAgent(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)]!;
}

export type BlockKind = "none" | "captcha" | "consent";

/** URL fragments that indicate Google has redirected us to a block page. */
const CAPTCHA_URL_MARKERS = ["/sorry/", "captcha", "/recaptcha", "unusual traffic"];

/**
 * Pure URL classification — split out so it can be unit-tested without a
 * live browser page. "+" in query/hash fragments encodes a space
 * ("unusual+traffic"), so normalise it before matching.
 */
export function detectBlockFromUrl(url: string): "none" | "captcha" {
  const lower = url.toLowerCase().replace(/\+/g, " ");
  return CAPTCHA_URL_MARKERS.some((m) => lower.includes(m)) ? "captcha" : "none";
}

/**
 * Detect whether the current page is a Google block/CAPTCHA page or a
 * cookie-consent wall. Returns:
 *  - "captcha" — Google rate-limit / sorry page (needs cooldown + retry)
 *  - "consent" — cookie consent form covering the content
 *  - "none"    — page looks normal
 */
export async function detectBlock(page: Page): Promise<BlockKind> {
  try {
    if (detectBlockFromUrl(page.url()) === "captcha") return "captcha";

    // reCAPTCHA iframe or visible challenge text
    const captchaFrame = page.frames().some((f) =>
      f.url().toLowerCase().includes("recaptcha")
    );
    if (captchaFrame) return "captcha";

    const hasCaptchaText = await page
      .locator("text=/unusual traffic|please show you.re not a robot|enable javascript and cookies/i")
      .first()
      .isVisible({ timeout: 500 })
      .catch(() => false);
    if (hasCaptchaText) return "captcha";

    // Cookie consent wall (common EU banners)
    const hasConsent = await page
      .locator("#consent-bump, form[action*='consent'], [aria-modal='true'] form")
      .first()
      .isVisible({ timeout: 500 })
      .catch(() => false);
    if (hasConsent) return "consent";

    return "none";
  } catch {
    return "none";
  }
}

/** Sleep for the given duration, logging the cooldown for observability. */
export async function cooldown(ms: number): Promise<void> {
  log.warn(`Rate-limit cooldown: sleeping ${Math.round(ms / 1000)}s`);
  await new Promise((resolve) => setTimeout(resolve, ms));
}
