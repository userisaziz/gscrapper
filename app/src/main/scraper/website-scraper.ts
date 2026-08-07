/**
 * Website enrichment — uses a real Playwright browser page to visit a lead's
 * website and extract business intelligence: emails, phone numbers, social
 * media links, and a description/meta summary.
 *
 * Why Playwright instead of raw fetch:
 *  - Executes JavaScript (many sites render emails/phones client-side)
 *  - Real browser TLS fingerprint (sites that block Node fetch work fine)
 *  - Handles cookie banners / SPAs / redirects like a real visitor
 *
 * Strategy: visit the homepage, then crawl up to 3 internal "contact-type"
 * pages (/contact, /about, etc.) where emails and phones are most likely.
 */
import type { Page } from "playwright";
import { moduleLogger } from "../logger";
import type { Person } from "./entry";

const log = moduleLogger("website-scraper");

export type PhoneType = "mobile" | "landline" | "unknown";

export interface WebsiteData {
  emails: string[];
  phones: string[];
  socials: string[];
  description: string;
  people: Person[];
  phoneType: PhoneType;
}

/** Per-page navigation timeout (ms). Sites that stall shouldn't block the job. */
const PAGE_TIMEOUT = 12_000;
/** Max internal pages to crawl beyond the homepage. */
const MAX_SUBPAGES = 3;

