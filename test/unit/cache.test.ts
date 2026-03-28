/**
 * Unit tests — LRU Cache Store
 */

import { describe, test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { LRUCache, buildCacheKey, normalizePrompt } from "../../src/cache/index.js";

describe("normalizePrompt", () => {
  test("lowercases text", () => {
    assert.equal(normalizePrompt("Hello World"), "hello world");
  });

  test("collapses whitespace", () => {
    assert.equal(normalizePrompt("hello   world\n\tfoo"), "hello world foo");
  });

  test("trims", () => {
    assert.equal(normalizePrompt("  hello  "), "hello");
  });

  test("handles empty string", () => {
    assert.equal(normalizePrompt(""), "");
  });
});

describe("buildCacheKey", () => {
  test("returns consistent hash for same input", () => {
    const msgs = [{ role: "user", content: "hello" }];
    const k1 = buildCacheKey("model-a", msgs, false);
    const k2 = buildCacheKey("model-a", msgs, false);
    assert.equal(k1, k2);
  });

  test("different models produce different keys", () => {
    const msgs = [{ role: "user", content: "hello" }];
    const k1 = buildCacheKey("model-a", msgs, false);
    const k2 = buildCacheKey("model-b", msgs, false);
    assert.notEqual(k1, k2);
  });

  test("tools flag changes key", () => {
    const msgs = [{ role: "user", content: "hello" }];
    const k1 = buildCacheKey("model-a", msgs, false);
    const k2 = buildCacheKey("model-a", msgs, true);
    assert.notEqual(k1, k2);
  });

  test("returns 64-char hex string (SHA-256)", () => {
    const key = buildCacheKey("m", [{ role: "user", content: "x" }], false);
    assert.equal(key.length, 64);
    assert.match(key, /^[0-9a-f]{64}$/);
  });
});

describe("LRUCache", () => {
  let cache: LRUCache;

  beforeEach(() => {
    cache = new LRUCache(300, 5);
  });

  test("miss returns null", () => {
    assert.equal(cache.get("nonexistent"), null);
  });

  test("set + get returns stored value", () => {
    cache.set("k1", '{"response":"hi"}', "model-a");
    assert.equal(cache.get("k1"), '{"response":"hi"}');
  });

  test("evicts oldest when at capacity", () => {
    for (let i = 0; i < 5; i++) {
      cache.set(`k${i}`, `v${i}`, "m");
    }
    // Add one more — k0 should be evicted
    cache.set("k5", "v5", "m");
    assert.equal(cache.get("k0"), null);
    assert.equal(cache.get("k5"), "v5");
  });

  test("get moves entry to most-recently-used", () => {
    cache.set("k0", "v0", "m");
    cache.set("k1", "v1", "m");
    cache.set("k2", "v2", "m");
    cache.set("k3", "v3", "m");
    cache.set("k4", "v4", "m");
    // Access k0 to make it most-recently-used
    cache.get("k0");
    // Fill to evict — k1 should go (oldest after k0 was refreshed)
    cache.set("k5", "v5", "m");
    assert.equal(cache.get("k0"), "v0"); // still here
    assert.equal(cache.get("k1"), null); // evicted
  });

  test("expired entries return null", () => {
    // TTL of 1 second
    const shortCache = new LRUCache(0.001, 100); // 1ms TTL
    shortCache.set("k1", "v1", "m");
    // Wait just a bit for TTL to pass
    const start = Date.now();
    while (Date.now() - start < 5) {
      /* spin */
    }
    assert.equal(shortCache.get("k1"), null);
  });

  test("getStats tracks hits and misses", () => {
    cache.set("k1", "v1", "m");
    cache.get("k1"); // hit
    cache.get("k2"); // miss
    cache.get("k2"); // miss
    const s = cache.getStats();
    assert.equal(s.hits, 1);
    assert.equal(s.misses, 2);
    assert.equal(s.stores, 1);
    assert.equal(s.size, 1);
  });

  test("sweep removes expired entries", () => {
    const shortCache = new LRUCache(0.001, 100);
    shortCache.set("k1", "v1", "m");
    shortCache.set("k2", "v2", "m");
    const start = Date.now();
    while (Date.now() - start < 5) {
      /* spin */
    }
    shortCache.sweep();
    assert.equal(shortCache.getStats().size, 0);
  });
});
