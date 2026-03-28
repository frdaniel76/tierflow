/**
 * TierFlow Quality Tier System
 *
 * 4 presets (Free/Smart Saver/Quality First/Maximum) that configure
 * all 8 routing categories at once. Optional per-category overrides.
 */

import { getConfig, getConfigPath, type FreeRouterConfig } from "./config.js";
import { readFileSync, writeFileSync, renameSync } from "node:fs";
import { join, dirname } from "node:path";
import { logger } from "./logger.js";

// ─── Types ───

export type QualityLevel = 1 | 2 | 3 | 4 | 5;
export type PresetName = "free" | "smart_saver" | "quality_first" | "maximum";

export type QualityTierEntry = {
  level: QualityLevel;
  label: string;
  model: string;
  inputPrice: number;
  outputPrice: number;
  contextWindow: number;
  speedTier: "fast" | "medium" | "slow";
  benchmarks?: Record<string, number>;
};

export type CategoryQualityConfig = {
  levels: QualityTierEntry[];
};

export type PresetDefinition = {
  name: PresetName;
  label: string;
  description: string;
  icon: string;
  estimatedDailyCost: string;
  models: Record<string, string>; // category → model ID
};

export type QualityTiersResponse = {
  presets: PresetDefinition[];
  activePreset: PresetName | "custom";
  globalLevel: QualityLevel;
  categories: Record<
    string,
    {
      currentModel: string;
      overrideLevel: QualityLevel | null;
      levels: QualityTierEntry[];
    }
  >;
};

// ─── Model Matrix (5 levels per category) ───

