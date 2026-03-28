# Architecture

Technical deep-dive into TierFlow's internals.

## System Overview

```
                         ┌─────────────────────────────────────────────┐
                         │              TierFlow (:18800)            │
Client ──HTTP POST──────>│                                             │
/v1/chat/completions     │  Parse ─> Cache Check ─> Route ─> PII Scrub│
                         │    ─> Compress ─> Forward ─> Rehydrate     │
                         │                                             │
                         │  ┌─────────┐  ┌──────────┐  ┌───────────┐ │
                         │  │ Router  │  │ PII Vault│  │ LRU Cache │ │
                         │  └────┬────┘  └──────────┘  └───────────┘ │
                         └───────┼────────────────────────────────────┘
                                 │ HTTP (~40ms)
                         ┌───────▼────────────────────┐
                         │  LLMRouter Service (:18801) │
                         │  Python + KNN + MiniLM-L6   │
                         └─────────────────────────────┘
```

## Request Pipeline

1. **Parse** — Read JSON body, extract model, messages, tools, stream flag
2. **Cache check** — SHA-256 hash of (model + messages + tools). On hit → return immediately (`X-Cache: HIT`)
3. **Route** — ML classifier (v2) or 14-dimension keyword scorer (v1 fallback)
4. **PII scrub** — If provider has `pii: true`, replace PII with type-preserving placeholders (AES-256-GCM encrypted)
5. **Compress** — If provider has `compress: true`, apply CtxPack passes
6. **Forward** — Dispatch to upstream (Anthropic Messages API or OpenAI-compatible)
7. **Rehydrate** — Replace placeholders with originals in response (streaming-safe carry buffer, max 40 chars)
8. **Cache store** — Store non-streaming, non-PII responses in LRU cache

## Routing Engine

### v2: ML Classifier (Primary)

When `mlClassifier` and `categories` are configured:

1. Check shortcuts (audio → transcription, tools → agentic, mode overrides → forced category)
2. Call LLMRouter at `mlClassifier.url` with `{ message, has_tools, has_audio }`
3. Receive `{ category, confidence, latency_ms }`
4. Map category → model from `categories` config
5. On timeout (default 500ms) → fall back to `fallback_category` (default: "general")

### v1: Keyword Scorer (Fallback)

When ML service is unavailable:

1. Score prompt across 15 weighted dimensions
2. Combine with sigmoid confidence calibration
3. Map to tier (SIMPLE/MEDIUM/COMPLEX/REASONING) via configurable boundaries
4. Select model from `tiers` config

## Provider Translation

Bidirectional Anthropic ↔ OpenAI format:

- Tool calls: `tool_use` blocks ↔ `tool_calls` array
- Thinking blocks: filtered/preserved based on provider
- System messages: top-level param (Anthropic) ↔ system role message (OpenAI)
- Streaming: `content_block_delta` ↔ `delta.content`

## Fallback Chain

Per request, tries models in order: primary → fallback[0] → fallback[1] → ...

Stops on: success, or stream already started (`res.headersSent`).

## Timeouts

| Tier         | Timeout |
| ------------ | ------- |
| SIMPLE       | 30s     |
| MEDIUM       | 60s     |
| COMPLEX      | 120s    |
| REASONING    | 120s    |
| Stream stall | 60s     |

## Source Files

| File                     | Purpose                                                            |
| ------------------------ | ------------------------------------------------------------------ |
| `src/server.ts`          | HTTP server, route handlers, stats, dashboard                      |
| `src/provider.ts`        | Provider dispatch, API translation, streaming                      |
| `src/router/index.ts`    | ML classifier + legacy scorer integration                          |
| `src/router/rules.ts`    | 14-dimension keyword scorer                                        |
| `src/router/selector.ts` | Tier → model, cost estimation                                      |
| `src/router/config.ts`   | Default config, dimension weights                                  |
| `src/pii/vault.ts`       | AES-256-GCM encryption, placeholder templates                      |
| `src/pii/middleware.ts`  | Scrub/rehydrate, streaming carry buffer                            |
| `src/pii/patterns.ts`    | 15 PII regexes across 5 passes                                     |
| `src/compress/passes.ts` | 6 compression algorithms                                           |
| `src/cache/store.ts`     | LRU cache, TTL, SHA-256 hashing                                    |
| `src/config.ts`          | Config types, loading, validation                                  |
| `src/auth.ts`            | Auth: env, file, keychain, profiles, none                          |
| `src/usage.ts`           | Token/cost tracking (allTime, byModel, byTier, byCategory, hourly) |
| `src/dashboard.ts`       | Built-in HTML monitoring UI                                        |
| `src/cli.ts`             | CLI entry (npx tierflow)                                           |
