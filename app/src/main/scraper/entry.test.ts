import { describe, expect, it } from "vitest";
import { escapeCsvField } from "./csv-writer";
import {
  CSV_HEADERS,
  entryToCsvRow,
  haversineDistance,
  filterAndSortWithinRadius,
  extractActualUrl,
  parseSearchResults,
  emptyEntry,
  Entry,
} from "./entry";

describe("escapeCsvField", () => {
  it("returns plain values unchanged", () => {
    expect(escapeCsvField("hello")).toBe("hello");
    expect(escapeCsvField("123")).toBe("123");
  });

  it("wraps values with commas in quotes", () => {
    expect(escapeCsvField("a,b")).toBe('"a,b"');
  });

  it("escapes embedded quotes by doubling", () => {
    expect(escapeCsvField('say "hi"')).toBe('"say ""hi"""');
  });

  it("wraps values with newlines", () => {
    expect(escapeCsvField("line1\nline2")).toBe('"line1\nline2"');
  });
});

describe("haversineDistance", () => {
  it("returns 0 for same point", () => {
    expect(haversineDistance(40.7128, -74.006, 40.7128, -74.006)).toBe(0);
  });

  it("computes approximate distance between NYC and LA", () => {
    const dist = haversineDistance(40.7128, -74.006, 34.0522, -118.2437);
    // ~3944 km
    expect(dist).toBeGreaterThan(3_900_000);
    expect(dist).toBeLessThan(4_000_000);
  });
});

describe("filterAndSortWithinRadius", () => {
  const entries: Entry[] = [
    { ...emptyEntry(), title: "far", latitude: 1.0, longitude: 1.0 },
    { ...emptyEntry(), title: "near", latitude: 0.001, longitude: 0.001 },
    { ...emptyEntry(), title: "medium", latitude: 0.01, longitude: 0.01 },
  ];

  it("filters entries outside radius", () => {
    // 200m radius: only "near" (~157m) qualifies
    const result = filterAndSortWithinRadius(entries, 0, 0, 200);
    expect(result.length).toBe(1);
    expect(result[0].title).toBe("near");
  });

  it("sorts by distance ascending", () => {
    const result = filterAndSortWithinRadius(entries, 0, 0, 200_000);
    expect(result[0].title).toBe("near");
    expect(result[1].title).toBe("medium");
    expect(result[2].title).toBe("far");
  });
});

describe("extractActualUrl", () => {
  it("extracts URL from Google redirect", () => {
    const result = extractActualUrl("/url?q=http://example.com/&opi=123");
    expect(result).toBe("http://example.com/");
  });

  it("returns non-redirect URLs unchanged", () => {
    expect(extractActualUrl("http://test.com")).toBe("http://test.com");
  });

  it("handles empty string", () => {
    expect(extractActualUrl("")).toBe("");
  });
});

describe("entryToCsvRow", () => {
  it("produces correct number of columns", () => {
    const entry = emptyEntry();
    entry.title = "Test Place";
    entry.latitude = 40.7;
    entry.longitude = -74.0;
    const row = entryToCsvRow(entry);
    expect(row.length).toBe(CSV_HEADERS.length); // always matches header count
  });
});

describe("parseSearchResults", () => {
  it("throws on empty data", () => {
    expect(() => parseSearchResults("[]")).toThrow();
  });

  it("throws on invalid structure", () => {
    expect(() => parseSearchResults('[["bad"]]')).toThrow();
  });
});