const MATRIX: Record<string, QualityTierEntry[]> = {
  simple_chat: [
    {
      level: 1,
      label: "Budget",
      model: "openrouter/mistralai/mistral-nemo",
      inputPrice: 0.04,
      outputPrice: 0.07,
      contextWindow: 128000,
      speedTier: "fast",
      benchmarks: { MMLU: 67 },
    },
    {
      level: 2,
      label: "Value",
      model: "openrouter/google/gemini-2.5-flash-lite",
      inputPrice: 0.1,
      outputPrice: 0.4,
      contextWindow: 1000000,
      speedTier: "fast",
      benchmarks: { MMLU: 78 },
    },
    {
      level: 3,
      label: "Balanced",
      model: "openrouter/google/gemini-2.5-flash",
      inputPrice: 0.15,
      outputPrice: 0.6,
      contextWindow: 1000000,
      speedTier: "fast",
      benchmarks: { MMLU: 82 },
    },
    {
      level: 4,
      label: "Premium",
      model: "openrouter/deepseek/deepseek-v3.2",
      inputPrice: 0.27,
      outputPrice: 1.1,
      contextWindow: 64000,
      speedTier: "fast",
      benchmarks: { MMLU: 88 },
    },
    {
      level: 5,
      label: "Best",
      model: "openrouter/anthropic/claude-sonnet-4-5",
      inputPrice: 3.0,
      outputPrice: 15.0,
      contextWindow: 200000,
      speedTier: "medium",
      benchmarks: { MMLU: 90 },
    },
  ],
  general: [
    {
      level: 1,
      label: "Budget",
      model: "openrouter/mistralai/mistral-nemo",
      inputPrice: 0.04,
      outputPrice: 0.07,
      contextWindow: 128000,
      speedTier: "fast",
      benchmarks: { MMLU: 67 },
    },
    {
      level: 2,
      label: "Value",
      model: "openrouter/google/gemini-2.5-flash-lite",
      inputPrice: 0.1,
      outputPrice: 0.4,
      contextWindow: 1000000,
      speedTier: "fast",
      benchmarks: { MMLU: 78 },
    },
    {
      level: 3,
      label: "Balanced",
      model: "openrouter/qwen/qwen3-235b-a22b-2507",
      inputPrice: 0.13,
      outputPrice: 0.4,
      contextWindow: 128000,
      speedTier: "fast",
      benchmarks: { MMLU: 87 },
    },
    {
      level: 4,
      label: "Premium",
      model: "openrouter/deepseek/deepseek-v3.2",
      inputPrice: 0.27,
      outputPrice: 1.1,
      contextWindow: 64000,
      speedTier: "fast",
      benchmarks: { MMLU: 88 },
    },
    {
      level: 5,
      label: "Best",
      model: "openrouter/google/gemini-2.5-pro",
      inputPrice: 1.25,
      outputPrice: 10.0,
      contextWindow: 1000000,
      speedTier: "medium",
      benchmarks: { MMLU: 90 },
    },
  ],
  coding: [
    {
      level: 1,
      label: "Budget",
      model: "openrouter/qwen/qwen3-coder:free",
      inputPrice: 0,
      outputPrice: 0,
      contextWindow: 128000,
      speedTier: "medium",
      benchmarks: { HumanEval: 72 },
    },
    {
      level: 2,
      label: "Value",
      model: "openrouter/deepseek/deepseek-v3.2",
      inputPrice: 0.27,
      outputPrice: 1.1,
      contextWindow: 64000,
      speedTier: "fast",
      benchmarks: { HumanEval: 82, "SWE-bench": 49 },
    },
    {
      level: 3,
      label: "Balanced",
      model: "openrouter/mistralai/devstral-2512",
      inputPrice: 0.4,
      outputPrice: 1.2,
      contextWindow: 128000,
      speedTier: "medium",
      benchmarks: { "SWE-bench": 46 },
    },
    {
      level: 4,
      label: "Premium",
      model: "openrouter/anthropic/claude-sonnet-4-5",
      inputPrice: 3.0,
      outputPrice: 15.0,
      contextWindow: 200000,
      speedTier: "medium",
      benchmarks: { HumanEval: 93, "SWE-bench": 72 },
    },
    {
      level: 5,
      label: "Best",
      model: "openrouter/anthropic/claude-opus-4-5",
      inputPrice: 15.0,
      outputPrice: 75.0,
      contextWindow: 200000,
      speedTier: "slow",
      benchmarks: { HumanEval: 96, "SWE-bench": 80 },
    },
  ],
  reasoning: [
    {
      level: 1,
      label: "Budget",
      model: "openrouter/qwen/qwen3-30b-a3b-thinking-2507",
      inputPrice: 0.1,
      outputPrice: 0.3,
      contextWindow: 32000,
      speedTier: "medium",
      benchmarks: { MATH: 78, GPQA: 52 },
    },
    {
      level: 2,
      label: "Value",
      model: "openrouter/deepseek/deepseek-r1",
      inputPrice: 0.55,
      outputPrice: 2.19,
      contextWindow: 164000,
      speedTier: "medium",
      benchmarks: { MATH: 90, GPQA: 59 },
    },
    {
      level: 3,
      label: "Balanced",
      model: "openrouter/openai/o3-mini",
      inputPrice: 1.1,
      outputPrice: 4.4,
      contextWindow: 200000,
      speedTier: "medium",
      benchmarks: { MATH: 90, GPQA: 63 },
    },
    {
      level: 4,
      label: "Premium",
      model: "openrouter/openai/o3",
      inputPrice: 2.0,
      outputPrice: 8.0,
      contextWindow: 200000,
      speedTier: "slow",
      benchmarks: { MATH: 97, GPQA: 77 },
    },
    {
      level: 5,
      label: "Best",
      model: "openrouter/google/gemini-2.5-pro",
      inputPrice: 1.25,
      outputPrice: 10.0,
      contextWindow: 1000000,
      speedTier: "medium",
      benchmarks: { MATH: 97, GPQA: 84 },
    },
  ],
  creative: [
    {
      level: 1,
      label: "Budget",
      model: "openrouter/stepfun/step-3.5-flash:free",
      inputPrice: 0,
      outputPrice: 0,
      contextWindow: 32000,
      speedTier: "fast",
      benchmarks: { Creative: 60 },
    },
    {
      level: 2,
      label: "Value",
      model: "openrouter/mistralai/mistral-nemo",
      inputPrice: 0.04,
      outputPrice: 0.07,
      contextWindow: 128000,
      speedTier: "fast",
      benchmarks: { Creative: 70 },
    },
    {
      level: 3,
      label: "Balanced",
      model: "openrouter/deepseek/deepseek-v3.2",
      inputPrice: 0.27,
      outputPrice: 1.1,
      contextWindow: 64000,
      speedTier: "fast",
      benchmarks: { Creative: 80 },
    },
    {
      level: 4,
      label: "Premium",
      model: "openrouter/anthropic/claude-sonnet-4-5",
      inputPrice: 3.0,
      outputPrice: 15.0,
      contextWindow: 200000,
      speedTier: "medium",
      benchmarks: { Creative: 90 },
    },
    {
      level: 5,
      label: "Best",
      model: "openrouter/anthropic/claude-opus-4-5",
      inputPrice: 15.0,
      outputPrice: 75.0,
      contextWindow: 200000,
      speedTier: "slow",
      benchmarks: { Creative: 100 },
    },
  ],
  data: [
    {
      level: 1,
      label: "Budget",
      model: "openrouter/google/gemini-2.5-flash-lite",
      inputPrice: 0.1,
      outputPrice: 0.4,
      contextWindow: 1000000,
      speedTier: "fast",
      benchmarks: {},
    },
    {
      level: 2,
      label: "Value",
      model: "openrouter/qwen/qwen3-235b-a22b-2507",
      inputPrice: 0.13,
      outputPrice: 0.4,
      contextWindow: 128000,
      speedTier: "fast",
      benchmarks: {},
    },
    {
      level: 3,
      label: "Balanced",
      model: "openrouter/deepseek/deepseek-v3.2",
      inputPrice: 0.27,
      outputPrice: 1.1,
      contextWindow: 64000,
      speedTier: "fast",
      benchmarks: {},
    },
    {
      level: 4,
      label: "Premium",
      model: "openrouter/google/gemini-2.5-flash",
      inputPrice: 0.15,
      outputPrice: 0.6,
      contextWindow: 1000000,
      speedTier: "fast",
      benchmarks: {},
    },
    {
      level: 5,
      label: "Best",
      model: "openrouter/google/gemini-2.5-pro",
      inputPrice: 1.25,
      outputPrice: 10.0,
      contextWindow: 1000000,
      speedTier: "medium",
      benchmarks: {},
    },
  ],
  agentic: [
    {
      level: 1,
      label: "Budget",
      model: "openrouter/xiaomi/mimo-v2-flash",
      inputPrice: 0.05,
      outputPrice: 0.1,
      contextWindow: 32000,
      speedTier: "fast",
      benchmarks: {},
    },
    {
      level: 2,
      label: "Value",
      model: "openrouter/deepseek/deepseek-v3.2",
      inputPrice: 0.27,
      outputPrice: 1.1,
      contextWindow: 64000,
      speedTier: "fast",
      benchmarks: {},
    },
    {
      level: 3,
      label: "Balanced",
      model: "openrouter/anthropic/claude-sonnet-4-5",
      inputPrice: 3.0,
      outputPrice: 15.0,
      contextWindow: 200000,
      speedTier: "medium",
      benchmarks: {},
    },
    {
      level: 4,
      label: "Premium",
      model: "openrouter/openai/gpt-4o",
      inputPrice: 2.5,
      outputPrice: 10.0,
      contextWindow: 128000,
      speedTier: "medium",
      benchmarks: {},
    },
    {
      level: 5,
      label: "Best",
      model: "openrouter/anthropic/claude-opus-4-5",
      inputPrice: 15.0,
      outputPrice: 75.0,
      contextWindow: 200000,
      speedTier: "slow",
      benchmarks: {},
    },
  ],
  transcription: [
    {
      level: 1,
      label: "Budget",
      model: "openrouter/google/gemini-2.5-flash-lite",
      inputPrice: 0.1,
      outputPrice: 0.4,
      contextWindow: 1000000,
      speedTier: "fast",
      benchmarks: { WER: 12 },
    },
    {
      level: 2,
      label: "Value",
      model: "openrouter/google/gemini-2.5-flash",
      inputPrice: 0.15,
      outputPrice: 0.6,
      contextWindow: 1000000,
      speedTier: "fast",
      benchmarks: { WER: 8 },
    },
    {
      level: 3,
      label: "Balanced",
      model: "openrouter/google/gemini-2.5-pro",
      inputPrice: 1.25,
      outputPrice: 10.0,
      contextWindow: 1000000,
      speedTier: "medium",
      benchmarks: { WER: 5 },
    },
    {
      level: 4,
      label: "Premium",
      model: "openrouter/google/gemini-2.5-pro",
      inputPrice: 1.25,
      outputPrice: 10.0,
      contextWindow: 1000000,
      speedTier: "medium",
      benchmarks: { WER: 4 },
    },
    {
      level: 5,
      label: "Best",
      model: "openrouter/openai/gpt-4o",
      inputPrice: 2.5,
      outputPrice: 10.0,
      contextWindow: 128000,
      speedTier: "medium",
      benchmarks: { WER: 3 },
    },
  ],
};

