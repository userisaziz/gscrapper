/**
 * Email extraction — fetches a website's HTML and extracts email addresses
 * from mailto: links (cheerio) with regex fallback.
 * Ported from gmaps/emailjob.go.
 */
import * as cheerio from "cheerio";

const EMAIL_REGEX =
  /[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*/g;

/** Common false-positive domains to exclude */
const EXCLUDED_DOMAINS = [
  "example.com",
  "test.com",
  "email.com",
  "domain.com",
  "yourdomain.com",
  "sentry.io",
  "wixpress.com",
  "googleusercontent.com",
];

/**
 * Extract emails from a website URL.
 * Returns deduplicated list of valid email addresses.
 */
export async function extractEmailsFromWebsite(websiteUrl: string): Promise<string[]> {
  const url = normalizeGoogleURL(websiteUrl);
  if (!url || !url.startsWith("http")) return [];

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const resp = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      redirect: "follow",
    });

    clearTimeout(timeout);

    if (!resp.ok) return [];

    const contentType = resp.headers.get("content-type") || "";
    if (!contentType.includes("text/html") && !contentType.includes("text/plain")) return [];

    const html = await resp.text();
    if (!html || html.length === 0) return [];

    // Try mailto: extraction first (more reliable)
    let emails = extractMailtoLinks(html);

    // Fallback to regex if no mailto links found
    if (emails.length === 0) {
      emails = extractEmailsRegex(html);
    }

    return emails;
  } catch {
    return [];
  }
}

/**
 * Extract emails from mailto: links using cheerio.
 */
function extractMailtoLinks(html: string): string[] {
  const seen = new Set<string>();
  const emails: string[] = [];

  try {
    const $ = cheerio.load(html);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    $("a[href^='mailto:']").each((_i: any, el: any) => {
      const href = $(el).attr("href");
      if (!href) return;

      const value = href.replace(/^mailto:/i, "").split("?")[0]!.trim();
      const email = validateEmail(value);
      if (email && !seen.has(email.toLowerCase())) {
        seen.add(email.toLowerCase());
        emails.push(email);
      }
    });
  } catch {
    /* cheerio parse error — fall through */
  }

  return emails;
}

/**
 * Extract emails from raw HTML using regex.
 */
function extractEmailsRegex(html: string): string[] {
  const seen = new Set<string>();
  const emails: string[] = [];

  // Strip script/style tags to reduce false positives
  const cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "");

  const matches = cleaned.match(EMAIL_REGEX);
  if (!matches) return [];

  for (const match of matches) {
    const email = validateEmail(match);
    if (email && !seen.has(email.toLowerCase())) {
      seen.add(email.toLowerCase());
      emails.push(email);
    }
  }

  return emails;
}

/**
 * Validate and normalize an email address.
 * Returns the normalized email or null if invalid.
 */
function validateEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase();

  // Basic structure check
  if (!email || !email.includes("@")) return null;

  const parts = email.split("@");
  if (parts.length !== 2) return null;

  const [local, domain] = parts;
  if (!local || !domain) return null;
  if (local.length > 64 || domain.length > 253) return null;

  // Domain must have at least one dot
  if (!domain.includes(".")) return null;

  // Must end with a valid TLD (at least 2 chars)
  const tld = domain.split(".").pop() || "";
  if (tld.length < 2) return null;

  // Exclude common false positives
  for (const excluded of EXCLUDED_DOMAINS) {
    if (domain === excluded || domain.endsWith("." + excluded)) return null;
  }

  // Exclude image/file-like patterns
  if (/\.(png|jpg|jpeg|gif|svg|webp|css|js|ico)$/i.test(email)) return null;

  return email;
}

/**
 * Normalize Google redirect URLs to actual target URLs.
 * Google Maps sometimes returns URLs like "/url?q=http://example.com/&opi=..."
 */
export function normalizeGoogleURL(rawURL: string): string {
  if (!rawURL) return rawURL;

  if (rawURL.startsWith("/url?q=")) {
    try {
      const parsed = new URL("https://www.google.com" + rawURL);
      const target = parsed.searchParams.get("q");
      if (target) return target;
    } catch {
      return rawURL;
    }
  }

  if (rawURL.startsWith("/")) {
    return "https://www.google.com" + rawURL;
  }

  return rawURL;
}
