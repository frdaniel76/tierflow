# Quality-Price Tradeoff System — TierFlow Design Specification v2

**Status:** Design Specification
**Date:** 2026-03-28
**Revision:** v2 — simplified with presets + integration config page

---

## Design Philosophy

The original 8x5 matrix (40 individual model choices) is too complex. Most users want one decision, not forty.

**New approach: 3 layers**

```
Layer 1: Presets      — Pick one of 4 presets. Done. (90% of users stop here)
Layer 2: Global slider — One slider 1-5 for all categories. Quick tweak.
Layer 3: Per-category  — Override individual categories. Power users only.
```

Plus a separate **Integrations page** to configure API keys and providers.

---

## A. Presets (Primary UX)

Four one-click profiles that configure ALL categories at once:

### 1. Free Tier
*Zero cost. Uses only free models. Quality varies.*

| Category | Model | Cost |
|----------|-------|------|
| simple_chat | `openrouter/mistralai/mistral-nemo` | Free* |
| general | `openrouter/qwen/qwen3-235b-a22b-2507` | ~Free* |
| coding | `openrouter/qwen/qwen3-coder:free` | Free |
| reasoning | `openrouter/qwen/qwen3-30b-a3b-thinking-2507` | ~Free* |
| creative | `openrouter/stepfun/step-3.5-flash:free` | Free |
| data | `openrouter/google/gemini-2.5-flash-lite` | ~$0.10/M |
| agentic | `openrouter/xiaomi/mimo-v2-flash` | ~$0.05/M |
| transcription | `openrouter/google/gemini-2.5-flash-lite` | ~$0.10/M |

**Est. cost:** ~$0-0.50/day at moderate usage
**Quality:** Acceptable for casual use. Coding and creative are solid (purpose-built free models). Reasoning is limited.

### 2. Smart Saver (Recommended Default)
*Best value. Routes cheap where it doesn't matter, pays for quality where it does.*

| Category | Model | Cost |
|----------|-------|------|
| simple_chat | `openrouter/google/gemini-2.5-flash-lite` | $0.10/$0.40 |
| general | `openrouter/deepseek/deepseek-v3.2` | $0.27/$1.10 |
| coding | `openrouter/qwen/qwen3-coder:free` | Free |
| reasoning | `openrouter/deepseek/deepseek-r1` | $0.55/$2.19 |
| creative | `openrouter/stepfun/step-3.5-flash:free` | Free |
| data | `openrouter/deepseek/deepseek-v3.2` | $0.27/$1.10 |
| agentic | `openrouter/deepseek/deepseek-v3.2` | $0.27/$1.10 |
| transcription | `openrouter/google/gemini-2.5-flash` | $0.15/$0.60 |

**Est. cost:** ~$1-5/day at moderate usage
**Quality:** Good across the board. Coding and creative use specialized free models. Reasoning uses DeepSeek R1 (strong). Simple chat is cheap but capable.

### 3. Quality First
*Premium models for important work. Cheap for trivial stuff.*

| Category | Model | Cost |
|----------|-------|------|
| simple_chat | `openrouter/google/gemini-2.5-flash` | $0.15/$0.60 |
| general | `openrouter/deepseek/deepseek-v3.2` | $0.27/$1.10 |
| coding | `openrouter/anthropic/claude-sonnet-4-5` | $3.00/$15.00 |
| reasoning | `openrouter/openai/o3` | $2.00/$8.00 |
| creative | `openrouter/anthropic/claude-sonnet-4-5` | $3.00/$15.00 |
| data | `openrouter/google/gemini-2.5-pro` | $1.25/$10.00 |
| agentic | `openrouter/anthropic/claude-sonnet-4-5` | $3.00/$15.00 |
| transcription | `openrouter/google/gemini-2.5-pro` | $1.25/$10.00 |

**Est. cost:** ~$10-30/day at moderate usage
**Quality:** Excellent. Claude Sonnet for code/creative/agentic. o3 for reasoning. Gemini Pro for data. Simple chat stays cheap (no need for Opus on "hello").

### 4. Maximum
*Best available model for everything. No compromises.*

