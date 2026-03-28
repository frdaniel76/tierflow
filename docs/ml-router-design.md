# FreeRouter ML-Powered Routing — Comprehensive Design

**Version:** 2.0
**Date:** 2026-03-28
**Status:** IMPLEMENTED

> **Implementation notes:** The actual config key is `mlClassifier` (not `classifier`).
> The embedding model used is `all-MiniLM-L6-v2` (not Longformer as originally proposed).
> Latency is ~40ms (not ~20ms). Memory is ~80MB model + ~600MB Docker image.
> The `shortcuts` config key was not implemented; shortcuts are hardcoded in `src/router/index.ts`.

---

## 1. Problem Statement

The current 14-dimension keyword scorer has fundamental limitations:

| Problem | Example | Impact |
|---------|---------|--------|
| Context bleed | "What's the time?" after a coding session → COMPLEX | Wastes money, adds latency |
| Over-trigger on keywords | "Tell me a joke step by step" → REASONING (60s+ R1 delay) | Terrible UX |
| Binary simple indicators | "What is X" always -0.10 regardless of X | Underestimates legitimate questions |
| MEDIUM band too narrow | 0.00–0.03 score range → almost never MEDIUM | Poor model utilization |
| No understanding | Matches words, not meaning | Can't handle novel query types |

**Root cause:** Rules can't understand language. A model trained on millions of human preferences can.

---

## 2. Architecture Overview

### Current (v1.x)
```
Request → 14-keyword-scorer (TypeScript, 0ms) → tier → model → forward
```

### Proposed (v2.0)
```
Request
    ↓
Hardcoded shortcuts (TypeScript, 0ms)
  - Audio attachment? → SIMPLE
  - Mode override (/simple)? → user's choice
  - Empty message? → reject
    ↓ (if no shortcut matched)
LLMRouter ML classifier (Python FastAPI, ~20ms)
  - Trained on human preference data
  - Returns: { category, model_id, confidence }
    ↓
FreeRouter maps category → model from config table
    ↓
PII scrub → forward → rehydrate → respond
```

### Component Diagram
```
┌─────────────────────────────────────────────────────────────┐
│                    FreeRouter (TypeScript)                   │
│                                                             │
│  ┌──────────────┐     ┌───────────────┐     ┌───────────┐  │
│  │  Shortcuts    │────▶│  ML Classifier │────▶│  Model    │  │
│  │  (0ms)       │     │  HTTP call     │     │  Selector │  │
│  │  audio→SIMPLE│     │  localhost:    │     │  from     │  │
│  │  /max→REASON │     │  18801        │     │  config   │  │
│  └──────────────┘     └───────┬───────┘     └─────┬─────┘  │
│                               │                    │        │
│  ┌────────────────────────────▼────────────────────▼─────┐  │
│  │           PII Scrub → Forward → Rehydrate             │  │
│  │           Token Tracking → Fallback Chain              │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                               │
                    ┌──────────▼──────────┐
                    │  LLMRouter Service  │
                    │  (Python FastAPI)   │
                    │  localhost:18801    │
                    │                    │
                    │  KNN Router +      │
                    │  Longformer embed  │
                    │  ~560MB model      │
                    └────────────────────┘
```

---

## 3. Category System

### Beyond SIMPLE/MEDIUM/COMPLEX/REASONING

Instead of 4 tiers based on "complexity," use **task categories** that map to **specialized models**:

| Category | Description | Best Model | Cost | Fallback |
|----------|-------------|-----------|------|----------|
| `simple_chat` | Greetings, time, weather, yes/no questions | Gemini 3.1 Flash Lite | $0.25/$1.50 | Mistral Nemo |
| `general` | General knowledge, explanations, summaries | DeepSeek V3.2 | $0.55/$2.19 | MiMo-V2-Flash |
| `coding` | Write, debug, review, explain code | Devstral 2 | **Free** | Qwen3 Coder Next ($0.12/$0.75) |
| `reasoning` | Prove, analyze, compare, design, complex math | DeepSeek R1 | **Free** | DeepSeek V3.2 |
| `creative` | Stories, jokes, poems, brainstorming | Step 3.5 Flash | **Free** | DeepSeek V3.2 |
| `data` | CSV, spreadsheet, data analysis, summarize docs | Gemini 3.1 Flash Lite (1M ctx) | $0.25/$1.50 | DeepSeek V3.2 |
| `agentic` | Tool calls, exec, file ops, calendar, email | DeepSeek V3.2 | $0.55/$2.19 | MiMo-V2-Flash |
| `transcription` | Voice/audio processing | N/A (local whisper) | **Free** | — |