const EMAIL_REGEX =
  /[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*/g;

/**
 * Phone regex — matches common international formats:
 * +1 (555) 123-4567, +44 20 7946 0958, 555-123-4567, +971 4 123 4567, etc.
 * Allows single-digit groups (e.g. the "4" in "+971 4 888 8888", common for
 * Gulf-region numbers). Final digit-count validation (7–15) filters noise.
 */
const PHONE_REGEX =
  /(?:\+\d{1,3}[\s.-]?)?(?:\(\d{1,4}\)[\s.-]?)?\d{1,4}(?:[\s.-]\d{1,4}){1,4}/g;

const EXCLUDED_EMAIL_DOMAINS = [
  "example.com", "test.com", "email.com", "domain.com", "yourdomain.com",
  "sentry.io", "wixpress.com", "googleusercontent.com", "sentry-next.wixpress.com",
  "webpkgcache.com", "googletagmanager.com", "googleapis.com",
];

const SOCIAL_DOMAINS = [
  "facebook.com", "instagram.com", "linkedin.com", "twitter.com", "x.com",
  "wa.me", "whatsapp.com", "youtube.com", "tiktok.com", "pinterest.com",
  "snapchat.com", "yelp.com", "tripadvisor.com",
];

/** Path fragments that indicate a page likely contains contact info. */
const CONTACT_PATH_HINTS = [
  "contact", "contacto", "kontakt", "contatto", "contato",
  "about", "about-us", "company",
  "imprint", "impressum", "legal", "footer", "get-in-touch", "reach-us",
  "info", "support", "enquire", "inquiry",
  "kontakta", "kontakte", "connexion", "contactez", "contattate",
  "iletişim", "kontak", "contactenos",
];

/** Path fragments that indicate a page likely lists team members. */
const PEOPLE_PATH_HINTS = [
  "team", "staff", "people", "leadership", "about", "company", "founders",
];

/** Max team pages to visit beyond the homepage. */
const MAX_PEOPLE_PAGES = 2;
/** Max people kept per lead (keeps CSV cells manageable). */
const MAX_PEOPLE = 5;

/**
 * Job-title keywords used to recognise decision-makers. Multi-word titles
 * come first so "General Manager" wins over its substring "Manager".
 */
const TITLE_KEYWORDS = [
  "General Manager", "Co-Founder", "CEO", "CTO", "COO", "Founder", "Owner",
  "Director", "Manager", "Partner", "Principal", "President",
];

/**
 * Scrape a lead's website using a Playwright page for full JS rendering.
 * Returns emails, phone numbers, social links, and a description.
 *
 * When `skipSubpages` is true only the homepage and contact-type pages are
 * visited — people/team pages are skipped.  Useful for fast-mode where
 * throughput matters more than exhaustive enrichment.
 */
export async function scrapeWebsiteData(
  page: Page,
  websiteUrl: string,
  options?: { skipSubpages?: boolean }
): Promise<WebsiteData> {
  const result: WebsiteData = {
    emails: [],
    phones: [],
    socials: [],
    description: "",
    people: [],
    phoneType: "unknown",
  };

  const url = normalizeUrl(websiteUrl);
  if (!url) return result;

  let origin = "";
  try {
    origin = new URL(url).origin;
  } catch {
    return result;
  }

  const seenEmails = new Set<string>();
  const seenPhones = new Set<string>();
  const seenSocials = new Set<string>();

  const addEmails = (emails: string[]) => {
    for (const e of emails) {
      const key = e.toLowerCase();
      if (!seenEmails.has(key)) {
        seenEmails.add(key);
        result.emails.push(e);
      }
    }
  };
  const addPhones = (phones: string[]) => {
    for (const p of phones) {
      if (!seenPhones.has(p)) {
        seenPhones.add(p);
        result.phones.push(p);
      }
    }
  };
  const addSocials = (socials: string[]) => {
    for (const s of socials) {
      const key = s.toLowerCase().replace(/\/+$/, "");
      if (!seenSocials.has(key)) {
        seenSocials.add(key);
        result.socials.push(s);
      }
    }
  };

  // ── Visit homepage ────────────────────────────────────────────────────────
  // Assigned inside the try below; the catch returns early, so both are
  // definitely assigned past the try/catch.
  let contactLinks: string[];
  let peopleLinks: string[];
  try {
    const resp = await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: PAGE_TIMEOUT,
    });
    if (!resp || resp.status() >= 400) return result;

    // Give JS-rendered content time to appear — SPAs (React, Vue, Angular)
    // often need 2–4 s to hydrate and inject emails into the DOM.
    await page.waitForTimeout(3000);

    const extracted = await extractFromPage(page);
    addEmails(extracted.emails);
    addPhones(extracted.phones);
    addSocials(extracted.socials);
    result.description = extracted.description;
    contactLinks = extracted.contactLinks;
    peopleLinks = extracted.peopleLinks;

    // The homepage is already loaded — grab any team members visible here
    // before navigating away (common on small-business sites).
    addPeople(result.people, await extractPeople(page));
  } catch (err) {
    log.warn(`Website scrape failed for ${url}:`, err);
    return result;
  }

  // ── Crawl contact-type subpages (always visited for emails) ───────────
  // Contact pages are the #1 source of business emails, so we always crawl
  // them regardless of skipSubpages.  Only people/team pages are skipped in
  // fast mode.
  {
    const subpages = contactLinks
      .filter((l) => l.startsWith(origin))
      .slice(0, options?.skipSubpages ? 1 : MAX_SUBPAGES);

    for (const subUrl of subpages) {
      try {
        await page.goto(subUrl, { waitUntil: "domcontentloaded", timeout: PAGE_TIMEOUT });
        await page.waitForTimeout(1500);
        const extracted = await extractFromPage(page);
        addEmails(extracted.emails);
        addPhones(extracted.phones);
        addSocials(extracted.socials);
        // Prefer a longer description if the subpage has one and homepage didn't
        if (!result.description && extracted.description) {
          result.description = extracted.description;
        }
      } catch {
        // Subpage failed — not critical, keep what we have
      }

      // Early exit if we already found emails (most common goal)
      if (result.emails.length >= 3) break;
    }
  }

  // ── Crawl people-type pages for decision-makers (skipped in fast mode) ─
  if (!options?.skipSubpages && result.people.length < MAX_PEOPLE) {
    const peoplePages = peopleLinks
      .filter((l) => l.startsWith(origin))
      .slice(0, MAX_PEOPLE_PAGES);

    for (const personUrl of peoplePages) {
      if (result.people.length >= MAX_PEOPLE) break;
      try {
        await page.goto(personUrl, { waitUntil: "domcontentloaded", timeout: PAGE_TIMEOUT });
        await page.waitForTimeout(1000);
        addPeople(result.people, await extractPeople(page));
      } catch {
        // Team page failed — not critical
      }
    }
  }

  // Cap results to keep CSV cells manageable
  result.emails = result.emails.slice(0, 5);
  result.phones = result.phones.slice(0, 3);
  result.socials = result.socials.slice(0, 6);
  result.people = result.people.slice(0, MAX_PEOPLE);
  result.phoneType = result.phones.length > 0 ? classifyPhoneType(result.phones[0]!) : "unknown";

  return result;
}

