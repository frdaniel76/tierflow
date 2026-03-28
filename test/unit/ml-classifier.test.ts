/**
 * Unit tests — ML Classifier module
 *
 * Tests the local ONNX-based ML classifier.
 * These tests verify the classifier logic WITHOUT requiring @huggingface/transformers.
 * Tests that require the model are skipped if the dependency is not installed.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const trainingDataPath = join(__dirname, "../../src/ml/training-data.json");

describe("ML training data", () => {
  const data = JSON.parse(readFileSync(trainingDataPath, "utf-8"));

  test("has valid structure", () => {
    assert.ok(data.version);
    assert.ok(data.model);
    assert.equal(data.embedding_dim, 384);
    assert.ok(Array.isArray(data.categories));
    assert.ok(Array.isArray(data.examples));
  });

  test("has 8 categories", () => {
    assert.equal(data.categories.length, 8);
    const expected = [
      "simple_chat",
      "general",
      "coding",
      "reasoning",
      "creative",
      "data",
      "agentic",
      "transcription",
    ];
    assert.deepEqual(data.categories.sort(), expected.sort());
  });

  test("has at least 150 training examples", () => {
    assert.ok(data.examples.length >= 150, `Only ${data.examples.length} examples`);
  });

  test("all examples have text and category", () => {
    for (const ex of data.examples) {
      assert.ok(ex.text, `Example missing text: ${JSON.stringify(ex)}`);
      assert.ok(ex.category, `Example missing category: ${JSON.stringify(ex)}`);
      assert.ok(
        data.categories.includes(ex.category),
        `Unknown category: ${ex.category}`,
      );
    }
  });

  test("category distribution is reasonable", () => {
    const counts: Record<string, number> = {};
    for (const ex of data.examples) {
      counts[ex.category] = (counts[ex.category] || 0) + 1;
    }
    // Each category should have at least 5 examples
    for (const cat of data.categories) {
      assert.ok(
        (counts[cat] || 0) >= 5,
        `${cat} has only ${counts[cat] || 0} examples (need at least 5)`,
      );
    }
  });

  test("no duplicate examples", () => {
    const texts = data.examples.map((e: { text: string }) => e.text.toLowerCase());
    const unique = new Set(texts);
    assert.equal(
      texts.length,
      unique.size,
      `Found ${texts.length - unique.size} duplicate examples`,
    );
  });

  test("examples are not empty", () => {
    for (const ex of data.examples) {
      assert.ok(ex.text.trim().length > 0, `Empty text in ${ex.category}`);
    }
  });

  test("model ID matches expected", () => {
    assert.equal(data.model, "Xenova/all-MiniLM-L6-v2");
  });
});

describe("ML classifier module", () => {
  test("isMLAvailable returns boolean", async () => {
    const { isMLAvailable } = await import("../../src/ml/index.js");
    const result = isMLAvailable();
    assert.equal(typeof result, "boolean");
  });

  test("getClassifierStatus returns valid shape", async () => {
    const { getClassifierStatus } = await import("../../src/ml/index.js");
    const status = getClassifierStatus();
    assert.equal(typeof status.available, "boolean");
    assert.equal(typeof status.model, "string");
    assert.equal(typeof status.training_examples, "number");
    assert.equal(typeof status.method, "string");
    assert.equal(status.model, "Xenova/all-MiniLM-L6-v2");
  });

  test("classify returns result or null depending on availability", async () => {
    const { isMLAvailable, classify } = await import("../../src/ml/index.js");
    const result = await classify("hello");
    if (isMLAvailable()) {
      // If available, should return a valid result
      assert.ok(result === null || result.category);
    } else {
      assert.equal(result, null);
    }
  });
});

// These tests only run if @huggingface/transformers is installed
describe("ML classifier with model (skip if not installed)", () => {
  let classify: (q: string) => Promise<any>;
  let available = false;

  test("check if model is available", async () => {
    const mod = await import("../../src/ml/index.js");
    available = await mod.initClassifier();
    classify = mod.classify;
    // This test always passes — it just sets up the flag
    assert.ok(true);
  });

  test("classifies 'hi' as simple_chat", async () => {
    if (!available) return; // skip
    const result = await classify("hi");
    assert.ok(result);
    assert.equal(result.category, "simple_chat");
    assert.ok(result.confidence > 0.5);
  });

  test("classifies coding prompt correctly", async () => {
    if (!available) return;
    const result = await classify("write a python function to sort a list");
    assert.ok(result);
    assert.equal(result.category, "coding");
  });

  test("classifies reasoning prompt correctly", async () => {
    if (!available) return;
    const result = await classify(
      "prove that the square root of 2 is irrational",
    );
    assert.ok(result);
    assert.equal(result.category, "reasoning");
  });

  test("classifies creative prompt correctly", async () => {
    if (!available) return;
    const result = await classify("write a haiku about programming");
    assert.ok(result);
    assert.equal(result.category, "creative");
  });

  test("classifies agentic prompt correctly", async () => {
    if (!available) return;
    const result = await classify("check my email and send a reply to bob");
    assert.ok(result);
    assert.equal(result.category, "agentic");
  });

  test("returns confidence between 0 and 1", async () => {
    if (!available) return;
    const result = await classify("explain how photosynthesis works");
    assert.ok(result);
    assert.ok(result.confidence >= 0 && result.confidence <= 1);
  });

  test("returns alternatives array", async () => {
    if (!available) return;
    const result = await classify("explain how photosynthesis works");
    assert.ok(result);
    assert.ok(Array.isArray(result.alternatives));
  });

  test("returns latency_ms", async () => {
    if (!available) return;
    const result = await classify("hello");
    assert.ok(result);
    assert.ok(result.latency_ms >= 0);
  });

  test("handles empty string gracefully", async () => {
    if (!available) return;
    const result = await classify("");
    assert.ok(result); // should still return something
    assert.ok(result.category);
  });

  test("handles very long input", async () => {
    if (!available) return;
    const longText = "explain this concept ".repeat(500); // 10,000 chars
    const result = await classify(longText);
    assert.ok(result);
    assert.ok(result.category);
  });
});
