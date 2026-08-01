/**
 * ReviewStore — persists Google reviews per place across scraping runs so we
 * can detect what changed (new reviews, edited ratings/text) between runs.
 *
 * Lives in its own `reviews.db` to avoid migrating the jobs schema.
 * Change detection is per-place (`cid`/`placeId`) on the same machine — it is
 * a local tracking aid, not a distributed audit trail.
 */
import Database from "better-sqlite3";
import { createHash } from "crypto";
import type { Review } from "../scraper/entry";

export interface UpsertResult {
  added: number;
  updated: number;
  unchanged: number;
}

export interface ReviewStatsSummary {
  total: number;
  by_status: Record<string, number>;
  by_rating: Record<string, number>;
}

const CREATE_REVIEWS = `
  CREATE TABLE IF NOT EXISTS reviews (
    review_id TEXT NOT NULL,
    place_ref TEXT NOT NULL,
    author TEXT NOT NULL DEFAULT '',
    rating INTEGER NOT NULL DEFAULT 0,
    text TEXT NOT NULL DEFAULT '',
    language TEXT NOT NULL DEFAULT '',
    images TEXT NOT NULL DEFAULT '[]',
    published_at TEXT NOT NULL DEFAULT '',
    first_seen_job TEXT NOT NULL,
    last_seen_job TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'new',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (review_id, place_ref)
  )
`;

export class ReviewStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(CREATE_REVIEWS);
  }

  /**
   * Upsert one place's reviews for a job run:
   *  - absent → insert with status 'new'
   *  - present with changed rating or text → update + status 'updated'
   *  - present and identical → touch last_seen_job + status 'unchanged'
   */
  upsertBatch(placeRef: string, jobId: string, reviews: Review[]): UpsertResult {
    const result: UpsertResult = { added: 0, updated: 0, unchanged: 0 };
    const now = new Date().toISOString();

    const get = this.db.prepare(
      "SELECT rating, text FROM reviews WHERE review_id = ? AND place_ref = ?"
    );
    const insert = this.db.prepare(
      `INSERT INTO reviews
         (review_id, place_ref, author, rating, text, language, images,
          published_at, first_seen_job, last_seen_job, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?)`
    );
    const markUpdated = this.db.prepare(
      `UPDATE reviews
       SET rating = ?, text = ?, language = ?, images = ?, published_at = ?,
           last_seen_job = ?, status = 'updated', updated_at = ?
       WHERE review_id = ? AND place_ref = ?`
    );
    const touch = this.db.prepare(
      `UPDATE reviews SET last_seen_job = ?, status = 'unchanged'
       WHERE review_id = ? AND place_ref = ?`
    );

    const runBatch = this.db.transaction((batch: Review[]) => {
      for (const review of batch) {
        const reviewId = stableReviewId(review);
        const text = review.description || "";
        const rating = review.rating || 0;
        const existing = get.get(reviewId, placeRef) as
          | { rating: number; text: string }
          | undefined;

        if (!existing) {
          insert.run(
            reviewId, placeRef, review.name || "", rating, text,
            review.language || "", JSON.stringify(review.images || []),
            review.when || "", jobId, jobId, now, now
          );
          result.added++;
        } else if (existing.rating !== rating || existing.text !== text) {
          markUpdated.run(
            rating, text, review.language || "",
            JSON.stringify(review.images || []), review.when || "",
            jobId, now, reviewId, placeRef
          );
          result.updated++;
        } else {
          touch.run(jobId, reviewId, placeRef);
          result.unchanged++;
        }
      }
    });

    runBatch(reviews);
    return result;
  }

  /** Aggregate counts by status and by rating, optionally for one place. */
  stats(placeRef?: string): ReviewStatsSummary {
    const where = placeRef ? " WHERE place_ref = ?" : "";
    const params: unknown[] = placeRef ? [placeRef] : [];

    const totalRow = this.db
      .prepare(`SELECT COUNT(*) AS n FROM reviews${where}`)
      .get(...params) as { n: number };

    const by_status: Record<string, number> = {};
    const statusRows = this.db
      .prepare(`SELECT status, COUNT(*) AS n FROM reviews${where} GROUP BY status`)
      .all(...params) as Array<{ status: string; n: number }>;
    for (const row of statusRows) by_status[row.status] = row.n;

    const by_rating: Record<string, number> = {};
    const ratingRows = this.db
      .prepare(`SELECT rating, COUNT(*) AS n FROM reviews${where} GROUP BY rating`)
      .all(...params) as Array<{ rating: number; n: number }>;
    for (const row of ratingRows) by_rating[String(row.rating)] = row.n;

    return { total: totalRow.n, by_status, by_rating };
  }

  close(): void {
    this.db.close();
  }
}

/**
 * Reviews scraped from the DOM fallback path may lack a reviewId — derive a
 * stable one from author + date + text so re-scrapes still match the row.
 */
function stableReviewId(review: Review): string {
  if (review.reviewId) return review.reviewId;
  const hash = createHash("sha1")
    .update(`${review.name}|${review.when}|${review.description}`)
    .digest("hex")
    .slice(0, 16);
  return `h-${hash}`;
}