// ─── Preset Definitions ───

const PRESETS: Record<PresetName, Record<string, QualityLevel>> = {
  free: {
    simple_chat: 1,
    general: 1,
    coding: 1,
    reasoning: 1,
    creative: 1,
    data: 1,
    agentic: 1,
    transcription: 1,
  },
  smart_saver: {
    simple_chat: 2,
    general: 2,
    coding: 1,
    reasoning: 2,
    creative: 1,
    data: 2,
    agentic: 2,
    transcription: 2,
  },
  quality_first: {
    simple_chat: 3,
    general: 4,
    coding: 4,
    reasoning: 4,
    creative: 4,
    data: 5,
    agentic: 3,
    transcription: 3,
  },
  maximum: {
    simple_chat: 5,
    general: 5,
    coding: 5,
    reasoning: 5,
    creative: 5,
    data: 5,
    agentic: 5,
    transcription: 5,
  },
};

const PRESET_META: PresetDefinition[] = [
  {
    name: "free",
    label: "Free Tier",
    description: "Zero cost. Uses only free/near-free models.",
    icon: "🆓",
    estimatedDailyCost: "~$0/day",
    models: {},
  },
  {
    name: "smart_saver",
    label: "Smart Saver",
    description: "Best value. Cheap where it doesn't matter, quality where it does.",
    icon: "💡",
    estimatedDailyCost: "~$1-5/day",
    models: {},
  },
  {
    name: "quality_first",
    label: "Quality First",
    description: "Premium models for important work. Cheap for trivial stuff.",
    icon: "⭐",
    estimatedDailyCost: "~$10-30/day",
    models: {},
  },
  {
    name: "maximum",
    label: "Maximum",
    description: "Best available model for everything.",
    icon: "🚀",
    estimatedDailyCost: "~$50-150/day",
    models: {},
  },
];

