import { describe, expect, it } from "vitest";
import type { Review } from "../scraper/entry";
import { ReviewStore } from "./reviews";

// better-sqlite3 is compiled against the Electron ABI (see the
// `rebuild:native` script), so its native binding cannot be dlopen'd by
// vitest's plain-Node runtime on machines where the app build is current.
// Probe the binding once and skip the suite when it is unavailable — the
// tests still run in any environment whose binding matches Node.
let nativeAvailable = true;
try {
  new ReviewStore(":memory:");
} catch {
  nativeAvailable = false;
}

function makeReview(overrides: Partial<Review> = {}): Review {
  return {
    name: "Jane Doe",
    profilePicture: "",
    rating: 5,
    description: "Great place!",
    images: [],
    when: "2 years ago",
    reviewId: "rev-1",
    source: "google",
    ratingScale: 5,
    ratingFloat: 5,
    authorUrl: "",
    postedAtUnixMicros: 0,
    updatedAtUnixMicros: 0,
    language: "en",
    translatedLang: "",
    ...overrides,
  } as Review;
}

describe.skipIf(!nativeAvailable)("ReviewStore", () => {
  it("inserts unseen reviews as 'new'", () => {
    const store = new ReviewStore(":memory:");
    const result = store.upsertBatch("place-1", "job-1", [
      makeReview({ reviewId: "a" }),
      makeReview({ reviewId: "b", name: "John", description: "Nice" }),
    ]);

    expect(result).toEqual({ added: 2, updated: 0, unchanged: 0 });
    const stats = store.stats("place-1");
    expect(stats.total).toBe(2);
    expect(stats.by_status).toEqual({ new: 2 });
  });

  it("marks identical re-scrapes as 'unchanged'", () => {
    const store = new ReviewStore(":memory:");
    store.upsertBatch("place-1", "job-1", [makeReview({ reviewId: "a" })]);

    const result = store.upsertBatch("place-1", "job-2", [makeReview({ reviewId: "a" })]);
    expect(result).toEqual({ added: 0, updated: 0, unchanged: 1 });
    expect(store.stats("place-1").by_status).toEqual({ unchanged: 1 });
  });

  it("detects rating and text changes as 'updated'", () => {
    const store = new ReviewStore(":memory:");
    store.upsertBatch("place-1", "job-1", [makeReview({ reviewId: "a" })]);

    const ratingChange = store.upsertBatch("place-1", "job-2", [
      makeReview({ reviewId: "a", rating: 3 }),
    ]);
    expect(ratingChange).toEqual({ added: 0, updated: 1, unchanged: 0 });

    const textChange = store.upsertBatch("place-1", "job-3", [
      makeReview({ reviewId: "a", rating: 3, description: "Edited review" }),
    ]);
    expect(textChange).toEqual({ added: 0, updated: 1, unchanged: 0 });
    expect(store.stats("place-1").by_status).toEqual({ updated: 1 });
  });

  it("tracks reviews per place independently", () => {
    const store = new ReviewStore(":memory:");
    store.upsertBatch("place-1", "job-1", [makeReview({ reviewId: "a" })]);
    store.upsertBatch("place-2", "job-1", [makeReview({ reviewId: "a", description: "Other" })]);

    // Same reviewId under a different place is a distinct row.
    expect(store.stats().total).toBe(2);
    expect(store.stats("place-1").total).toBe(1);
    expect(store.stats("place-2").total).toBe(1);
  });

  it("derives a stable ID for reviews missing a reviewId", () => {
    const store = new ReviewStore(":memory:");
    const noId = makeReview({ reviewId: "" });

    const first = store.upsertBatch("place-1", "job-1", [noId]);
    expect(first.added).toBe(1);

    // Same content without reviewId must match the existing row, not insert.
    const second = store.upsertBatch("place-1", "job-2", [makeReview({ reviewId: "" })]);
    expect(second).toEqual({ added: 0, updated: 0, unchanged: 1 });
  });

  it("aggregates counts by rating", () => {
    const store = new ReviewStore(":memory:");
    store.upsertBatch("place-1", "job-1", [
      makeReview({ reviewId: "a", rating: 5 }),
      makeReview({ reviewId: "b", rating: 5 }),
      makeReview({ reviewId: "c", rating: 1, description: "Bad" }),
    ]);

    const stats = store.stats("place-1");
    expect(stats.by_rating).toEqual({ "5": 2, "1": 1 });
  });
});