/** Merge newly found people into the accumulator, deduping by name. */
function addPeople(target: Person[], found: Person[]): void {
  const seen = new Set(target.map((p) => p.name.toLowerCase()));
  for (const person of found) {
    const key = person.name.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      target.push(person);
    }
  }
}

// ─── Page-level extraction ────────────────────────────────────────────────────

interface PageExtract {
  emails: string[];
  phones: string[];
  socials: string[];
  description: string;
  contactLinks: string[];
  peopleLinks: string[];
}

/**
 * Extract all intelligence from the currently loaded page.
 * Runs inside the page context for access to rendered DOM + text.
 */
async function extractFromPage(page: Page): Promise<PageExtract> {
  return page.evaluate(
    ({ emailRe, phoneRe, socialDomains, contactHints, peopleHints }) => {
      const emails: string[] = [];
      const phones: string[] = [];
      const socials: string[] = [];
      const contactLinks: string[] = [];
      const peopleLinks: string[] = [];

      // ── Emails from mailto: links ──
      document.querySelectorAll("a[href^='mailto:']").forEach((a) => {
        const href = a.getAttribute("href") || "";
        const value = href.replace(/^mailto:/i, "").split("?")[0]?.trim() || "";
        if (value && value.includes("@")) emails.push(value.toLowerCase());
      });

      // ── Emails from data attributes (data-email, data-contact, etc.) ──
      // Some themes/plugins store emails in data attributes to keep them
      // out of plain text while still making them accessible to JS.
      document.querySelectorAll("[data-email], [data-mail], [data-contact], [data-contact-email]").forEach((el) => {
        for (const attr of ["data-email", "data-mail", "data-contact", "data-contact-email"]) {
          const value = el.getAttribute(attr);
          if (value && value.includes("@")) emails.push(value.trim().toLowerCase());
        }
      });

      // ── Full rendered text (catches JS-rendered phones/emails) ──
      const bodyText = document.body?.innerText || "";
      const fullHtml = document.documentElement?.innerHTML || "";

      // Emails from visible text
      const textEmailMatches = bodyText.match(new RegExp(emailRe, "g")) || [];
      emails.push(...textEmailMatches.map((e: string) => e.toLowerCase()));

      // Emails from HTML source (data attributes, scripts with plain emails)
      const htmlNoScripts = fullHtml
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ");
      const htmlEmailMatches = htmlNoScripts.match(new RegExp(emailRe, "g")) || [];
      emails.push(...htmlEmailMatches.map((e: string) => e.toLowerCase()));

      // ── Phones from visible text ──
      const phoneMatches = bodyText.match(new RegExp(phoneRe, "g")) || [];
      for (const raw of phoneMatches) {
        const digits = raw.replace(/\D/g, "");
        // Must have 7–15 digits to be a plausible phone number
        if (digits.length >= 7 && digits.length <= 15) {
          phones.push(raw.trim());
        }
      }

      // Also check tel: links (very reliable)
      document.querySelectorAll("a[href^='tel:']").forEach((a) => {
        const href = a.getAttribute("href") || "";
        const value = href.replace(/^tel:/i, "").trim();
        if (value) phones.push(value);
      });

      // ── Social links ──
      document.querySelectorAll("a[href]").forEach((a) => {
        const href = a.getAttribute("href") || "";
        if (!href.startsWith("http")) return;
        try {
          const host = new URL(href).hostname.replace(/^www\./, "");
          for (const domain of socialDomains) {
            if (host === domain || host.endsWith("." + domain)) {
              socials.push(href);
              break;
            }
          }
        } catch { /* invalid URL */ }
      });

      // ── Description: meta tags → og:description → first paragraph ──
      let description = "";
      const metaDesc =
        document.querySelector("meta[name='description']")?.getAttribute("content") ||
        document.querySelector("meta[property='og:description']")?.getAttribute("content") ||
        "";
      if (metaDesc.trim()) {
        description = metaDesc.trim();
      } else {
        // Fallback: first meaningful paragraph
        const paragraphs = document.querySelectorAll("p");
        for (const p of paragraphs) {
          const text = (p.textContent || "").trim();
          if (text.length > 40 && text.length < 500) {
            description = text;
            break;
          }
        }
      }

      // ── Discover contact-type and people-type internal links ──
      const seen = new Set<string>();
      const seenPeople = new Set<string>();
      document.querySelectorAll("a[href]").forEach((a) => {
        const href = a.getAttribute("href") || "";
        if (!href.startsWith("/") && !href.startsWith("http")) return;
        if (href.includes("#") && href.split("#")[0] === "") return;

        const pathPart = href.split("?")[0]?.split("#")[0]?.toLowerCase() || "";
        const segments = pathPart.split("/").filter(Boolean);
        const lastSegment = segments[segments.length - 1] || "";

        const isContact =
          contactHints.some((hint: string) => lastSegment === hint) ||
          contactHints.some((hint: string) => pathPart.includes("/" + hint + "/")) ||
          contactHints.some((hint: string) => pathPart.endsWith("/" + hint));

        if (isContact) {
          const anchorText = (a.textContent || "").toLowerCase();
          const textHint = contactHints.some((h: string) => anchorText.includes(h));
          if (lastSegment || textHint) {
            const resolved = href.startsWith("http") ? href : new URL(href, window.location.origin).href;
            if (!seen.has(resolved)) {
              seen.add(resolved);
              contactLinks.push(resolved);
            }
          }
        }

        const isPeople =
          peopleHints.some((hint: string) => lastSegment === hint) ||
          peopleHints.some((hint: string) => pathPart.includes("/" + hint + "/")) ||
          peopleHints.some((hint: string) => pathPart.endsWith("/" + hint));

        if (isPeople) {
          const anchorText = (a.textContent || "").toLowerCase();
          const textHint = peopleHints.some((h: string) => anchorText.includes(h));
          if (lastSegment || textHint) {
            const resolved = href.startsWith("http") ? href : new URL(href, window.location.origin).href;
            if (!seenPeople.has(resolved)) {
              seenPeople.add(resolved);
              peopleLinks.push(resolved);
            }
          }
        }
      });

      // Also detect contact hints from nav/footer link text
      document.querySelectorAll("nav a, footer a, [class*='footer'] a, [class*='nav'] a").forEach((a) => {
        const text = (a.textContent || "").trim().toLowerCase();
        const href = a.getAttribute("href") || "";
        if (!href || href === "#" || href.startsWith("javascript:")) return;
        const isContactText = ["contact", "contact us", "get in touch", "reach us", "about us", "about"].includes(text);
        if (isContactText) {
          const resolved = href.startsWith("http") ? href : new URL(href, window.location.origin).href;
          if (!seen.has(resolved)) {
            seen.add(resolved);
            contactLinks.push(resolved);
          }
        }
      });

      return { emails, phones, socials, description, contactLinks, peopleLinks };
    },
    {
      emailRe: EMAIL_REGEX.source,
      phoneRe: PHONE_REGEX.source,
      socialDomains: SOCIAL_DOMAINS,
      contactHints: CONTACT_PATH_HINTS,
      peopleHints: PEOPLE_PATH_HINTS,
    }
  ).then((raw) => ({
    emails: dedupeValidEmails(raw.emails),
    phones: dedupePhones(raw.phones),
    socials: [...new Set(raw.socials)].slice(0, 8),
    description: (raw.description || "").slice(0, 500),
    contactLinks: raw.contactLinks.slice(0, 6),
    peopleLinks: raw.peopleLinks.slice(0, 6),
  }));
}