| Category | Model | Cost |
|----------|-------|------|
| simple_chat | `openrouter/anthropic/claude-sonnet-4-5` | $3.00/$15.00 |
| general | `openrouter/google/gemini-2.5-pro` | $1.25/$10.00 |
| coding | `openrouter/anthropic/claude-opus-4-5` | $15.00/$75.00 |
| reasoning | `openrouter/google/gemini-2.5-pro` | $1.25/$10.00 |
| creative | `openrouter/anthropic/claude-opus-4-5` | $15.00/$75.00 |
| data | `openrouter/google/gemini-2.5-pro` | $1.25/$10.00 |
| agentic | `openrouter/anthropic/claude-opus-4-5` | $15.00/$75.00 |
| transcription | `openrouter/openai/gpt-4o-audio-preview` | $2.50/$10.00 |

**Est. cost:** ~$50-150/day at moderate usage
**Quality:** Maximum across every category. Use for critical production workloads.

---

## B. Global Slider (Quick Adjustment)

After selecting a preset, the user can fine-tune with a single global slider:

```
Budget ●────●────●────●────● Premium
  1      2      3      4      5
```

This maps to:
- **1** = Free Tier preset
- **2** = Smart Saver preset
- **3** = Between Smart Saver and Quality First
- **4** = Quality First preset
- **5** = Maximum preset

Level 3 interpolates by promoting reasoning + coding to mid-tier while keeping simple/creative cheap:

| Category | Level 3 Model |
|----------|---------------|
| simple_chat | `gemini-2.5-flash-lite` (cheap) |
| general | `deepseek-v3.2` (value) |
| coding | `deepseek-v3.2` (value) |
| reasoning | `openai/o3-mini` (mid-tier) |
| creative | `deepseek-v3.2` (value) |
| data | `deepseek-v3.2` (value) |
| agentic | `anthropic/claude-sonnet-4-5` (premium for tool reliability) |
| transcription | `gemini-2.5-flash` (value) |

---

## C. Per-Category Override (Power Users)

Expandable section below the global slider. Only shown when user clicks "Customize per category".

Each category shows:
- Current model (from preset or global slider)
- Mini slider to override (1-5 specific to that category)
- Resets to preset default on preset change

```
┌─────────────────────────────────────────┐
│ ▶ Customize per category                │  (collapsed by default)
├─────────────────────────────────────────┤
│ ⚙ Coding     [●●●●○]  claude-sonnet    │
│ 🧮 Reasoning  [●●●○○]  o3-mini          │
│ 💬 Simple     [●○○○○]  flash-lite       │  (dimmed — not worth overriding)
│ ...                                      │
└─────────────────────────────────────────┘
```

---

## D. Dashboard UI Design

### Quality Tab Layout

```
┌──────────────────────────────────────────────────────────┐
│  Stats  │  Quality  │  Integrations                      │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  Choose a profile:                                       │
│                                                          │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌─────────┐ │
│  │ 🆓 Free  │  │ 💡 Smart │  │ ⭐ Quality│  │ 🚀 Max  │ │
│  │  Tier    │  │  Saver   │  │  First   │  │         │ │
│  │          │  │ ✓ active │  │          │  │         │ │
│  │ ~$0/day  │  │ ~$3/day  │  │ ~$20/day │  │~$80/day │ │
│  └──────────┘  └──────────┘  └──────────┘  └─────────┘ │
│                                                          │
│  Fine-tune:                                              │
│  Budget ●────●────●────●────● Premium                    │
│                    ▲                                     │
│              Smart Saver                                 │
│                                                          │
│  Est. $3.12/day  ·  Saved 94% vs always-Opus             │
│                                                          │
│  ▶ Customize per category                                │
│                                                          │
│            [Apply Changes]                               │
└──────────────────────────────────────────────────────────┘
```

### Preset Cards

Each card shows:
- Icon + name
- One-line description
- Estimated daily cost (calculated from actual usage patterns)
- Active indicator (checkmark)
- Click to select

### Cost Comparison Bar

