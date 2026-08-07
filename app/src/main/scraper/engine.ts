/**
 * ScraperEngine — orchestrates the full scraping pipeline:
 * search → place details → email extraction → CSV output.
 * Manages Playwright browser lifecycle, concurrency, timeout, and cancellation.
 */
import { chromium, Browser, BrowserContext, Page } from "playwright";
import fs from "fs";
import path from "path";
import { Entry, parseSearchResults, filterAndSortWithinRadius } from "./entry";
import { buildSearchUrl, MAX_RESULTS_PER_SEARCH } from "./search-job";
import { fetchPlaceDetails } from "./place-job";
import { extractEmailsFromWebsite } from "./email-job";
import { scrapeWebsiteData } from "./website-scraper";
import { initCsvFile, appendEntryToCsv } from "./csv-writer";
import { filterHealthyProxies, pacedDelay, randomDelay, ProxyRotator } from "./proxy";
import { BoundedSet } from "./bounded-set";
import { cooldown, detectBlock, randomUserAgent } from "./resilience";
import type { SelectorTelemetry } from "./telemetry";
import type { ReviewDateFilter } from "./reviews";
import type { ReviewStore } from "../store/reviews";
import {
  boundingBoxFromCenter,
  cellSizeKmForZoom,
  generateCellsCapped,
  subdivideCell,
  type SearchCell,
} from "./grid";
import type { APIRequestContext, APIResponse } from "playwright";
import type { JobStore, JobRecord } from "../store/jobs";
import { moduleLogger } from "../logger";

const log = moduleLogger("engine");

type EmitFn = (channel: string, data?: unknown) => void;

interface RunningJob {
  abortController: AbortController;
}

/** Concurrency limit for parallel place-detail fetching. */
const PAGE_POOL_SIZE = 3;

/**
 * Cooldown after hitting a Google block page. Overridable via env so tests
 * and unusually aggressive rate-limiting environments can tune it.
 */
function blockCooldownMs(): number {
  const fromEnv = parseInt(process.env.GMAPS_BLOCK_COOLDOWN_MS || "", 10);
  return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : 60_000;
}

/**
 * Distinguish a fatal browser crash (Chromium died / target closed) from a
 * page-level error. Crashes trigger a relaunch; page errors just skip the
 * keyword.
 */
function isBrowserCrash(err: unknown, browser: Browser | null): boolean {
  if (browser && !browser.isConnected()) return true;
  const name = err instanceof Error ? err.name : "";
  const msg = err instanceof Error ? err.message : String(err);
  return (
    name === "TargetClosedError" ||
    /target closed|browser has been closed|connection closed/i.test(msg)
  );
}

export class ScraperEngine {
  private dataFolder: string;
  private emit: EmitFn;
  private jobStore: JobStore | null;
  private telemetry: SelectorTelemetry | null;
  private reviewStore: ReviewStore | null;
  private running = new Map<string, RunningJob>();

  constructor(
    dataFolder: string,
    emit: EmitFn,
    jobStore: JobStore | null = null,
    telemetry: SelectorTelemetry | null = null,
    reviewStore: ReviewStore | null = null
  ) {
    this.dataFolder = dataFolder;
    this.emit = emit;
    this.jobStore = jobStore;
    this.telemetry = telemetry;
    this.reviewStore = reviewStore;
  }

