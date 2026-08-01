import { describe, expect, it } from "vitest";
import { detectBlockFromUrl, randomUserAgent, USER_AGENTS } from "./resilience";

describe("USER_AGENTS", () => {
  it("is a non-empty pool of plausible browser UA strings", () => {
    expect(USER_AGENTS.length).toBeGreaterThanOrEqual(8);
    for (const ua of USER_AGENTS) {
      expect(ua).toMatch(/^Mozilla\/5\.0/);
      expect(ua.length).toBeGreaterThan(50);
    }
  });

  it("contains distinct entries", () => {
    expect(new Set(USER_AGENTS).size).toBe(USER_AGENTS.length);
  });
});

describe("randomUserAgent", () => {
  it("always returns a member of the pool", () => {
    for (let i = 0; i < 50; i++) {
      expect(USER_AGENTS).toContain(randomUserAgent());
    }
  });
});

describe("detectBlockFromUrl", () => {
  it("flags Google sorry / rate-limit pages", () => {
    expect(detectBlockFromUrl("https://www.google.com/sorry/index?continue=xyz")).toBe("captcha");
    expect(detectBlockFromUrl("https://www.google.com/recaptcha/api2/anchor")).toBe("captcha");
    expect(detectBlockFromUrl("https://maps.google.com/?q=x#unusual+traffic")).toBe("captcha");
  });

  it("is case-insensitive", () => {
    expect(detectBlockFromUrl("https://WWW.GOOGLE.COM/SORRY/index")).toBe("captcha");
  });

  it("passes normal search and maps URLs", () => {
    expect(detectBlockFromUrl("https://www.google.com/maps/search/cafes/@25.2,55.2,15z")).toBe("none");
    expect(detectBlockFromUrl("https://www.google.com/maps/place/Some+Business/")).toBe("none");
    expect(detectBlockFromUrl("about:blank")).toBe("none");
  });
});