```
Your cost:    ████░░░░░░░░░░░░  $3.12/day
Always Opus:  ████████████████  $52.00/day
                                 94% saved
```

---

## E. Integrations Page (New Tab)

A dedicated tab for managing API providers — enter keys, test connections, enable/disable.

### Layout

```
┌──────────────────────────────────────────────────────────┐
│  Stats  │  Quality  │  Integrations                      │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  API Providers                                           │
│                                                          │
│  ┌────────────────────────────────────────────────────┐  │
│  │ OpenRouter                          ● Connected    │  │
│  │ API Key: sk-or-****...****          [Test] [Edit]  │  │
│  │ Features: PII scrubbing ✓  Compression ✓           │  │
│  │ Models used: 12  ·  Requests today: 847            │  │
│  └────────────────────────────────────────────────────┘  │
│                                                          │
│  ┌────────────────────────────────────────────────────┐  │
│  │ Anthropic                           ● Connected    │  │
│  │ API Key: sk-ant-****...****         [Test] [Edit]  │  │
│  │ Features: PII scrubbing ○  Compression ○           │  │
│  │ Models used: 3  ·  Requests today: 203             │  │
│  └────────────────────────────────────────────────────┘  │
│                                                          │
│  ┌────────────────────────────────────────────────────┐  │
│  │ Ollama (Local)                      ● Connected    │  │
│  │ Auth: none                          [Test]         │  │
│  │ URL: http://localhost:11434                         │  │
│  └────────────────────────────────────────────────────┘  │
│                                                          │
│  ┌────────────────────────────────────────────────────┐  │
│  │ + Add Provider                                     │  │
│  │ OpenAI · Groq · Together · Mistral · DeepSeek     │  │
│  │ Perplexity · Fireworks · Custom                    │  │
│  └────────────────────────────────────────────────────┘  │
│                                                          │
│  ML Classifier                                           │
│  ┌────────────────────────────────────────────────────┐  │
│  │ LLMRouter Service                  ● Connected     │  │
│  │ URL: http://127.0.0.1:18801       [Test]           │  │
│  │ Model: all-MiniLM-L6-v2 · KNN · ~40ms latency     │  │
│  └────────────────────────────────────────────────────┘  │
│                                                          │
│  System                                                  │
│  ┌────────────────────────────────────────────────────┐  │
│  │ Cache: ✓ enabled (TTL 300s, max 5000)  [Toggle]    │  │
│  │ Config: /path/to/tierflow.config.json  [Reload]    │  │
│  └────────────────────────────────────────────────────┘  │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

### Provider Card Details

Each provider card shows:
- **Name + status dot** (green=connected, red=error, gray=disabled)
- **API key** (masked: `sk-or-****...****`) with Edit button
- **Features** checkboxes: PII scrubbing, Compression (toggle live)
- **Usage stats**: models used count, requests today (from `/stats`)
- **Test button**: Pings the provider's health/models endpoint

### Edit Key Modal

When clicking [Edit] on a provider's API key:

```
┌─────────────────────────────────────┐
│ Edit API Key — OpenRouter            │
│                                     │
│ Current: sk-or-****...3f2a          │
│ New key: [________________________] │
│                                     │
│ Storage: ○ Environment variable     │
│          ● Config file              │
│          ○ macOS Keychain           │
│                                     │
│        [Cancel]  [Save & Test]      │
└─────────────────────────────────────┘
```

**Security note:** Keys entered via the UI are written to the config file (not env vars). The config file is gitignored. For production, users should use env vars.

### Add Provider Flow

Clicking "+ Add Provider" shows a provider template selector:

```
┌─────────────────────────────────────────┐
│ Add Provider                            │
│                                         │
│ Select provider:                        │
│ [OpenAI      ▾]                         │
│                                         │
│ API Key: [____________________________] │
│                                         │
│ ✓ Auto-configured:                      │
│   Base URL: https://api.openai.com      │
│   API type: openai                      │
│                                         │
│ □ Enable PII scrubbing                  │
│ □ Enable compression                    │
│                                         │
│          [Cancel]  [Add & Test]         │
└─────────────────────────────────────────┘
```

Known provider templates (pre-filled base URLs):
- OpenAI: `https://api.openai.com`
- Anthropic: `https://api.anthropic.com` (api: anthropic)
- Groq: `https://api.groq.com/openai`
- Together: `https://api.together.xyz`
- Mistral: `https://api.mistral.ai`
- DeepSeek: `https://api.deepseek.com`
- Perplexity: `https://api.perplexity.ai`
- Fireworks: `https://api.fireworks.ai/inference`
- Custom: user enters URL + selects API type

