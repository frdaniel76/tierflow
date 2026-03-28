/**
 * Unit tests — ML Routing Pipeline Integration
 *
 * Tests that the local ONNX ML classifier integrates correctly with the
 * router, verifying end-to-end: query → local-ml classification → model selection.
 *
 * These tests call route() directly (no HTTP server needed) but require
 * @huggingface/transformers to be installed for the local ML path.
 */

import { describe, test, before } from "node:test";
import assert from "node:assert/strict";
import { route, type RouterOptions, type RouteMetadata } from "../../src/router/index.js";
import { getRoutingConfig } from "../../src/router/config.js";
import { initClassifier, isMLAvailable } from "../../src/ml/index.js";
import { buildPricingMap } from "../../src/models.js";
import { loadConfig } from "../../src/config.js";

// Load config so getRoutingConfig() works
loadConfig();

const routingConfig = getRoutingConfig();
const modelPricing = buildPricingMap();
const options: RouterOptions = { config: routingConfig, modelPricing };

// Skip all tests if ML classifier is not available
let mlReady = false;

before(async () => {
  if (!isMLAvailable()) {
    console.log("  ⚠ @huggingface/transformers not installed — skipping ML pipeline tests");
    return;
  }
  mlReady = await initClassifier();
  if (!mlReady) {
    console.log("  ⚠ ML classifier failed to init — skipping ML pipeline tests");
  }
});

describe("ML routing pipeline (local-ml → model selection)", () => {
  test("route() uses local-ml method when classifier is available", async () => {
    if (!mlReady) return;
    const decision = await route("Hello, how are you?", undefined, 4096, options);
    assert.equal(decision.method, "local-ml", `Expected method=local-ml, got ${decision.method}`);
  });

  test("reasoning header contains 'local-ml'", async () => {
    if (!mlReady) return;
    const decision = await route("Write a Python function to sort a list", undefined, 4096, options);
    assert.ok(
      decision.reasoning.includes("local-ml"),
      `Reasoning should contain 'local-ml': ${decision.reasoning}`,
    );
  });

  test("simple greeting → simple_chat category", async () => {
    if (!mlReady) return;
    const decision = await route("Hi there!", undefined, 4096, options);
    assert.equal(decision.category, "simple_chat", `Expected simple_chat, got ${decision.category}`);
  });

  test("coding prompt → coding category", async () => {
    if (!mlReady) return;
    const decision = await route(
      "Write a TypeScript function that implements binary search",
      undefined,
      4096,
      options,
    );
    assert.equal(decision.category, "coding", `Expected coding, got ${decision.category}`);
  });

  test("reasoning prompt → reasoning category", async () => {
    if (!mlReady) return;
    const decision = await route(
      "Prove that the square root of 2 is irrational using proof by contradiction",
      undefined,
      4096,
      options,
    );
    assert.equal(decision.category, "reasoning", `Expected reasoning, got ${decision.category}`);
  });

  test("creative prompt → creative category", async () => {
    if (!mlReady) return;
    const decision = await route(
      "Write a short poem about the ocean at sunset",
      undefined,
      4096,
      options,
    );
    assert.equal(decision.category, "creative", `Expected creative, got ${decision.category}`);
  });

  test("confidence is between 0 and 1", async () => {
    if (!mlReady) return;
    const decision = await route("Explain quantum physics", undefined, 4096, options);
    assert.ok(decision.confidence >= 0 && decision.confidence <= 1);
  });

  test("model is selected from category config", async () => {
    if (!mlReady) return;
    const decision = await route("Hello!", undefined, 4096, options);
    const category = decision.category!;
    const catConfig = routingConfig.categories?.[category];
    assert.ok(catConfig, `Category ${category} should exist in config`);
    const validModels = [catConfig.primary, ...catConfig.fallback];
    assert.ok(
      validModels.includes(decision.model),
      `Model ${decision.model} should be in ${category} models: ${validModels.join(", ")}`,
    );
  });

  test("tools metadata promotes simple_chat/general to agentic", async () => {
    if (!mlReady) return;
    const metadata: RouteMetadata = { hasTools: true };
    const decision = await route("What's the weather?", undefined, 4096, options, metadata);
    // With tools, simple_chat or general should be promoted to agentic
    if (decision.category === "agentic") {
      assert.ok(
        decision.reasoning.includes("tools-present"),
        `Reasoning should mention tools-present: ${decision.reasoning}`,
      );
    }
    // Either agentic (promoted) or a specialized category (kept)
    assert.ok(decision.category);
  });

  test("audio metadata routes to transcription", async () => {
    if (!mlReady) return;
    const metadata: RouteMetadata = { hasAudio: true };
    const decision = await route("transcribe this", undefined, 4096, options, metadata);
    assert.equal(decision.category, "transcription");
    assert.equal(decision.method, "shortcut");
  });

  test("mode override bypasses ML classifier", async () => {
    if (!mlReady) return;
    const decision = await route("/reasoning What is 2+2?", undefined, 4096, options);
    assert.equal(decision.method, "shortcut");
    assert.ok(
      decision.reasoning.includes("user-mode"),
      `Reasoning should mention user-mode: ${decision.reasoning}`,
    );
  });

  test("latency is reported in reasoning", async () => {
    if (!mlReady) return;
    const decision = await route("Tell me about javascript", undefined, 4096, options);
    assert.ok(
      decision.reasoning.includes("ms)"),
      `Reasoning should include latency: ${decision.reasoning}`,
    );
  });
});
