# Token & Cost Tracking

**Status:** IMPLEMENTED in `src/usage.ts`

## Overview

Track token usage and costs per request, accumulate totals, and expose via `/stats` and `/dashboard`.

## Data Flow

```
Provider response → usage { prompt_tokens, completion_tokens, cost }
        ↓
TierFlow accumulates in-memory (src/usage.ts):
  - all-time totals (tokens, cost, requests)
  - by model, by tier, by category
  - rolling 24h window (per-hour buckets)
        ↓
GET /stats → exposes accumulated data as JSON
GET /dashboard → polls /stats and renders charts
```

## TokenUsageStats Shape (from `src/usage.ts`)

```typescript
{
  allTime: {
    promptTokens: number,
    completionTokens: number,
    totalTokens: number,
    cost: number,          // USD estimated from model pricing
    requests: number,
  },
  byModel: Record<string, { tokens: number, cost: number, requests: number }>,
  byTier: Record<string, { tokens: number, cost: number, requests: number }>,
  byCategory: Record<string, { tokens: number, cost: number, requests: number }>,
  hourly: Array<{          // Rolling 24h, one entry per hour
    hour: string,          // ISO hour: "2026-03-22T14:00:00Z"
    tokens: number,
    cost: number,
    requests: number,
  }>,
}
```

## Accumulation Logic

After each successful response, `recordUsage()` in `src/usage.ts` is called from `src/provider.ts`:

1. Extract `usage.prompt_tokens`, `usage.completion_tokens` from provider response
2. Add to `allTime` totals
3. Add to `byModel[modelId]`, `byTier[tier]`, and `byCategory[category]`
4. Add to current hour bucket in `hourly[]`
5. Prune hourly entries older than 24h

## Endpoints

- `GET /stats` — returns full stats including `tokenUsage` object
- `GET /health` — includes stats summary in response
- `GET /dashboard` — HTML dashboard that polls `/stats` every 5s and renders:
  - Total cost card
  - Category breakdown table (requests, tokens, cost per category)
  - Model usage table (requests, tokens, cost per model)
  - Hourly activity bar chart (last 24h)

## Limitations

- **In-memory only** — stats reset on server restart
- **Cost estimation** — based on model pricing in `src/models.ts`, not actual billing
- Dashboard shows "Stats since last restart" with uptime
