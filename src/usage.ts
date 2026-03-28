/**
 * Token usage and cost accumulator.
 * Tracks per-request, per-model, per-tier, per-category, and rolling 24h hourly data.
 * Includes baseline cost tracking for savings calculation.
 */

export interface HourlyBucket {
  hour: string; // ISO hour: "2026-03-22T14:00:00Z"
  tokens: number;
  cost: number;
  baselineCost: number;
  requests: number;
}

export interface UsageByKey {
  tokens: number;
  cost: number;
  baselineCost: number;
  requests: number;
}

export interface TokenUsageStats {
  allTime: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    cost: number;
    baselineCost: number;
    requests: number;
  };
  byModel: Record<string, UsageByKey>;
  byTier: Record<string, UsageByKey>;
  byCategory: Record<string, UsageByKey>;
  hourly: HourlyBucket[];
}

const usage: TokenUsageStats = {
  allTime: {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    cost: 0,
    baselineCost: 0,
    requests: 0,
  },
  byModel: {},
  byTier: {},
  byCategory: {},
  hourly: [],
};

/**
 * Record token usage from a completed request.
 */
export function recordUsage(
  model: string,
  tier: string,
  data: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    cost?: number;
    baselineCost?: number;
  },
  category?: string,
): void {
  const prompt = data.prompt_tokens ?? 0;
  const completion = data.completion_tokens ?? 0;
  const total = data.total_tokens ?? prompt + completion;
  const cost = data.cost ?? 0;
  const baselineCost = data.baselineCost ?? 0;

  if (total === 0 && cost === 0) return;

  // All-time
  usage.allTime.promptTokens += prompt;
  usage.allTime.completionTokens += completion;
  usage.allTime.totalTokens += total;
  usage.allTime.cost += cost;
  usage.allTime.baselineCost += baselineCost;
  usage.allTime.requests++;

  // By model
  if (!usage.byModel[model]) {
    usage.byModel[model] = { tokens: 0, cost: 0, baselineCost: 0, requests: 0 };
  }
  usage.byModel[model].tokens += total;
  usage.byModel[model].cost += cost;
  usage.byModel[model].baselineCost += baselineCost;
  usage.byModel[model].requests++;

  // By tier
  if (!usage.byTier[tier]) {
    usage.byTier[tier] = { tokens: 0, cost: 0, baselineCost: 0, requests: 0 };
  }
  usage.byTier[tier].tokens += total;
  usage.byTier[tier].cost += cost;
  usage.byTier[tier].baselineCost += baselineCost;
  usage.byTier[tier].requests++;

  // By category
  if (category) {
    if (!usage.byCategory[category]) {
      usage.byCategory[category] = { tokens: 0, cost: 0, baselineCost: 0, requests: 0 };
    }
    usage.byCategory[category].tokens += total;
    usage.byCategory[category].cost += cost;
    usage.byCategory[category].baselineCost += baselineCost;
    usage.byCategory[category].requests++;
  }

  // Hourly bucket
  const now = new Date();
  const hourKey = now.toISOString().slice(0, 13) + ":00:00Z";
  let bucket = usage.hourly.find((b) => b.hour === hourKey);
  if (!bucket) {
    bucket = { hour: hourKey, tokens: 0, cost: 0, baselineCost: 0, requests: 0 };
    usage.hourly.push(bucket);
  }
  bucket.tokens += total;
  bucket.cost += cost;
  bucket.baselineCost += baselineCost;
  bucket.requests++;

  // Prune >24h
  const cutoff =
    new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString().slice(0, 13) + ":00:00Z";
  usage.hourly = usage.hourly.filter((b) => b.hour >= cutoff);
}

/**
 * Get current usage stats (for /stats endpoint).
 */
export function getUsageStats(): TokenUsageStats {
  return usage;
}

/**
 * Reset usage stats (for testing).
 */
export function resetUsage(): void {
  usage.allTime = {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    cost: 0,
    baselineCost: 0,
    requests: 0,
  };
  usage.byModel = {};
  usage.byTier = {};
  usage.byCategory = {};
  usage.hourly = [];
}
