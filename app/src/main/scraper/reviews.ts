/**
 * Reviews extraction — RPC-based pagination via Google's batchexecute endpoint,
 * with DOM scraping fallback.
 */
import crypto from "crypto";
import type { Page } from "playwright";
import { Review } from "./entry";

export interface FetchReviewsResult {
  rpcPages: string[];
  domReviews: Review[];
}

/** Optional publication-date window for collected reviews (ISO dates). */
export interface ReviewDateFilter {
  after?: string;
  before?: string;
}

/**
 * Attempts RPC-based review extraction first, falls back to DOM scraping.
 * When a date filter is given, DOM reviews outside the window are dropped
 * (unparseable dates are kept — filtering is best-effort, never lossy on
 * data we can't understand).
 */
export async function fetchReviewsWithFallback(
  page: Page,
  mapUrl: string,
  reviewCount: number,
  dateFilter?: ReviewDateFilter
): Promise<FetchReviewsResult> {
  // Try RPC first
  try {
    const pages = await fetchReviewsRpc(page, mapUrl, reviewCount);
    if (pages.length > 0) return { rpcPages: pages, domReviews: [] };
  } catch { /* fall through to DOM */ }

  // DOM fallback
  try {
    let domReviews = await extractReviewsFromDom(page);
    if (dateFilter) {
      domReviews = domReviews.filter((r) => reviewWithinWindow(r, dateFilter));
    }
    if (domReviews.length > 0) return { rpcPages: [], domReviews };
  } catch { /* ignore */ }

  return { rpcPages: [], domReviews: [] };
}

// ─── Date filtering ─────────────────────────────────────────────────────────────

