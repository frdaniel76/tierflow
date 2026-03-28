# Dashboard v2 — Cost Stats, Token Consumption & Config Viewer

**Status:** Design Specification
**Date:** 2026-03-28

---

## Overview

Enhance the TierFlow dashboard with three new sections: cost & savings tracking, detailed token consumption analytics, and a live config viewer. All implemented as inline HTML in `dashboard.ts` — no external files, no framework.

## Critical Gap Found

**Savings data doesn't exist yet.** The `RoutingDecision.baselineCost` is computed during routing but discarded after the response. To show savings, `usage.ts` must be extended to track `baselineCost` alongside actual cost.

---

## A. Data Pipeline Changes (Prerequisite)

### usage.ts — Add baselineCost tracking

```typescript
// Extend UsageByKey
export interface UsageByKey {
  tokens: number;
  cost: number;
  baselineCost: number;   // what Opus would have cost
  requests: number;
}

// Extend HourlyBucket
export interface HourlyBucket {
  hour: string;
  tokens: number;
  cost: number;
  baselineCost: number;   // ADD
  requests: number;
}

// Extend allTime shape
allTime: {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cost: number;
  baselineCost: number;   // ADD
  requests: number;
};

// Extend recordUsage signature
export function recordUsage(
  model: string,
  tier: string,
  data: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    cost?: number;
    baselineCost?: number;   // ADD
  },
  category?: string,
): void
```

### provider.ts — Compute baseline at each recordUsage call site

```typescript
const OPUS_INPUT_PRICE  = 15 / 1_000_000;  // $15/M
const OPUS_OUTPUT_PRICE = 75 / 1_000_000;  // $75/M

// At each recordUsage call (3 sites):
const baselineCost = (promptTokens * OPUS_INPUT_PRICE) + (completionTokens * OPUS_OUTPUT_PRICE);
recordUsage(model, tier, { prompt_tokens, completion_tokens, baselineCost }, category);
```

---

## B. Cost & Savings Section

**Data source:** `GET /stats` → `stats.tokenUsage.allTime.{cost, baselineCost, requests}`

**Cards:**
| Card | Value | Source |
|------|-------|--------|
| Actual Cost | `$X.XXXX` | `allTime.cost` |
| Baseline Cost | `$X.XXXX` | `allTime.baselineCost` |
| Saved | `XX.X%` + `$X.XX saved` | `(baseline - actual) / baseline` |
| Cost/1k Requests | `$X.XXXX` | `actual / requests * 1000` |

**Efficiency bar:** Horizontal bar showing actual cost as percentage of baseline (green fill, lower = better).

**Hourly cost trend:** 24-bar CSS chart from `tokenUsage.hourly[]`, tooltips show actual + saved per hour.

---

## C. Token Consumption Section

**Data source:** `GET /stats` → `stats.tokenUsage.{allTime, byCategory, byModel}`

**Cards:**
| Card | Value | Source |
|------|-------|--------|
| Total Tokens | `XM` | `allTime.totalTokens` |
| Avg Tokens/Request | `Xk` | `totalTokens / requests` |
| Completion Ratio | `XX%` | `completionTokens / totalTokens` |

**Distribution mini-bars:** Horizontal bars for top categories and models by token count, color-coded per category.

**Upgraded tables:** Category and Model tables gain a "Saved" column showing `baselineCost - cost` per row.

---

## D. Config Viewer

**Data source:** `GET /config` → `{ configPath, config }` (fetched once on load, not on poll)

**Tabbed interface:**
- **Providers tab:** Cards per provider showing baseUrl, API type, PII/compress status, enabled/disabled
- **Routing tab:** Category → Model mapping table + Tier → Model table (with fallbacks)
- **Features tab:** Grid of enabled/disabled features (Cache, ML Classifier, PII, Compression, Agentic Tiers)

**Reload button:** Calls `POST /reload-config` then re-fetches config.

---

## E. Config Editor (Phase 2 — Design Only)

Not implemented yet. Would require:
- New `POST /config` endpoint accepting partial config patch
- Dashboard form with dropdowns for category → model
- Checkboxes for cache/PII/compress
- Diff preview before apply
- `writeConfig()` function in config.ts with atomic write (temp file + rename)

---

## Implementation Sequence

| Phase | What | Files |
|-------|------|-------|
| 1 | Data pipeline — baselineCost tracking | `usage.ts`, `provider.ts` |
| 2 | Cost & Savings dashboard section | `dashboard.ts` |
| 3 | Token consumption section | `dashboard.ts` |
| 4 | Config viewer | `dashboard.ts` |
| 5 | Test & verify | manual browser test |

**All changes are in 3 files:** `usage.ts`, `provider.ts`, `dashboard.ts`.

---

## Data Flow

```
API response (real token counts)
  → provider.ts: compute baselineCost from Opus pricing
  → recordUsage(model, tier, { tokens, baselineCost }, category)
  → usage.ts: accumulate into allTime, byModel, byTier, byCategory, hourly
  → GET /stats: returns full stats with baselineCost fields
  → dashboard: renders savings %, cost bars, token charts

GET /config (once on load):
  → renderConfig: providers, routing tables, feature toggles
```
