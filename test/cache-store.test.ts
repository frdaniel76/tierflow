/**
 * Unit tests for LRU Cache store.
 *
 * Usage:
 *   npx tsx test/cache-store.test.ts
 */

import { LRUCache, buildCacheKey, normalizePrompt } from "../src/cache/index.js";

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>) {
  process.stdout.write(`  ${name} ... `);
  try {
    await fn();
    console.log("PASS");
    passed++;
  } catch (err) {
    console.log("FAIL");
    console.error(`    ${err instanceof Error ? err.message : String(err)}`);
    failed++;
  }
}

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(msg);
}

function assertEqual<T>(actual: T, expected: T, msg?: string) {
  if (actual !== expected) throw new Error(msg || `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

// ═══════════════════════════════════════════
// normalizePrompt()
// ═══════════════════════════════════════════

async function normalizeTests() {
  console.log("\n=== normalizePrompt() ===\n");

  await test("lowercases text", () => {
    assertEqual(normalizePrompt("Hello World"), "hello world");
  });

  await test("collapses whitespace", () => {
    assertEqual(normalizePrompt("hello   world"), "hello world");
  });

  await test("trims leading/trailing", () => {
    assertEqual(normalizePrompt("  hello  "), "hello");
  });

  await test("collapses tabs and newlines", () => {
    assertEqual(normalizePrompt("hello\n\t\tworld"), "hello world");
  });

  await test("handles empty string", () => {
    assertEqual(normalizePrompt(""), "");
  });

  await test("identical prompts normalize to same string", () => {
    assertEqual(
      normalizePrompt("What is  the capital   of France?"),
      normalizePrompt("what is the capital of france?"),
    );
  });
}

// ═══════════════════════════════════════════
// buildCacheKey()
// ═══════════════════════════════════════════

async function cacheKeyTests() {
  console.log("\n=== buildCacheKey() ===\n");

  await test("returns a 64-char hex string (SHA-256)", () => {
    const key = buildCacheKey("auto", [{ role: "user", content: "hello" }], false);
    assertEqual(key.length, 64);
    assert(/^[0-9a-f]+$/.test(key), "Should be hex");
  });

  await test("same input produces same key", () => {
    const msgs = [{ role: "user", content: "hello" }];
    const k1 = buildCacheKey("auto", msgs, false);
    const k2 = buildCacheKey("auto", msgs, false);
    assertEqual(k1, k2);
  });

  await test("different model produces different key", () => {
    const msgs = [{ role: "user", content: "hello" }];
    const k1 = buildCacheKey("auto", msgs, false);
    const k2 = buildCacheKey("gpt-4", msgs, false);
    assert(k1 !== k2, "Different models should produce different keys");
  });

  await test("different message produces different key", () => {
    const k1 = buildCacheKey("auto", [{ role: "user", content: "hello" }], false);
    const k2 = buildCacheKey("auto", [{ role: "user", content: "world" }], false);
    assert(k1 !== k2, "Different messages should produce different keys");
  });

  await test("tools flag changes key", () => {
    const msgs = [{ role: "user", content: "hello" }];
    const k1 = buildCacheKey("auto", msgs, false);
    const k2 = buildCacheKey("auto", msgs, true);
    assert(k1 !== k2, "Tools flag should change key");
  });

  await test("whitespace normalization makes equivalent prompts match", () => {
    const k1 = buildCacheKey("auto", [{ role: "user", content: "Hello  World" }], false);
    const k2 = buildCacheKey("auto", [{ role: "user", content: "hello world" }], false);
    assertEqual(k1, k2, "Normalized prompts should match");
  });

  await test("multi-message conversation included in key", () => {
    const k1 = buildCacheKey("auto", [
      { role: "system", content: "You are helpful" },
      { role: "user", content: "hello" },
    ], false);
    const k2 = buildCacheKey("auto", [
      { role: "user", content: "hello" },
    ], false);
    assert(k1 !== k2, "Different conversation history should produce different keys");
  });

  await test("null content handled", () => {
    const key = buildCacheKey("auto", [{ role: "assistant", content: null }], false);
    assertEqual(key.length, 64);
  });
}

// ═══════════════════════════════════════════
// LRUCache — basic operations
// ═══════════════════════════════════════════

async function basicCacheTests() {
  console.log("\n=== LRUCache — Basic Operations ===\n");

  await test("get returns null for missing key", () => {
    const cache = new LRUCache(300, 100);
    assertEqual(cache.get("nonexistent"), null);
  });

  await test("set + get round-trip", () => {
    const cache = new LRUCache(300, 100);
    cache.set("key1", '{"response": "hello"}', "gpt-4");
    assertEqual(cache.get("key1"), '{"response": "hello"}');
  });

  await test("overwrite existing key", () => {
    const cache = new LRUCache(300, 100);
    cache.set("key1", "first", "gpt-4");
    cache.set("key1", "second", "gpt-4");
    assertEqual(cache.get("key1"), "second");
  });

  await test("clear removes all entries", () => {
    const cache = new LRUCache(300, 100);
    cache.set("a", "1", "m");
    cache.set("b", "2", "m");
    cache.clear();
    assertEqual(cache.get("a"), null);
    assertEqual(cache.get("b"), null);
    assertEqual(cache.getStats().size, 0);
  });
}

// ═══════════════════════════════════════════
// LRUCache — TTL expiry
// ═══════════════════════════════════════════

async function ttlTests() {
  console.log("\n=== LRUCache — TTL Expiry ===\n");

  await test("entry expires after TTL", async () => {
    const cache = new LRUCache(1, 100); // 1 second TTL
    cache.set("key1", "data", "m");
    assertEqual(cache.get("key1"), "data"); // immediate: should exist

    await new Promise(r => setTimeout(r, 1100)); // wait 1.1s
    assertEqual(cache.get("key1"), null); // should be expired
  });

  await test("sweep removes expired entries", async () => {
    const cache = new LRUCache(1, 100); // 1 second TTL
    cache.set("a", "1", "m");
    cache.set("b", "2", "m");
    assertEqual(cache.getStats().size, 2);

    await new Promise(r => setTimeout(r, 1100));
    const swept = cache.sweep();
    assertEqual(swept, 2);
    assertEqual(cache.getStats().size, 0);
  });

  await test("non-expired entries survive sweep", async () => {
    const cache = new LRUCache(10, 100); // 10 second TTL
    cache.set("a", "1", "m");
    const swept = cache.sweep();
    assertEqual(swept, 0);
    assertEqual(cache.getStats().size, 1);
  });
}

// ═══════════════════════════════════════════
// LRUCache — LRU eviction
// ═══════════════════════════════════════════

async function evictionTests() {
  console.log("\n=== LRUCache — LRU Eviction ===\n");

  await test("evicts oldest when at capacity", () => {
    const cache = new LRUCache(300, 3); // max 3 entries
    cache.set("a", "1", "m");
    cache.set("b", "2", "m");
    cache.set("c", "3", "m");
    cache.set("d", "4", "m"); // should evict "a"

    assertEqual(cache.get("a"), null, "Oldest (a) should be evicted");
    assertEqual(cache.get("b"), "2");
    assertEqual(cache.get("d"), "4");
  });

  await test("accessing an entry refreshes its LRU position", () => {
    const cache = new LRUCache(300, 3);
    cache.set("a", "1", "m");
    cache.set("b", "2", "m");
    cache.set("c", "3", "m");

    cache.get("a"); // touch "a" — moves to most recent

    cache.set("d", "4", "m"); // should evict "b" (now oldest)

    assertEqual(cache.get("a"), "1", "a should survive (was touched)");
    assertEqual(cache.get("b"), null, "b should be evicted (oldest untouched)");
    assertEqual(cache.get("d"), "4");
  });

  await test("eviction counter increments", () => {
    const cache = new LRUCache(300, 2);
    cache.set("a", "1", "m");
    cache.set("b", "2", "m");
    cache.set("c", "3", "m"); // evicts "a"
    cache.set("d", "4", "m"); // evicts "b"

    assertEqual(cache.getStats().evictions, 2);
  });
}

// ═══════════════════════════════════════════
// LRUCache — stats
// ═══════════════════════════════════════════

async function statsTests() {
  console.log("\n=== LRUCache — Stats ===\n");

  await test("tracks hits and misses", () => {
    const cache = new LRUCache(300, 100);
    cache.set("a", "1", "m");
    cache.get("a");     // hit
    cache.get("a");     // hit
    cache.get("miss");  // miss

    const s = cache.getStats();
    assertEqual(s.hits, 2);
    assertEqual(s.misses, 1);
  });

  await test("tracks stores", () => {
    const cache = new LRUCache(300, 100);
    cache.set("a", "1", "m");
    cache.set("b", "2", "m");
    assertEqual(cache.getStats().stores, 2);
  });

  await test("hit rate calculation", () => {
    const cache = new LRUCache(300, 100);
    cache.set("a", "1", "m");
    cache.get("a");     // hit
    cache.get("miss");  // miss
    assertEqual(cache.getStats().hitRate, "50.0%");
  });

  await test("hit rate 0% when no requests", () => {
    const cache = new LRUCache(300, 100);
    assertEqual(cache.getStats().hitRate, "0.0%");
  });

  await test("size reflects current entries", () => {
    const cache = new LRUCache(300, 100);
    cache.set("a", "1", "m");
    cache.set("b", "2", "m");
    assertEqual(cache.getStats().size, 2);
  });
}

// ═══════════════════════════════════════════
// Run all
// ═══════════════════════════════════════════

(async () => {
  console.log("Cache Store — Unit Tests");

  await normalizeTests();
  await cacheKeyTests();
  await basicCacheTests();
  await ttlTests();
  await evictionTests();
  await statsTests();

  console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
})();