const RELATIVE_DATE_RE =
  /^(?:a|an|\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago$/;

const UNIT_MS: Record<string, number> = {
  second: 1_000,
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
  week: 604_800_000,
  month: 2_629_800_000,  // ~30.44 days
  year: 31_557_600_000, // ~365.25 days
};

/**
 * Best-effort parse of Google's review dates: relative strings ("2 years
 * ago", "a week ago", "yesterday") and absolute ISO strings. Returns null
 * when the value can't be understood.
 */
export function parseReviewDate(
  value: string | null | undefined,
  now: Date = new Date()
): Date | null {
  if (!value) return null;
  const v = value.trim().toLowerCase();
  if (!v) return null;

  if (v === "just now" || v === "moments ago") return new Date(now.getTime());
  if (v === "yesterday") return new Date(now.getTime() - UNIT_MS.day!);

  const rel = v.match(RELATIVE_DATE_RE);
  if (rel) {
    const words = v.split(/\s+/);
    const qtyRaw = words[0]!;
    const qty = qtyRaw === "a" || qtyRaw === "an" ? 1 : parseInt(qtyRaw, 10);
    const unitMs = UNIT_MS[rel[1]!];
    if (Number.isFinite(qty) && unitMs) {
      return new Date(now.getTime() - qty * unitMs);
    }
  }

  const absolute = new Date(value);
  return Number.isNaN(absolute.getTime()) ? null : absolute;
}

/**
 * True when the review's publication date falls inside the filter window.
 * Reviews with unparseable dates are included (best-effort filtering).
 */
export function reviewWithinWindow(
  review: Review,
  filter?: ReviewDateFilter,
  now: Date = new Date()
): boolean {
  if (!filter || (!filter.after && !filter.before)) return true;

  const date =
    parseReviewDate(review.when, now) ??
    (review.postedAtUnixMicros > 0 ? new Date(review.postedAtUnixMicros / 1000) : null);
  if (!date) return true;

  if (filter.after) {
    const after = new Date(filter.after);
    if (!Number.isNaN(after.getTime()) && date < after) return false;
  }
  if (filter.before) {
    const before = endOfDay(filter.before);
    if (!Number.isNaN(before.getTime()) && date > before) return false;
  }
  return true;
}

/** Bare date strings (YYYY-MM-DD) are treated as inclusive of the whole day. */
function endOfDay(iso: string): Date {
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return new Date(iso + "T23:59:59.999Z");
  return new Date(iso);
}

// ─── RPC-based extraction ─────────────────────────────────────────────────────

async function fetchReviewsRpc(page: Page, mapUrl: string, _reviewCount: number): Promise<string[]> {
  const placeId = extractPlaceId(mapUrl);
  if (!placeId) return [];

  const requestId = generateRandomId(21);
  const pages: string[] = [];
  let pageToken = "";

  const maxPages = 50;
  for (let i = 0; i < maxPages; i++) {
    const url = buildReviewUrl(placeId, pageToken, 20, requestId);

    // Use browser fetch to get proper cookies
    const result = await page.evaluate(async (fetchUrl: string) => {
      try {
        const resp = await fetch(fetchUrl, { method: "GET", credentials: "include" });
        if (!resp.ok) return { error: `HTTP ${resp.status}` };
        return { data: await resp.text() };
      } catch (e: any) {
        return { error: e.message };
      }
    }, url);

    if (!result || result.error || !result.data || result.data.length < 10) break;

    pages.push(result.data);
    pageToken = extractNextPageToken(result.data);
    if (!pageToken) break;
  }

  return pages;
}

function extractPlaceId(mapUrl: string): string {
  const patterns = [
    /!1s([^!]+)/,
    /place_id=([^&]+)/,
    /\/place\/[^/]+\/@[^/]+\/data=!.*!1s([^!]+)/,
    /(0x[0-9a-fA-F]+:0x[0-9a-fA-F]+)/,
  ];
  for (const re of patterns) {
    const match = mapUrl.match(re);
    if (match) return decodeURIComponent(match[1]!);
  }
  return "";
}

function buildReviewUrl(placeId: string, pageToken: string, pageSize: number, requestId: string): string {
  const encodedPlaceId = encodeURIComponent(placeId);
  const encodedToken = encodeURIComponent(pageToken);

  const pb =
    `!1m6!1s${encodedPlaceId}` +
    `!6m4!4m1!1e1!4m1!1e3` +
    `!2m2!1i${pageSize}!2s${encodedToken}` +
    `!5m2!1s${requestId}!7e81` +
    `!8m9!2b1!3b1!5b1!7b1` +
    `!12m4!1b1!2b1!4m1!1e1!11m0!13m1!1e1`;

  return `https://www.google.com/maps/rpc/listugcposts?authuser=0&hl=en&pb=${pb}`;
}

function extractNextPageToken(data: string): string {
  let text = data;
  if (text.startsWith(")]}'\n")) text = text.slice(5);
  else if (text.startsWith(")]}'")) text = text.slice(4);

  try {
    const result = JSON.parse(text);
    if (Array.isArray(result) && result.length >= 2 && typeof result[1] === "string") {
      return result[1];
    }
  } catch { /* ignore */ }
  return "";
}

function generateRandomId(length: number): string {
  const bytes = crypto.randomBytes(Math.max(16, Math.ceil((length * 6) / 8)));
  return bytes.toString("base64url").slice(0, length);
}

// ─── DOM-based extraction (fallback) ─────────────────────────────────────────

async function extractReviewsFromDom(page: Page): Promise<Review[]> {
  // Click reviews tab/button
  await page.evaluate(() => {
    const buttons = document.querySelectorAll('button[jsaction*="review"], button[role="tab"]');
    for (const btn of buttons) {
      const text = (btn.getAttribute("aria-label") || btn.textContent || "").toLowerCase();
      if (text.includes("review")) { (btn as HTMLElement).click(); return; }
    }
  });

  await page.waitForTimeout(3000);

  const reviews: Review[] = [];
  let lastCount = 0;
  let stuckCount = 0;

  for (let attempt = 0; attempt < 30; attempt++) {
    const domReviews = await page.evaluate(() => {
      const results: any[] = [];
      const selectors = [".jftiEf", "div[data-review-id]", ".WMbnJf"];
      let elements: Element[] = [];

      for (const sel of selectors) {
        const els = document.querySelectorAll(sel);
        if (els.length > 0) { elements = Array.from(els); break; }
      }

      for (const el of elements) {
        const nameEl = el.querySelector(".d4r55, .WNxzHc, button.al6Kxe");
        const name = nameEl?.textContent?.trim() || "";
        if (!name) continue;

        const ratingEl = el.querySelector('[role="img"][aria-label*="star"]');
        const ratingMatch = (ratingEl?.getAttribute("aria-label") || "").match(/(\d+)/);
        const rating = ratingMatch ? parseInt(ratingMatch[1]!) : 0;

        const textEl = el.querySelector(".wiI7pd, .MyEned span");
        const text = textEl?.textContent?.trim() || "";

        const timeEl = el.querySelector(".rsqaWe, .DU9Pgb");
        const when = timeEl?.textContent?.trim() || "";

        results.push({ name, rating, text, when });
      }
      return results;
    });

    for (const d of domReviews) {
      const isDup = reviews.some((r) => r.name === d.name && r.description === d.text);
      if (!isDup) {
        reviews.push({
          name: d.name, profilePicture: "", rating: d.rating,
          description: d.text, images: [], when: d.when,
          reviewId: "", source: "dom", ratingScale: 5, ratingFloat: d.rating,
          authorUrl: "", postedAtUnixMicros: 0, updatedAtUnixMicros: 0,
          language: "", translatedLang: "", textOriginal: d.text, textTranslated: "",
          replyText: "", replyTextOriginal: "", replyLanguage: "", replyTranslatedLang: "",
          replyPostedAtUnixMicros: 0, replyUpdatedAtUnixMicros: 0, publishedAt: null,
        });
      }
    }

    if (reviews.length === lastCount) {
      stuckCount++;
      if (stuckCount > 5) break;
    } else {
      stuckCount = 0;
      lastCount = reviews.length;
    }

    // Scroll for more
    await page.evaluate(() => {
      const el = document.querySelector(".m6QErb.DxyBCb.kA9KIf.dS8AEf, .m6QErb, div[role='feed']");
      if (el) el.scrollBy(0, 800);
      else window.scrollBy(0, 800);
    });
    await page.waitForTimeout(500);
  }

  return reviews;
}