  /**
   * Run a scraping job. This is the main entry point called from IPC.
   * Runs asynchronously — does not block the caller.
   */
  async run(job: JobRecord): Promise<void> {
    const jobId = job.id;
    const data = job.data;
    const abortController = new AbortController();
    this.running.set(jobId, { abortController });

    const csvPath = path.join(this.dataFolder, `${jobId}.csv`);
    let browser: Browser | null = null;
    let failureReason: string | null = null;

    log.info(`Job ${jobId} starting: ${data.keywords?.length ?? 0} keywords`);

    try {
      this.emitStatus(jobId, "running");
      await initCsvFile(csvPath);

      // Parse coordinates
      const lat = parseFloat(data.lat) || 0;
      const lon = parseFloat(data.lon) || 0;
      const hasGeo = lat !== 0 || lon !== 0;

      // Health-check proxies
      let proxies: string[] = data.proxies || [];
      if (proxies.length > 0) {
        this.emit("proxy:health", { total: proxies.length, healthy: 0 });
        proxies = await filterHealthyProxies(proxies);
        this.emit("proxy:health", { total: (data.proxies || []).length, healthy: proxies.length });
        log.info(`Proxy health: ${proxies.length}/${(data.proxies || []).length} healthy`);

        if (proxies.length === 0) {
          throw new Error(
            `All ${(data.proxies || []).length} proxies failed the health check. Fix them or clear the proxy list to scrape directly.`
          );
        }
      }

      // Launch browser
      const launchOpts: Record<string, unknown> = {
        headless: true,
        args: ["--disable-blink-features=AutomationControlled", "--no-sandbox"],
      };

      // Launch browser. Use the first healthy proxy as the browser-level
      // fallback; per-context rotation overrides it for each keyword.
      if (proxies.length > 0) {
        launchOpts.proxy = { server: proxies[0] };
      }

      browser = await chromium.launch(launchOpts);
      const rotator = new ProxyRotator(proxies);

      const keywords: string[] = data.keywords || [];
      const hl = data.lang || "en";
      const zoom = data.zoom || 15;
      const radius = data.radius || 10000;
      const maxDepth = data.depth || 10;
      const extractEmail = data.email || false;
      const fastMode = data.fast_mode || false;
      const delaySec = data.delay || 0;
      const maxTimeSec = data.max_time || 600;
      const monitorReviews = data.monitor_reviews || false;
      const dateFilter: ReviewDateFilter | undefined =
        data.reviews_after || data.reviews_before
          ? { after: data.reviews_after, before: data.reviews_before }
          : undefined;

      const deadline = Date.now() + maxTimeSec * 1000;
      const seen = new BoundedSet(500_000);
      let totalEntries = 0;

      for (let ki = 0; ki < keywords.length; ki++) {
        if (abortController.signal.aborted) break;
        if (Date.now() > deadline) break;

        const keyword = keywords[ki]!;

        // Pacing between searches
        if (delaySec > 0 && ki > 0) {
          const minDelay = Math.max(1, delaySec / 2);
          await pacedDelay(minDelay, delaySec);
        }

        this.emit("scrape:progress", {
          jobId,
          keyword,
          keywordIndex: ki + 1,
          totalKeywords: keywords.length,
          entriesFound: totalEntries,
        });

        try {
          // Rotate proxy per context so each keyword exits from a different IP.
          // Rotate user agents too — a constant UA across hundreds of requests
          // is a trivial automation fingerprint.
          const contextProxy = rotator.next();
          const context = await browser.newContext({
            userAgent: randomUserAgent(),
            viewport: { width: 1920, height: 1080 },
            locale: hl,
            ...(contextProxy ? { proxy: { server: contextProxy } } : {}),
          });

          const page = await context.newPage();

          let entries: Entry[];

          if (hasGeo) {
            // Grid search: fan out many pb-endpoint searches across the
            // radius. This is the only way to beat Google's per-search result
            // cap and extract everything in the area (not just the first 20).
            entries = await this.runGridSearch(page, keyword, {
              lat, lon, zoom, radius, hl, jobId, deadline, abortController,
            });
          } else {
            entries = await this.runNormalSearch(page, keyword, {
              lat, lon, zoom, radius, hl, maxDepth, hasGeo, jobId,
            });
          }

          // Deduplicate with bounded LRU set. Prefer the stable Google dataId
          // (unique per place); fall back to link, then title+coords.
          const newEntries = entries.filter((e) => {
            const key = e.dataId || e.link || e.title + e.latitude + e.longitude;
            return seen.add(key);
          });

          log.info(`Keyword "${keyword}": ${entries.length} found, ${newEntries.length} new`);

          // Process entries in parallel batches (page pool)
          totalEntries += await this.processEntriesParallel(
            context, newEntries, csvPath, jobId,
            { extractEmail, fastMode, deadline, abortController, monitorReviews, dateFilter }
          );

          await context.close().catch(() => {});
        } catch (err) {
          log.warn(`Keyword "${keyword}" failed:`, err);

          // Browser crash recovery: if Chromium itself died (OOM, sandbox
          // kill, TargetClosedError), relaunch with the same options and
          // continue with the remaining keywords instead of losing the job.
          // The loop index (ki) is the processed cursor — everything after it
          // still runs against the fresh browser.
          if (!abortController.signal.aborted && isBrowserCrash(err, browser)) {
            log.warn(`Browser crash on keyword "${keyword}" — relaunching (resuming at keyword ${ki + 1}/${keywords.length})`);
            this.emit("scrape:blocked", { jobId, keyword, reason: "browser-crash" });
            await browser.close().catch(() => {});
            browser = await chromium.launch(launchOpts);
          }
        }
      }

      // Distinguish user-cancelled jobs from natural completion.
      if (abortController.signal.aborted) {
        log.info(`Job ${jobId} cancelled: ${totalEntries} entries collected before cancel`);
        this.emitStatus(jobId, "cancelled");
        this.emit("job:cancelled", jobId);
      } else {
        log.info(`Job ${jobId} completed: ${totalEntries} entries`);
        this.emitStatus(jobId, "completed");
        this.emit("job:completed", jobId);
      }
    } catch (err: unknown) {
      let message = err instanceof Error ? err.message : "Scraping failed";
      if (message.includes("Executable doesn't exist")) {
        message =
          "Playwright browsers are not installed. Open Settings → Playwright Browsers and click Install Now, then try again.";
        failureReason = "browser-missing";
      } else if (isBrowserCrash(err, browser)) {
        failureReason = "browser-crash";
      } else if (message.toLowerCase().includes("blocked all requests") || message.toLowerCase().includes("0 results")) {
        failureReason = "all-empty";
      } else if (message.toLowerCase().includes("block") || message.toLowerCase().includes("captcha")) {
        failureReason = "captcha";
      }
      if (!abortController.signal.aborted) {
        log.error(`Job ${jobId} failed:`, message);
        if (failureReason && this.jobStore) {
          this.jobStore.updateData(jobId, { failure_reason: failureReason });
        }
        this.emitStatus(jobId, "failed");
        this.emit("scrape:error", message);
      }
    } finally {
      if (browser) {
        await browser.close().catch(() => {});
      }
      this.running.delete(jobId);
    }
  }