### Test Connection

[Test] button flow:
1. POST to server: `/test-provider` with `{ provider: "openrouter" }`
2. Server calls provider's `/v1/models` (or `/health`)
3. Returns: `{ ok: true, models: 47, latency_ms: 120 }` or `{ ok: false, error: "401 Unauthorized" }`
4. UI shows green check or red X with error message

---

## F. Config Schema Updates

### Presets in config

```typescript
export type PresetName = "free" | "smart_saver" | "quality_first" | "maximum" | "custom";

export type QualityConfig = {
  preset: PresetName;           // active preset
  globalLevel?: 1 | 2 | 3 | 4 | 5;  // global slider position
  overrides?: Record<string, {  // per-category overrides
    level: 1 | 2 | 3 | 4 | 5;
    model?: string;             // explicit model override
  }>;
};
```

### Config JSON example

```json
{
  "quality": {
    "preset": "smart_saver",
    "globalLevel": 2,
    "overrides": {
      "reasoning": { "level": 4 }
    }
  }
}
```

This means: use Smart Saver for everything, except reasoning which gets bumped to level 4 (o3).

### How preset → categories mapping works

When a preset is applied:
1. Look up the preset's model table (hardcoded in `quality.ts`)
2. Write each category's `primary` model into `config.categories`
3. Apply any per-category overrides on top
4. Write config to disk + reload

The router never sees "presets" — it only sees `categories[cat].primary` as before.

---

## G. New Server Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `GET /quality-tiers` | GET | Returns presets + current selection + model matrix |
| `POST /quality-preset` | POST | Apply a preset: `{ preset: "smart_saver" }` |
| `POST /quality-level` | POST | Set global level: `{ level: 3 }` |
| `POST /quality-override` | POST | Override one category: `{ category: "coding", level: 4 }` |
| `POST /test-provider` | POST | Test provider connectivity: `{ provider: "openrouter" }` |
| `POST /provider` | POST | Add/update provider config |
| `DELETE /provider/:name` | DELETE | Remove a provider |

---

## H. Implementation Plan

### New Files

| File | Purpose |
|------|---------|
| `src/quality.ts` | Preset definitions, model matrix, preset→categories mapping |
| `src/integrations.ts` | Provider test, add/edit/remove logic |

### Modified Files

| File | Changes |
|------|---------|
| `src/config.ts` | Add `QualityConfig` type, `writeConfig()`, provider CRUD helpers |
| `src/server.ts` | Add 7 new endpoints |
| `src/dashboard.ts` | Add Quality tab, Integrations tab, preset cards, slider, provider cards |

### Build Sequence

| Phase | What | Effort |
|-------|------|--------|
| 1 | Presets + quality module | Medium |
| 2 | Quality tab UI (presets + global slider) | Medium |
| 3 | Per-category overrides (collapsible) | Small |
| 4 | Integrations page — provider list + status | Medium |
| 5 | Provider test + add/edit flow | Medium |
| 6 | Savings estimator | Small |
| 7 | Test & verify | Small |

---

## I. Key Simplifications vs v1 Design

| v1 (8x5 matrix) | v2 (presets + slider) |
|------------------|-----------------------|
| 40 individual choices | 4 presets (one click) |
| Must understand every model | Presets are opinionated |
| No guidance on which to pick | "Smart Saver" recommended |
| Power users only | Casual users work fine |
| No integration management | Full provider config UI |
| Changes require editing JSON | Visual sliders + Apply |

The 5-level model matrix per category still exists internally — but it's an implementation detail behind the presets, not the primary UI.
