import { describe, expect, it } from "vitest";
import { ScrapeStartSchema, LoginSchema, JobIdSchema, parseDuration } from "./schemas";

describe("parseDuration", () => {
  it("parses seconds", () => {
    expect(parseDuration("30s")).toBe(30);
  });

  it("parses minutes", () => {
    expect(parseDuration("10m")).toBe(600);
  });

  it("parses hours", () => {
    expect(parseDuration("2h")).toBe(7200);
  });

  it("returns default 600 for invalid format", () => {
    expect(parseDuration("abc")).toBe(600);
    expect(parseDuration("")).toBe(600);
  });
});

describe("ScrapeStartSchema", () => {
  it("accepts valid input with defaults", () => {
    const result = ScrapeStartSchema.safeParse({ keywords: "restaurants" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.lang).toBe("en");
      expect(result.data.zoom).toBe(15);
      expect(result.data.depth).toBe(10);
      expect(result.data.name).toBe("Untitled Job");
    }
  });

  it("rejects empty keywords", () => {
    const result = ScrapeStartSchema.safeParse({ keywords: "" });
    expect(result.success).toBe(false);
  });

  it("rejects invalid max_time format", () => {
    const result = ScrapeStartSchema.safeParse({ keywords: "test", max_time: "10x" });
    expect(result.success).toBe(false);
  });

  it("rejects zoom out of range", () => {
    const result = ScrapeStartSchema.safeParse({ keywords: "test", zoom: 99 });
    expect(result.success).toBe(false);
  });

  it("rejects invalid lat format", () => {
    const result = ScrapeStartSchema.safeParse({ keywords: "test", lat: "abc" });
    expect(result.success).toBe(false);
  });
});

describe("LoginSchema", () => {
  it("accepts valid email and password", () => {
    const result = LoginSchema.safeParse({ email: "user@example.com", password: "secret123" });
    expect(result.success).toBe(true);
  });

  it("rejects invalid email", () => {
    const result = LoginSchema.safeParse({ email: "not-an-email", password: "secret" });
    expect(result.success).toBe(false);
  });

  it("rejects empty password", () => {
    const result = LoginSchema.safeParse({ email: "user@example.com", password: "" });
    expect(result.success).toBe(false);
  });
});

describe("JobIdSchema", () => {
  it("accepts valid UUID", () => {
    const result = JobIdSchema.safeParse("550e8400-e29b-41d4-a716-446655440000");
    expect(result.success).toBe(true);
  });

  it("rejects non-UUID string", () => {
    const result = JobIdSchema.safeParse("not-a-uuid");
    expect(result.success).toBe(false);
  });
});
