/**
 * Entry data model and Google Maps internal JSON parser.
 * Ported from gmaps/entry.go — parses Google's undocumented APP_INITIALIZATION_STATE format.
 */

export interface Image {
  title: string;
  image: string;
}

export interface LinkSource {
  link: string;
  source: string;
}

export interface Owner {
  id: string;
  name: string;
  link: string;
}

export interface Address {
  borough: string;
  street: string;
  city: string;
  postalCode: string;
  state: string;
  country: string;
}

export interface Option {
  name: string;
  enabled: boolean;
  values: string[];
}

export interface About {
  id: string;
  name: string;
  options: Option[];
}

export interface Person {
  name: string;
  title: string;
}

export interface SubRating {
  category: string;
  rating: number;
}

export interface Review {
  name: string;
  profilePicture: string;
  rating: number;
  description: string;
  images: string[];
  when: string;
  reviewId: string;
  source: string;
  ratingScale: number;
  ratingFloat: number;
  authorUrl: string;
  postedAtUnixMicros: number;
  updatedAtUnixMicros: number;
  language: string;
  translatedLang: string;
  textOriginal: string;
  textTranslated: string;
  replyText: string;
  replyTextOriginal: string;
  replyLanguage: string;
  replyTranslatedLang: string;
  replyPostedAtUnixMicros: number;
  replyUpdatedAtUnixMicros: number;
  publishedAt: string | null;
}

export interface Entry {
  id: string;
  link: string;
  cid: string;
  title: string;
  categories: string[];
  category: string;
  address: string;
  openHours: Record<string, string[]>;
  popularTimes: Record<string, Record<number, number>>;
  webSite: string;
  phone: string;
  plusCode: string;
  reviewCount: number;
  reviewRating: number;
  reviewsPerRating: Record<number, number>;
  latitude: number;
  longitude: number;
  status: string;
  description: string;
  reviewsLink: string;
  thumbnail: string;
  timezone: string;
  priceRange: string;
  dataId: string;
  streetViewUrl: string;
  placeId: string;
  images: Image[];
  reservations: LinkSource[];
  orderOnline: LinkSource[];
  menu: LinkSource;
  owner: Owner;
  completeAddress: Address;
  creditCardsAccepted: string[];
  about: About[];
  userReviews: Review[];
  userReviewsExtended: Review[];
  emails: string[];
  websitePhones: string[];
  socials: string[];
  websiteDescription: string;
  people: Person[];
  phoneType: "mobile" | "landline" | "unknown";
  subRatings: SubRating[];
}

// ─── Deep array accessor ──────────────────────────────────────────────────────

/** Navigate nested arrays by index path. Returns undefined if any step fails. */
function dig(arr: any, ...indexes: number[]): any {
  let current = arr;
  for (const idx of indexes) {
    if (!Array.isArray(current) || idx >= current.length || current[idx] == null) {
      return undefined;
    }
    current = current[idx];
  }
  return current;
}

function digStr(arr: any, ...indexes: number[]): string {
  const v = dig(arr, ...indexes);
  return typeof v === "string" ? v : "";
}

function digNum(arr: any, ...indexes: number[]): number {
  const v = dig(arr, ...indexes);
  return typeof v === "number" ? v : 0;
}

function digArr(arr: any, ...indexes: number[]): any[] {
  const v = dig(arr, ...indexes);
  return Array.isArray(v) ? v : [];
}

// ─── CSV output ───────────────────────────────────────────────────────────────

export const CSV_HEADERS = [
  "input_id", "link", "title", "category", "address", "open_hours", "popular_times",
  "website", "phone", "plus_code", "review_count", "review_rating", "reviews_per_rating",
  "latitude", "longitude", "cid", "status", "descriptions", "reviews_link", "thumbnail",
  "timezone", "price_range", "data_id", "street_view_url", "place_id", "images",
  "reservations", "order_online", "menu", "owner", "complete_address",
  "credit_cards_accepted", "about", "user_reviews", "user_reviews_extended", "emails",
  "website_phones", "socials", "website_description", "people", "phone_type", "sub_ratings",
];