### Why Specialized Models?

| Query | Current (tier-based) | Proposed (category-based) |
|-------|---------------------|--------------------------|
| "Fix the off-by-one in this loop" | COMPLEX → DeepSeek V3.2 ($0.55/M) | `coding` → Devstral 2 (**free**, better at code) |
| "Tell me a joke" | MEDIUM → Gemini Flash | `creative` → Step 3.5 Flash (**free**, better at creative) |
| "Prove the Pythagorean theorem" | REASONING → DeepSeek R1 | `reasoning` → DeepSeek R1 (same, correct) |
| "What's 2+2?" | MEDIUM → Gemini Flash | `simple_chat` → Gemini Flash Lite (cheaper) |
| "Analyze this CSV data" | COMPLEX → DeepSeek V3.2 | `data` → Gemini Flash Lite (1M context, cheaper) |
| "Read my email" | MEDIUM + tools → agentic | `agentic` → DeepSeek V3.2 (correct) |

**Cost savings:** 3 of 8 categories use **free** models. Current system uses paid models for everything.

---

## 4. Configuration Table

### freerouter.config.json (v2.0)

```json
{
  "port": 18800,
  "host": "127.0.0.1",
  "classifier": {
    "type": "llmrouter",
    "url": "http://127.0.0.1:18801/classify",
    "timeout_ms": 500,
    "fallback": "general"
  },
  "providers": {
    "openrouter": {
      "baseUrl": "https://openrouter.ai/api/v1",
      "api": "openai",
      "auth": { "type": "env", "key": "OPENROUTER_API_KEY" },
      "pii": true
    }
  },
  "categories": {
    "simple_chat": {
      "primary": "openrouter/google/gemini-3.1-flash-lite",
      "fallback": ["openrouter/mistralai/mistral-nemo"],
      "timeout": 30000
    },
    "general": {
      "primary": "openrouter/deepseek/deepseek-v3.2",
      "fallback": ["openrouter/xiaomi/mimo-v2-flash", "openrouter/mistralai/mistral-nemo"],
      "timeout": 60000
    },
    "coding": {
      "primary": "openrouter/mistralai/devstral-2",
      "fallback": ["openrouter/qwen/qwen3-coder-next", "openrouter/deepseek/deepseek-v3.2"],
      "timeout": 120000
    },
    "reasoning": {
      "primary": "openrouter/deepseek/deepseek-r1",
      "fallback": ["openrouter/deepseek/deepseek-v3.2"],
      "timeout": 120000
    },
    "creative": {
      "primary": "openrouter/stepfun/step-3.5-flash",
      "fallback": ["openrouter/deepseek/deepseek-v3.2"],
      "timeout": 60000
    },
    "data": {
      "primary": "openrouter/google/gemini-3.1-flash-lite",
      "fallback": ["openrouter/deepseek/deepseek-v3.2"],
      "timeout": 60000
    },
    "agentic": {
      "primary": "openrouter/deepseek/deepseek-v3.2",
      "fallback": ["openrouter/xiaomi/mimo-v2-flash"],
      "timeout": 120000
    },
    "transcription": {
      "handler": "local_whisper",
      "timeout": 30000
    }
  },
  "shortcuts": {
    "has_audio_attachment": "transcription",
    "has_tools": "agentic",
    "mode_overrides": {
      "simple": "simple_chat",
      "medium": "general",
      "complex": "coding",
      "max": "reasoning",
      "code": "coding",
      "creative": "creative"
    }
  }
}
```

---

## 5. LLMRouter Service Design

### Service: `llmrouter-service`

A lightweight Python FastAPI microservice that wraps LLMRouter.

**Port:** 18801
**Endpoint:** `POST /classify`

```json
// Request
{
  "message": "Fix the off-by-one error in the loop",
  "has_tools": false,
  "has_audio": false
}

// Response
{
  "category": "coding",
  "confidence": 0.87,
  "alternatives": [
    {"category": "general", "confidence": 0.09},
    {"category": "reasoning", "confidence": 0.04}
  ]
}
```

### Router Selection

**Primary:** `knnrouter` — fastest, good accuracy, no GPU needed
- Latency: ~20ms (10ms embedding + 10ms KNN lookup)
- Memory: ~200MB (Longformer model + training data)
- Training: pre-trained on Chatbot Arena data, optionally fine-tuned on your usage

**Fallback if service down:** FreeRouter falls back to `general` category (DeepSeek V3.2).

### Training Pipeline

LLMRouter can be trained on your own data for better accuracy:

