# Quality-Price Tradeoff System — TierFlow Design Specification

**Status:** Design Specification
**Date:** 2026-03-28

---

## Concept

For each routing category, the user sets a quality level (1-5) via a slider. Each level maps to a specific model optimized for that category at that price point.

```
Level 1: Budget    — cheapest, acceptable quality
Level 2: Value     — good quality, low cost
Level 3: Balanced  — recommended default
Level 4: Premium   — high quality, higher cost
Level 5: Best      — maximum quality, expensive
```

---

## A. Quality Tier Matrix (8 Categories x 5 Levels)

Prices are USD per 1M tokens (input / output). Benchmarks are approximate.

### simple_chat

| Lvl | Label | Model | In/Out $/M | Benchmark |
|-----|-------|-------|------------|-----------|
| 1 | Budget | `openrouter/mistralai/mistral-nemo` | $0.04/$0.07 | MMLU ~67% |
| 2 | Value | `openrouter/google/gemini-2.5-flash-lite` | $0.10/$0.40 | MMLU ~78% |
| 3 | Balanced | `openrouter/google/gemini-2.5-flash` | $0.15/$0.60 | MMLU ~82% |
| 4 | Premium | `openrouter/deepseek/deepseek-v3.2` | $0.27/$1.10 | MMLU ~88% |
| 5 | Best | `openrouter/anthropic/claude-sonnet-4-5` | $3.00/$15.00 | MMLU ~90%+ |

### general

| Lvl | Label | Model | In/Out $/M | Benchmark |
|-----|-------|-------|------------|-----------|
| 1 | Budget | `openrouter/mistralai/mistral-nemo` | $0.04/$0.07 | MMLU ~67% |
| 2 | Value | `openrouter/google/gemini-2.5-flash-lite` | $0.10/$0.40 | MMLU ~78% |
| 3 | Balanced | `openrouter/qwen/qwen3-235b-a22b-2507` | $0.13/$0.40 | MMLU ~87% |
| 4 | Premium | `openrouter/deepseek/deepseek-v3.2` | $0.27/$1.10 | MMLU ~88% |
| 5 | Best | `openrouter/google/gemini-2.5-pro` | $1.25/$10.00 | MMLU ~90% |

### coding

| Lvl | Label | Model | In/Out $/M | Benchmark |
|-----|-------|-------|------------|-----------|
| 1 | Budget | `openrouter/qwen/qwen3-coder:free` | Free | HumanEval ~72% |
| 2 | Value | `openrouter/deepseek/deepseek-v3.2` | $0.27/$1.10 | HumanEval ~82%, SWE-bench ~49% |
| 3 | Balanced | `openrouter/mistralai/devstral-2512` | $0.40/$1.20 | SWE-bench ~46% |
| 4 | Premium | `openrouter/anthropic/claude-sonnet-4-5` | $3.00/$15.00 | HumanEval ~93%, SWE-bench ~72% |
| 5 | Best | `openrouter/anthropic/claude-opus-4-5` | $15.00/$75.00 | SWE-bench ~80%+ |

### reasoning

| Lvl | Label | Model | In/Out $/M | Benchmark |
|-----|-------|-------|------------|-----------|
| 1 | Budget | `openrouter/qwen/qwen3-30b-a3b-thinking-2507` | $0.10/$0.30 | MATH ~78%, GPQA ~52% |
| 2 | Value | `openrouter/deepseek/deepseek-r1` | $0.55/$2.19 | MATH ~90%, GPQA ~59% |
| 3 | Balanced | `openrouter/openai/o3-mini` | $1.10/$4.40 | MATH ~90%, GPQA ~63% |
| 4 | Premium | `openrouter/openai/o3` | $2.00/$8.00 | MATH ~97%, GPQA ~77% |
| 5 | Best | `openrouter/google/gemini-2.5-pro` | $1.25/$10.00 | MATH ~97%, GPQA ~84% |

### creative

