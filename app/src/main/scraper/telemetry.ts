/**
 * Selector telemetry — tracks hit/miss rates for the DOM selectors the
 * scraper relies on. When Google changes its markup, miss rates spike; the
 * Settings → Scraper Health card surfaces the most-degraded selectors so
 * maintenance can target them first.
 */
import Database from "better-sqlite3";

export interface SelectorStat {
  selector: string;
  hits: number;
  misses: number;
  last_seen: string;
  /** misses / (hits + misses), 0–1. */
  miss_rate: number;
}

const CREATE_TABLE = `
  CREATE TABLE IF NOT EXISTS selector_health (
    selector TEXT PRIMARY KEY,
    hits INTEGER NOT NULL DEFAULT 0,
    misses INTEGER NOT NULL DEFAULT 0,
    last_seen TEXT NOT NULL
  )
`;

export class SelectorTelemetry {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(CREATE_TABLE);
  }

  /** Record one observation of a selector (hit = element was found). */
  record(selector: string, hit: boolean): void {
    this.db
      .prepare(
        `INSERT INTO selector_health (selector, hits, misses, last_seen)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(selector) DO UPDATE SET
           hits = hits + excluded.hits,
           misses = misses + excluded.misses,
           last_seen = excluded.last_seen`
      )
      .run(selector, hit ? 1 : 0, hit ? 0 : 1, new Date().toISOString());
  }

  /**
   * Selector health rows ordered by miss-rate (worst first), then by
   * volume, so rarely-seen selectors don't dominate the report.
   */
  stats(limit = 50): SelectorStat[] {
    const rows = this.db
      .prepare(
        `SELECT selector, hits, misses, last_seen
         FROM selector_health
         ORDER BY (misses * 1.0 / MAX(1, hits + misses)) DESC, misses DESC
         LIMIT ?`
      )
      .all(limit) as Array<{ selector: string; hits: number; misses: number; last_seen: string }>;

    return rows.map((r) => ({
      ...r,
      miss_rate: r.misses / Math.max(1, r.hits + r.misses),
    }));
  }

  close(): void {
    this.db.close();
  }
}
