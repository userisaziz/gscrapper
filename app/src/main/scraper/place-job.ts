/**
 * Place job — navigates to a Google Maps place URL, extracts APP_INITIALIZATION_STATE,
 * and optionally fetches reviews.
 */
import type { Page } from "playwright";
import { Entry, entryFromJson, extractReviewsFromRpcPage, Review } from "./entry";
import { fetchReviewsWithFallback, type ReviewDateFilter } from "./reviews";

const EXTRACT_JS = `
(function() {
  if (!window.APP_INITIALIZATION_STATE || !window.APP_INITIALIZATION_STATE[3]) return null;
  const appState = window.APP_INITIALIZATION_STATE[3];
  for (const key of Object.keys(appState)) {
    const arr = appState[key];
    if (Array.isArray(arr)) {
      for (const idx of [6, 5]) {
        const item = arr[idx];
        if (typeof item === 'string' && item.startsWith(")]}'")) return item;
      }
    }
  }
  return null;
})()
`;

export interface PlaceJobOptions {
  extractEmail: boolean;
  extractReviews: boolean;
  /** Optional publication-date window applied to DOM-extracted reviews. */
  dateFilter?: ReviewDateFilter;
}

/**
 * Fetch place details from a Google Maps place URL using a Playwright page.
 */
export async function fetchPlaceDetails(
  page: Page,
  url: string,
  hl: string,
  opts: PlaceJobOptions
): Promise<{ entry: Entry; reviewsRaw: string[]; domReviews: Review[] }> {
  const targetUrl = url + (url.includes("?") ? "&" : "?") + `hl=${hl}`;

  await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 30000 });

  // Dismiss cookie consent if present
  try {
    const rejectBtn = page.locator('button:has-text("Reject all"), button:has-text("Accept all")');
    await rejectBtn.first().click({ timeout: 3000 });
  } catch { /* no cookie banner */ }

  // Extract APP_INITIALIZATION_STATE JSON
  const raw = await extractJson(page);
  if (!raw) throw new Error("APP_INITIALIZATION_STATE data not found");

  const cleaned = raw.replace(/^\)\]\}'/, "").trim();
  const entry = entryFromJson(cleaned);
  entry.link = entry.link || page.url();

  let reviewsRaw: string[] = [];
  let domReviews: Review[] = [];

  // Fetch extra reviews if requested
  if (opts.extractReviews && entry.reviewCount > 0) {
    const result = await fetchReviewsWithFallback(page, page.url(), entry.reviewCount, opts.dateFilter);
    reviewsRaw = result.rpcPages;
    domReviews = result.domReviews;
  }

  // Attach extra reviews to entry
  for (const pageData of reviewsRaw) {
    const reviews = extractReviewsFromRpcPage(pageData);
    entry.userReviewsExtended.push(...reviews);
  }
  if (domReviews.length > 0) {
    entry.userReviewsExtended.push(...domReviews);
  }

  return { entry, reviewsRaw, domReviews };
}

async function extractJson(page: Page): Promise<string | null> {
  const maxRetries = 2;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const result = await page.evaluate(EXTRACT_JS, { timeout: 30000 });
      if (result && typeof result === "string" && result.length > 0) {
        return result;
      }
    } catch { /* retry */ }

    if (attempt < maxRetries - 1) {
      try {
        await page.reload({ waitUntil: "domcontentloaded" });
      } catch { /* ignore */ }
    }
  }
  return null;
}