| Lvl | Label | Model | In/Out $/M | Benchmark |
|-----|-------|-------|------------|-----------|
| 1 | Budget | `openrouter/stepfun/step-3.5-flash:free` | Free | Creative: 3/5 |
| 2 | Value | `openrouter/mistralai/mistral-nemo` | $0.04/$0.07 | Creative: 3.5/5 |
| 3 | Balanced | `openrouter/deepseek/deepseek-v3.2` | $0.27/$1.10 | Creative: 4/5 |
| 4 | Premium | `openrouter/anthropic/claude-sonnet-4-5` | $3.00/$15.00 | Creative: 4.5/5 |
| 5 | Best | `openrouter/anthropic/claude-opus-4-5` | $15.00/$75.00 | Creative: 5/5 |

### data

| Lvl | Label | Model | In/Out $/M | Benchmark |
|-----|-------|-------|------------|-----------|
| 1 | Budget | `openrouter/google/gemini-2.5-flash-lite` | $0.10/$0.40 | Good structured output |
| 2 | Value | `openrouter/qwen/qwen3-235b-a22b-2507` | $0.13/$0.40 | Good SQL |
| 3 | Balanced | `openrouter/deepseek/deepseek-v3.2` | $0.27/$1.10 | Excellent structured output |
| 4 | Premium | `openrouter/google/gemini-2.5-flash` | $0.15/$0.60 | Native code exec, 1M context |
| 5 | Best | `openrouter/google/gemini-2.5-pro` | $1.25/$10.00 | Best for complex analysis |

### agentic

| Lvl | Label | Model | In/Out $/M | Benchmark |
|-----|-------|-------|------------|-----------|
| 1 | Budget | `openrouter/xiaomi/mimo-v2-flash` | $0.05/$0.10 | Basic tool use |
| 2 | Value | `openrouter/deepseek/deepseek-v3.2` | $0.27/$1.10 | Solid tool calling |
| 3 | Balanced | `openrouter/anthropic/claude-sonnet-4-5` | $3.00/$15.00 | Excellent tool use |
| 4 | Premium | `openrouter/openai/gpt-4o` | $2.50/$10.00 | Strong agentic, vision |
| 5 | Best | `openrouter/anthropic/claude-opus-4-5` | $15.00/$75.00 | Best for long autonomous runs |

### transcription

| Lvl | Label | Model | In/Out $/M | Benchmark |
|-----|-------|-------|------------|-----------|
| 1 | Budget | `openrouter/google/gemini-2.5-flash-lite` | $0.10/$0.40 | WER ~12% |
| 2 | Value | `openrouter/google/gemini-2.5-flash` | $0.15/$0.60 | WER ~8% |
| 3 | Balanced | `openrouter/google/gemini-2.5-pro` | $1.25/$10.00 | WER ~5% |
| 4 | Premium | `openrouter/openai/whisper-large-v3` | $0.006/min | WER ~4% |
| 5 | Best | `openrouter/openai/gpt-4o-audio-preview` | $2.50/$10.00 | WER ~3% |

---

## B. Config Schema

### New Types (src/config.ts)

```typescript
export type QualityLevel = 1 | 2 | 3 | 4 | 5;

export type QualityTierEntry = {
  level: QualityLevel;
  label: "Budget" | "Value" | "Balanced" | "Premium" | "Best";
  model: string;                         // provider/model-id
  inputPrice: number;                    // $/1M input tokens
  outputPrice: number;                   // $/1M output tokens
  contextWindow: number;
  speedTier: "fast" | "medium" | "slow";
  pricingUnit?: "token" | "minute";      // default: token
  benchmarks?: Record<string, number>;   // { "HumanEval": 82 }
};

export type CategoryQualityConfig = {
  selected: QualityLevel;
  levels: [QualityTierEntry, QualityTierEntry, QualityTierEntry, QualityTierEntry, QualityTierEntry];
};
```

### FreeRouterConfig addition

```typescript
qualityTiers?: Record<string, CategoryQualityConfig>;
```

### How It Works

When user moves slider to level N for category C:
1. Dashboard POSTs `{ category: "coding", level: 3 }` to `POST /quality-level`
2. Server reads `qualityTiers["coding"].levels[2]` (0-indexed)
3. Updates `qualityTiers["coding"].selected = 3`
4. Updates `categories["coding"].primary = levels[2].model`
5. Writes config to disk (atomic: temp file + rename)
6. Calls `reloadConfig()` — takes effect immediately