export function entryToCsvRow(e: Entry): string[] {
  return [
    e.id, e.link, e.title, e.category, e.address,
    JSON.stringify(e.openHours), JSON.stringify(e.popularTimes),
    e.webSite, e.phone, e.plusCode,
    String(e.reviewCount), String(e.reviewRating), JSON.stringify(e.reviewsPerRating),
    String(e.latitude), String(e.longitude),
    e.cid, e.status, e.description, e.reviewsLink, e.thumbnail,
    e.timezone, e.priceRange, e.dataId, e.streetViewUrl, e.placeId,
    JSON.stringify(e.images), JSON.stringify(e.reservations), JSON.stringify(e.orderOnline),
    JSON.stringify(e.menu), JSON.stringify(e.owner), JSON.stringify(e.completeAddress),
    e.creditCardsAccepted.join(", "), JSON.stringify(e.about),
    JSON.stringify(e.userReviews), JSON.stringify(e.userReviewsExtended),
    e.emails.join(", "),
    e.websitePhones.join(", "), e.socials.join(", "), e.websiteDescription,
    JSON.stringify(e.people), e.phoneType, JSON.stringify(e.subRatings),
  ];
}

// ─── Haversine ────────────────────────────────────────────────────────────────

export function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371e3;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function filterAndSortWithinRadius(entries: Entry[], lat: number, lon: number, radius: number): Entry[] {
  return entries
    .map((e) => ({ entry: e, dist: haversineDistance(lat, lon, e.latitude, e.longitude) }))
    .filter((x) => x.dist <= radius)
    .sort((a, b) => a.dist - b.dist)
    .map((x) => x.entry);
}

// ─── URL helpers ──────────────────────────────────────────────────────────────

/**
 * Construct a Google Maps place URL from a dataId (CID pair).
 * The dataId format is "0xA:0xB" where B is the place's CID in hex.
 * Google Maps resolves /maps/place/?cid=<decimal> to the correct place page,
 * which means fetchPlaceDetails can enrich grid-mode entries that otherwise
 * arrive without a link from the pb search endpoint.
 */
export function linkFromDataId(dataId: string): string {
  if (!dataId) return "";
  const parts = dataId.split(":");
  if (parts.length !== 2) return "";
  const cidHex = parts[1]!.replace("0x", "");
  const cid = BigInt("0x" + cidHex).toString(10);
  return `https://www.google.com/maps/place/?cid=${cid}`;
}

export function extractActualUrl(googleUrl: string): string {
  if (!googleUrl || !googleUrl.startsWith("/url?q=")) return googleUrl;
  try {
    const parsed = new URL("https://www.google.com" + googleUrl);
    return parsed.searchParams.get("q") || googleUrl;
  } catch {
    return googleUrl;
  }
}

function extractStreetViewUrl(images: Image[]): string {
  for (const img of images) {
    if (img.title.includes("Street View")) {
      const match = img.image.match(/panoid=([^&]+)/);
      if (match) return `https://www.google.com/maps/@?api=1&map_action=pano&pano=${match[1]}`;
    }
  }
  return "";
}

// ─── EntryFromJSON ────────────────────────────────────────────────────────────

