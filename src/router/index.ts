/**
 * Smart Router Entry Point — v2.0
 *
 * ML-powered classification via LLMRouter service.
 * Falls back to legacy keyword scorer when ML service is unavailable.
 *
 * Decision flow:
 * 1. Check shortcuts (audio, tools, mode override)
 * 2. Call ML classifier (HTTP to localhost:18801, ~40ms)
 * 3. Map category → model from config
 * 4. Fall back to legacy scorer if ML is down
 */

import type {
  Tier,
  Category,
  RoutingDecision,
  RoutingConfig,
  CategoryResult,
  CategoryConfig,
} from "./types.js";
import { CATEGORY_TO_TIER } from "./types.js";
import { classifyByRules } from "./rules.js";
import { selectModel, type ModelPricing } from "./selector.js";
import { logger } from "../logger.js";

export type RouterOptions = {
  config: RoutingConfig;
  modelPricing: Map<string, ModelPricing>;
};

export type RouteMetadata = {
  hasTools?: boolean;
  hasAudio?: boolean;
};

/**
 * Route a request to the best model for the task.
 *
 * v2: Uses ML classifier for category-based routing.
 * Falls back to legacy keyword scorer when ML service is unavailable.
 */
export async function route(
  prompt: string,
  systemPrompt: string | undefined,
  maxOutputTokens: number,
  options: RouterOptions,
  metadata?: RouteMetadata,
): Promise<RoutingDecision> {
  const { config, modelPricing } = options;
  const estimatedTotalTokens = Math.ceil(`${systemPrompt ?? ""} ${prompt}`.length / 4);

  // ─── v2: Category-based routing (if categories configured) ───
  if (config.categories && config.mlClassifier) {
    return routeByCategory(prompt, estimatedTotalTokens, maxOutputTokens, options, metadata);
  }

  // ─── Legacy: Tier-based routing ───
  return routeByTier(prompt, systemPrompt, estimatedTotalTokens, maxOutputTokens, options);
}

/**
 * v2 category-based routing via ML classifier.
 */
async function routeByCategory(
  prompt: string,
  estimatedTotalTokens: number,
  maxOutputTokens: number,
  options: RouterOptions,
  metadata?: RouteMetadata,
): Promise<RoutingDecision> {
  const { config, modelPricing } = options;
  const categories = config.categories!;
  const mlConfig = config.mlClassifier!;

  // ─── Shortcuts (0ms, no ML needed) ───

  // Audio attachment → transcription
  if (metadata?.hasAudio) {
    return buildCategoryDecision(
      "transcription",
      1.0,
      "shortcut",
      "audio-attachment",
      categories,
      modelPricing,
      estimatedTotalTokens,
      maxOutputTokens,
    );
  }

  // Mode override (user typed /code, /max, etc.)
  if (config.modeOverrides) {
    const override = detectModeOverride(prompt, config.modeOverrides);
    if (override) {
      return buildCategoryDecision(
        override as Category,
        0.99,
        "shortcut",
        `user-mode: ${override}`,
        categories,
        modelPricing,
        estimatedTotalTokens,
        maxOutputTokens,
      );
    }
  }

  // ─── ML Classifier (~40ms) ───
  try {
    const result = await callMLClassifier(prompt, mlConfig, metadata);

    // If tools present and classifier didn't pick agentic, check if we should override
    let category = result.category;
    let reasoning = `ml: ${category} (conf=${result.confidence.toFixed(2)}, ${result.latency_ms ?? 0}ms)`;

    if (metadata?.hasTools && category !== "agentic") {
      // Tools present — use agentic for simple/general queries, keep specialized for others
      if (category === "simple_chat" || category === "general") {
        category = "agentic";
        reasoning += " | tools-present -> agentic";
      } else {
        reasoning += " | tools-present (kept specialized)";
      }
    }

    return buildCategoryDecision(
      category,
      result.confidence,
      "ml-classifier",
      reasoning,
      categories,
      modelPricing,
      estimatedTotalTokens,
      maxOutputTokens,
    );
  } catch (err) {
    // ML service down — fall back to default category
    const fallback = (mlConfig.fallback_category ?? "general") as Category;
    logger.warn(
      `[Router] ML classifier unavailable: ${err instanceof Error ? err.message : err} — using ${fallback}`,
    );

    // If tools present, prefer agentic fallback
    const category = metadata?.hasTools ? "agentic" : fallback;
    return buildCategoryDecision(
      category,
      0.5,
      "shortcut",
      `ml-fallback: ${category}`,
      categories,
      modelPricing,
      estimatedTotalTokens,
      maxOutputTokens,
    );
  }
}

/**
 * Call the ML classifier HTTP service.
 */
