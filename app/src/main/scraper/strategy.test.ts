import { describe, expect, it } from "vitest";
import { applyStrategy, isStrategy, STRATEGIES, STRATEGY_ORDER } from "./strategy";

describe("STRATEGIES", () => {
  it("defines exactly the four presets in order", () => {
    expect(STRATEGY_ORDER).toEqual(["quick", "standard", "detailed", "deep"]);
    for (const key of STRATEGY_ORDER) {
      expect(STRATEGIES[key]).toBeDefined();
    }
  });

  it("increases coverage from quick to deep", () => {
    expect(STRATEGIES.quick.depth).toBeLessThan(STRATEGIES.standard.depth);
    expect(STRATEGIES.standard.depth).toBeLessThan(STRATEGIES.detailed.depth);
    expect(STRATEGIES.detailed.depth).toBeLessThan(STRATEGIES.deep.depth);
    expect(STRATEGIES.quick.zoom).toBeLessThanOrEqual(STRATEGIES.deep.zoom);
  });

  it("only quick enables fast mode", () => {
    expect(STRATEGIES.quick.fastMode).toBe(true);
    expect(STRATEGIES.standard.fastMode).toBe(false);
    expect(STRATEGIES.detailed.fastMode).toBe(false);
    expect(STRATEGIES.deep.fastMode).toBe(false);
  });

  it("gives every preset a description", () => {
    for (const key of STRATEGY_ORDER) {
      expect(STRATEGIES[key].description.length).toBeGreaterThan(0);
    }
  });
});

describe("isStrategy", () => {
  it("accepts known strategy keys", () => {
    for (const key of STRATEGY_ORDER) {
      expect(isStrategy(key)).toBe(true);
    }
  });

  it("rejects unknown values", () => {
    expect(isStrategy("turbo")).toBe(false);
    expect(isStrategy("")).toBe(false);
    expect(isStrategy(15)).toBe(false);
    expect(isStrategy(null)).toBe(false);
    expect(isStrategy(undefined)).toBe(false);
  });
});

describe("applyStrategy", () => {
  const base = { zoom: 15, depth: 10, radius: 10_000, fastMode: false };

  it("overrides zoom, depth and fastMode from the preset", () => {
    const resolved = applyStrategy("quick", base);
    expect(resolved).toEqual({
      zoom: STRATEGIES.quick.zoom,
      depth: STRATEGIES.quick.depth,
      fastMode: STRATEGIES.quick.fastMode,
      radius: 10_000,
    });
  });

  it("scales the radius by the preset radiusScale", () => {
    const resolved = applyStrategy("deep", { ...base, radius: 10_000 });
    expect(resolved.radius).toBe(15_000); // 10_000 * 1.5
  });

  it("keeps the radius unchanged for scale-1 presets", () => {
    for (const key of ["quick", "standard", "detailed"] as const) {
      expect(applyStrategy(key, base).radius).toBe(base.radius);
    }
  });

  it("rounds the scaled radius to an integer", () => {
    const resolved = applyStrategy("deep", { ...base, radius: 10_001 });
    expect(Number.isInteger(resolved.radius)).toBe(true);
    expect(resolved.radius).toBe(Math.round(10_001 * 1.5));
  });
});