// Populate preset models from matrix
for (const preset of PRESET_META) {
  const levels = PRESETS[preset.name];
  for (const [cat, level] of Object.entries(levels)) {
    preset.models[cat] = MATRIX[cat][level - 1].model;
  }
}

// ─── Public API ───

export function getQualityMatrix(): Record<string, QualityTierEntry[]> {
  return MATRIX;
}

export function getPresets(): PresetDefinition[] {
  return PRESET_META;
}

/**
 * Build the quality tiers response for GET /quality-tiers.
 */
export function getQualityTiersResponse(): QualityTiersResponse {
  const cfg = getConfig();
  const categories: QualityTiersResponse["categories"] = {};

  // Detect active preset and per-category levels by matching current model to matrix
  let detectedPreset: PresetName | "custom" = "custom";
  const detectedLevels: Record<string, QualityLevel | null> = {};

  for (const [cat, levels] of Object.entries(MATRIX)) {
    const currentModel = cfg.categories?.[cat]?.primary ?? "";
    const matchedLevel = levels.find((l) => l.model === currentModel);
    detectedLevels[cat] = matchedLevel ? matchedLevel.level : null;

    categories[cat] = {
      currentModel,
      overrideLevel: matchedLevel?.level ?? null,
      levels,
    };
  }

  // Check if detected levels match any preset exactly
  for (const [presetName, presetLevels] of Object.entries(PRESETS)) {
    const matches = Object.entries(presetLevels).every(
      ([cat, level]) => detectedLevels[cat] === level,
    );
    if (matches) {
      detectedPreset = presetName as PresetName;
      break;
    }
  }

  // Compute global level as average
  const detectedValues = Object.values(detectedLevels).filter((v): v is QualityLevel => v !== null);
  const avgLevel =
    detectedValues.length > 0
      ? (Math.round(
          detectedValues.reduce((a, b) => a + b, 0) / detectedValues.length,
        ) as QualityLevel)
      : (2 as QualityLevel);

  return {
    presets: PRESET_META,
    activePreset: detectedPreset,
    globalLevel: avgLevel,
    categories,
  };
}