export function entryFromJson(raw: string, reviewCountOnly = false): Entry {
  const jd = JSON.parse(raw);
  if (!Array.isArray(jd) || jd.length < 7) throw new Error("Invalid JSON structure");

  const darray = jd[6];
  if (!Array.isArray(darray)) throw new Error("Invalid JSON: darray not found");

  const entry = emptyEntry();
  entry.reviewCount = Math.floor(digNum(darray, 4, 8));

  if (reviewCountOnly) return entry;

  entry.link = digStr(darray, 27);
  entry.title = digStr(darray, 11);

  const categoriesI = digArr(darray, 13);
  entry.categories = categoriesI.filter((c) => typeof c === "string");
  entry.category = entry.categories[0] || "";

  const rawAddr = digStr(darray, 18);
  entry.address = rawAddr.startsWith(entry.title + ",")
    ? rawAddr.slice(entry.title.length + 1).trim()
    : rawAddr.trim();

  entry.openHours = getHours(darray);
  entry.popularTimes = getPopularTimes(darray);
  entry.webSite = extractActualUrl(digStr(darray, 7, 0));
  entry.phone = digStr(darray, 178, 0, 0);
  entry.plusCode = digStr(darray, 183, 2, 2, 0);
  entry.reviewRating = digNum(darray, 4, 7);
  entry.latitude = digNum(darray, 9, 2);
  entry.longitude = digNum(darray, 9, 3);
  entry.cid = digStr(jd, 25, 3, 0, 13, 0, 0, 1);
  entry.status = digStr(darray, 34, 4, 4) || digStr(darray, 88, 0);
  entry.description = digStr(darray, 32, 1, 1);
  entry.reviewsLink = digStr(darray, 4, 3, 0);
  entry.thumbnail = digStr(darray, 72, 0, 1, 6, 0);
  entry.timezone = digStr(darray, 30);
  entry.priceRange = digStr(darray, 4, 2);
  entry.dataId = digStr(darray, 10);
  entry.placeId = digStr(darray, 78);

  // Images
  const imgArr = digArr(darray, 171, 0);
  entry.images = imgArr.map((item) => ({
    title: digStr(item, 2),
    image: digStr(item, 3, 0, 6, 0),
  })).filter((img) => img.image);
  entry.streetViewUrl = extractStreetViewUrl(entry.images);

  // Reservations
  entry.reservations = getLinkSources(digArr(darray, 46), [0], [1]);

  // Order online
  let orderArr = digArr(darray, 75, 0, 1, 2);
  if (orderArr.length === 0) orderArr = digArr(darray, 75, 0, 0, 2);
  entry.orderOnline = getLinkSources(orderArr, [1, 2, 0], [0, 0]);

  // Menu
  entry.menu = { link: digStr(darray, 38, 0), source: digStr(darray, 38, 1) };

  // Owner
  const ownerId = digStr(darray, 57, 2);
  entry.owner = {
    id: ownerId,
    name: digStr(darray, 57, 1),
    link: ownerId ? `https://www.google.com/maps/contrib/${ownerId}` : "",
  };

  // Complete address
  entry.completeAddress = {
    borough: digStr(darray, 183, 1, 0),
    street: digStr(darray, 183, 1, 1),
    city: digStr(darray, 183, 1, 3),
    postalCode: digStr(darray, 183, 1, 4),
    state: digStr(darray, 183, 1, 5),
    country: digStr(darray, 183, 1, 6),
  };

  // About
  const aboutI = digArr(darray, 100, 1);
  for (const el of aboutI) {
    if (!Array.isArray(el)) continue;
    const about: About = { id: digStr(el, 0), name: digStr(el, 1), options: [] };
    const optsI = digArr(el, 2);
    for (const optEl of optsI) {
      if (!Array.isArray(optEl)) continue;
      const opt: Option = {
        enabled: digNum(optEl, 2, 1, 0, 0) === 1,
        name: digStr(optEl, 1),
        values: getOptionValues(optEl),
      };
      if (opt.name) about.options.push(opt);
      if (about.id === "payments" && opt.name === "Credit cards" && opt.values.length > 0) {
        entry.creditCardsAccepted = [...new Set([...entry.creditCardsAccepted, ...opt.values])];
      }
    }
    entry.about.push(about);
  }

  // Reviews per rating
  entry.reviewsPerRating = {
    1: Math.floor(digNum(darray, 175, 3, 0)),
    2: Math.floor(digNum(darray, 175, 3, 1)),
    3: Math.floor(digNum(darray, 175, 3, 2)),
    4: Math.floor(digNum(darray, 175, 3, 3)),
    5: Math.floor(digNum(darray, 175, 3, 4)),
  };

  // Per-category sub-ratings (e.g. hotels: Service, Cleanliness, Rooms).
  // Best-effort: Google only includes these for some categories; a miss yields [].
  entry.subRatings = getSubRatings(darray);

  // Inline reviews
  let reviewsI = digArr(darray, 175, 9, 0, 0);
  if (reviewsI.length === 0) reviewsI = digArr(darray, 175, 9, 0);
  entry.userReviews = reviewsI.length > 0 ? parseReviews(reviewsI) : [];

  return entry;
}

// ─── Search results parser ────────────────────────────────────────────────────

export function parseSearchResults(raw: string): Entry[] {
  const data = JSON.parse(raw);
  if (!Array.isArray(data) || data.length === 0) throw new Error("Empty JSON data");

  const container = data[0];
  if (!Array.isArray(container)) throw new Error("Invalid business list structure");

  const items = digArr(container, 1);
  if (items.length < 2) throw new Error("Empty business list");

  const entries: Entry[] = [];
  for (let i = 1; i < items.length; i++) {
    const arr = items[i];
    if (!Array.isArray(arr)) continue;
    const business = digArr(arr, 14);
    if (business.length === 0) continue;

    const entry = emptyEntry();
    entry.id = digStr(business, 0);
    entry.title = digStr(business, 11);
    entry.categories = digArr(business, 13).map(String);
    entry.category = entry.categories[0] || "";
    entry.webSite = digStr(business, 7, 0);
    entry.reviewRating = digNum(business, 4, 7);
    entry.reviewCount = Math.floor(digNum(business, 4, 8));

    const fullAddress = digArr(business, 2);
    entry.address = fullAddress.map(String).join(", ");

    entry.latitude = digNum(business, 9, 2);
    entry.longitude = digNum(business, 9, 3);
    entry.phone = digStr(business, 178, 0, 0).replace(/ /g, "");
    entry.openHours = getHours(business);
    entry.status = digStr(business, 34, 4, 4);
    entry.timezone = digStr(business, 30);
    entry.dataId = digStr(business, 10);
    entry.link = linkFromDataId(entry.dataId);

    entries.push(entry);
  }

  return entries;
}

