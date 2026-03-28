/**
 * Integration tests for response cache in the HTTP pipeline.
 *
 * Tests against the running TierFlow (:18800) with cache enabled.
 *
 * Usage:
 *   npx tsx test/cache-integration.test.ts
 */

const BASE = "http://127.0.0.1:18800";

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
  if (actual !== expected)
    throw new Error(msg || `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

// Unique suffix to prevent cross-test cache hits
// Uses hex to avoid triggering PII detection (timestamps look like phone numbers)
let counter = 0;
function uniqueContent(base: string): string {
  return `${base} ref-${(++counter).toString(16)}x${Math.random().toString(36).slice(2, 6)}`;
}

async function chat(content: string, extra: Record<string, unknown> = {}): Promise<Response> {
  return fetch(`${BASE}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "auto",
      messages: [{ role: "user", content }],
      stream: false,
      ...extra,
    }),
    signal: AbortSignal.timeout(60000),
  });
}

async function getStats(): Promise<Record<string, any>> {
  const res = await fetch(`${BASE}/stats`);
  return res.json() as Promise<Record<string, any>>;
}

// ═══════════════════════════════════════════
// Prerequisites
// ═══════════════════════════════════════════

async function prerequisiteTests() {
  console.log("\n=== Prerequisites ===\n");

  await test("TierFlow is healthy", async () => {
    const res = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(5000) });
    assert(res.ok, `Expected 200, got ${res.status}`);
  });

  await test("cache stats available", async () => {
    const stats = await getStats();
    assert("cache" in stats, "Should have cache in stats");
    assert("hits" in stats.cache, "Should have cache.hits");
  });
}

// ═══════════════════════════════════════════
// Cache HIT/MISS flow
// ═══════════════════════════════════════════

async function hitMissTests() {
  console.log("\n=== Cache HIT/MISS ===\n");

  await test("first request returns X-Cache: MISS", async () => {
    const content = uniqueContent("What color is the sky?");
    const res = await chat(content);
    assert(res.ok, `Expected 200, got ${res.status}`);
    assertEqual(res.headers.get("x-cache"), "MISS");
  });

  await test("identical second request returns X-Cache: HIT", async () => {
    const content = uniqueContent("What is 1+1?");
    // First request (MISS)
    const res1 = await chat(content);
    assert(res1.ok, "First request should succeed");
    assertEqual(res1.headers.get("x-cache"), "MISS");

    // Second identical request (HIT)
    const res2 = await chat(content);
    assert(res2.ok, "Second request should succeed");
    assertEqual(res2.headers.get("x-cache"), "HIT");
  });

  await test("cached response body matches original", async () => {
    const content = uniqueContent("Define the word 'cache'");
    const res1 = await chat(content);
    const body1 = await res1.text();

    const res2 = await chat(content);
    const body2 = await res2.text();

    assertEqual(body1, body2, "Cached response should be identical to original");
  });

  await test("different message is a MISS", async () => {
    const content1 = uniqueContent("What is gravity?");
    const content2 = uniqueContent("What is magnetism?");

    await chat(content1); // populate cache
    const res = await chat(content2);
    assertEqual(res.headers.get("x-cache"), "MISS");
  });
}

// ═══════════════════════════════════════════
// Cache exclusions
// ═══════════════════════════════════════════

async function exclusionTests() {
  console.log("\n=== Cache Exclusions ===\n");

  await test("streaming requests are not cached", async () => {
    const content = uniqueContent("Stream test");
    // Streaming request
    const res = await fetch(`${BASE}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "auto",
        messages: [{ role: "user", content }],
        stream: true,
      }),
      signal: AbortSignal.timeout(60000),
    });
    assert(res.ok, `Expected 200, got ${res.status}`);
    // Consume stream
    await res.text();

    // No X-Cache header on streaming
    const cacheHeader = res.headers.get("x-cache");
    assertEqual(cacheHeader, null, "Streaming should not have X-Cache header");
  });

  await test("requests with tools are not cached (default)", async () => {
    const content = uniqueContent("What's the weather?");
    const tools = [
      {
        type: "function",
        function: {
          name: "get_weather",
          description: "Get weather",
          parameters: { type: "object", properties: {} },
        },
      },
    ];

    // First request with tools
    const res1 = await chat(content, { tools });
    assert(res1.ok, `Expected 200, got ${res1.status}`);
    const cache1 = res1.headers.get("x-cache");
    // Should not have cache header (tools excluded)
    assertEqual(cache1, null, "Tool requests should not be cached");
  });
}

// ═══════════════════════════════════════════
// Cache stats
// ═══════════════════════════════════════════

async function cacheStatsTests() {
  console.log("\n=== Cache Stats ===\n");

  await test("hits counter increments on cache hit", async () => {
    const before = await getStats();
    const content = uniqueContent("Stats test");
    await chat(content); // MISS
    await chat(content); // HIT
    const after = await getStats();
    assert(
      after.cache.hits > before.cache.hits,
      `hits should increase: ${before.cache.hits} -> ${after.cache.hits}`,
    );
  });

  await test("stores counter increments on cache store", async () => {
    const before = await getStats();
    await chat(uniqueContent("Store test")); // new entry stored
    const after = await getStats();
    assert(
      after.cache.stores > before.cache.stores,
      `stores should increase: ${before.cache.stores} -> ${after.cache.stores}`,
    );
  });

  await test("size reflects cached entries", async () => {
    const stats = await getStats();
    assert(stats.cache.size > 0, `Cache should have entries, got size=${stats.cache.size}`);
  });

  await test("hitRate is a valid percentage string", async () => {
    const stats = await getStats();
    assert(
      stats.cache.hitRate.endsWith("%"),
      `hitRate should end with %, got: ${stats.cache.hitRate}`,
    );
    const pct = parseFloat(stats.cache.hitRate);
    assert(!isNaN(pct), `hitRate should be a number, got: ${stats.cache.hitRate}`);
    assert(pct >= 0 && pct <= 100, `hitRate should be 0-100, got: ${pct}`);
  });
}

// ═══════════════════════════════════════════
// Cache performance
// ═══════════════════════════════════════════

async function performanceTests() {
  console.log("\n=== Cache Performance ===\n");

  await test("cache hit is faster than cache miss", async () => {
    const content = uniqueContent("Performance test");

    // First request (MISS — calls LLM)
    const t1Start = Date.now();
    await chat(content);
    const t1 = Date.now() - t1Start;

    // Second request (HIT — from cache)
    const t2Start = Date.now();
    await chat(content);
    const t2 = Date.now() - t2Start;

    assert(t2 < t1, `Cache hit (${t2}ms) should be faster than miss (${t1}ms)`);
    assert(t2 < 100, `Cache hit should be <100ms, got ${t2}ms`);
  });
}

// ═══════════════════════════════════════════
// Run all
// ═══════════════════════════════════════════

(async () => {
  console.log("Cache — Integration Tests (live TierFlow)");

  try {
    await prerequisiteTests();
    await hitMissTests();
    await exclusionTests();
    await cacheStatsTests();
    await performanceTests();
  } catch (err) {
    console.error("\nFATAL:", err);
    process.exit(1);
  }

  console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
})();