  /**
   * Process entries in parallel using a pool of browser pages.
   * Returns the number of successfully written entries.
   */
  private async processEntriesParallel(
    context: BrowserContext,
    entries: Entry[],
    csvPath: string,
    jobId: string,
    opts: {
      extractEmail: boolean;
      fastMode: boolean;
      deadline: number;
      abortController: AbortController;
      monitorReviews: boolean;
      dateFilter?: ReviewDateFilter;
    }
  ): Promise<number> {
    let written = 0;
    const { extractEmail, fastMode, deadline, abortController, monitorReviews, dateFilter } = opts;

    // Process in batches of PAGE_POOL_SIZE
    for (let i = 0; i < entries.length; i += PAGE_POOL_SIZE) {
      if (abortController.signal.aborted) break;

      const batch = entries.slice(i, i + PAGE_POOL_SIZE);
      const results = await Promise.allSettled(
        batch.map(async (entry) => {
          // Fetch place details if we have a link. Skip once past the deadline
          // so we still honour max_time, but ALWAYS write the entry afterwards:
          // the search-level data we already collected must never be discarded
          // just because collection ran long.
          // In fast_mode we skip enrichment entirely for maximum throughput.
          if (!fastMode && entry.link && Date.now() <= deadline) {
            const placePage = await context.newPage();
            try {
              const result = await fetchPlaceDetails(placePage, entry.link, "en", {
                extractEmail: false,
                extractReviews: monitorReviews,
                dateFilter,
              });
              Object.assign(entry, result.entry, {
                userReviewsExtended: result.entry.userReviewsExtended,
              });
            } catch {
              // Place details failed — keep search-level data
            } finally {
              await placePage.close().catch(() => {});
            }

            // Review monitoring: persist this place's reviews so changes
            // across runs (new / edited / unchanged) can be tracked.
            if (monitorReviews && this.reviewStore && entry.userReviewsExtended.length > 0) {
              try {
                const placeRef = entry.cid || entry.placeId || entry.dataId || entry.link;
                const counts = this.reviewStore.upsertBatch(
                  placeRef, jobId, entry.userReviewsExtended
                );
                this.emit("reviews:synced", {
                  jobId,
                  placeRef,
                  title: entry.title,
                  ...counts,
                });
              } catch (err) {
                log.warn("Review monitoring upsert failed:", err);
              }
            }
          }

          // Website enrichment: emails, phones, socials, description —
          // uses a real browser page so JS-rendered content is captured and
          // bot-blocking sites see a genuine Chrome fingerprint.
          if (!fastMode && extractEmail && entry.webSite && Date.now() <= deadline) {
            const sitePage = await context.newPage();
            try {
              const siteData = await scrapeWebsiteData(sitePage, entry.webSite);
              entry.emails = siteData.emails;
              entry.websitePhones = siteData.phones;
              entry.socials = siteData.socials;
              entry.websiteDescription = siteData.description;
              entry.people = siteData.people;
              entry.phoneType = siteData.phoneType;
            } catch {
              entry.emails = [];
            } finally {
              await sitePage.close().catch(() => {});
            }

            // Fallback: if the browser scrape found no emails, try the fast
            // HTTP-only extractor as a second chance (different code path).
            if (entry.emails.length === 0) {
              try {
                entry.emails = await extractEmailsFromWebsite(entry.webSite);
              } catch {
                entry.emails = [];
              }
            }
          }

          // Write to CSV (async)
          await appendEntryToCsv(csvPath, entry);
          return entry;
        })
      );

      // Count successes and emit progress
      for (const result of results) {
        if (result.status === "fulfilled") {
          written++;
          this.emit("scrape:entry", {
            jobId,
            title: result.value.title,
            count: written,
          });
        }
      }
    }

    return written;
  }