// ─── Reviews parser ───────────────────────────────────────────────────────────

export function parseReviews(reviewsI: any[]): Review[] {
  const result: Review[] = [];

  for (const item of reviewsI) {
    let el = digArr(item, 0);
    if (el.length === 0) {
      el = Array.isArray(item) ? item : [];
      if (el.length === 0) continue;
    }

    const name = firstNonEmpty(digStr(el, 1, 4, 5, 0), digStr(el, 1, 4, 4), digStr(el, 0, 1));
    if (!name) continue;

    const rating = Math.floor(firstNonZero(digNum(el, 2, 0, 0), digNum(el, 2, 0), digNum(el, 1, 0, 0)));

    const review: Review = {
      name,
      profilePicture: firstNonEmpty(digStr(el, 1, 2, 0), digStr(el, 0, 2, 0)),
      rating,
      description: firstNonEmpty(digStr(el, 2, 15, 0, 0), digStr(el, 2, 15, 0), digStr(el, 3, 0)),
      images: [],
      when: firstNonEmpty(digStr(el, 1, 6), digStr(el, 3, 3), digStr(el, 2, 1, 3, 8, 0)),
      reviewId: digStr(el, 0),
      source: digStr(el, 1, 13, 0) || "unknown",
      ratingScale: Math.floor(digNum(el, 1, 13, 4)) || 5,
      ratingFloat: rating,
      authorUrl: digStr(el, 1, 4, 2, 0),
      postedAtUnixMicros: Math.floor(digNum(el, 1, 2)),
      updatedAtUnixMicros: Math.floor(digNum(el, 1, 3)),
      language: digStr(el, 2, 14, 0),
      translatedLang: digStr(el, 2, 14, 1),
      textOriginal: digStr(el, 2, 15, 0, 0),
      textTranslated: digStr(el, 2, 15, 1, 0),
      replyText: "",
      replyTextOriginal: "",
      replyLanguage: "",
      replyTranslatedLang: "",
      replyPostedAtUnixMicros: 0,
      replyUpdatedAtUnixMicros: 0,
      publishedAt: null,
    };

    // Rating float for aggregators
    const r2 = digArr(el, 2);
    if (r2.length > 0 && r2[0] == null) {
      review.ratingFloat = digNum(el, 2, 8, 1);
    }

    // Reply
    const r3 = digArr(el, 3);
    if (r3.length >= 15 && r3[1] != null) {
      review.replyPostedAtUnixMicros = Math.floor(digNum(el, 3, 1));
      review.replyUpdatedAtUnixMicros = Math.floor(digNum(el, 3, 2));
      review.replyLanguage = digStr(el, 3, 13, 0);
      review.replyTranslatedLang = digStr(el, 3, 13, 1);
      review.replyTextOriginal = digStr(el, 3, 14, 0, 0);
      review.replyText = digStr(el, 3, 14, 1, 0);
    }

    // Published at
    const tsMicros = firstNonZero(digNum(el, 1, 2), digNum(el, 1, 3));
    if (tsMicros > 0) {
      const d = new Date(tsMicros / 1000);
      if (d.getFullYear() >= 2007 && d.getTime() <= Date.now() + 86400000) {
        review.publishedAt = d.toISOString();
      }
    }

    // Images
    const imgs = digArr(el, 2, 2);
    for (const img of imgs) {
      const url = digStr(img, 1, 6, 0);
      if (url) review.images.push(url);
    }

    result.push(review);
  }

  return result;
}

