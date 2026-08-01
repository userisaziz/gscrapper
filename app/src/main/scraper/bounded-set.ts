/**
 * Bounded LRU deduplication set.
 * Evicts oldest entries when capacity is reached to prevent unbounded memory growth.
 *
 * Backed by a Map whose iteration order equals insertion order (JS spec).
 * Eviction grabs the first (oldest) key via the map's iterator — O(1) amortized,
 * unlike the previous Array.shift() which was O(n) per eviction.
 */
export class BoundedSet {
  private map = new Map<string, true>();
  private readonly maxSize: number;

  constructor(maxSize = 500_000) {
    this.maxSize = maxSize;
  }

  /** Returns true if the key is new (not seen before), false if duplicate. */
  add(key: string): boolean {
    if (this.map.has(key)) return false;

    // Evict oldest if at capacity
    if (this.map.size >= this.maxSize) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) {
        this.map.delete(oldest);
      }
    }

    this.map.set(key, true);
    return true;
  }

  has(key: string): boolean {
    return this.map.has(key);
  }

  get size(): number {
    return this.map.size;
  }

  clear(): void {
    this.map.clear();
  }
}
