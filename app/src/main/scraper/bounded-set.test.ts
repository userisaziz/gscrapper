import { describe, expect, it } from "vitest";
import { BoundedSet } from "./bounded-set";

describe("BoundedSet", () => {
  it("returns true for new keys", () => {
    const set = new BoundedSet(10);
    expect(set.add("a")).toBe(true);
    expect(set.add("b")).toBe(true);
  });

  it("returns false for duplicate keys", () => {
    const set = new BoundedSet(10);
    set.add("a");
    expect(set.add("a")).toBe(false);
  });

  it("evicts oldest entry when at capacity", () => {
    const set = new BoundedSet(3);
    set.add("a");
    set.add("b");
    set.add("c");
    // At capacity — adding "d" should evict "a"
    expect(set.add("d")).toBe(true);
    expect(set.has("a")).toBe(false);
    expect(set.has("b")).toBe(true);
    expect(set.has("d")).toBe(true);
    expect(set.size).toBe(3);
  });

  it("tracks size correctly", () => {
    const set = new BoundedSet(100);
    set.add("x");
    set.add("y");
    set.add("x"); // duplicate
    expect(set.size).toBe(2);
  });

  it("clear resets everything", () => {
    const set = new BoundedSet(10);
    set.add("a");
    set.add("b");
    set.clear();
    expect(set.size).toBe(0);
    expect(set.has("a")).toBe(false);
    expect(set.add("a")).toBe(true);
  });

  it("handles large capacity without issues", () => {
    const set = new BoundedSet(500_000);
    for (let i = 0; i < 1000; i++) {
      set.add(`key-${i}`);
    }
    expect(set.size).toBe(1000);
    expect(set.has("key-500")).toBe(true);
  });
});
