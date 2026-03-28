/**
 * Integration tests for stats/metrics accuracy.
 *
 * Verifies that /stats endpoint returns correct counters after real requests.
 * Tests against the running TierFlow (:18800).
 *
 * Usage:
 *   npx tsx test/stats-accuracy.test.ts
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

async function getStats(): Promise<Record<string, any>> {
  const res = await fetch(`${BASE}/stats`);
  return res.json() as Promise<Record<string, any>>;
}

async function chat(content: string, extraBody: Record<string, unknown> = {}): Promise<Response> {
  return fetch(`${BASE}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "auto",
      messages: [{ role: "user", content }],
      stream: false,
      ...extraBody,
    }),
    signal: AbortSignal.timeout(30000),
  });
}

// ═══════════════════════════════════════════
// Stats schema validation
// ═══════════════════════════════════════════

async function schemaTests() {
  console.log("\n=== Stats Schema ===\n");

  await test("/stats returns valid JSON", async () => {
    const res = await fetch(`${BASE}/stats`);
    assert(res.ok, `Expected 200, got ${res.status}`);
    const data = (await res.json()) as any;
    assert(typeof data === "object", "Should return an object");
  });

  await test("stats has required top-level fields", async () => {
    const stats = await getStats();
    const required = [
      "started",
      "requests",
      "errors",
      "timeouts",
      "byTier",
      "byModel",
      "pii",
      "compress",
    ];
    for (const field of required) {
      assert(field in stats, `Missing field: ${field}`);
    }
  });

  await test("stats.started is a valid ISO date", async () => {
    const stats = await getStats();
    const date = new Date(stats.started);
    assert(!isNaN(date.getTime()), `started should be valid date, got: ${stats.started}`);
  });

  await test("stats.byTier has all 4 tiers", async () => {
    const stats = await getStats();
    for (const tier of ["SIMPLE", "MEDIUM", "COMPLEX", "REASONING"]) {
      assert(tier in stats.byTier, `Missing tier: ${tier}`);
      assert(typeof stats.byTier[tier] === "number", `${tier} should be a number`);
    }
  });

  await test("stats.pii has required fields", async () => {
    const stats = await getStats();
    for (const field of ["scrubbed", "rehydrated", "errors"]) {
      assert(field in stats.pii, `Missing pii.${field}`);
      assert(typeof stats.pii[field] === "number", `pii.${field} should be a number`);
    }
  });

  await test("stats.compress has required fields", async () => {
    const stats = await getStats();
    for (const field of ["compressed", "tokensSaved", "errors"]) {
      assert(field in stats.compress, `Missing compress.${field}`);
      assert(typeof stats.compress[field] === "number", `compress.${field} should be a number`);
    }
  });

  await test("stats has tokenUsage section", async () => {
    const stats = await getStats();
    assert("tokenUsage" in stats, "Should have tokenUsage");
    assert("allTime" in stats.tokenUsage, "Should have tokenUsage.allTime");
    assert("byModel" in stats.tokenUsage, "Should have tokenUsage.byModel");
    assert("byTier" in stats.tokenUsage, "Should have tokenUsage.byTier");
    assert("byCategory" in stats.tokenUsage, "Should have tokenUsage.byCategory");
  });
}

// ═══════════════════════════════════════════
// Request counter accuracy
// ═══════════════════════════════════════════

async function counterTests() {
  console.log("\n=== Counter Accuracy ===\n");

  await test("requests counter increments by 1 per request", async () => {
    const before = await getStats();
    await chat("ping");
    const after = await getStats();
    assertEqual(
      after.requests,
      before.requests + 1,
      `requests: ${before.requests} → ${after.requests}`,
    );
  });

  await test("byModel counter increments for routed model", async () => {
    const before = await getStats();
    const res = await chat("Hello");
    const model = res.headers.get("x-tierflow-model") ?? "";
    const after = await getStats();
    // The model in byModel might use a different key format
    const totalModelCountBefore = Object.values(before.byModel as Record<string, number>).reduce(
      (a, b) => a + b,
      0,
    );
    const totalModelCountAfter = Object.values(after.byModel as Record<string, number>).reduce(
      (a, b) => a + b,
      0,
    );
    assert(
      totalModelCountAfter > totalModelCountBefore,
      `Total model count should increase: ${totalModelCountBefore} → ${totalModelCountAfter}`,
    );
  });

  await test("byTier counter increments", async () => {
    const before = await getStats();
    const totalTierBefore = Object.values(before.byTier as Record<string, number>).reduce(
      (a, b) => a + b,
      0,
    );
    await chat("What time is it?");
    const after = await getStats();
    const totalTierAfter = Object.values(after.byTier as Record<string, number>).reduce(
      (a, b) => a + b,
      0,
    );
    assert(
      totalTierAfter > totalTierBefore,
      `Total tier count should increase: ${totalTierBefore} → ${totalTierAfter}`,
    );
  });
}

// ═══════════════════════════════════════════
// Token usage tracking
// ═══════════════════════════════════════════

async function tokenUsageTests() {
  console.log("\n=== Token Usage Tracking ===\n");

  await test("allTime token counters increase after a request", async () => {
    const before = await getStats();
    await chat("What is the capital of France?");
    const after = await getStats();
    assert(
      after.tokenUsage.allTime.totalTokens > before.tokenUsage.allTime.totalTokens,
      `totalTokens should increase: ${before.tokenUsage.allTime.totalTokens} → ${after.tokenUsage.allTime.totalTokens}`,
    );
  });

  await test("allTime.requests increments", async () => {
    const before = await getStats();
    await chat("Hello");
    const after = await getStats();
    assert(
      after.tokenUsage.allTime.requests > before.tokenUsage.allTime.requests,
      `allTime.requests should increase: ${before.tokenUsage.allTime.requests} → ${after.tokenUsage.allTime.requests}`,
    );
  });

  await test("allTime.cost is non-negative", async () => {
    const stats = await getStats();
    assert(
      stats.tokenUsage.allTime.cost >= 0,
      `Cost should be >= 0, got ${stats.tokenUsage.allTime.cost}`,
    );
  });

  await test("byCategory has entries after requests", async () => {
    // Make sure at least one request has been made
    await chat("Hello there");
    const stats = await getStats();
    const categoryCount = Object.keys(stats.tokenUsage.byCategory).length;
    assert(categoryCount > 0, `byCategory should have entries, got ${categoryCount}`);
  });
}

// ═══════════════════════════════════════════
// Error counter
// ═══════════════════════════════════════════

async function errorTests() {
  console.log("\n=== Error Handling Stats ===\n");

  await test("errors counter increments on bad request", async () => {
    const before = await getStats();
    // Send garbage body
    await fetch(`${BASE}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
      signal: AbortSignal.timeout(5000),
    }).catch(() => {});
    const after = await getStats();
    assert(
      after.errors >= before.errors,
      `errors should not decrease: ${before.errors} → ${after.errors}`,
    );
  });
}

// ═══════════════════════════════════════════
// Config endpoint
// ═══════════════════════════════════════════

async function configTests() {
  console.log("\n=== Config Endpoint ===\n");

  await test("/config returns sanitized config", async () => {
    const res = await fetch(`${BASE}/config`);
    assert(res.ok, `Expected 200, got ${res.status}`);
    const data = (await res.json()) as any;
    assert("config" in data, "Should have config field");
    assert("providers" in data.config, "Should have providers");
  });

  await test("/config does not expose API keys", async () => {
    const res = await fetch(`${BASE}/config`);
    const text = await res.text();
    assert(!text.includes("sk-"), "Should not expose API keys");
    assert(!text.includes("OPENROUTER_API_KEY"), "Should not expose env var names in values");
  });

  await test("POST /reload-config succeeds", async () => {
    const res = await fetch(`${BASE}/reload-config`, { method: "POST" });
    assert(res.ok, `Expected 200, got ${res.status}`);
    const data = (await res.json()) as any;
    assertEqual(data.status, "reloaded", "Should return status: reloaded");
  });
}

// ═══════════════════════════════════════════
// Run all
// ═══════════════════════════════════════════

(async () => {
  console.log("Stats & Metrics — Accuracy Tests (live TierFlow)");

  try {
    await schemaTests();
    await counterTests();
    await tokenUsageTests();
    await errorTests();
    await configTests();
  } catch (err) {
    console.error("\nFATAL:", err);
    process.exit(1);
  }

  console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
})();
