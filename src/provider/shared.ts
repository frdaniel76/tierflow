/**
 * Provider Shared Utilities — used by both Anthropic and OpenAI providers.
 */

import { getConfig, toInternalApiType } from "../config.js";
import { recordUsage } from "../usage.js";
import type { ProviderConfig } from "./types.js";

// ─── Timeout Configuration ───

const TIER_TIMEOUTS: Record<string, number> = {
  SIMPLE: 30_000,
  MEDIUM: 60_000,
  COMPLEX: 120_000,
  REASONING: 120_000,
  EXPLICIT: 120_000,
};

const STREAM_STALL_TIMEOUT = 60_000;

export function getTierTimeout(tier: string): number {
  return TIER_TIMEOUTS[tier] ?? 60_000;
}

export { STREAM_STALL_TIMEOUT };

export class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TimeoutError";
  }
}

// ─── Baseline Cost ───

const OPUS_INPUT_PRICE = 15 / 1_000_000;
const OPUS_OUTPUT_PRICE = 75 / 1_000_000;

export function computeBaselineCost(promptTokens: number, completionTokens: number): number {
  return promptTokens * OPUS_INPUT_PRICE + completionTokens * OPUS_OUTPUT_PRICE;
}

// ─── Category State ───

let _currentCategory: string | undefined;

export function setCurrentCategory(cat: string | undefined) {
  _currentCategory = cat;
}

export function getCurrentCategory(): string | undefined {
  return _currentCategory;
}

// ─── Provider Config ───

export function getProviderConfig(provider: string): ProviderConfig | undefined {
  const cfg = getConfig();
  const entry = cfg.providers[provider];
  if (!entry) return undefined;
  return {
    baseUrl: entry.baseUrl,
    api: toInternalApiType(entry.api),
    headers: entry.headers,
  };
}

export function parseModelId(modelId: string): { provider: string; model: string } {
  const slash = modelId.indexOf("/");
  if (slash === -1) return { provider: "anthropic", model: modelId };
  return { provider: modelId.slice(0, slash), model: modelId.slice(slash + 1) };
}

// ─── Stream Helpers ───

export async function readStreamWithStallDetection(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  onChunk: (value: Uint8Array) => void,
  abortController: AbortController,
): Promise<void> {
  while (true) {
    let stallTimerId: ReturnType<typeof setTimeout> | undefined;
    const stallPromise = new Promise<never>((_, reject) => {
      stallTimerId = setTimeout(() => {
        abortController.abort();
        reject(new TimeoutError(`Stream stalled: no data for ${STREAM_STALL_TIMEOUT / 1000}s`));
      }, STREAM_STALL_TIMEOUT);
    });

    try {
      const result = await Promise.race([reader.read(), stallPromise]);
      clearTimeout(stallTimerId);
      const { done, value } = result as ReadableStreamReadResult<Uint8Array>;
      if (done) break;
      if (value) onChunk(value);
    } catch (err) {
      clearTimeout(stallTimerId);
      throw err;
    }
  }
}

// ─── Usage Recording ───

export function recordProviderUsage(
  modelName: string,
  tier: string,
  usage: { prompt_tokens: number; completion_tokens: number; [key: string]: unknown },
): void {
  const promptTokens = usage.prompt_tokens ?? 0;
  const completionTokens = usage.completion_tokens ?? 0;
  recordUsage(
    modelName,
    tier,
    {
      ...usage,
      baselineCost: computeBaselineCost(promptTokens, completionTokens),
    },
    _currentCategory,
  );
}