**Fallback arrays in categories are NOT changed** — they're safety nets, not quality choices.

---

## C. Dashboard UI — Quality Sliders

### Layout

New "Quality Tiers" tab alongside existing "Stats" tab. Each category gets a card with:

```
┌─────────────────────────────────────┐
│ ⚙ Coding          Level 2 · Value  │
│                                     │
│ ●────●────○────○────○               │
│ Budget Value Balanced Premium Best  │
│                                     │
│ ┌─────────────────────────────────┐ │
│ │ deepseek/deepseek-v3.2          │ │
│ │ $0.27 / $1.10 per 1M · 64k · ⚡│ │
│ │ HumanEval 82  SWE-bench 49     │ │
│ │ Est. $0.04/day at current usage │ │
│ └─────────────────────────────────┘ │
└─────────────────────────────────────┘
```

### Savings Panel (top of quality tab)

```
Current: $0.0412/day  →  New: $0.1280/day
         [Apply Changes]
```

Updates in real-time as sliders move. Uses actual usage patterns from `/stats` to estimate costs.

### Category Icons

| Category | Icon |
|----------|------|
| simple_chat | 💬 |
| general | 🌐 |
| coding | ⚙ |
| reasoning | 🧮 |
| creative | ✍ |
| data | 📊 |
| agentic | 🤖 |
| transcription | 🎤 |

---

## D. Model Stats Per Card

Each level's model card shows:

| Field | Source | Format |
|-------|--------|--------|
| Model name | matrix | `deepseek/deepseek-v3.2` |
| Input/Output price | matrix | `$0.27 / $1.10 per 1M` or `Free` |
| Context window | matrix | `64k` / `128k` / `1M` |
| Speed tier | matrix | fast (green) / medium (blue) / slow (yellow) |
| Benchmarks | matrix | Chips: `HumanEval 82`, `SWE-bench 49` |
| Est. daily cost | calculated | `$0.04/day at current usage` |

Benchmark keys per category:
- coding: HumanEval, SWE-bench
- reasoning: MATH, GPQA
- general/simple_chat: MMLU
- creative: Creative (subjective 1-5)
- data: structured output quality
- agentic: tool use reliability
- transcription: WER (lower = better)

---

## E. Savings Estimator

Real-time calculation as sliders move:

```
daily_cost = (avg_tokens_per_request / 1M) × output_price × (daily_request_estimate)
```

- Uses `/stats` → `byCategory[cat].{tokens, requests}` for actual usage patterns
- Shows "no usage data" when a category has zero requests
- Changed sliders get yellow border until Applied
- Apply button disabled until changes exist

---

## F. Implementation Plan

### New File: src/quality.ts

- `QUALITY_TIER_MATRIX`: Full 8x5 hardcoded matrix
- `getQualityTiersResponse()`: Returns matrix + detected `selected` levels
- `setQualityLevel(category, level, configPath)`: Writes config, reloads

### Modified Files

| File | Change |
|------|--------|
| `src/config.ts` | Add types + `qualityTiers` field + `writeConfig()` |
| `src/server.ts` | Add `GET /quality-tiers` + `POST /quality-level` endpoints |
| `src/dashboard.ts` | Add tab bar, quality panel, slider cards, savings estimator |

### Build Sequence

| Phase | What |
|-------|------|
| 1 | Types + config schema (`config.ts`) |
| 2 | Quality module with matrix (`quality.ts`) |
| 3 | Server endpoints (`server.ts`) |
| 4 | Dashboard UI (`dashboard.ts`) |
| 5 | Add `qualityTiers` to example config |
| 6 | Test: slider → Apply → verify routing change |

### Security

- `POST /quality-level` validates category is one of 8 known + level is 1-5
- Config write uses atomic temp-file + rename
- Server binds localhost only — no auth needed
- No user-supplied strings written to config without validation

### Backward Compatibility

- `qualityTiers` is optional — existing configs work without it
- When absent, quality tab shows "Configure quality tiers to enable" message
- Router still reads `categories[cat].primary` — quality system is a config layer on top
