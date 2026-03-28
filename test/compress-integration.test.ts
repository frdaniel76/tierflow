/**
 * Integration tests for CtxPack compression in the HTTP pipeline.
 *
 * Tests against the running FreeRouter instance on :18800.
 * Verifies response headers, stats counters, and actual compression.
 *
 * Requires: FreeRouter running with `"compress": true` on openrouter provider.
 *
 * Usage:
 *   npx tsx test/compress-integration.test.ts
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
  if (actual !== expected) throw new Error(msg || `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
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

async function getStats(): Promise<Record<string, any>> {
  const res = await fetch(`${BASE}/stats`);
  return res.json() as Promise<Record<string, any>>;
}

// ═══════════════════════════════════════════
// Health check
// ═══════════════════════════════════════════

async function healthTests() {
  console.log("\n=== Prerequisite: FreeRouter running ===\n");

  await test("FreeRouter is healthy", async () => {
    const res = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(5000) });
    assert(res.ok, `Expected 200, got ${res.status}`);
  });

  await test("compress stats field exists", async () => {
    const stats = await getStats();
    assert("compress" in stats, "Stats should have 'compress' field");
    assert("compressed" in stats.compress, "compress.compressed should exist");
    assert("tokensSaved" in stats.compress, "compress.tokensSaved should exist");
    assert("errors" in stats.compress, "compress.errors should exist");
  });
}

// ═══════════════════════════════════════════
// Compression triggers on compressible content
// ═══════════════════════════════════════════

async function compressionTriggerTests() {
  console.log("\n=== Compression Triggers ===\n");

  await test("repeated lines trigger compression with savings header", async () => {
    const content = "Log output:\n" + "Processing item...\n".repeat(15) + "\n\n\n\nDone. Summarize.";
    const res = await chat(content);
    assert(res.ok, `Expected 200, got ${res.status}`);
    const savings = res.headers.get("x-ctxpack-savings");
    assert(savings !== null, "X-CtxPack-Savings header should be set");
    const pct = parseInt(savings!);
    assert(pct > 0, `Savings should be positive, got ${pct}%`);
  });

  await test("JSON in fenced block gets compacted", async () => {
    const content = 'Parse this:\n```json\n{\n  "name": "Alice",\n  "age": 30,\n  "city": "London",\n  "email": "test@example.com"\n}\n```\nWhat fields are there?';
    const res = await chat(content);
    assert(res.ok, `Expected 200, got ${res.status}`);
    const savings = res.headers.get("x-ctxpack-savings");
    assert(savings !== null, "Should have savings header for JSON content");
  });

  await test("before/after token headers are valid numbers", async () => {
    const content = "Output:\n" + "line\n".repeat(20) + "\n\n\n\nSummarize.";
    const res = await chat(content);
    assert(res.ok, `Expected 200, got ${res.status}`);
    const before = res.headers.get("x-ctxpack-before");
    const after = res.headers.get("x-ctxpack-after");
    assert(before !== null, "X-CtxPack-Before header should be set");
    assert(after !== null, "X-CtxPack-After header should be set");
    assert(parseInt(before!) > parseInt(after!), `Before (${before}) should be > After (${after})`);
  });
}

// ═══════════════════════════════════════════
// No compression on clean content
// ═══════════════════════════════════════════

async function noCompressionTests() {
  console.log("\n=== No Compression on Clean Content ===\n");

  await test("clean short message has no savings header", async () => {
    const res = await chat("What is 2 plus 2?");
    assert(res.ok, `Expected 200, got ${res.status}`);
    const savings = res.headers.get("x-ctxpack-savings");
    assertEqual(savings, null, "Should NOT have savings header for clean content");
  });
}

// ═══════════════════════════════════════════
// Stats counters increment
// ═══════════════════════════════════════════

async function statsTests() {
  console.log("\n=== Stats Counters ===\n");

  await test("compress.compressed counter increments", async () => {
    const before = await getStats();
    const content = "Logs:\n" + "PASS\n".repeat(15) + "\n\n\n\nDone. What happened?";
    const res = await chat(content);
    assert(res.ok, `Expected 200, got ${res.status}`);
    const after = await getStats();
    assert(
      after.compress.compressed > before.compress.compressed,
      `compressed: ${before.compress.compressed} → ${after.compress.compressed} (should increase)`,
    );
  });

  await test("compress.tokensSaved counter increments", async () => {
    const before = await getStats();
    const content = "Data:\n" + "Processing...\n".repeat(20) + "\n\n\n\n\nWhat is this?";
    const res = await chat(content);
    assert(res.ok, `Expected 200, got ${res.status}`);
    const after = await getStats();
    assert(
      after.compress.tokensSaved > before.compress.tokensSaved,
      `tokensSaved: ${before.compress.tokensSaved} → ${after.compress.tokensSaved} (should increase)`,
    );
  });

  await test("compress.errors stays at 0", async () => {
    const stats = await getStats();
    assertEqual(stats.compress.errors, 0, `Expected 0 errors, got ${stats.compress.errors}`);
  });
}

// ═══════════════════════════════════════════
// Response still valid after compression
// ═══════════════════════════════════════════

async function responseValidityTests() {
  console.log("\n=== Response Validity ===\n");

  await test("response is valid JSON with choices array", async () => {
    const content = "Output:\n" + "ok\n".repeat(10) + "\n\n\n\nWhat was the output?";
    const res = await chat(content);
    assert(res.ok, `Expected 200, got ${res.status}`);
    const data = await res.json() as any;
    assert(Array.isArray(data.choices), "Response should have choices array");
    assert(data.choices.length > 0, "Should have at least one choice");
    assert(typeof data.choices[0].message.content === "string", "Choice should have string content");
  });

  await test("model header is set on compressed request", async () => {
    const content = "Logs:\n" + "step done\n".repeat(10) + "\n\n\n\nSummarize.";
    const res = await chat(content);
    const model = res.headers.get("x-clawrouter-model");
    assert(model !== null, "X-TierFlow-Model header should be set");
  });
}

// ═══════════════════════════════════════════
// Run all
// ═══════════════════════════════════════════

(async () => {
  console.log("CtxPack — Integration Tests (live FreeRouter)");

  try {
    await healthTests();
    await compressionTriggerTests();
    await noCompressionTests();
    await statsTests();
    await responseValidityTests();
  } catch (err) {
    console.error("\nFATAL:", err);
    process.exit(1);
  }

  console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
})();
