/**
 * Integration tests for ML classifier routing.
 *
 * Tests against the running TierFlow (:18800) + LLMRouter (:18801).
 * Verifies that ML classification results in correct model selection.
 *
 * Requires: TierFlow + LLMRouter both running.
 *
 * Usage:
 *   npx tsx test/ml-classifier-integration.test.ts
 */

const BASE = "http://127.0.0.1:18800";
const ML_BASE = "http://127.0.0.1:18801";

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
  if (!haystack.includes(needle))
    throw new Error(msg || `Expected "${haystack}" to include "${needle}"`);
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

async function classify(message: string): Promise<{ category: string; confidence: number }> {
  const res = await fetch(`${ML_BASE}/classify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, has_tools: false, has_audio: false }),
    signal: AbortSignal.timeout(5000),
  });
  return res.json() as Promise<{ category: string; confidence: number }>;
}

// Expected model prefixes per category (primary + fallbacks from tierflow.config.json)
const CATEGORY_MODELS: Record<string, string[]> = {
  simple_chat: ["gemini-2.5-flash-lite", "mistral-nemo"],
  general: ["qwen3-235b", "mimo-v2-flash", "mistral-nemo"],
  coding: ["qwen3-coder", "devstral", "qwen3-coder-next"],
  reasoning: ["gpt-oss-120b", "nemotron-3-super", "qwen3-30b-a3b-thinking"],
  creative: ["step-3.5-flash", "deepseek-v3"],
  data: ["gemini-2.5-flash-lite", "deepseek-v3"],
  agentic: ["deepseek-v3.2", "deepseek/deepseek-v3", "mimo-v2-flash", "mistral-nemo"],
  transcription: ["gemini-2.5-flash-lite"],
};

// ═══════════════════════════════════════════
// Prerequisites
// ═══════════════════════════════════════════

async function prerequisiteTests() {
  console.log("\n=== Prerequisites ===\n");

  await test("TierFlow is healthy", async () => {
    const res = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(5000) });
    assert(res.ok, `Expected 200, got ${res.status}`);
  });

  await test("LLMRouter ML classifier is responding", async () => {
    const result = await classify("hello");
    assert("category" in result, "Should return category");
    assert("confidence" in result, "Should return confidence");
  });
}

// ═══════════════════════════════════════════
// ML Classification → Correct Model Selection
// ═══════════════════════════════════════════

async function classificationTests() {
  console.log("\n=== ML Classification → Model Selection ===\n");

  await test("simple greeting → simple_chat model", async () => {
    const mlResult = await classify("Hi, how are you?");
    assert(
      mlResult.category === "simple_chat",
      `ML classified as ${mlResult.category}, expected simple_chat`,
    );

    const res = await chat("Hi, how are you?");
    assert(res.ok, `Expected 200, got ${res.status}`);
    const model = res.headers.get("x-tierflow-model") ?? "";
    const reasoning = res.headers.get("x-tierflow-reasoning") ?? "";
    assertIncludes(reasoning, "simple_chat", `Reasoning should mention simple_chat: ${reasoning}`);
    assert(
      CATEGORY_MODELS.simple_chat.some((m) => model.includes(m)),
      `Model ${model} should match simple_chat models`,
    );
  });

  await test("code request → coding model", async () => {
    const mlResult = await classify("Write a Python function to sort a list using quicksort");
    assert(
      mlResult.category === "coding",
      `ML classified as ${mlResult.category}, expected coding`,
    );

    const res = await chat("Write a Python function to sort a list using quicksort");
    assert(res.ok, `Expected 200, got ${res.status}`);
    const model = res.headers.get("x-tierflow-model") ?? "";
    const reasoning = res.headers.get("x-tierflow-reasoning") ?? "";
    assertIncludes(reasoning, "coding", `Reasoning should mention coding: ${reasoning}`);
    assert(
      CATEGORY_MODELS.coding.some((m) => model.includes(m)),
      `Model ${model} should match coding models`,
    );
  });

  await test("math proof → reasoning model", async () => {
    const mlResult = await classify(
      "Prove that the square root of 2 is irrational. Show all steps.",
    );
    assert(
      mlResult.category === "reasoning",
      `ML classified as ${mlResult.category}, expected reasoning`,
    );

    const res = await chat("Prove that the square root of 2 is irrational. Show all steps.");
    assert(res.ok, `Expected 200, got ${res.status}`);
    const model = res.headers.get("x-tierflow-model") ?? "";
    const reasoning = res.headers.get("x-tierflow-reasoning") ?? "";
    assertIncludes(reasoning, "reasoning", `Reasoning should mention reasoning: ${reasoning}`);
    assert(
      CATEGORY_MODELS.reasoning.some((m) => model.includes(m)),
      `Model ${model} should match reasoning models`,
    );
  });

  await test("creative writing → creative model", async () => {
    const mlResult = await classify("Write a short poem about the ocean at sunset");
    assert(
      mlResult.category === "creative",
      `ML classified as ${mlResult.category}, expected creative`,
    );

    const res = await chat("Write a short poem about the ocean at sunset");
    assert(res.ok, `Expected 200, got ${res.status}`);
    const model = res.headers.get("x-tierflow-model") ?? "";
    assert(
      CATEGORY_MODELS.creative.some((m) => model.includes(m)),
      `Model ${model} should match creative models`,
    );
  });
}

// ═══════════════════════════════════════════
// ML Classifier fallback (service down simulation)
// ═══════════════════════════════════════════

async function mlFallbackTests() {
  console.log("\n=== ML Classifier Behavior ===\n");

  await test("classification returns confidence score", async () => {
    const result = await classify("Explain quantum entanglement in simple terms");
    assert(result.confidence > 0, `Confidence should be > 0, got ${result.confidence}`);
    assert(result.confidence <= 1, `Confidence should be <= 1, got ${result.confidence}`);
  });

  await test("routing header includes ML confidence and latency", async () => {
    const res = await chat("What is the capital of France?");
    assert(res.ok, `Expected 200, got ${res.status}`);
    const reasoning = res.headers.get("x-tierflow-reasoning") ?? "";
    assertIncludes(reasoning, "ml:", "Reasoning should indicate ML routing");
    assertIncludes(reasoning, "conf=", "Reasoning should include confidence score");
    assertIncludes(reasoning, "ms)", "Reasoning should include latency");
  });
}

// ═══════════════════════════════════════════
// Mode overrides bypass ML
// ═══════════════════════════════════════════

async function modeOverrideTests() {
  console.log("\n=== Mode Overrides ===\n");

  await test("/reasoning prefix forces reasoning model", async () => {
    const res = await chat("/reasoning What is 2+2?");
    assert(res.ok, `Expected 200, got ${res.status}`);
    const model = res.headers.get("x-tierflow-model") ?? "";
    const reasoning = res.headers.get("x-tierflow-reasoning") ?? "";
    assert(
      CATEGORY_MODELS.reasoning.some((m) => model.includes(m)),
      `Model ${model} should be reasoning model for /reasoning override`,
    );
    assertIncludes(reasoning, "user-mode", "Reasoning should indicate user-mode override");
  });

  await test("/simple prefix forces simple_chat model", async () => {
    const res = await chat("/simple Explain quantum physics");
    assert(res.ok, `Expected 200, got ${res.status}`);
    const model = res.headers.get("x-tierflow-model") ?? "";
    assert(
      CATEGORY_MODELS.simple_chat.some((m) => model.includes(m)),
      `Model ${model} should be simple_chat model for /simple override`,
    );
  });

  await test("[code] bracket forces coding model", async () => {
    const res = await chat("[code] Hello world");
    assert(res.ok, `Expected 200, got ${res.status}`);
    const model = res.headers.get("x-tierflow-model") ?? "";
    assert(
      CATEGORY_MODELS.coding.some((m) => model.includes(m)),
      `Model ${model} should be coding model for [code] override`,
    );
  });
}

// ═══════════════════════════════════════════
// Run all
// ═══════════════════════════════════════════

(async () => {
  console.log("ML Classifier — Integration Tests (live TierFlow + LLMRouter)");

  try {
    await prerequisiteTests();
    await classificationTests();
    await mlFallbackTests();
    await modeOverrideTests();
  } catch (err) {
    console.error("\nFATAL:", err);
    process.exit(1);
  }

  console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
})();