// ─── People extraction ─────────────────────────────────────────────────────────

/** A piece of text found on the page plus its document-order position. */
export interface TextCandidate {
  text: string;
  position: number;
}

/**
 * Extract decision-maker people (name + job title) from the current page.
 * Scans headings, bold text and definition lists, then pairs plausible
 * person names with the nearest job-title keyword. Best-effort: any failure
 * yields an empty array, never an error.
 */
async function extractPeople(page: Page): Promise<Person[]> {
  try {
    const texts = await page.evaluate(() => {
      const out: { text: string; position: number }[] = [];
      const els = document.querySelectorAll("h1, h2, h3, h4, strong, b, dt, dd");
      let pos = 0;
      els.forEach((el) => {
        pos += 1;
        const text = (el.textContent || "").replace(/\s+/g, " ").trim();
        if (text && text.length <= 60) out.push({ text, position: pos });
      });
      return out;
    });

    const names = texts.filter((t) => isPersonName(t.text));
    const titles: TextCandidate[] = [];
    for (const t of texts) {
      const title = matchTitle(t.text);
      if (title) titles.push({ text: title, position: t.position });
    }
    return pairPeopleWithTitles(names, titles);
  } catch (err) {
    log.warn("People extraction failed:", err);
    return [];
  }
}

/** Lowercase surname particles allowed inside a person name. */
const NAME_PARTICLES = new Set([
  "van", "von", "der", "den", "de", "del", "della", "di", "da", "ter", "ten",
  "al", "el", "la", "le", "du", "dos", "das", "bin", "ibn",
]);

