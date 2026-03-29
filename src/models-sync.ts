/**
 * Model Catalog Auto-Sync
 *
 * Fetches current model list and pricing from OpenRouter's API
 * and updates the in-memory pricing map. Can be run on startup
 * or periodically to keep pricing current.
 *
 * OpenRouter API: GET https://openrouter.ai/api/v1/models (no auth required)
 */

import { logger } from "./logger.js";

type OpenRouterModel = {
  id: string;
  name: string;
  pricing: {
    prompt: string; // price per token as string
    completion: string;
  };
  context_length: number;
  top_provider?: {
    max_completion_tokens?: number;
  };
  architecture?: {
    modality?: string;
    input_modalities?: string[];
    output_modalities?: string[];
  };
};

type SyncResult = {
  success: boolean;
  modelsUpdated: number;
  modelsTotal: number;
  error?: string;
  timestamp: string;
};

const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";

let lastSyncResult: SyncResult | null = null;

/**
 * Fetch models from OpenRouter and update the pricing map.
 * Returns the number of models matched and updated.
 */
export async function syncModelPricing(
  pricingMap: Map<string, { inputPrice: number; outputPrice: number }>,
): Promise<SyncResult> {
  const timestamp = new Date().toISOString();

  try {
    const res = await fetch(OPENROUTER_MODELS_URL, {
      signal: AbortSignal.timeout(10_000),
      headers: { "User-Agent": "TierFlow/2.0" },
    });

    if (!res.ok) {
      const result: SyncResult = {
        success: false,
        modelsUpdated: 0,
        modelsTotal: 0,
        error: `HTTP ${res.status}`,
        timestamp,
      };
      lastSyncResult = result;
      return result;
    }

    const body = (await res.json()) as { data: OpenRouterModel[] };
    const models = body.data || [];
    let updated = 0;

    for (const m of models) {
      // OpenRouter model IDs: "anthropic/claude-opus-4-6", "openai/gpt-4o", etc.
      // In TierFlow, OpenRouter models are prefixed: "openrouter/anthropic/claude-opus-4-6"
      const orId = `openrouter/${m.id}`;

      // Parse pricing (OpenRouter returns per-token, we need per-1M-token)
      const inputPerToken = parseFloat(m.pricing?.prompt || "0");
      const outputPerToken = parseFloat(m.pricing?.completion || "0");
      const inputPrice = inputPerToken * 1_000_000;
      const outputPrice = outputPerToken * 1_000_000;

      // Update pricing if the model is in our map or routing config
      let matched = false;
      if (pricingMap.has(orId)) {
        pricingMap.set(orId, { inputPrice, outputPrice });
        matched = true;
      }

      // Also update the direct-API version if it exists
      if (pricingMap.has(m.id)) {
        pricingMap.set(m.id, { inputPrice, outputPrice });
        matched = true;
      }

      if (matched) updated++;
    }

    const result: SyncResult = {
      success: true,
      modelsUpdated: updated,
      modelsTotal: models.length,
      timestamp,
    };
    lastSyncResult = result;

    logger.info(
      `[models-sync] Updated ${updated} model prices from OpenRouter (${models.length} models available)`,
    );

    return result;
  } catch (err) {
    const result: SyncResult = {
      success: false,
      modelsUpdated: 0,
      modelsTotal: 0,
      error: (err as Error).message,
      timestamp,
    };
    lastSyncResult = result;
    logger.warn(`[models-sync] Failed to sync: ${result.error}`);
    return result;
  }
}

/**
 * Get the result of the last sync attempt.
 */
export function getLastSyncResult(): SyncResult | null {
  return lastSyncResult;
}

/**
 * Start periodic sync (default: every 24 hours).
 */
export function startPeriodicSync(
  pricingMap: Map<string, { inputPrice: number; outputPrice: number }>,
  intervalMs: number = 24 * 60 * 60 * 1000,
): void {
  // Sync once on startup (non-blocking)
  syncModelPricing(pricingMap).catch(() => {});

  // Then periodically
  setInterval(() => {
    syncModelPricing(pricingMap).catch(() => {});
  }, intervalMs);
}