/** Extract reviews from RPC response pages */
export function extractReviewsFromRpcPage(data: string): Review[] {
  let text = data;
  if (text.startsWith(")]}'\n")) text = text.slice(5);
  else if (text.startsWith(")]}'")) text = text.slice(4);

  try {
    const jd = JSON.parse(text);
    if (!Array.isArray(jd) || jd.length < 3) return [];
    let reviewsI = digArr(jd, 2);
    if (reviewsI.length === 0) reviewsI = digArr(jd, 0);
    return parseReviews(reviewsI);
  } catch {
    return [];
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function emptyEntry(): Entry {
  return {
    id: "", link: "", cid: "", title: "", categories: [], category: "",
    address: "", openHours: {}, popularTimes: {}, webSite: "", phone: "",
    plusCode: "", reviewCount: 0, reviewRating: 0, reviewsPerRating: {},
    latitude: 0, longitude: 0, status: "", description: "", reviewsLink: "",
    thumbnail: "", timezone: "", priceRange: "", dataId: "", streetViewUrl: "",
    placeId: "", images: [], reservations: [], orderOnline: [],
    menu: { link: "", source: "" }, owner: { id: "", name: "", link: "" },
    completeAddress: { borough: "", street: "", city: "", postalCode: "", state: "", country: "" },
    creditCardsAccepted: [], about: [], userReviews: [], userReviewsExtended: [], emails: [],
    websitePhones: [], socials: [], websiteDescription: "",
    people: [], phoneType: "unknown", subRatings: [],
  };
}

function getHours(darray: any[]): Record<string, string[]> {
  let items = digArr(darray, 203, 0);
  if (items.length === 0) items = digArr(darray, 34, 1);

  const hours: Record<string, string[]> = {};
  for (const item of items) {
    if (!Array.isArray(item)) continue;
    const day = digStr(item, 0);
    if (!day) continue;

    const timeSlotsI = digArr(item, 3);
    if (timeSlotsI.length > 0) {
      const times: string[] = [];
      for (const slot of timeSlotsI) {
        const timeStr = digStr(slot, 0);
        if (timeStr) times.push(timeStr);
      }
      if (times.length > 0) hours[day] = times;
    } else {
      const timesI = digArr(item, 1);
      const times = timesI.filter((t) => typeof t === "string") as string[];
      if (times.length > 0) hours[day] = times;
    }
  }
  return hours;
}

function getPopularTimes(darray: any[]): Record<string, Record<number, number>> {
  const items = digArr(darray, 84, 0);
  const dayNames: Record<number, string> = {
    1: "Monday", 2: "Tuesday", 3: "Wednesday", 4: "Thursday",
    5: "Friday", 6: "Saturday", 7: "Sunday",
  };
  const result: Record<string, Record<number, number>> = {};

  for (const item of items) {
    if (!Array.isArray(item)) continue;
    const day = Math.floor(digNum(item, 0));
    const timesI = digArr(item, 1);
    const times: Record<number, number> = {};
    for (const t of timesI) {
      if (!Array.isArray(t) || t.length < 2) continue;
      const h = Math.floor(t[0]);
      const v = Math.floor(t[1]);
      times[h] = v;
    }
    if (dayNames[day]) result[dayNames[day]] = times;
  }
  return result;
}

function getLinkSources(arr: any[], linkPath: number[], sourcePath: number[]): LinkSource[] {
  const result: LinkSource[] = [];
  for (const item of arr) {
    if (!Array.isArray(item)) continue;
    const link = digStr(item, ...linkPath);
    const source = digStr(item, ...sourcePath);
    if (link && source) result.push({ link, source });
  }
  return result;
}

function getOptionValues(opt: any[]): string[] {
  const valuesI = digArr(opt, 2, 4, 1, 0, 0);
  const values: string[] = [];
  for (const v of valuesI) {
    const val = digStr(v, 2) || digStr(v, 3);
    if (val) values.push(val);
  }
  return values;
}

/**
 * Extract per-category sub-ratings (e.g. hotel "Service", "Cleanliness").
 * Google embeds these for some business categories in a few possible shapes.
 * We scan a small set of candidate paths and collect [category, rating] pairs.
 * Returns [] when nothing plausible is found — never throws.
 */
function getSubRatings(darray: any[]): SubRating[] {
  const result: SubRating[] = [];
  const seen = new Set<string>();

  const push = (category: string, rating: number): void => {
    if (!category || rating <= 0 || rating > 5) return;
    const key = category.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    result.push({ category, rating });
  };

  // Candidate container paths where Google has been observed to place
  // per-category rating arrays. Each candidate is an array of items shaped
  // roughly like [categoryString, ..., [ratingNumber]].
  const candidatePaths: number[][] = [
    [175, 4],
    [175, 5],
    [4, 4],
    [32, 2],
  ];

  for (const cp of candidatePaths) {
    const items = digArr(darray, ...cp);
    for (const item of items) {
      if (!Array.isArray(item)) continue;
      const category = digStr(item, 0);
      if (!category || typeof category !== "string") continue;
      // Rating may live at several offsets depending on the shape.
      const rating =
        digNum(item, 1) || digNum(item, 2, 0) || digNum(item, 1, 0) || digNum(item, 2);
      if (rating > 0 && rating <= 5) push(category, rating);
    }
    if (result.length > 0) break;
  }

  return result;
}

function firstNonEmpty(...values: string[]): string {
  return values.find((v) => v !== "") || "";
}

function firstNonZero(...values: number[]): number {
  return values.find((v) => v !== 0) || 0;
}
