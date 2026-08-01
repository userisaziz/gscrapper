/**
 * Google Maps search job — builds the search URL with pb parameter,
 * fetches results, and parses entries.
 */
import { Entry, filterAndSortWithinRadius, parseSearchResults } from "./entry";

export interface MapSearchParams {
  query: string;
  lat: number;
  lon: number;
  zoomLvl: number;
  radius: number;
  hl: string;
  /**
   * Results to request per search. The `!7iNN` field in the pb parameter
   * controls this. Google honours it up to ~100 (higher values are clamped
   * server-side), so we default to 100 instead of the old 20.
   */
  count?: number;
}

/** Google caps a single search at roughly this many results. */
export const MAX_RESULTS_PER_SEARCH = 100;

export function buildSearchUrl(params: MapSearchParams): string {
  const viewportW = 600;
  const viewportH = 800;
  const count = Math.min(params.count ?? MAX_RESULTS_PER_SEARCH, MAX_RESULTS_PER_SEARCH);

  const pb =
    `!4m12!1m3!1d3826.902183192154!2d${params.lon.toFixed(4)}!3d${params.lat.toFixed(4)}` +
    `!2m3!1f0!2f0!3f0!3m2!1i${viewportW}!2i${viewportH}!4f${params.zoomLvl.toFixed(1)}` +
    `!7i${count}!8i0!10b1!12m22!1m3!18b1!30b1!34e1!2m3!5m1!6e2!20e3!4b0!10b1!12b1!13b1!16b1` +
    `!17m1!3e1!20m3!5e2!6b1!14b1!46m1!1b0!96b1!19m4!2m3!1i360!2i120!4i8`;

  const url = new URL("https://maps.google.com/search");
  url.searchParams.set("tbm", "map");
  url.searchParams.set("authuser", "0");
  url.searchParams.set("hl", params.hl);
  url.searchParams.set("q", params.query);
  url.searchParams.set("pb", pb);

  return url.toString();
}

/**
 * Parse the raw search response body (first line is a header, skip it).
 */
export function processSearchResponse(body: string, params: MapSearchParams): Entry[] {
  const newlineIdx = body.indexOf("\n");
  if (newlineIdx === -1) return [];
  const jsonPart = body.slice(newlineIdx + 1);
  if (!jsonPart.trim()) return [];

  const entries = parseSearchResults(jsonPart);
  return filterAndSortWithinRadius(entries, params.lat, params.lon, params.radius);
}