  /**
   * Whether the Chromium executable Playwright needs is present on disk.
   * Used to fail fast with a clear, actionable message instead of creating a
   * job that is guaranteed to crash on browser launch.
   *
   * When packaged we bundle the headless-shell and point Playwright at it via
   * PLAYWRIGHT_BROWSERS_PATH (see playwright-env.ts), so we verify that bundle
   * is present. Otherwise (dev, or a user who installed browsers manually) we
   * fall back to asking Playwright for its executable.
   */
  isBrowserReady(): boolean {
    try {
      const bundledPath = process.env.PLAYWRIGHT_BROWSERS_PATH;
      if (bundledPath && fs.existsSync(bundledPath)) {
        // Headless launches use the chromium-headless-shell build; confirm a
        // fully-installed one is present in the bundled folder.
        return fs.readdirSync(bundledPath).some((dir) => {
          return (
            dir.startsWith("chromium_headless_shell-") &&
            fs.existsSync(path.join(bundledPath, dir, "INSTALLATION_COMPLETE"))
          );
        });
      }
      const execPath = chromium.executablePath();
      return !!execPath && fs.existsSync(execPath);
    } catch {
      return false;
    }
  }

  /**
   * Cancel a running job by ID.
   */
  cancel(jobId: string): void {
    const running = this.running.get(jobId);
    if (running) {
      running.abortController.abort();
      this.running.delete(jobId);
    }
  }

  // ─── Search strategies ──────────────────────────────────────────────────────

