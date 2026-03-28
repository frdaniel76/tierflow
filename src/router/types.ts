/**
 * Smart Router Types — v2.0
 *
 * Category-based routing powered by ML classifier.
 * 8 categories map to specialized models.
 * Backward-compatible with legacy tier system.
 */

// Legacy tier system (kept for backward compat)
export type Tier = "SIMPLE" | "MEDIUM" | "COMPLEX" | "REASONING";

// New category system
export type Category =
  | "simple_chat"
  | "general"
  | "coding"
  | "reasoning"
  | "creative"
  | "data"
  | "agentic"
  | "transcription";

export type CategoryResult = {
  category: Category;
  confidence: number;
  alternatives?: Array<{ category: Category; confidence: number }>;
  latency_ms?: number;
};

export type ScoringResult = {
  score: number;
  tier: Tier | null;
  confidence: number;
  signals: string[];
  agenticScore?: number;
  category?: Category; // v2: ML-classified category
};

export type RoutingDecision = {
  model: string;
  tier: Tier; // legacy compat — derived from category
  category?: Category; // v2: the actual classification
  confidence: number;
  method: "rules" | "llm" | "ml-classifier" | "shortcut";
  reasoning: string;
  costEstimate: number;
  baselineCost: number;
  savings: number;
};

export type CategoryConfig = {
  primary: string;
  fallback: string[];
  timeout?: number; // ms
};

export type TierConfig = {
  primary: string;
  fallback: string[];
};

export type MLClassifierConfig = {
  url: string; // http://127.0.0.1:18801/classify
  timeout_ms: number; // max wait for classifier response
  fallback_category: Category; // category when classifier is unreachable
};

// Legacy scoring config (kept for backward compat, not used in v2)
export type ScoringConfig = {
  tokenCountThresholds: { simple: number; complex: number };
  codeKeywords: string[];
  reasoningKeywords: string[];
  simpleKeywords: string[];
  technicalKeywords: string[];
  creativeKeywords: string[];
  imperativeVerbs: string[];
  constraintIndicators: string[];
  outputFormatKeywords: string[];
  referenceKeywords: string[];
  negationKeywords: string[];
  domainSpecificKeywords: string[];
  agenticTaskKeywords: string[];
  dimensionWeights: Record<string, number>;
  tierBoundaries: {
    simpleMedium: number;
    mediumComplex: number;
    complexReasoning: number;
  };
  confidenceSteepness: number;
  confidenceThreshold: number;
};

export type ClassifierConfig = {
  llmModel: string;
  llmMaxTokens: number;
  llmTemperature: number;
  promptTruncationChars: number;
  cacheTtlMs: number;
};

export type OverridesConfig = {
  maxTokensForceComplex: number;
  structuredOutputMinTier: Tier;
  ambiguousDefaultTier: Tier;
  agenticMode?: boolean;
};

export type RoutingConfig = {
  version: string;
  classifier: ClassifierConfig;
  scoring: ScoringConfig;
  tiers: Record<Tier, TierConfig>;
  agenticTiers?: Record<Tier, TierConfig>;
  categories?: Record<string, CategoryConfig>; // v2: category-based routing
  mlClassifier?: MLClassifierConfig; // v2: ML service config
  modeOverrides?: Record<string, string>; // v2: mode → category mapping
  overrides: OverridesConfig;
};

// Map categories to legacy tiers for backward compat
export const CATEGORY_TO_TIER: Record<Category, Tier> = {
  simple_chat: "SIMPLE",
  general: "MEDIUM",
  coding: "COMPLEX",
  reasoning: "REASONING",
  creative: "MEDIUM",
  data: "MEDIUM",
  agentic: "COMPLEX",
  transcription: "SIMPLE",
};