```
Step 1: Collect queries from FreeRouter logs (prompt + which model was used)
Step 2: Generate embeddings via Longformer
Step 3: Evaluate which model answered best (or use human feedback)
Step 4: Train KNN/SVM/MLP router on this data
Step 5: Deploy updated model
```

This can run as a weekly batch job using FreeRouter's request logs.

### Health Check

`GET /health` → `{"status": "ok", "router": "knnrouter", "models_loaded": true}`

### Service Management

Run as a launchd daemon alongside FreeRouter:

```xml
<!-- ~/Library/LaunchAgents/com.medme.llmrouter.plist -->
<plist>
  <dict>
    <key>Label</key><string>com.medme.llmrouter</string>
    <key>ProgramArguments</key>
    <array>
      <string>/Users/medme/.pyenv/shims/python</string>
      <string>/Users/medme/Projects/llmrouter-service/server.py</string>
    </array>
    <key>KeepAlive</key><true/>
    <key>RunAtLoad</key><true/>
  </dict>
</plist>
```

---

## 6. FreeRouter Code Changes

### Files to Remove
| File | Lines | Why |
|------|-------|-----|
| `src/router/rules.ts` | 301 | Entire keyword scorer — replaced by LLMRouter |
| `src/router/config.ts` (scoring section) | ~160 | Keyword lists, weights — no longer needed |

### Files to Modify
| File | Change |
|------|--------|
| `src/router/index.ts` | Replace `classifyByRules()` call with HTTP call to LLMRouter service |
| `src/router/types.ts` | Add `CategoryResult` type, update `RoutingDecision` |
| `src/router/selector.ts` | Map category → model instead of tier → model |
| `src/config.ts` | Add `classifier` and `categories` config sections |
| `src/server.ts` | Update shortcuts logic, update stats to track categories |
| `freerouter.config.json` | New format with categories instead of tiers |

### Files Unchanged
| File | Lines | Why |
|------|-------|-----|
| `src/provider.ts` | 907 | All forwarding/streaming/PII logic stays |
| `src/pii/*` | 972 | Entire PII system stays |
| `src/usage.ts` | 115 | Token tracking stays |
| `src/auth.ts` | 129 | Auth stays |
| `src/models.ts` | 143 | Pricing stays |
| `src/logger.ts` | 33 | Logging stays |

### New Router Decision Flow (router/index.ts)

```typescript
export async function route(
  prompt: string,
  systemPrompt: string | undefined,
  maxOutputTokens: number,
  options: RouterOptions,
  metadata?: { hasTools: boolean; hasAudio: boolean },
): Promise<RoutingDecision> {

  // Layer 1: Hardcoded shortcuts (0ms)
  if (metadata?.hasAudio) return resolveCategory("transcription", options);
  if (metadata?.hasTools) return resolveCategory("agentic", options);

  const modeOverride = detectModeOverride(prompt);
  if (modeOverride) return resolveCategory(modeOverride.category, options);

  // Layer 2: ML classifier (~20ms)
  try {
    const result = await classifyWithLLMRouter(prompt, options.config.classifier);
    return resolveCategory(result.category, options);
  } catch (err) {
    // Fallback if service is down
    logger.warn(`[Router] LLMRouter unavailable, using fallback: ${err}`);
    return resolveCategory(options.config.classifier.fallback, options);
  }
}
```

---

## 7. Cost Impact Analysis

### Current Monthly Estimate (based on your usage patterns)
| Tier | Model | % of requests | Cost/M tokens | Est. monthly |
|------|-------|---------------|---------------|-------------|
| SIMPLE/MEDIUM | Gemini Flash | 60% | $0.50 avg | ~$0.50 |
| COMPLEX | DeepSeek V3.2 | 30% | $2.74 avg | ~$0.60 |
| REASONING | DeepSeek R1 | 10% | $4.36 avg | ~$0.30 |
| **Total** | | | | **~$1.40/week** |

### Proposed Monthly Estimate
| Category | Model | % of requests | Cost/M tokens | Est. monthly |
|----------|-------|---------------|---------------|-------------|
| simple_chat | Gemini Flash Lite | 30% | $1.75 avg | ~$0.15 |
| general | DeepSeek V3.2 | 15% | $2.74 avg | ~$0.20 |
| coding | Devstral 2 | 20% | **Free** | $0.00 |
| reasoning | DeepSeek R1 | 5% | **Free** | $0.00 |
| creative | Step 3.5 Flash | 10% | **Free** | $0.00 |
| data | Gemini Flash Lite | 5% | $1.75 avg | ~$0.05 |
| agentic | DeepSeek V3.2 | 15% | $2.74 avg | ~$0.20 |
| **Total** | | | | **~$0.60/week** |