/**
 * Apply a preset — updates all categories in config.
 */
export function applyPreset(preset: PresetName): void {
  const levels = PRESETS[preset];
  if (!levels) throw new Error(`Unknown preset: ${preset}`);

  for (const [cat, level] of Object.entries(levels)) {
    setCategoryModel(cat, MATRIX[cat][level - 1].model);
  }
  writeConfigToDisk();
}

/**
 * Set a single category's quality level.
 */
export function setQualityLevel(category: string, level: QualityLevel): void {
  const catMatrix = MATRIX[category];
  if (!catMatrix) throw new Error(`Unknown category: ${category}`);
  if (level < 1 || level > 5) throw new Error(`Level must be 1-5, got ${level}`);

  setCategoryModel(category, catMatrix[level - 1].model);
  writeConfigToDisk();
}

/**
 * Set global quality level — maps to per-category levels using interpolation.
 */
export function setGlobalLevel(level: QualityLevel): void {
  // Level 1=free, 2=smart_saver, 4=quality_first, 5=maximum
  // Level 3 = interpolated mid-tier
  const presetMap: Record<number, PresetName | null> = {
    1: "free",
    2: "smart_saver",
    3: null, // interpolated
    4: "quality_first",
    5: "maximum",
  };

  const preset = presetMap[level];
  if (preset) {
    applyPreset(preset);
    return;
  }

  // Level 3: promote reasoning + coding to mid, keep others cheap
  const level3: Record<string, QualityLevel> = {
    simple_chat: 2,
    general: 3,
    coding: 2,
    reasoning: 3,
    creative: 2,
    data: 3,
    agentic: 3,
    transcription: 2,
  };
  for (const [cat, lv] of Object.entries(level3)) {
    setCategoryModel(cat, MATRIX[cat][lv - 1].model);
  }
  writeConfigToDisk();
}

// ─── Internal Helpers ───

function setCategoryModel(category: string, model: string): void {
  const cfg = getConfig();
  if (!cfg.categories) cfg.categories = {};
  if (!cfg.categories[category]) {
    cfg.categories[category] = { primary: model, fallback: [], timeout: 60000 };
  } else {
    cfg.categories[category].primary = model;
  }
}

function writeConfigToDisk(): void {
  const configPath = getConfigPath();
  if (!configPath) {
    logger.warn("Cannot save quality config — no config file path");
    return;
  }

  try {
    const cfg = getConfig();
    const tmpPath = configPath + ".tmp";
    writeFileSync(tmpPath, JSON.stringify(cfg, null, 2) + "\n");
    renameSync(tmpPath, configPath);
    logger.info(`Config saved to ${configPath}`);
  } catch (err) {
    logger.error("Failed to write config:", err);
    throw err;
  }
}

/**
 * Test a provider by pinging its base URL + /v1/models.
 */
export async function testProvider(
  providerName: string,
): Promise<{ ok: boolean; latency_ms: number; error?: string; models?: number }> {
  const cfg = getConfig();
  const provider = cfg.providers[providerName];
  if (!provider) return { ok: false, latency_ms: 0, error: `Provider "${providerName}" not found` };

  const testUrl = provider.baseUrl.replace(/\/+$/, "") + "/v1/models";
  const start = Date.now();

  try {
    const res = await fetch(testUrl, {
      headers: { Authorization: "Bearer test" },
      signal: AbortSignal.timeout(5000),
    });
    const latency = Date.now() - start;

    if (res.ok) {
      const body = (await res.json()) as { data?: unknown[] };
      return { ok: true, latency_ms: latency, models: body.data?.length ?? 0 };
    }
    return { ok: false, latency_ms: latency, error: `${res.status} ${res.statusText}` };
  } catch (err) {
    return { ok: false, latency_ms: Date.now() - start, error: (err as Error).message };
  }
}
