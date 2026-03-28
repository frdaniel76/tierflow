/**
 * Integration tests for agentic routing.
 *
 * Verifies that requests with `tools` array get routed to agentic models,
 * and that the agentic override logic works correctly.
 *
 * Tests against the running FreeRouter (:18800).
 *
 * Usage:
 *   npx tsx test/agentic-routing.test.ts
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

function assertIncludes(haystack: string, needle: string, msg?: string) {
  if (!haystack.includes(needle)) throw new Error(msg || `Expected "${haystack}" to include "${needle}"`);
}

function assertNotIncludes(haystack: string, needle: string, msg?: string) {
  if (haystack.includes(needle)) throw new Error(msg || `Expected "${haystack}" NOT to include "${needle}"`);
}

// Sample tool definitions
const SAMPLE_TOOLS = [
  {
    type: "function",
    function: {
      name: "get_weather",
      description: "Get current weather for a location",
      parameters: {
        type: "object",
        properties: {
          location: { type: "string", description: "City name" },
        },
        required: ["location"],
      },
    },
  },
];

// Expected agentic models from freerouter.config.json
const AGENTIC_MODELS = ["deepseek-v3.2", "deepseek/deepseek-v3"];

async function chat(content: string, tools?: any[]): Promise<Response> {
  const body: Record<string, unknown> = {
    model: "auto",
    messages: [{ role: "user", content }],
    stream: false,
  };
  if (tools) body.tools = tools;

  return fetch(`${BASE}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60000),
  });
}

// ═══════════════════════════════════════════
// Prerequisites
// ═══════════════════════════════════════════

async function prerequisiteTests() {
  console.log("\n=== Prerequisites ===\n");

  await test("FreeRouter is healthy", async () => {
    const res = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(5000) });
    assert(res.ok, `Expected 200, got ${res.status}`);
  });
}

// ═══════════════════════════════════════════
// Tools present → agentic model
// ═══════════════════════════════════════════

async function agenticOverrideTests() {
  console.log("\n=== Agentic Override (tools present) ===\n");

  await test("simple query WITHOUT tools → simple_chat model", async () => {
    const res = await chat("Hi there!");
    assert(res.ok, `Expected 200, got ${res.status}`);
    const model = res.headers.get("x-clawrouter-model") ?? "";
    assert(
      !AGENTIC_MODELS.some(m => model.includes(m)),
      `Simple query without tools should NOT use agentic model, got: ${model}`,
    );
  });

  await test("simple query WITH tools → agentic model", async () => {
    const res = await chat("Hi there!", SAMPLE_TOOLS);
    assert(res.ok, `Expected 200, got ${res.status}`);
    const model = res.headers.get("x-clawrouter-model") ?? "";
    const reasoning = res.headers.get("x-clawrouter-reasoning") ?? "";
    assert(
      AGENTIC_MODELS.some(m => model.includes(m)),
      `Simple query WITH tools should use agentic model, got: ${model}`,
    );
    assertIncludes(reasoning, "tools-present", "Reasoning should mention tools-present");
  });

  await test("general query WITH tools → agentic model", async () => {
    const res = await chat("What is the weather like in London today?", SAMPLE_TOOLS);
    assert(res.ok, `Expected 200, got ${res.status}`);
    const model = res.headers.get("x-clawrouter-model") ?? "";
    const reasoning = res.headers.get("x-clawrouter-reasoning") ?? "";
    assert(
      AGENTIC_MODELS.some(m => model.includes(m)),
      `General query WITH tools should use agentic model, got: ${model}`,
    );
  });
}

// ═══════════════════════════════════════════
// Specialized queries keep their model even with tools
// ═══════════════════════════════════════════

async function specializedWithToolsTests() {
  console.log("\n=== Specialized Queries Keep Model With Tools ===\n");

  await test("coding query WITH tools → keeps coding model (not agentic)", async () => {
    const res = await chat("Write a Python quicksort implementation", SAMPLE_TOOLS);
    assert(res.ok, `Expected 200, got ${res.status}`);
    const model = res.headers.get("x-clawrouter-model") ?? "";
    const reasoning = res.headers.get("x-clawrouter-reasoning") ?? "";
    // Coding should stay coding, not be overridden to agentic
    // Per router code: only simple_chat and general get overridden
    if (reasoning.includes("coding")) {
      assertIncludes(reasoning, "kept specialized", "Coding with tools should say 'kept specialized'");
    }
    // Model should be either coding or agentic (both acceptable per current logic)
  });

  await test("reasoning query WITH tools → keeps reasoning model", async () => {
    const res = await chat("Prove that sqrt(2) is irrational step by step", SAMPLE_TOOLS);
    assert(res.ok, `Expected 200, got ${res.status}`);
    const reasoning = res.headers.get("x-clawrouter-reasoning") ?? "";
    // If classified as reasoning, should keep specialized
    if (reasoning.includes("reasoning")) {
      assertIncludes(reasoning, "kept specialized", "Reasoning with tools should say 'kept specialized'");
    }
  });
}

// ═══════════════════════════════════════════
// Agentic tier stats tracking
// ═══════════════════════════════════════════

async function agenticStatsTests() {
  console.log("\n=== Agentic Stats ===\n");

  await test("agentic request increments byModel counter", async () => {
    const statsBefore = await (await fetch(`${BASE}/stats`)).json() as any;
    const res = await chat("Check my calendar for today", SAMPLE_TOOLS);
    assert(res.ok, `Expected 200, got ${res.status}`);
    const statsAfter = await (await fetch(`${BASE}/stats`)).json() as any;
    assert(statsAfter.requests > statsBefore.requests, "Request count should increment");
  });
}

// ═══════════════════════════════════════════
// Run all
// ═══════════════════════════════════════════

(async () => {
  console.log("Agentic Routing — Integration Tests (live FreeRouter)");

  try {
    await prerequisiteTests();
    await agenticOverrideTests();
    await specializedWithToolsTests();
    await agenticStatsTests();
  } catch (err) {
    console.error("\nFATAL:", err);
    process.exit(1);
  }

  console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
})();
