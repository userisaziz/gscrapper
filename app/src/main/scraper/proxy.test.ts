import { describe, expect, it } from "vitest";
import { randomDelay, pacedDelay, ProxyRotator } from "./proxy";

describe("randomDelay", () => {
  it("returns minMs when maxMs <= minMs", () => {
    expect(randomDelay(100, 100)).toBe(100);
    expect(randomDelay(200, 50)).toBe(200);
  });

  it("returns value within [minMs, maxMs)", () => {
    for (let i = 0; i < 100; i++) {
      const val = randomDelay(10, 20);
      expect(val).toBeGreaterThanOrEqual(10);
      expect(val).toBeLessThan(20);
    }
  });
});

describe("pacedDelay", () => {
  it("resolves within expected time range", async () => {
    const start = Date.now();
    await pacedDelay(0.01, 0.02); // 10-20ms
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(5); // allow timer imprecision
    expect(elapsed).toBeLessThan(100);
  });
});

describe("ProxyRotator", () => {
  it("returns null for empty proxy list", () => {
    const rotator = new ProxyRotator([]);
    expect(rotator.next()).toBeNull();
    expect(rotator.next()).toBeNull();
    expect(rotator.size).toBe(0);
  });

  it("cycles through proxies in round-robin order", () => {
    const rotator = new ProxyRotator(["http://a:1", "http://b:2", "http://c:3"]);
    expect(rotator.size).toBe(3);
    expect(rotator.next()).toBe("http://a:1");
    expect(rotator.next()).toBe("http://b:2");
    expect(rotator.next()).toBe("http://c:3");
    // wraps around
    expect(rotator.next()).toBe("http://a:1");
    expect(rotator.next()).toBe("http://b:2");
  });

  it("always returns the same proxy for a single-entry list", () => {
    const rotator = new ProxyRotator(["http://only:8080"]);
    for (let i = 0; i < 5; i++) {
      expect(rotator.next()).toBe("http://only:8080");
    }
  });
});
