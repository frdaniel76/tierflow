/**
 * Unit tests — Quality tier system
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  getQualityMatrix,
  getPresets,
  getQualityTiersResponse,
} from "../../src/quality.js";

describe("getQualityMatrix", () => {
  test("returns 8 categories", () => {
    const matrix = getQualityMatrix();
    const cats = Object.keys(matrix);
    assert.equal(cats.length, 8);
    assert.ok(cats.includes("simple_chat"));
    assert.ok(cats.includes("coding"));
    assert.ok(cats.includes("reasoning"));
    assert.ok(cats.includes("creative"));
    assert.ok(cats.includes("agentic"));
    assert.ok(cats.includes("transcription"));
  });

  test("each category has exactly 5 levels", () => {
    const matrix = getQualityMatrix();
    for (const [cat, levels] of Object.entries(matrix)) {
      assert.equal(levels.length, 5, `${cat} should have 5 levels`);
    }
  });

  test("levels are numbered 1-5 in order", () => {
    const matrix = getQualityMatrix();
    for (const [cat, levels] of Object.entries(matrix)) {
      for (let i = 0; i < 5; i++) {
        assert.equal(levels[i].level, i + 1, `${cat} level ${i} should be ${i + 1}`);
      }
    }
  });

  test("each level has required fields", () => {
    const matrix = getQualityMatrix();
    for (const levels of Object.values(matrix)) {
      for (const level of levels) {
        assert.ok(level.label, "Missing label");
        assert.ok(level.model, "Missing model");
        assert.equal(typeof level.inputPrice, "number");
        assert.equal(typeof level.outputPrice, "number");
        assert.ok(level.contextWindow > 0, "contextWindow must be positive");
        assert.ok(["fast", "medium", "slow"].includes(level.speedTier));
      }
    }
  });

  test("prices increase from level 1 to 5 (generally)", () => {
    const matrix = getQualityMatrix();
    for (const [cat, levels] of Object.entries(matrix)) {
      // Level 5 should cost more than level 1 (output price)
      assert.ok(
        levels[4].outputPrice >= levels[0].outputPrice,
        `${cat}: level 5 output price should be >= level 1`,
      );
    }
  });

  test("free models have zero prices", () => {
    const matrix = getQualityMatrix();
    const coding1 = matrix.coding[0];
    assert.equal(coding1.inputPrice, 0);
    assert.equal(coding1.outputPrice, 0);
    assert.ok(coding1.model.includes("free") || coding1.inputPrice === 0);
  });
});

describe("getPresets", () => {
  test("returns 4 presets", () => {
    const presets = getPresets();
    assert.equal(presets.length, 4);
  });

  test("presets have correct names", () => {
    const presets = getPresets();
    const names = presets.map((p) => p.name);
    assert.deepEqual(names, ["free", "smart_saver", "quality_first", "maximum"]);
  });

  test("each preset has models for all 8 categories", () => {
    const presets = getPresets();
    for (const preset of presets) {
      const cats = Object.keys(preset.models);
      assert.equal(cats.length, 8, `${preset.name} should have 8 category models`);
    }
  });

  test("free preset uses cheapest models", () => {
    const presets = getPresets();
    const free = presets.find((p) => p.name === "free")!;
    const matrix = getQualityMatrix();
    // Free preset should use level 1 for all categories
    for (const [cat, model] of Object.entries(free.models)) {
      assert.equal(model, matrix[cat][0].model, `Free preset ${cat} should use level 1`);
    }
  });

  test("maximum preset uses best models", () => {
    const presets = getPresets();
    const max = presets.find((p) => p.name === "maximum")!;
    const matrix = getQualityMatrix();
    for (const [cat, model] of Object.entries(max.models)) {
      assert.equal(model, matrix[cat][4].model, `Maximum preset ${cat} should use level 5`);
    }
  });

  test("presets have required metadata", () => {
    const presets = getPresets();
    for (const preset of presets) {
      assert.ok(preset.label, `${preset.name} missing label`);
      assert.ok(preset.description, `${preset.name} missing description`);
      assert.ok(preset.icon, `${preset.name} missing icon`);
      assert.ok(preset.estimatedDailyCost, `${preset.name} missing cost estimate`);
    }
  });
});

describe("getQualityTiersResponse", () => {
  test("returns valid response structure", () => {
    const resp = getQualityTiersResponse();
    assert.ok(resp.presets);
    assert.ok(resp.activePreset);
    assert.ok(resp.globalLevel >= 1 && resp.globalLevel <= 5);
    assert.ok(resp.categories);
  });

  test("response categories have levels array", () => {
    const resp = getQualityTiersResponse();
    for (const [cat, info] of Object.entries(resp.categories)) {
      assert.ok(Array.isArray(info.levels), `${cat} missing levels array`);
      assert.equal(info.levels.length, 5, `${cat} should have 5 levels`);
    }
  });
});
