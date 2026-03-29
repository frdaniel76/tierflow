/**
 * Model Definitions — pricing catalog for cost estimation.
 *
 * Maps provider models with pricing for the cost calculator.
 * Pricing is in USD per 1M tokens (March 2026).
 *
 * Models listed under both direct API IDs and OpenRouter IDs
 * so cost estimation works regardless of routing path.
 */

export type ModelDef = {
  /** Model ID in "provider/model-id" format */
  id: string;
  name: string;
  inputPrice: number; // $/1M input tokens
  outputPrice: number; // $/1M output tokens
  contextWindow: number;
  maxOutput: number;
  reasoning?: boolean;
  vision?: boolean;
  agentic?: boolean;
  coding?: boolean;
};

// ─── YOUR CONFIGURED MODELS ───

export const MODELS: ModelDef[] = [
  // ═══ Anthropic ═══
  {
    id: "anthropic/claude-opus-4-6",
    name: "Claude Opus 4.6",
    inputPrice: 5,
    outputPrice: 25,
    contextWindow: 1_000_000,
    maxOutput: 128_000,
    reasoning: true,
    vision: true,
    agentic: true,
    coding: true,
  },
  {
    id: "anthropic/claude-sonnet-4-6",
    name: "Claude Sonnet 4.6",
    inputPrice: 3,
    outputPrice: 15,
    contextWindow: 1_000_000,
    maxOutput: 128_000,
    reasoning: true,
    vision: true,
    agentic: true,
    coding: true,
  },
  {
    id: "anthropic/claude-haiku-4-5",
    name: "Claude Haiku 4.5",
    inputPrice: 1,
    outputPrice: 5,
    contextWindow: 200_000,
    maxOutput: 8_192,
    vision: true,
  },

  // ═══ OpenAI ═══
  {
    id: "openai/gpt-4o",
    name: "GPT-4o",
    inputPrice: 2.5,
    outputPrice: 10,
    contextWindow: 128_000,
    maxOutput: 16_384,
    vision: true,
    agentic: true,
  },
  {
    id: "openai/gpt-4o-mini",
    name: "GPT-4o Mini",
    inputPrice: 0.15,
    outputPrice: 0.6,
    contextWindow: 128_000,
    maxOutput: 16_384,
  },
  {
    id: "openai/o3",
    name: "o3",
    inputPrice: 2.0,
    outputPrice: 8.0,
    contextWindow: 200_000,
    maxOutput: 100_000,
    reasoning: true,
  },
  {
    id: "openai/o3-mini",
    name: "o3-mini",
    inputPrice: 1.1,
    outputPrice: 4.4,
    contextWindow: 128_000,
    maxOutput: 65_536,
    reasoning: true,
  },
  {
    id: "openai/gpt-oss-120b",
    name: "GPT-OSS 120B",
    inputPrice: 0.039,
    outputPrice: 0.10,
    contextWindow: 131_000,
    maxOutput: 16_384,
  },

  // ═══ Google ═══
  {
    id: "google/gemini-2.5-pro",
    name: "Gemini 2.5 Pro",
    inputPrice: 1.25,
    outputPrice: 10,
    contextWindow: 1_050_000,
    maxOutput: 65_536,
    reasoning: true,
    vision: true,
  },
  {
    id: "google/gemini-2.5-flash",
    name: "Gemini 2.5 Flash",
    inputPrice: 0.30,
    outputPrice: 2.50,
    contextWindow: 1_000_000,
    maxOutput: 65_536,
    reasoning: true,
  },
  {
    id: "google/gemini-2.5-flash-lite",
    name: "Gemini 2.5 Flash Lite",
    inputPrice: 0.10,
    outputPrice: 0.40,
    contextWindow: 1_000_000,
    maxOutput: 65_536,
  },

  // ═══ xAI / Grok ═══
  {
    id: "xai/grok-4-1-fast",
    name: "Grok 4.1 Fast",
    inputPrice: 0.20,
    outputPrice: 0.50,
    contextWindow: 2_000_000,
    maxOutput: 128_000,
    reasoning: true,
    agentic: true,
  },

  // ═══ DeepSeek ═══
  {
    id: "deepseek/deepseek-chat",
    name: "DeepSeek V3.2",
    inputPrice: 0.28,
    outputPrice: 0.42,
    contextWindow: 128_000,
    maxOutput: 8_192,
    coding: true,
    agentic: true,
  },
  {
    id: "deepseek/deepseek-reasoner",
    name: "DeepSeek Reasoner",
    inputPrice: 0.28,
    outputPrice: 0.42,
    contextWindow: 128_000,
    maxOutput: 64_000,
    reasoning: true,
  },

  // ═══ Mistral ═══
  {
    id: "mistral/codestral-2508",
    name: "Codestral",
    inputPrice: 0.30,
    outputPrice: 0.90,
    contextWindow: 256_000,
    maxOutput: 32_000,
    coding: true,
  },
  {
    id: "mistral/mistral-small-3.2-24b",
    name: "Mistral Small 3.2",
    inputPrice: 0.075,
    outputPrice: 0.20,
    contextWindow: 131_000,
    maxOutput: 32_000,
    vision: true,
  },
  {
    id: "mistral/mistral-nemo",
    name: "Mistral Nemo",
    inputPrice: 0.02,
    outputPrice: 0.04,
    contextWindow: 131_000,
    maxOutput: 32_000,
  },

  // ═══ OpenRouter models (used in routing config) ═══
  // These mirror the above but with openrouter/ prefix so the
  // pricing map works for both direct and OpenRouter paths.
  {
    id: "openrouter/anthropic/claude-opus-4-5",
    name: "Claude Opus 4.5 (OR)",
    inputPrice: 5,
    outputPrice: 25,
    contextWindow: 1_000_000,
    maxOutput: 128_000,
    reasoning: true,
    vision: true,
    agentic: true,
    coding: true,
  },
  {
    id: "openrouter/anthropic/claude-sonnet-4-5",
    name: "Claude Sonnet 4.5 (OR)",
    inputPrice: 3,
    outputPrice: 15,
    contextWindow: 1_000_000,
    maxOutput: 128_000,
    reasoning: true,
    vision: true,
    agentic: true,
    coding: true,
  },
  {
    id: "openrouter/openai/gpt-4o",
    name: "GPT-4o (OR)",
    inputPrice: 2.5,
    outputPrice: 10,
    contextWindow: 128_000,
    maxOutput: 16_384,
    vision: true,
    agentic: true,
  },
  {
    id: "openrouter/openai/o3",
    name: "o3 (OR)",
    inputPrice: 2.0,
    outputPrice: 8.0,
    contextWindow: 200_000,
    maxOutput: 100_000,
    reasoning: true,
  },
  {
    id: "openrouter/openai/o3-mini",
    name: "o3-mini (OR)",
    inputPrice: 1.1,
    outputPrice: 4.4,
    contextWindow: 128_000,
    maxOutput: 65_536,
    reasoning: true,
  },
  {
    id: "openrouter/openai/gpt-oss-120b",
    name: "GPT-OSS 120B (OR)",
    inputPrice: 0.039,
    outputPrice: 0.10,
    contextWindow: 131_000,
    maxOutput: 16_384,
  },
  {
    id: "openrouter/google/gemini-2.5-pro",
    name: "Gemini 2.5 Pro (OR)",
    inputPrice: 1.25,
    outputPrice: 10,
    contextWindow: 1_050_000,
    maxOutput: 65_536,
    reasoning: true,
    vision: true,
  },
  {
    id: "openrouter/google/gemini-2.5-flash",
    name: "Gemini 2.5 Flash (OR)",
    inputPrice: 0.30,
    outputPrice: 2.50,
    contextWindow: 1_000_000,
    maxOutput: 65_536,
    reasoning: true,
  },
  {
    id: "openrouter/google/gemini-2.5-flash-lite",
    name: "Gemini 2.5 Flash Lite (OR)",
    inputPrice: 0.10,
    outputPrice: 0.40,
    contextWindow: 1_000_000,
    maxOutput: 65_536,
  },
  {
    id: "openrouter/deepseek/deepseek-v3.2",
    name: "DeepSeek V3.2 (OR)",
    inputPrice: 0.28,
    outputPrice: 0.42,
    contextWindow: 128_000,
    maxOutput: 8_192,
    coding: true,
    agentic: true,
  },
  {
    id: "openrouter/deepseek/deepseek-r1",
    name: "DeepSeek R1 (OR)",
    inputPrice: 0.55,
    outputPrice: 2.19,
    contextWindow: 164_000,
    maxOutput: 64_000,
    reasoning: true,
  },
  {
    id: "openrouter/mistralai/devstral-2512",
    name: "Devstral (OR)",
    inputPrice: 0.40,
    outputPrice: 1.20,
    contextWindow: 128_000,
    maxOutput: 32_000,
    coding: true,
  },
  {
    id: "openrouter/mistralai/mistral-nemo",
    name: "Mistral Nemo (OR)",
    inputPrice: 0.02,
    outputPrice: 0.04,
    contextWindow: 131_000,
    maxOutput: 32_000,
  },
  {
    id: "openrouter/qwen/qwen3-235b-a22b-2507",
    name: "Qwen3 235B (OR)",
    inputPrice: 0.13,
    outputPrice: 0.40,
    contextWindow: 128_000,
    maxOutput: 32_000,
  },
  {
    id: "openrouter/qwen/qwen3-coder:free",
    name: "Qwen3 Coder (OR, Free)",
    inputPrice: 0,
    outputPrice: 0,
    contextWindow: 128_000,
    maxOutput: 32_000,
    coding: true,
  },
  {
    id: "openrouter/qwen/qwen3-30b-a3b-thinking-2507",
    name: "Qwen3 30B Thinking (OR)",
    inputPrice: 0.10,
    outputPrice: 0.30,
    contextWindow: 32_000,
    maxOutput: 16_384,
    reasoning: true,
  },
  {
    id: "openrouter/stepfun/step-3.5-flash:free",
    name: "Step 3.5 Flash (OR, Free)",
    inputPrice: 0,
    outputPrice: 0,
    contextWindow: 32_000,
    maxOutput: 8_192,
  },
  {
    id: "openrouter/xiaomi/mimo-v2-flash",
    name: "Xiaomi MiMo V2 Flash (OR)",
    inputPrice: 0.05,
    outputPrice: 0.10,
    contextWindow: 32_000,
    maxOutput: 8_192,
  },
  {
    id: "openrouter/qwen/qwen3-coder-next",
    name: "Qwen3 Coder Next (OR)",
    inputPrice: 0,
    outputPrice: 0,
    contextWindow: 128_000,
    maxOutput: 32_000,
    coding: true,
  },
  {
    id: "openrouter/nvidia/nemotron-3-super-120b-a12b:free",
    name: "NVIDIA Nemotron 3 Super 120B (OR, Free)",
    inputPrice: 0,
    outputPrice: 0,
    contextWindow: 262_000,
    maxOutput: 32_000,
    agentic: true,
  },
  // ═══ Meta / Llama (via OpenRouter) ═══
  {
    id: "openrouter/meta-llama/llama-3.3-70b-instruct",
    name: "Llama 3.3 70B (OR)",
    inputPrice: 0.10,
    outputPrice: 0.32,
    contextWindow: 128_000,
    maxOutput: 32_000,
  },
];

/**
 * Build the pricing map used by the router.
 */
export function buildPricingMap(): Map<string, { inputPrice: number; outputPrice: number }> {
  const map = new Map<string, { inputPrice: number; outputPrice: number }>();
  for (const m of MODELS) {
    map.set(m.id, { inputPrice: m.inputPrice, outputPrice: m.outputPrice });
  }
  return map;
}

/**
 * Get context window for a model ID.
 */
export function getContextWindow(modelId: string): number | undefined {
  return MODELS.find((m) => m.id === modelId)?.contextWindow;
}

/**
 * Check if a model supports reasoning.
 */
export function isReasoningModel(modelId: string): boolean {
  return MODELS.find((m) => m.id === modelId)?.reasoning ?? false;
}

/**
 * Check if a model is optimized for agentic workflows.
 */
export function isAgenticModel(modelId: string): boolean {
  return MODELS.find((m) => m.id === modelId)?.agentic ?? false;
}