async function callMLClassifier(
  message: string,
  config: { url: string; timeout_ms: number },
  metadata?: RouteMetadata,
): Promise<CategoryResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeout_ms);

  try {
    const response = await fetch(config.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message,
        has_tools: metadata?.hasTools ?? false,
        has_audio: metadata?.hasAudio ?? false,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return (await response.json()) as CategoryResult;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Detect user mode override from prompt prefix.
 */
function detectModeOverride(prompt: string, overrides: Record<string, string>): string | null {
  // /mode text
  const slashMatch = prompt.match(/^\/([a-z]+)\s+/i);
  if (slashMatch) {
    const mode = slashMatch[1].toLowerCase();
    if (overrides[mode]) return overrides[mode];
  }
  // mode mode: text
  const prefixMatch = prompt.match(/^([a-z]+)\s+mode[:\s,]+/i);
  if (prefixMatch) {
    const mode = prefixMatch[1].toLowerCase();
    if (overrides[mode]) return overrides[mode];
  }
  // [mode] text
  const bracketMatch = prompt.match(/^\[([a-z]+)\]\s*/i);
  if (bracketMatch) {
    const mode = bracketMatch[1].toLowerCase();
    if (overrides[mode]) return overrides[mode];
  }
  return null;
}

/**
 * Build a RoutingDecision from a category classification.
 */
function buildCategoryDecision(
  category: Category,
  confidence: number,
  method: "ml-classifier" | "shortcut",
  reasoning: string,
  categories: Record<string, CategoryConfig>,
  modelPricing: Map<string, ModelPricing>,
  estimatedTokens: number,
  maxOutputTokens: number,
): RoutingDecision {
  const catConfig = categories[category];
  if (!catConfig) {
    // Unknown category — fall back to general
    const fallbackConfig = categories["general"] ?? {
      primary: "openrouter/deepseek/deepseek-v3.2",
      fallback: [],
    };
    return {
      model: fallbackConfig.primary,
      tier: "MEDIUM",
      category: "general" as Category,
      confidence: 0.5,
      method,
      reasoning: `${reasoning} | unknown-category-fallback`,
      costEstimate: 0,
      baselineCost: 0,
      savings: 0,
    };
  }

  const model = catConfig.primary;
  const tier = CATEGORY_TO_TIER[category] ?? "MEDIUM";

  // Cost estimate
  const pricing = modelPricing.get(model);
  const costEstimate = pricing
    ? (estimatedTokens / 1_000_000) * (pricing.inputPrice ?? 0) +
      (maxOutputTokens / 1_000_000) * (pricing.outputPrice ?? 0)
    : 0;

  return {
    model,
    tier,
    category,
    confidence,
    method,
    reasoning,
    costEstimate,
    baselineCost: 0,
    savings: 0,
  };
}

/**
 * Legacy tier-based routing (fallback when categories not configured).
 */
function routeByTier(
  prompt: string,
  systemPrompt: string | undefined,
  estimatedTotalTokens: number,
  maxOutputTokens: number,
  options: RouterOptions,
): RoutingDecision {
  const { config, modelPricing } = options;
  const estimatedUserTokens = Math.ceil(prompt.length / 4);

  const ruleResult = classifyByRules(prompt, systemPrompt, estimatedUserTokens, config.scoring);
  const agenticScore = ruleResult.agenticScore ?? 0;
  const isAutoAgentic = agenticScore >= 0.69;
  const isExplicitAgentic = config.overrides.agenticMode ?? false;
  const useAgenticTiers = (isAutoAgentic || isExplicitAgentic) && config.agenticTiers != null;
  const tierConfigs = useAgenticTiers ? config.agenticTiers! : config.tiers;

  if (estimatedTotalTokens > config.overrides.maxTokensForceComplex) {
    return selectModel(
      "COMPLEX",
      0.95,
      "rules",
      `Input exceeds ${config.overrides.maxTokensForceComplex} tokens`,
      tierConfigs,
      modelPricing,
      estimatedTotalTokens,
      maxOutputTokens,
    );
  }

  let tier: Tier;
  let confidence: number;
  let reasoning = `score=${ruleResult.score.toFixed(2)} | ${ruleResult.signals.join(", ")}`;

  if (ruleResult.tier !== null) {
    tier = ruleResult.tier;
    confidence = ruleResult.confidence;
  } else {
    tier = config.overrides.ambiguousDefaultTier;
    confidence = 0.5;
    reasoning += ` | ambiguous -> default: ${tier}`;
  }

  if (isAutoAgentic) reasoning += " | auto-agentic";

  return selectModel(
    tier,
    confidence,
    "rules",
    reasoning,
    tierConfigs,
    modelPricing,
    estimatedTotalTokens,
    maxOutputTokens,
  );
}

export { getFallbackChain, getFallbackChainFiltered, calculateModelCost } from "./selector.js";
export { DEFAULT_ROUTING_CONFIG } from "./config.js";
export type { RoutingDecision, Tier, Category, RoutingConfig } from "./types.js";
export type { ModelPricing } from "./selector.js";