/**
 * A plausible person name: 2–4 name words, each starting with a capital
 * letter (accented Latin letters allowed), no digits or punctuation noise.
 * Lowercase surname particles (van, der, al…) may appear between name words
 * and don't count toward the length limit ("Mary Jane van der Berg" = 3
 * name words).
 */
export function isPersonName(text: string): boolean {
  const words = text.trim().split(/\s+/);
  if (words.length < 2) return false;
  const nameWords = words.filter((w) => !NAME_PARTICLES.has(w.toLowerCase()));
  if (nameWords.length < 2 || nameWords.length > 4) return false;
  return words.every(
    (w) => /^[\p{Lu}][\p{L}'’.-]*$/u.test(w) || NAME_PARTICLES.has(w.toLowerCase())
  );
}

/**
 * Precompiled word-boundary patterns — substring matching would let
 * "dire**cto**r" satisfy "CTO". Multi-word titles are matched first so
 * "General Manager" is not reduced to "Manager".
 */
const TITLE_PATTERNS: { keyword: string; re: RegExp }[] = TITLE_KEYWORDS.map(
  (keyword) => ({
    keyword,
    re: new RegExp(
      `\\b${keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
      "i"
    ),
  })
);

/**
 * Return the canonical job-title keyword contained in the text, or null.
 * Multi-word titles are matched first so "General Manager" is not reduced
 * to "Manager".
 */
export function matchTitle(text: string): string | null {
  for (const { keyword, re } of TITLE_PATTERNS) {
    if (re.test(text)) return keyword;
  }
  return null;
}

/** Max document-order distance between a name and its title. */
const MAX_PAIR_DISTANCE = 10;

/**
 * Pair each person name with the nearest job title (by document-order
 * position). Names without a title within MAX_PAIR_DISTANCE are dropped —
 * a bare name is not an actionable lead. Capped at 5 results, deduped.
 */
export function pairPeopleWithTitles(
  names: TextCandidate[],
  titles: TextCandidate[]
): Person[] {
  const result: Person[] = [];
  const seen = new Set<string>();

  for (const name of names) {
    if (result.length >= MAX_PEOPLE) break;

    let bestTitle: string | null = null;
    let bestDistance = Infinity;
    for (const title of titles) {
      const distance = Math.abs(title.position - name.position);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestTitle = title.text;
      }
    }

    if (bestTitle === null || bestDistance > MAX_PAIR_DISTANCE) continue;

    const key = name.text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ name: name.text, title: bestTitle });
  }

  return result;
}

// ─── Phone type classification ─────────────────────────────────────────────────

/**
 * Mobile prefixes per country (international digit form, optional +).
 * Best-effort heuristics — no carrier database is consulted.
 */
const MOBILE_PATTERNS: RegExp[] = [
  /^\+?447\d{9}$/,        // UK +44 7xxx
  /^\+?91[6-9]\d{9}$/,    // India 98/99/97/96…
  /^\+?9715\d{8}$/,       // UAE +971 5x
  /^\+?491[5-7]\d{8,9}$/, // Germany +49 15x/16x/17x
  /^\+?33[67]\d{8}$/,     // France +33 6/7
  /^\+?34[67]\d{8}$/,     // Spain +34 6/7
  /^\+?393\d{8,9}$/,      // Italy +39 3x
  /^\+?316\d{8}$/,        // Netherlands +31 6x
];

/** Landline prefixes per country (checked only after mobile patterns). */
const LANDLINE_PATTERNS: RegExp[] = [
  /^\+?44[1-3]\d{8,9}$/,  // UK geographic
  /^\+?971[2-4]\d{7}$/,   // UAE geographic (2=Abu Dhabi, 4=Dubai…)
  /^\+?33[1-5]\d{8}$/,    // France geographic
  /^\+?34[89]\d{8}$/,     // Spain geographic
];

/**
 * Classify a phone number as mobile / landline / unknown using light
 * country-prefix heuristics. Numbers without a recognisable country code
 * (e.g. NANP +1, where mobile and landline ranges overlap) stay "unknown".
 */
export function classifyPhoneType(phone: string): PhoneType {
  if (!phone) return "unknown";
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) return "unknown";

  if (MOBILE_PATTERNS.some((re) => re.test(digits))) return "mobile";
  if (LANDLINE_PATTERNS.some((re) => re.test(digits))) return "landline";
  return "unknown";
}

// ─── Validation & normalization ───────────────────────────────────────────────

function dedupeValidEmails(raw: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const email of raw) {
    const normalized = email.trim().toLowerCase();
    if (!normalized || seen.has(normalized)) continue;

    const parts = normalized.split("@");
    if (parts.length !== 2) continue;
    const [local, domain] = parts;
    if (!local || !domain) continue;
    if (local.length > 64 || domain.length > 253) continue;
    if (!domain.includes(".")) continue;

    const tld = domain.split(".").pop() || "";
    if (tld.length < 2) continue;

    // Exclude known false-positive domains
    if (EXCLUDED_EMAIL_DOMAINS.some((d) => domain === d || domain.endsWith("." + d))) continue;

    // Exclude file-extension-like patterns (e.g. name@image.png)
    if (/\.(png|jpg|jpeg|gif|svg|webp|css|js|ico|woff|ttf)$/i.test(normalized)) continue;

    // Exclude version-like patterns (e.g. 1.2.3@4.5)
    if (/^\d[\d.]*@/.test(normalized)) continue;

    seen.add(normalized);
    result.push(normalized);
  }

  return result;
}

function dedupePhones(raw: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const phone of raw) {
    // Normalize: strip formatting but keep + prefix
    const digits = phone.replace(/\D/g, "");
    if (digits.length < 7 || digits.length > 15) continue;

    // Skip numbers that are likely not phones:
    // all same digit, sequential, or looks like a year
    if (/^(\d)\1+$/.test(digits)) continue;
    if (digits.length === 4 && parseInt(digits) >= 1900 && parseInt(digits) <= 2100) continue;

    const key = phone.startsWith("+") ? "+" + digits : digits;
    if (seen.has(key)) continue;
    seen.add(key);

    // Keep the formatted version for readability, trim whitespace
    result.push(phone.replace(/\s+/g, " ").trim());
  }

  return result;
}

/**
 * Normalize a website URL: handle Google redirect URLs, add protocol if missing.
 */
function normalizeUrl(raw: string): string {
  if (!raw) return "";

  let url = raw.trim();

  // Handle Google redirect format: /url?q=http://example.com/&opi=...
  if (url.startsWith("/url?q=")) {
    try {
      const parsed = new URL("https://www.google.com" + url);
      const target = parsed.searchParams.get("q");
      if (target) url = target;
    } catch {
      return "";
    }
  }

  // Skip relative paths that aren't Google redirects
  if (url.startsWith("/")) return "";

  // Add protocol if missing
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    url = "https://" + url;
  }

  try {
    const parsed = new URL(url);
    // Skip obviously invalid hosts
    if (!parsed.hostname || parsed.hostname.length < 3) return "";
    return parsed.href;
  } catch {
    return "";
  }
}