  /**
   * Adaptive grid search: the only way to pull a large number of leads out of
   * Google Maps.
   *
   * A single Google search caps at ~100 results no matter how you page it
   * (there is no working offset cursor). So we split the target circle into a
   * grid of overlapping cells and run one search per cell, then merge and
   * dedupe. This is the same strategy the gosom Go scraper uses to reach
   * thousands of results per keyword.
   *
   * Two phases:
   *   1. Breadth - search every base grid cell once, so the whole radius is
   *                covered even if we later run out of time.
   *   2. Refine  - any cell that came back at the ~100 cap is "saturated"
   *                (more businesses hidden there). Subdivide it into 4
   *                higher-zoom sub-cells and re-search, recursively, bounded by
   *                depth, a total search budget, and the job deadline. This
   *                recovers leads that Google truncated in dense clusters.
   */
  private async runGridSearch(
    page: Page,
    keyword: string,
    params: {
      lat: number; lon: number; zoom: number; radius: number; hl: string;
      jobId: string; deadline: number; abortController: AbortController;
    }
  ): Promise<Entry[]> {
    const MAX_CELLS = 2000;       // base grid cap — dense grids are key to high yield
    const MAX_SEARCHES = 3000;    // total search budget across both phases
    const MAX_REFINE_DEPTH = 3;   // subdivide at most 3 levels (zoom +3)
    const MIN_CELL_KM = 0.2;      // don't subdivide below ~200m cells

    // Boost the grid zoom above the user's display zoom. Higher zoom = smaller
    // viewport per search = less overlap waste and more unique results per cell.
    // Minimum zoom 16 ensures cells are small enough for urban density.
    const gridZoom = Math.max(params.zoom + 1, 16);

    const bbox = boundingBoxFromCenter(params.lat, params.lon, params.radius);
    const cellSize = cellSizeKmForZoom(params.lat, gridZoom);
    const baseCells = generateCellsCapped(bbox, cellSize, MAX_CELLS);

    log.info(
      `Adaptive grid search "${keyword}": ${baseCells.length} base cells ` +
      `(cellSize ${cellSize.toFixed(2)}km, radius ${params.radius}m, gridZoom ${gridZoom})`
    );
    this.emit("scrape:grid", {
      jobId: params.jobId,
      keyword,
      totalCells: baseCells.length,
    });

    const all: Entry[] = [];
    const request = page.context().request;
    let searches = 0;
    let throttleCount = 0;
    const hotCells: SearchCell[] = [];

    const shouldStop = (): boolean =>
      params.abortController.signal.aborted ||
      Date.now() > params.deadline ||
      searches >= MAX_SEARCHES;

    // Adaptive pacing: base delay increases when Google throttles us.
    const pace = (): Promise<void> => {
      const baseMin = 300 + throttleCount * 200;
      const baseMax = 800 + throttleCount * 400;
      return new Promise((resolve) => setTimeout(resolve, randomDelay(baseMin, baseMax)));
    };

    // Keep only businesses inside the user's circle (nearest first) and report.
    const record = (raw: Entry[]): void => {
      const filtered = filterAndSortWithinRadius(
        raw, params.lat, params.lon, params.radius
      );
      all.push(...filtered);
      this.emit("scrape:progress", {
        jobId: params.jobId,
        keyword,
        cellsDone: searches,
        totalCells: baseCells.length,
        entriesFound: all.length,
      });
    };

    // ── Phase 1: breadth — cover every base cell once ────────────────────
    let consecutiveEmpty = 0;
    let totalResults = 0;
    const EARLY_ABORT_THRESHOLD = 5; // after this many cells, check for total failure

    for (let ci = 0; ci < baseCells.length; ci++) {
      if (shouldStop()) break;
      const cell = baseCells[ci]!;

      const raw = await this.searchCellRaw(
        request, keyword, cell.lat, cell.lon, gridZoom, params.hl
      );
      searches++;
      totalResults += raw.length;

      // Throttle heuristic: in an urban area, 3+ consecutive empty cells
      // likely means Google is suppressing results. Back off harder.
      if (raw.length === 0) {
        consecutiveEmpty++;
        if (consecutiveEmpty >= 3) throttleCount = Math.min(throttleCount + 1, 10);
      } else {
        consecutiveEmpty = 0;
      }

      // Early termination: if the first N cells ALL returned 0 results,
      // Google is almost certainly blocking us. Stop immediately instead
      // of burning 30 minutes on the remaining cells.
      if (ci + 1 >= EARLY_ABORT_THRESHOLD && totalResults === 0) {
        log.warn(
          `Grid search "${keyword}" aborted: first ${EARLY_ABORT_THRESHOLD} cells ` +
          `all returned 0 results — Google is likely blocking requests.`
        );
        this.emit("scrape:blocked", {
          jobId: params.jobId,
          keyword,
          reason: "all-empty",
          cellsChecked: ci + 1,
        });
        // Throw to fail the job with the "all-empty" reason
        throw new Error("Google blocked all requests — first 5 cells returned 0 results");
      }

      if (raw.length >= MAX_RESULTS_PER_SEARCH) {
        // Saturated: Google truncated this cell, so there are more businesses
        // here than we saw. Queue it for refinement.
        hotCells.push({ lat: cell.lat, lon: cell.lon, zoom: gridZoom, sizeKm: cellSize });
      }
      record(raw);
      log.info(
        `Grid cell ${ci + 1}/${baseCells.length}: ${raw.length} results` +
        (raw.length >= MAX_RESULTS_PER_SEARCH ? " (saturated)" : "")
      );
      if (ci < baseCells.length - 1) await pace();
    }

    // ── Phase 2: refine — subdivide saturated cells to recover overflow ──
    if (hotCells.length > 0 && !shouldStop()) {
      log.info(`Refining ${hotCells.length} saturated cell(s) via subdivision...`);
      const stack: Array<{ cell: SearchCell; depth: number }> =
        hotCells.map((cell) => ({ cell, depth: 0 }));

      while (stack.length > 0 && !shouldStop()) {
        const { cell, depth } = stack.pop()!;
        const subs = subdivideCell(cell);
        for (const sub of subs) {
          if (shouldStop()) break;
          if (sub.sizeKm < MIN_CELL_KM || depth + 1 > MAX_REFINE_DEPTH) continue;

          const raw = await this.searchCellRaw(
            request, keyword, sub.lat, sub.lon, sub.zoom, params.hl
          );
          searches++;
          record(raw);
          log.info(
            `Refine d${depth + 1} zoom${sub.zoom}: ${raw.length} results` +
            (raw.length >= MAX_RESULTS_PER_SEARCH ? " (saturated)" : "")
          );
          // Still saturated and we can go deeper? Queue another split.
          if (
            raw.length >= MAX_RESULTS_PER_SEARCH &&
            depth + 1 < MAX_REFINE_DEPTH &&
            sub.sizeKm / 2 >= MIN_CELL_KM
          ) {
            stack.push({ cell: sub, depth: depth + 1 });
          }
          await pace();
        }
      }
    }

    log.info(
      `Adaptive grid search "${keyword}" done: ${all.length} raw entries from ` +
      `${searches} searches (${hotCells.length} saturated cells refined)`
    );
    return all;
  }

