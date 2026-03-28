/**
 * Unit tests — Config loading and types
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { getConfig, loadConfig, getSanitizedConfig } from "../../src/config.js";

describe("config", () => {
  test("loadConfig returns valid config object", () => {
    const cfg = loadConfig();
    assert.ok(cfg);
    assert.equal(typeof cfg.port, "number");
    assert.equal(typeof cfg.host, "string");
    assert.ok(cfg.providers);
    assert.ok(cfg.tiers);
    assert.ok(cfg.auth);
  });

  test("getConfig returns same config after loadConfig", () => {
    loadConfig();
    const cfg = getConfig();
    assert.ok(cfg);
    assert.equal(typeof cfg.port, "number");
  });

  test("config has required tiers", () => {
    const cfg = loadConfig();
    const tiers = Object.keys(cfg.tiers);
    assert.ok(tiers.includes("SIMPLE"), "Missing SIMPLE tier");
    assert.ok(tiers.includes("MEDIUM"), "Missing MEDIUM tier");
    assert.ok(tiers.includes("COMPLEX"), "Missing COMPLEX tier");
    assert.ok(tiers.includes("REASONING"), "Missing REASONING tier");
  });

  test("each tier has primary model", () => {
    const cfg = loadConfig();
    for (const [name, tier] of Object.entries(cfg.tiers)) {
      assert.ok(tier.primary, `Tier ${name} missing primary model`);
      assert.ok(Array.isArray(tier.fallback), `Tier ${name} missing fallback array`);
    }
  });

  test("providers have required fields", () => {
    const cfg = loadConfig();
    for (const [name, provider] of Object.entries(cfg.providers)) {
      assert.ok(provider.baseUrl, `Provider ${name} missing baseUrl`);
      assert.ok(
        provider.api === "anthropic" || provider.api === "openai",
        `Provider ${name} has invalid api type: ${provider.api}`,
      );
    }
  });

  test("getSanitizedConfig redacts secrets", () => {
    loadConfig();
    const sanitized = getSanitizedConfig();
    const json = JSON.stringify(sanitized);
    // Should not contain actual API keys
    assert.ok(!json.includes("sk-ant-"), "Config contains Anthropic key");
    assert.ok(!json.includes("sk-proj-"), "Config contains OpenAI key");
  });

  test("config defaults are reasonable", () => {
    const cfg = loadConfig();
    assert.ok(cfg.port >= 1024 && cfg.port <= 65535, "Port out of range");
    assert.ok(cfg.host === "127.0.0.1" || cfg.host === "0.0.0.0", "Unexpected host");
  });
});