**Estimated savings: ~57%** — mostly from routing coding/reasoning/creative to free models.

---

## 8. Quality Impact

| Scenario | Current | Proposed | Quality Change |
|----------|---------|----------|---------------|
| Voice "Tell me a joke" | REASONING (R1, 60s) | `simple_chat` (Flash Lite, 2s) | ✅ Faster, correct tier |
| "Fix the off-by-one" | COMPLEX (V3.2) | `coding` (Devstral 2) | ✅ Better model for code |
| "What's on my calendar?" | MEDIUM + agentic (V3.2) | `agentic` (V3.2) | ➡ Same (correct) |
| "Prove P≠NP" | REASONING (R1) | `reasoning` (R1) | ➡ Same (correct) |
| "Write me a poem" | MEDIUM (Gemini Flash) | `creative` (Step 3.5 Flash) | ✅ Better model for creative |
| "Summarize this document" | COMPLEX (V3.2) | `data` (Flash Lite, 1M ctx) | ✅ More context, cheaper |
| "Hi, who are you?" | MEDIUM (Gemini Flash) | `simple_chat` (Flash Lite) | ✅ Cheaper, just as good |

---

## 9. Migration Strategy

### Phase 1: Setup LLMRouter Service (Day 1)
1. Create `~/Projects/llmrouter-service/` project
2. Install LLMRouter: `pip install llmrouter-lib`
3. Write FastAPI `/classify` endpoint
4. Train KNN router on Chatbot Arena data (built-in)
5. Test classification accuracy on sample queries
6. Deploy as launchd service on port 18801

### Phase 2: Update FreeRouter Config (Day 1)
1. Add `classifier` and `categories` to config schema
2. Update `freerouter.config.json` with new category→model table
3. Keep old tier config as backward-compatible fallback

### Phase 3: Replace Classifier Call (Day 2)
1. Replace `classifyByRules()` with HTTP call to LLMRouter
2. Add shortcuts for audio/tools/mode-override
3. Add graceful fallback when LLMRouter is unreachable
4. Update `selectModel()` to use categories instead of tiers

### Phase 4: Testing (Day 2)
1. Run existing PII tests (should all pass — PII unchanged)
2. Test category classification on 50+ sample queries
3. Run E2E test suite via `~/bin/e2e-test`
4. Test fallback behavior (kill LLMRouter → FreeRouter still works)

### Phase 5: Optimization (Week 2+)
1. Collect routing logs for 1 week
2. Train custom router on your data (instead of generic Chatbot Arena)
3. Evaluate accuracy improvement
4. Add personalized routing (LLMRouter's `personalizedrouter`)

---

## 10. Risk Mitigation

| Risk | Mitigation |
|------|-----------|
| LLMRouter service crashes | FreeRouter falls back to `general` category (V3.2) — still works |
| ML classifier misroutes | Mode overrides still work (`/simple`, `/code`, `/max`) |
| Free models are rate-limited | Paid fallbacks configured for every category |
| New dependency (Python) | Isolated service — FreeRouter TypeScript core unchanged |
| Model cold start (first request) | Launchd keeps service running, model stays loaded in memory |
| Latency increase (+20ms) | Negligible vs LLM inference time (2-60s) |

---

## 11. Files to Create

```
~/Projects/llmrouter-service/
├── server.py              # FastAPI service (port 18801)
├── classifier.py          # LLMRouter wrapper
├── requirements.txt       # llmrouter-lib, fastapi, uvicorn
├── config.yaml            # Router config
├── train.py               # Custom training script
├── test_classifier.py     # Unit tests
└── com.medme.llmrouter.plist  # launchd daemon config

~/Projects/freerouter/
├── src/router/index.ts    # Modified — HTTP call to LLMRouter
├── src/router/types.ts    # Modified — CategoryResult type
├── src/router/selector.ts # Modified — category → model
├── src/router/rules.ts    # DELETED (or kept as legacy fallback)
├── src/config.ts          # Modified — new config sections
├── src/server.ts          # Modified — shortcuts, stats
└── freerouter.config.json # New format with categories
```

---

## 12. Open Questions

1. **Should we keep the old scorer as a fallback?** Pro: safety net. Con: dead code maintenance.
2. **Train on our data or use pre-trained?** Start pre-trained, train custom after collecting 1 week of logs.
3. **Should agentic always go to V3.2?** Or let the ML classifier also pick the model for tool calls?
4. **Max budget per request?** Should the config have a `max_cost_per_request` cap?
5. **Dashboard integration?** Show category distribution on the monitoring dashboard (like the current tier chart).