  /**
   * Run a single pb search centered on a point at a given zoom and return the
   * parsed entries WITHOUT radius filtering, so the caller can inspect the raw
   * count to detect saturation. Uses the context's API request client, which
   * reuses the browser's cookies and proxy without triggering a navigation
   * (navigating to the raw pb endpoint makes the browser treat the response as
   * a download and fail with "Download is starting").
   */
  private async searchCellRaw(
    request: APIRequestContext,
    keyword: string,
    lat: number,
    lon: number,
    zoom: number,
    hl: string
  ): Promise<Entry[]> {
    const SEARCH_TIMEOUT = 30000;
    const MAX_RETRIES = 3;
    const url = buildSearchUrl({
      query: keyword,
      lat,
      lon,
      zoomLvl: zoom,
      radius: 0, // unused by buildSearchUrl; radius filtering happens in the caller
      hl,
      count: MAX_RESULTS_PER_SEARCH,
    });

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        // Hard-bounded request. Playwright's own `timeout` occasionally fails to
        // abort a stalled socket (one request hung ~15 min until ECONNRESET), so
        // race it against a timer to guarantee the search loop keeps progressing.
        const response = await new Promise<APIResponse>((resolve, reject) => {
          const timer = setTimeout(
            () => reject(new Error("cell search timed out")),
            SEARCH_TIMEOUT,
          );
          request
            .get(url, { timeout: SEARCH_TIMEOUT })
            .then((res) => {
              clearTimeout(timer);
              resolve(res);
            })
            .catch((err) => {
              clearTimeout(timer);
              reject(err);
            });
        });

        // 429 / 503 → Google is throttling us. Back off and retry.
        const status = response.status();
        if ((status === 429 || status === 503) && attempt < MAX_RETRIES) {
          const backoff = Math.min(2000 * 2 ** attempt, 15000) + randomDelay(0, 1000);
          log.warn(`Cell search throttled (HTTP ${status}), retry ${attempt + 1}/${MAX_RETRIES} after ${backoff}ms`);
          await new Promise((r) => setTimeout(r, backoff));
          continue;
        }

        if (!response.ok()) return [];
        const body = await response.text();

        // Block detection: Google serves HTML block pages (sorry, CAPTCHA,
        // rate-limit) instead of the expected JSON response. Check for
        // common block indicators.
        const isHtml = body.trimStart().startsWith("<!DOCTYPE") || body.trimStart().startsWith("<html");
        const hasBlockSignals =
          body.includes("/sorry/") ||
          body.toLowerCase().includes("unusual traffic") ||
          body.toLowerCase().includes("captcha") ||
          body.includes("google.com/recaptcha") ||
          body.includes(" automated query");

        if (isHtml || hasBlockSignals) {
          this.emit("scrape:blocked", { keyword, reason: isHtml ? "html-block" : "captcha" });
          if (attempt < MAX_RETRIES) {
            await cooldown(blockCooldownMs());
            continue;
          }
          log.warn(`Cell search blocked (${isHtml ? "HTML page" : "block signals"}) after cooldown for "${keyword}"`);
          return [];
        }

        const newlineIdx = body.indexOf("\n");
        if (newlineIdx === -1) return [];
        const jsonPart = body.slice(newlineIdx + 1);
        if (!jsonPart.trim()) return [];
        return parseSearchResults(jsonPart);
      } catch (err) {
        // Network-level failure (timeout, ECONNRESET). Retry with backoff.
        if (attempt < MAX_RETRIES) {
          const backoff = Math.min(1500 * 2 ** attempt, 12000) + randomDelay(0, 800);
          log.warn(`Cell search error (attempt ${attempt + 1}/${MAX_RETRIES}):`, err);
          await new Promise((r) => setTimeout(r, backoff));
          continue;
        }
        log.warn("Cell search failed after retries:", err);
        return [];
      }
    }
    return [];
  }

  /**
   * Normal mode: navigate to Google Maps, search, scroll to load results,
   * and extract place URLs from the DOM.
   */
  private async runNormalSearch(
    page: Page,
    keyword: string,
    params: {
      lat: number; lon: number; zoom: number; radius: number;
      hl: string; maxDepth: number; hasGeo: boolean; jobId: string;
    }
  ): Promise<Entry[]> {
    // Build the Google Maps search URL
    let mapUrl: string;
    if (params.hasGeo) {
      const encoded = encodeURIComponent(keyword);
      mapUrl = `https://www.google.com/maps/search/${encoded}/@${params.lat},${params.lon},${params.zoom}z?hl=${params.hl}`;
    } else {
      const encoded = encodeURIComponent(keyword);
      mapUrl = `https://www.google.com/maps/search/${encoded}?hl=${params.hl}`;
    }

    await page.goto(mapUrl, { waitUntil: "domcontentloaded", timeout: 30000 });

    // Dismiss cookie consent
    await this.dismissCookies(page);

    // Block detection: if Google redirected us to a CAPTCHA / sorry page,
    // cool down, then retry the navigation once before giving up on this
    // keyword (the job itself keeps going with the next keyword).
    if ((await detectBlock(page)) === "captcha") {
      this.emit("scrape:blocked", { jobId: params.jobId, keyword, reason: "captcha" });
      await cooldown(blockCooldownMs());
      await page.goto(mapUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
      await this.dismissCookies(page);
      if ((await detectBlock(page)) === "captcha") {
        log.warn(`Still blocked after cooldown for "${keyword}" — skipping keyword`);
        return [];
      }
    }

    // Check if redirected to a single place
    await page.waitForTimeout(3000);
    const currentUrl = page.url();
    if (currentUrl.includes("/maps/place/")) {
      // Single result — will be handled as a place job
      return [{ link: currentUrl } as Entry];
    }

    // Wait for results feed
    try {
      await page.waitForSelector("div[role='feed']", { timeout: 10000 });
    } catch {
      // No feed — might be a single place or no results
      this.telemetry?.record("div[role='feed']", false);
      if (page.url().includes("/maps/place/")) {
        return [{ link: page.url() } as Entry];
      }
      return [];
    }
    this.telemetry?.record("div[role='feed']", true);

    // Scroll to load more results
    await this.scrollForResults(page, params.maxDepth);

    // Extract place links from the DOM
    const links = await page.evaluate(() => {
      const anchors = document.querySelectorAll("div[role='feed'] div[jsaction] > a");
      const hrefs: string[] = [];
      anchors.forEach((a) => {
        const href = a.getAttribute("href");
        if (href && href.includes("/maps/place/")) {
          hrefs.push(href);
        }
      });
      return hrefs;
    });
    this.telemetry?.record("div[role='feed'] div[jsaction] > a", links.length > 0);

    // Convert links to minimal entries
    const typedLinks: string[] = links;
    return typedLinks.map((link) => ({ link } as Entry));
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────

  private async scrollForResults(page: Page, maxDepth: number): Promise<void> {
    let previousHeight = 0;

    for (let i = 0; i < maxDepth; i++) {
      const scrollHeight = await page.evaluate(() => {
        const el = document.querySelector("div[role='feed']");
        if (!el) return 0;
        el.scrollTop = el.scrollHeight;
        return el.scrollHeight;
      });

      if (scrollHeight === previousHeight) break;
      previousHeight = scrollHeight;

      // Wait for new content to load
      await page.waitForTimeout(Math.min(500 + i * 200, 2000));

      // Check for "end of list" marker
      const endOfList = await page.evaluate(() => {
        const el = document.querySelector("span.HlvSq");
        return !!el;
      });
      if (endOfList) break;
    }
  }

  private async dismissCookies(page: Page): Promise<void> {
    try {
      await page.evaluate(() => {
        // Try consent form buttons
        const consentForm = document.querySelector('form[action*="consent.google"]');
        if (consentForm) {
          const btn = consentForm.querySelector("button, input[type='submit']");
          if (btn) (btn as HTMLElement).click();
          return;
        }
        // Try reject/decline buttons across common languages so EU consent
        // walls don't hide the results feed regardless of the page locale.
        const rejectTexts = [
          "reject", "decline", // en
          "ablehnen",          // de
          "refuser",           // fr
          "rifiuta",           // it
          "weigeren",          // nl
          "recusar",           // pt
          "odrzuć",            // pl
          "rechazar",          // es
        ];
        const buttons = document.querySelectorAll("button, input[type='submit']");
        for (const btn of buttons) {
          const text = ((btn as HTMLElement).textContent || (btn as HTMLInputElement).value || "").toLowerCase();
          if (rejectTexts.some((t) => text.includes(t))) {
            (btn as HTMLElement).click();
            return;
          }
        }
      });
    } catch {
      /* no cookie banner */
    }
  }

  private emitStatus(jobId: string, status: string): void {
    // Persist to the job store so the status survives restarts and is
    // returned by polling, then notify the renderer for instant updates.
    this.jobStore?.updateStatus(jobId, status);
    this.emit("job:status", { id: jobId, status });
  }
}
