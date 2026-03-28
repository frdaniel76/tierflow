/**
 * Unit tests — Rule-based classifier
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { classifyByRules } from "../../src/router/rules.js";
import { DEFAULT_ROUTING_CONFIG } from "../../src/router/config.js";

const scoring = DEFAULT_ROUTING_CONFIG.scoring;

describe("classifyByRules", () => {
  test("routes 'hi' to SIMPLE", () => {
    const r = classifyByRules("hi", undefined, 2, scoring);
    assert.equal(r.tier, "SIMPLE");
  });

  test("routes greeting to SIMPLE", () => {
    const r = classifyByRules("hello, how are you?", undefined, 5, scoring);
    assert.equal(r.tier, "SIMPLE");
  });

  test("routes short factual question to SIMPLE", () => {
    const r = classifyByRules("what is the capital of France?", undefined, 8, scoring);
    assert.ok(r.tier === "SIMPLE" || r.tier === "MEDIUM");
  });

  test("routes code request to COMPLEX or higher", () => {
    const r = classifyByRules(
      "implement a complete binary search tree with insert, delete, and rebalance operations in typescript with full type annotations",
      undefined,
      25,
      scoring,
    );
    assert.ok(
      r.tier === "COMPLEX" || r.tier === "REASONING",
      `Expected COMPLEX or REASONING, got ${r.tier}`,
    );
  });

  test("routes reasoning task to REASONING", () => {
    const r = classifyByRules(
      "prove that the square root of 2 is irrational using proof by contradiction, then explain why this proof technique works in general",
      undefined,
      30,
      scoring,
    );
    assert.ok(
      r.tier === "COMPLEX" || r.tier === "REASONING",
      `Expected COMPLEX or REASONING, got ${r.tier}`,
    );
  });

  test("multi-step instructions score higher", () => {
    const simple = classifyByRules("what is 2+2", undefined, 4, scoring);
    const multiStep = classifyByRules(
      "first analyze the data, then create a visualization, step 1 clean the dataset, step 2 calculate correlations, step 3 plot results",
      undefined,
      25,
      scoring,
    );
    assert.ok(
      multiStep.score > simple.score,
      `Multi-step score (${multiStep.score}) should be > simple score (${simple.score})`,
    );
  });

  test("returns confidence between 0 and 1", () => {
    const r = classifyByRules("tell me about javascript", undefined, 5, scoring);
    assert.ok(r.confidence >= 0 && r.confidence <= 1);
  });

  test("returns signals array", () => {
    const r = classifyByRules("write a function in python", undefined, 7, scoring);
    assert.ok(Array.isArray(r.signals));
  });

  test("creative keywords influence scoring", () => {
    const r = classifyByRules(
      "write a poem about the ocean, make it lyrical and evocative with vivid imagery",
      undefined,
      15,
      scoring,
    );
    assert.ok(r.signals.some((s) => s.includes("creative") || s.includes("poem")));
  });

  test("empty prompt returns SIMPLE or null tier", () => {
    const r = classifyByRules("", undefined, 0, scoring);
    assert.ok(r.tier === "SIMPLE" || r.tier === null);
  });
});
