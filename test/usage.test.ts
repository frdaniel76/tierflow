/**
 * Unit tests for token usage and cost accumulator.
 *
 * Usage:
 *   npx tsx test/usage.test.ts
 */

import { recordUsage, getUsageStats, resetUsage } from "../src/usage.js";

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

function assertEqual<T>(actual: T, expected: T, msg?: string) {
  if (actual !== expected)
    throw new Error(msg || `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(msg);
}

// ═══════════════════════════════════════════
// All-Time Accumulation
// ═══════════════════════════════════════════

async function allTimeTests() {
  console.log("\n=== All-Time Accumulation ===\n");

  await test("records prompt + completion tokens", () => {
    resetUsage();
    recordUsage("deepseek/deepseek-chat-v3", "COMPLEX", {
      prompt_tokens: 100,
      completion_tokens: 50,
      total_tokens: 150,
      cost: 0.001,
    });
    const s = getUsageStats();
    assertEqual(s.allTime.promptTokens, 100);
    assertEqual(s.allTime.completionTokens, 50);
    assertEqual(s.allTime.totalTokens, 150);
    assertEqual(s.allTime.requests, 1);
  });

  await test("accumulates across multiple requests", () => {
    resetUsage();
    recordUsage("model-a", "SIMPLE", { prompt_tokens: 10, completion_tokens: 5, cost: 0.001 });
    recordUsage("model-a", "SIMPLE", { prompt_tokens: 20, completion_tokens: 10, cost: 0.002 });
    recordUsage("model-b", "COMPLEX", { prompt_tokens: 100, completion_tokens: 50, cost: 0.01 });
    const s = getUsageStats();
    assertEqual(s.allTime.promptTokens, 130);
    assertEqual(s.allTime.completionTokens, 65);
    assertEqual(s.allTime.requests, 3);
    assert(
      Math.abs(s.allTime.cost - 0.013) < 0.0001,
      `Expected cost ~0.013, got ${s.allTime.cost}`,
    );
  });

  await test("skips zero-usage records", () => {
    resetUsage();
    recordUsage("model", "SIMPLE", { prompt_tokens: 0, completion_tokens: 0, cost: 0 });
    const s = getUsageStats();
    assertEqual(s.allTime.requests, 0);
    assertEqual(s.allTime.totalTokens, 0);
  });

  await test("handles missing fields gracefully", () => {
    resetUsage();
    recordUsage("model", "SIMPLE", {}); // all undefined
    assertEqual(getUsageStats().allTime.requests, 0);
    recordUsage("model", "SIMPLE", { prompt_tokens: 50 }); // only prompt
    assertEqual(getUsageStats().allTime.promptTokens, 50);
    assertEqual(getUsageStats().allTime.completionTokens, 0);
    assertEqual(getUsageStats().allTime.totalTokens, 50);
    assertEqual(getUsageStats().allTime.requests, 1);
  });

  await test("computes total from prompt+completion when total_tokens missing", () => {
    resetUsage();
    recordUsage("model", "SIMPLE", { prompt_tokens: 30, completion_tokens: 20 });
    assertEqual(getUsageStats().allTime.totalTokens, 50);
  });
}

// ═══════════════════════════════════════════
// By Model Breakdown
// ═══════════════════════════════════════════

async function byModelTests() {
  console.log("\n=== By Model Breakdown ===\n");

  await test("tracks tokens per model", () => {
    resetUsage();
    recordUsage("deepseek/v3", "COMPLEX", { total_tokens: 100, cost: 0.01 });
    recordUsage("deepseek/v3", "COMPLEX", { total_tokens: 200, cost: 0.02 });
    recordUsage("gemini/flash", "SIMPLE", { total_tokens: 50, cost: 0.001 });
    const s = getUsageStats();
    assertEqual(s.byModel["deepseek/v3"].tokens, 300);
    assertEqual(s.byModel["deepseek/v3"].requests, 2);
    assertEqual(s.byModel["gemini/flash"].tokens, 50);
    assertEqual(s.byModel["gemini/flash"].requests, 1);
  });

  await test("tracks cost per model", () => {
    resetUsage();
    recordUsage("model-a", "SIMPLE", { total_tokens: 100, cost: 0.005 });
    recordUsage("model-b", "COMPLEX", { total_tokens: 200, cost: 0.05 });
    const s = getUsageStats();
    assert(Math.abs(s.byModel["model-a"].cost - 0.005) < 0.0001, "model-a cost");
    assert(Math.abs(s.byModel["model-b"].cost - 0.05) < 0.0001, "model-b cost");
  });
}

// ═══════════════════════════════════════════
// By Tier Breakdown
// ═══════════════════════════════════════════

async function byTierTests() {
  console.log("\n=== By Tier Breakdown ===\n");

  await test("tracks tokens per tier", () => {
    resetUsage();
    recordUsage("model", "SIMPLE", { total_tokens: 50, cost: 0.001 });
    recordUsage("model", "COMPLEX", { total_tokens: 200, cost: 0.01 });
    recordUsage("model", "COMPLEX", { total_tokens: 300, cost: 0.02 });
    recordUsage("model", "REASONING", { total_tokens: 500, cost: 0.05 });
    const s = getUsageStats();
    assertEqual(s.byTier["SIMPLE"].tokens, 50);
    assertEqual(s.byTier["COMPLEX"].tokens, 500);
    assertEqual(s.byTier["COMPLEX"].requests, 2);
    assertEqual(s.byTier["REASONING"].tokens, 500);
  });
}

// ═══════════════════════════════════════════
// Hourly Buckets (Rolling 24h)
// ═══════════════════════════════════════════

async function hourlyTests() {
  console.log("\n=== Hourly Buckets ===\n");

  await test("creates hourly bucket for current hour", () => {
    resetUsage();
    recordUsage("model", "SIMPLE", { total_tokens: 100, cost: 0.01 });
    const s = getUsageStats();
    assertEqual(s.hourly.length, 1);
    assertEqual(s.hourly[0].tokens, 100);
    assertEqual(s.hourly[0].requests, 1);
    // Hour key should be current hour
    const expectedHour = new Date().toISOString().slice(0, 13) + ":00:00Z";
    assertEqual(s.hourly[0].hour, expectedHour);
  });

  await test("accumulates within same hour", () => {
    resetUsage();
    recordUsage("model", "SIMPLE", { total_tokens: 50, cost: 0.001 });
    recordUsage("model", "COMPLEX", { total_tokens: 150, cost: 0.01 });
    const s = getUsageStats();
    assertEqual(s.hourly.length, 1);
    assertEqual(s.hourly[0].tokens, 200);
    assertEqual(s.hourly[0].requests, 2);
  });

  await test("reset clears all data", () => {
    resetUsage();
    recordUsage("model", "SIMPLE", { total_tokens: 100, cost: 0.01 });
    resetUsage();
    const s = getUsageStats();
    assertEqual(s.allTime.totalTokens, 0);
    assertEqual(s.allTime.requests, 0);
    assertEqual(s.hourly.length, 0);
    assertEqual(Object.keys(s.byModel).length, 0);
    assertEqual(Object.keys(s.byTier).length, 0);
  });
}

// ═══════════════════════════════════════════
// Edge Cases
// ═══════════════════════════════════════════

async function edgeCaseTests() {
  console.log("\n=== Edge Cases ===\n");

  await test("handles very small costs (micro-cents)", () => {
    resetUsage();
    recordUsage("model", "SIMPLE", { total_tokens: 3, cost: 0.000004 });
    const s = getUsageStats();
    assert(s.allTime.cost > 0, "Cost should be > 0");
    assert(s.allTime.cost < 0.001, `Cost should be tiny, got ${s.allTime.cost}`);
  });

  await test("handles many models without error", () => {
    resetUsage();
    for (let i = 0; i < 50; i++) {
      recordUsage(`model-${i}`, "SIMPLE", { total_tokens: 10, cost: 0.001 });
    }
    const s = getUsageStats();
    assertEqual(Object.keys(s.byModel).length, 50);
    assertEqual(s.allTime.requests, 50);
    assertEqual(s.allTime.totalTokens, 500);
  });

  await test("handles rapid sequential calls", () => {
    resetUsage();
    for (let i = 0; i < 1000; i++) {
      recordUsage("model", "SIMPLE", { total_tokens: 1, cost: 0.000001 });
    }
    const s = getUsageStats();
    assertEqual(s.allTime.requests, 1000);
    assertEqual(s.allTime.totalTokens, 1000);
    assertEqual(s.hourly.length, 1);
    assertEqual(s.hourly[0].requests, 1000);
  });
}

// ═══════════════════════════════════════════
// Run All
// ═══════════════════════════════════════════

async function main() {
  console.log("\n╔══════════════════════════════════════╗");
  console.log("║  Token Usage Accumulator Tests       ║");
  console.log("╚══════════════════════════════════════╝");

  await allTimeTests();
  await byModelTests();
  await byTierTests();
  await hourlyTests();
  await edgeCaseTests();

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Test runner error:", err);
  process.exit(1);
});
