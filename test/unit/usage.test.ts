/**
 * Unit tests — Usage tracking with baseline cost
 */

import { describe, test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { recordUsage, getUsageStats, resetUsage } from "../../src/usage.js";

describe("usage tracking", () => {
  beforeEach(() => {
    resetUsage();
  });

  test("records basic usage", () => {
    recordUsage("model-a", "SIMPLE", {
      prompt_tokens: 100,
      completion_tokens: 50,
      cost: 0.001,
    });
    const stats = getUsageStats();
    assert.equal(stats.allTime.promptTokens, 100);
    assert.equal(stats.allTime.completionTokens, 50);
    assert.equal(stats.allTime.totalTokens, 150);
    assert.equal(stats.allTime.cost, 0.001);
    assert.equal(stats.allTime.requests, 1);
  });

  test("tracks baselineCost in allTime", () => {
    recordUsage("model-a", "SIMPLE", {
      prompt_tokens: 100,
      completion_tokens: 50,
      cost: 0.001,
      baselineCost: 0.005,
    });
    const stats = getUsageStats();
    assert.equal(stats.allTime.baselineCost, 0.005);
  });

  test("accumulates baselineCost across requests", () => {
    recordUsage("model-a", "SIMPLE", { prompt_tokens: 100, completion_tokens: 50, baselineCost: 0.005 });
    recordUsage("model-b", "COMPLEX", { prompt_tokens: 200, completion_tokens: 100, baselineCost: 0.010 });
    const stats = getUsageStats();
    assert.equal(stats.allTime.baselineCost, 0.015);
  });

  test("tracks baselineCost per model", () => {
    recordUsage("model-a", "SIMPLE", { prompt_tokens: 100, completion_tokens: 50, baselineCost: 0.005 });
    recordUsage("model-a", "SIMPLE", { prompt_tokens: 100, completion_tokens: 50, baselineCost: 0.005 });
    const stats = getUsageStats();
    assert.equal(stats.byModel["model-a"].baselineCost, 0.010);
  });

  test("tracks baselineCost per tier", () => {
    recordUsage("model-a", "SIMPLE", { prompt_tokens: 100, completion_tokens: 50, baselineCost: 0.005 });
    const stats = getUsageStats();
    assert.equal(stats.byTier["SIMPLE"].baselineCost, 0.005);
  });

  test("tracks baselineCost per category", () => {
    recordUsage("model-a", "SIMPLE", { prompt_tokens: 100, completion_tokens: 50, baselineCost: 0.005 }, "coding");
    const stats = getUsageStats();
    assert.equal(stats.byCategory["coding"].baselineCost, 0.005);
  });

  test("tracks baselineCost in hourly buckets", () => {
    recordUsage("model-a", "SIMPLE", { prompt_tokens: 100, completion_tokens: 50, baselineCost: 0.005 });
    const stats = getUsageStats();
    assert.ok(stats.hourly.length > 0);
    assert.equal(stats.hourly[0].baselineCost, 0.005);
  });

  test("defaults baselineCost to 0 when not provided", () => {
    recordUsage("model-a", "SIMPLE", { prompt_tokens: 100, completion_tokens: 50 });
    const stats = getUsageStats();
    assert.equal(stats.allTime.baselineCost, 0);
  });

  test("resetUsage clears baselineCost", () => {
    recordUsage("model-a", "SIMPLE", { prompt_tokens: 100, completion_tokens: 50, baselineCost: 0.005 });
    resetUsage();
    const stats = getUsageStats();
    assert.equal(stats.allTime.baselineCost, 0);
  });

  test("savings can be computed from cost vs baselineCost", () => {
    recordUsage("model-a", "SIMPLE", { prompt_tokens: 1000, completion_tokens: 500, cost: 0.001, baselineCost: 0.050 });
    const stats = getUsageStats();
    const savings = stats.allTime.baselineCost - stats.allTime.cost;
    const savingsPct = (savings / stats.allTime.baselineCost) * 100;
    assert.ok(savings > 0, "Should have positive savings");
    assert.ok(savingsPct > 90, "Should save >90% vs Opus baseline");
  });

  test("skips recording when total=0 and cost=0", () => {
    recordUsage("model-a", "SIMPLE", { prompt_tokens: 0, completion_tokens: 0, cost: 0, baselineCost: 0.005 });
    const stats = getUsageStats();
    assert.equal(stats.allTime.requests, 0);
  });

  test("tracks multiple categories independently", () => {
    recordUsage("model-a", "SIMPLE", { prompt_tokens: 100, completion_tokens: 50, baselineCost: 0.005 }, "coding");
    recordUsage("model-b", "COMPLEX", { prompt_tokens: 200, completion_tokens: 100, baselineCost: 0.010 }, "reasoning");
    const stats = getUsageStats();
    assert.equal(stats.byCategory["coding"].baselineCost, 0.005);
    assert.equal(stats.byCategory["reasoning"].baselineCost, 0.010);
    assert.equal(Object.keys(stats.byCategory).length, 2);
  });
});
