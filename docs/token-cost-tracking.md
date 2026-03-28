# Token & Cost Tracking — Design

## Overview

Track token usage and costs per request, accumulate totals, and expose via /stats for the dashboard.

## Data Flow

```
OpenRouter response → usage { prompt_tokens, completion_tokens, cost }
        ↓
FreeRouter accumulates in-memory:
  - all-time totals (tokens, cost, by model, by tier)
  - rolling 24h window (per-hour buckets)
        ↓
/stats endpoint exposes accumulated data
        ↓
Dashboard /api/token-costs combines:
  - FreeRouter /stats (live session data)
  - OpenRouter /api/v1/auth/key (billing totals: daily/weekly/monthly)
        ↓
Dashboard card: gauges, bars, breakdown tables
```

## FreeRouter Stats Extension

Add to the existing `stats` object:

```typescript
tokenUsage: {
  allTime: {
    promptTokens: number,
    completionTokens: number,
    totalTokens: number,
    cost: number,          // USD from OpenRouter
    requests: number,
  },
  byModel: Record<string, { tokens: number, cost: number, requests: number }>,
  byTier: Record<string, { tokens: number, cost: number, requests: number }>,
  hourly: Array<{          // Rolling 24h, one entry per hour
    hour: string,          // ISO hour: "2026-03-22T14:00:00Z"
    tokens: number,
    cost: number,
    requests: number,
  }>,
}
```

## Accumulation Logic

After each successful response in `forwardToOpenAI` and `forwardToAnthropic`:
1. Extract `usage.prompt_tokens`, `usage.completion_tokens`, `usage.cost` from response
2. Add to `allTime` totals
3. Add to `byModel[modelName]` and `byTier[tier]`
4. Add to current hour bucket in `hourly[]`
5. Prune hourly entries older than 24h

## Dashboard API

`GET /api/token-costs` returns:
```json
{
  "freerouter": { /* stats.tokenUsage from FreeRouter /stats */ },
  "billing": {
    "daily": 0.72,
    "weekly": 1.33,
    "monthly": 1.33
  }
}
```

## Dashboard Card

- Cost gauge: daily spend with color thresholds
- Bar chart: hourly token usage (last 24h)
- Model breakdown: tokens + cost per model
- Tier breakdown: tokens + cost per tier
- Billing summary: daily/weekly/monthly from OpenRouter
```
