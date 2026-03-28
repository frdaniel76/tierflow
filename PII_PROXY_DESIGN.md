# TierFlow PII Proxy — Design & Implementation Plan

**Version:** 2.0.0
**Date:** 2026-03-28
**Status:** IMPLEMENTED — Type-preserving placeholders with AES-256-GCM encryption

> **Note:** Some sections of this design doc describe the original `<<category:hexid>>` placeholder
> format from the initial design. The implemented format uses `p0{12hex}` prefix-based
> type-preserving placeholders (see Section 4 for actual templates). The streaming carry buffer
> (Section 7) was reimplemented to use `p0` prefix detection instead of `<<>>` delimiters.
> Max carry buffer: 40 chars (not 24).

---

## Table of Contents

1. [Goal](#1-goal)
2. [Architecture Overview](#2-architecture-overview)
3. [Configuration Design](#3-configuration-design)
4. [PII Module Integration](#4-pii-module-integration)
5. [Request Pipeline — Non-Streaming](#5-request-pipeline--non-streaming)
6. [Request Pipeline — Streaming](#6-request-pipeline--streaming)
7. [Streaming Rehydration — The Hard Problem](#7-streaming-rehydration--the-hard-problem)
8. [Session Management](#8-session-management)
9. [Error Handling & Robustness](#9-error-handling--robustness)
10. [Files to Create / Modify](#10-files-to-create--modify)
11. [Implementation Sequence](#11-implementation-sequence)
12. [QA & Testing Strategy](#12-qa--testing-strategy)
13. [Rollback Plan](#13-rollback-plan)
14. [Open Questions](#14-open-questions)

---

## 1. Goal

Route selected queries to cheap external models (e.g. DeepSeek-V3, Qwen-Plus) via OpenRouter, while automatically scrubbing PII before data leaves the machine and rehydrating it on the way back. Local Ollama models remain untouched — zero overhead for local traffic.

**Design principles:**
- PII protection is **per-provider**, controlled by a single config flag
- Local traffic (Ollama) has **zero performance impact** — no scanning, no vault
- The feature is **opt-in** — existing setups work unchanged
- Streaming must work correctly — no dropped or corrupted PII placeholders
- Failure in the PII layer must **not** silently leak real data to external providers

---

## 2. Architecture Overview

```
OpenClaw (client)
    │
    │  POST /v1/chat/completions  { model: "auto", messages: [...] }
    │
    ▼
┌─────────────────────────────────────────────────────┐
│  TierFlow  (server.ts)                            │
│                                                     │
│  1. Parse request                                   │
│  2. route() → tier + model (e.g. openrouter/deepseek-chat) │
│  3. Resolve provider from model prefix              │
│                                                     │
│  ┌─────────────────────────────────────┐            │
│  │  PII Gate  (NEW — pii/middleware.ts)│            │
│  │                                     │            │
│  │  provider.pii == true?              │            │
│  │    YES → vault.redact(messages)     │            │
│  │    NO  → passthrough                │            │
│  └─────────────────────────────────────┘            │
│                                                     │
│  4. forwardRequest() → provider backend             │
│                                                     │
│  ┌─────────────────────────────────────┐            │
│  │  PII Rehydration  (response path)   │            │
│  │                                     │            │
│  │  was scrubbed?                      │            │
│  │    YES → rehydrate response         │            │
│  │    NO  → passthrough                │            │
│  └─────────────────────────────────────┘            │
│                                                     │
│  5. Return response to client                       │
└─────────────────────────────────────────────────────┘
         │                          │
         ▼                          ▼
   ┌──────────┐            ┌──────────────┐
   │  Ollama  │            │  OpenRouter  │
   │  (local) │            │  (external)  │
   │  No PII  │            │  Scrubbed    │
   │  layer   │            │  data only   │
   └──────────┘            └──────────────┘
```

---

## 3. Configuration Design

### 3.1 Provider-Level PII Flag

The `pii` flag lives on the provider entry. This is the simplest model — if a provider is external, all models on it get scrubbed.

**Updated `ProviderConfigEntry` type** (`src/config.ts:27`):

```typescript
export type ProviderConfigEntry = {
  baseUrl: string;
  api: "anthropic" | "openai";
  headers?: Record<string, string>;
  auth?: AuthConfig;
  pii?: boolean | PiiConfig;     // NEW — default: false
};

// NEW type
export type PiiConfig = {
  enabled: boolean;
  mode?: "strict" | "standard";       // strict (default) = fail-closed, standard = log + pass
  exclude?: string[];                 // categories to skip (e.g. ["postcode", "phone"])
  scrub_system?: boolean;             // opt-in: scrub system/developer messages (default: false)
  debug_log_scrubbed?: boolean;       // TEMPORARY — logs scrubbed (safe) payload for verification
};
```

**Why provider-level, not model-level?**
- Simpler mental model: "this endpoint is external, protect it"
- Avoids per-model config sprawl when adding new OpenRouter models
- Can still be overridden per-model if needed later (model-level flag would override provider-level)

### 3.2 Example Config — Minimal

```jsonc
{
  "port": 18800,
  "host": "127.0.0.1",
  "providers": {
    "ollama": {
      "baseUrl": "http://127.0.0.1:11434/v1",
      "api": "openai",
      "auth": { "type": "env", "key": "OLLAMA_API_KEY" }
      // no pii key → defaults to false → zero overhead
    },
    "openrouter": {
      "baseUrl": "https://openrouter.ai/api/v1",
      "api": "openai",
      "auth": { "type": "env", "key": "OPENROUTER_API_KEY" },
      "pii": true   // ← scrub all traffic to this provider
    }
  },
  "tiers": {
    "SIMPLE":    { "primary": "ollama/gemma3:1b",           "fallback": [] },
    "MEDIUM":    { "primary": "openrouter/deepseek/deepseek-chat", "fallback": ["ollama/qwen3:8b"] },
    "COMPLEX":   { "primary": "openrouter/qwen/qwen-plus",  "fallback": ["ollama/qwen2.5-coder:7b"] },
    "REASONING": { "primary": "ollama/deepseek-r1:7b",      "fallback": [] }
  }
}
```

**What this achieves:**
- Simple queries → local gemma3:1b (fast, no PII overhead)
- Medium/Complex → OpenRouter's cheap Chinese models (PII-scrubbed automatically)
- Reasoning → local deepseek-r1 (no PII overhead)
- Fallbacks for MEDIUM/COMPLEX land on local Ollama (PII layer auto-disengages)

### 3.3 Example Config — Granular

```jsonc
"openrouter": {
  "baseUrl": "https://openrouter.ai/api/v1",
  "api": "openai",
  "auth": { "type": "env", "key": "OPENROUTER_API_KEY" },
  "pii": {
    "enabled": true,
    "mode": "strict",                     // fail request if scrub errors
    "exclude": ["postcode", "phone"]      // allow these categories through
  }
}
```

### 3.4 Environment Variable

```bash
# Add to ~/.zprofile alongside existing OLLAMA_API_KEY
export OPENROUTER_API_KEY="sk-or-v1-..."
```

### 3.5 Hot-Reload Support

The existing `POST /reload-config` endpoint already reloads `tierflow.config.json`. The PII config is read from the same file, so hot-reload works automatically. No vault state is affected by a config reload — active sessions continue until their TTL expires.

---

## 4. PII Module Integration

### 4.1 What We're Copying from pii-vault

Three files from `github.com/frdaniel76/pii-vault`, placed under `src/pii/`:

| Source file | Destination | Lines | Dependencies |
|---|---|---|---|
| `src/patterns.ts` | `src/pii/patterns.ts` | ~80 | None |
| `src/vault.ts` | `src/pii/vault.ts` | ~300 | `node:crypto`, `patterns.ts` |
| `src/vault-store.ts` | `src/pii/vault-store.ts` | ~70 | `vault.ts` |

**Not copied:**
- `src/detector.ts` — the `scan()` function. We don't need a separate scan gate; we always scrub if `pii: true`.
- `src/server.ts` — the MCP wrapper. We're calling vault directly, not via MCP.

**Total addition:** ~450 lines, zero new npm dependencies (only `node:crypto`).

**Vendoring note:** These files are copied (vendored) from pii-vault, not imported as a dependency. Pin to a specific pii-vault commit hash at copy time and record it in a comment at the top of each copied file. Treat as vendored code — sync manually if upstream improves.

### 4.2 New File: `src/pii/middleware.ts`

This is the glue between TierFlow's request pipeline and pii-vault's core.

```typescript
// src/pii/middleware.ts

import { SecretVault } from "./vault.js";
import { VaultStore } from "./vault-store.js";

export const piiVaultStore = new VaultStore();

export interface ScrubResult {
  messages: ChatMessage[];      // scrubbed messages
  sessionId: string;            // vault session for rehydration
  scrubbed: boolean;            // true if any PII was found and replaced
  categories: string[];         // what types of PII were found
}

/**
 * Scrub PII from all message content fields.
 * Returns the original messages untouched if no PII is found.
 *
 * Handles both string content and OpenAI array-format content
 * (e.g. [{ type: "text", text: "..." }, { type: "image_url", ... }]).
 * Only `type: "text"` entries are scrubbed — images and other types
 * are passed through unchanged.
 */
export function scrubMessages(
  messages: ChatMessage[],
  exclude?: string[],
  scrubSystem?: boolean,    // opt-in: scrub system/developer messages
): ScrubResult;

/**
 * Rehydrate a complete (non-streaming) response string.
 */
export function rehydrateText(
  text: string,
  sessionId: string,
): string;

/**
 * Rehydrate a streaming chunk, handling split placeholders.
 * Returns { output, carry } where carry is an incomplete
 * placeholder suffix to prepend to the next chunk.
 */
export function rehydrateChunk(
  chunk: string,
  sessionId: string,
  carry: string,
): { output: string; carry: string };

/**
 * Clean up a vault session after request completes.
 */
export function destroySession(sessionId: string): void;
```

### 4.3 Module Structure

```
src/pii/
├── patterns.ts        ← from pii-vault (PII regex definitions)
├── vault.ts           ← from pii-vault (SecretVault: redact + rehydrate)
├── vault-store.ts     ← from pii-vault (session management, TTL, sweep)
├── middleware.ts       ← NEW (scrubMessages, rehydrateText, rehydrateChunk)
└── index.ts           ← barrel export
```

---

## 5. Request Pipeline — Non-Streaming

Non-streaming is simpler because we get the full response body before sending anything to the client.

### Flow

```
handleChatCompletions()                    (server.ts)
│
├── route() → model = "openrouter/deepseek-chat"
├── parseModelId() → provider = "openrouter"
├── getProviderConfig("openrouter") → pii: true
│
├── PII SCRUB (NEW)
│   ├── scrubMessages(chatReq.messages)
│   │     → replaces "email me at john@acme.com" with "email me at p0a1b2c3@maildomain.com"
│   │     → type-preserving: emails look like emails, keys like keys
│   │     → returns { messages, sessionId, scrubbed: true }
│   ├── chatReq.messages = scrubbedMessages
│   └── (original messages NOT modified — deep copy)
│
├── forwardRequest(chatReq, model, tier, res, stream=false)
│   └── POST to OpenRouter → gets response JSON
│       → response.choices[0].message.content contains "p0a1b2c3@maildomain.com"
│
├── PII REHYDRATE (NEW — inside modified forwardToOpenAI)
│   ├── rehydrateText(responseBody, sessionId)
│   │     → restores "john@acme.com"
│   └── send rehydrated JSON to client
│
└── destroySession(sessionId)
```

### Where Exactly in the Code

**Scrub** — in `handleChatCompletions()` at `server.ts:~260`, after the model is resolved but before `forwardRequest()`:

```typescript
// After line ~257 (model resolved, before forwardRequest loop)
let piiSession: string | null = null;
const providerName = parseModelId(routedModel).provider;
const providerCfg = getProviderConfigEntry(providerName);

if (isPiiEnabled(providerCfg)) {
  const scrubResult = scrubMessages(chatReq.messages, getPiiExclude(providerCfg));
  chatReq = { ...chatReq, messages: scrubResult.messages };
  piiSession = scrubResult.sessionId;
}
```

**Rehydrate** — inside `forwardToOpenAI()` at `provider.ts:~590`, after receiving the full response body but before writing to `res`:

```typescript
// Non-streaming path in forwardToOpenAI
const body = await upstreamRes.text();
let responseJson = JSON.parse(body);

if (piiSession) {
  // Rehydrate all content fields in the response
  for (const choice of responseJson.choices ?? []) {
    if (choice.message?.content) {
      choice.message.content = rehydrateText(choice.message.content, piiSession);
    }
  }
}

// Note: Do NOT forward upstream Content-Length — rehydration changes body size
// (placeholders like <<email:a1b2c3d4e5f6>> are replaced with real values of
// different length). Always re-serialize and let Node calculate the length.
const responseBody = JSON.stringify(responseJson);
res.writeHead(200, { "Content-Type": "application/json", "Content-Length": String(Buffer.byteLength(responseBody)) });
res.end(responseBody);
```

---

## 6. Request Pipeline — Streaming

Streaming is the harder case. OpenRouter sends SSE chunks with partial content, and a PII placeholder like `<<email:a1b2c3d4e5f6>>` can be split across chunk boundaries.

### Flow

```
handleChatCompletions()                    (server.ts)
│
├── route() → model = "openrouter/deepseek-chat"
├── PII SCRUB (same as non-streaming)
│
├── forwardRequest(chatReq, model, tier, res, stream=true)
│   └── Opens SSE connection to OpenRouter
│       │
│       ├── chunk: {"choices":[{"delta":{"content":"email me at "}}]}
│       │   → no placeholder pattern → emit as-is
│       │
│       ├── chunk: {"choices":[{"delta":{"content":"<<ema"}}]}
│       │   → PARTIAL placeholder detected → hold in carry buffer
│       │
│       ├── chunk: {"choices":[{"delta":{"content":"il:a1b2c3d4e5f6>> ok"}}]}
│       │   → carry + chunk = "<<email:a1b2c3d4e5f6>> ok"
│       │   → rehydrate → "john@acme.com ok"
│       │   → emit rehydrated chunk
│       │
│       └── [DONE] → flush carry buffer → destroySession()
```

---

## 7. Streaming Rehydration — The Hard Problem

### 7.1 The Problem

Placeholder format: `<<type:hexid>>` (e.g. `<<email:a1b2c3d4e5f6>>`)

An LLM generating token-by-token might split this across chunks:

| Chunk | Content |
|---|---|
| 1 | `"Your address is "` |
| 2 | `"<<"` |
| 3 | `"email:a1"` |
| 4 | `"b2c3d4e5f6>>"` |

We can't rehydrate until we have the full placeholder. But we also can't buffer everything (defeats the purpose of streaming).

### 7.2 The Solution: Carry Buffer

The `rehydrateChunk()` function uses a small carry buffer:

```typescript
export function rehydrateChunk(
  chunk: string,
  sessionId: string,
  carry: string,
): { output: string; carry: string } {
  const vault = piiVaultStore.get(sessionId);
  if (!vault) return { output: carry + chunk, carry: "" };

  const text = carry + chunk;

  // Find all complete placeholders and rehydrate them
  const placeholderRegex = /<<([a-z]{2,8}):([0-9a-f]{12})>>/g;
  let result = "";
  let lastEnd = 0;
  let lastMatchEnd = 0;

  for (const match of text.matchAll(placeholderRegex)) {
    result += text.slice(lastEnd, match.index);
    const rehydrated = vault.rehydrate(match[0]);
    result += rehydrated.text;
    lastEnd = match.index + match[0].length;
    lastMatchEnd = lastEnd;
  }

  // Check for a partial placeholder at the end
  // Look for an opening "<<" or a trailing "<" that could be the start of "<<"
  const remaining = text.slice(lastEnd);
  const partialStart = remaining.lastIndexOf("<<");

  if (partialStart !== -1) {
    const afterPartial = remaining.slice(partialStart);
    // Could this be the start of a placeholder?
    // Max placeholder length: << (2) + type (8) + : (1) + hexid (12) + >> (2) = 25 chars
    if (afterPartial.length < 25 && !afterPartial.includes(">>")) {
      // Partial match — hold it in carry
      result += remaining.slice(0, partialStart);
      return { output: result, carry: afterPartial };
    }
  }

  // Check for a trailing single "<" that could be the first char of "<<"
  // Without this, a chunk ending in "<" would emit it, and the next chunk
  // starting with "<email:...>>" would never match the placeholder regex.
  if (remaining.endsWith("<")) {
    result += remaining.slice(0, -1);
    return { output: result, carry: "<" };
  }

  // No partial — flush everything
  result += remaining;
  return { output: result, carry: "" };
}
```

### 7.3 Carry Buffer Properties

| Property | Value | Why |
|---|---|---|
| Max carry size | 24 bytes | Single `<` (1 char) or `<<` + up to 8 type chars + `:` + 12 hex chars = 23 chars. If carry exceeds 24 chars, it's not a placeholder — flush it. |
| Carry timeout | None needed | SSE stall detection (30s) already handles dead connections. If the stream ends, the `finally` block flushes carry. |
| Memory overhead | Negligible | One string ≤24 chars per active streaming request |

### 7.4 Edge Cases

| Case | Handling |
|---|---|
| `<<` split across chunks (`<` + `<email:...>>`) | A trailing single `<` at chunk end is held in carry. Next chunk prepends it, forming `<<email:...>>` which matches the placeholder regex. If the next chunk doesn't form `<<`, the `<` is flushed as text. |
| Placeholder fully within one chunk | Rehydrated immediately, no carry needed |
| Multiple placeholders in one chunk | All complete ones rehydrated; only trailing partial held |
| Chunk contains `<<` but it's not a placeholder (e.g. `<<important>>`) | Carry holds up to 25 chars. If `>>` arrives and regex doesn't match the full pattern, carry is flushed as-is. |
| `<<` followed by `>>` with wrong format (e.g. `<<FOO:bar>>`) | Regex requires `[a-z]{2,8}` and `[0-9a-f]{12}` — uppercase/wrong-length won't match. Flushed as-is. |
| Stream ends with non-empty carry | `finally` block flushes carry to client (it's just text, not a real placeholder) |
| Model never outputs the placeholder (rewrites it) | No rehydration needed — the original PII was already scrubbed, so nothing leaks. User sees the rewritten text as-is. |
| Nested or adjacent placeholders (`<<email:aaa>><<phone:bbb>>`) | Regex handles multiple non-overlapping matches. Both rehydrated. |

### 7.5 Carry Buffer Flush Safety

The carry buffer introduces a **small delay** in streaming output — text that might be part of a placeholder is held back until the next chunk arrives. Worst case: ~24 characters delayed by one chunk interval.

**This is safe because:**
- LLM SSE chunks arrive every 10-100ms typically
- 24 chars of delay is imperceptible to the user
- The delay only occurs when the text actually contains `<<` — normal text streams at full speed

### 7.6 Integration Point in `forwardToOpenAI()`

The streaming rehydration wraps the existing SSE pass-through loop in `provider.ts:601-651`:

```typescript
// Inside the streaming loop in forwardToOpenAI()
let carry = "";

// For each SSE data line:
if (piiSession && parsed.choices?.[0]?.delta?.content) {
  const { output, carry: newCarry } = rehydrateChunk(
    parsed.choices[0].delta.content,
    piiSession,
    carry,
  );
  carry = newCarry;
  parsed.choices[0].delta.content = output;
}

// In the finally block:
if (carry) {
  // Flush remaining carry as a final content chunk
  const flushChunk = makeChunk({ content: carry });
  res.write(`data: ${JSON.stringify(flushChunk)}\n\n`);
}
```

---

## 8. Session Management

### 8.1 Lifecycle

```
Request arrives
    │
    ├── pii: true? → vaultStore.getOrCreate(sessionId) → scrub messages
    │                    │
    │                    ├── Forward to external provider
    │                    │
    │                    ├── Rehydrate response (streaming or non-streaming)
    │                    │
    │                    └── destroySession(sessionId) ← explicit cleanup
    │
    └── pii: false? → no vault interaction
```

### 8.2 Session ID Strategy

Each request gets its own session ID (`vaultStore.generateId()` → 16-char hex). Sessions are **request-scoped**, not conversation-scoped. This means:

- No cross-request state leakage
- No session ID threading needed between client and proxy
- Vault is destroyed immediately after the response completes
- If the response fails mid-stream, the vault's 30-minute TTL auto-cleans it

### 8.3 Memory Footprint

| Metric | Value |
|---|---|
| Vault overhead per request | ~2-10 KB (depends on number of PII items) |
| Session TTL | 30 minutes (safety net — normally destroyed in <1s) |
| Sweep interval | 5 minutes (background, `.unref()`'d) |
| Concurrent sessions | One per in-flight PII-scrubbed request |

On a single-user server doing ~1 request at a time, this is effectively zero overhead.

---

## 9. Error Handling & Robustness

### 9.1 Fail-Closed Principle

**Critical invariant: if PII scrubbing fails, the request MUST NOT reach the external provider with unscrubbed data.**

Two modes controlled by `pii.mode`:

| Mode | Behavior on scrub error |
|---|---|
| `strict` (default) | Return 500 to client. Log error. Do not forward. |
| `standard` | Return 500 to client. Log error. Do not forward. |

**Why both modes are identical for scrub failures:** Leaking real PII to an external provider is never acceptable, so both modes are fail-closed on the outbound path. The modes only differ on **rehydration failures** (inbound path), where showing a placeholder to the user is ugly but safe.

### 9.2 Error Scenarios

| Scenario | Handling | Risk |
|---|---|---|
| **Scrub throws** (regex error, crypto failure) | `strict`/`standard`: Return `500 { error: "PII scrub failed" }`. Do NOT forward request. | None — request blocked |
| **Rehydrate fails** (session expired, decrypt error) | `strict`: Return `502 { error: "PII rehydrate failed" }`. `standard`: Return response with placeholders intact + `X-PII-Warning` header. | `standard` mode: user sees `<<email:abc123>>` instead of real value. Ugly but safe. |
| **Rehydrate fails mid-stream** | `strict`: Write error SSE event + `[DONE]`. `standard`: Continue stream with placeholders. | Same as above — placeholders visible but no PII leaked |
| **Vault session not found** (shouldn't happen) | Same as rehydrate failure. Log as critical. | None — placeholder stays |
| **External provider returns error** | Normal TierFlow fallback chain. If fallback is local (Ollama), PII layer auto-disengages for that attempt. Vault destroyed on request end. | None |
| **Fallback from external → local mid-request** | PII scrub was applied to messages. Local Ollama sees scrubbed messages. **Rehydration must be conditional:** only run if the *actual responding provider* has `pii: true`. If the fallback lands on a local provider (no PII), skip rehydration — the local model's response won't contain placeholders. The `piiSession` is still destroyed on request end. | Slightly wasteful (Ollama gets scrubbed text) but safe and correct. |
| **Request aborted by client** | `finally` block destroys vault session. | None — crypto keys zeroed |
| **TierFlow crashes** | Vault keys are memory-only. No PII persisted to disk. | None |

### 9.3 Logging

PII-related events logged (never logging actual PII values):

```
[PII] Scrubbed 3 items (email, phone, api_key) for provider openrouter — session abc123
[PII] Rehydrated 3 items — session abc123
[PII] Session abc123 destroyed
[PII] ERROR: Scrub failed — request blocked — error: <message>
[PII] WARNING: Rehydrate failed for session abc123 — placeholders retained
```

### 9.4 Response Headers

Every PII-scrubbed response gets metadata headers (these are proxy-internal, visible only to OpenClaw):

| Header | Value |
|---|---|
| `X-PII-Scrubbed` | `true` |
| `X-PII-Categories` | `email,phone,api_key` |
| `X-PII-Count` | `3` |
| `X-PII-Warning` | Only set if rehydration had issues |

These headers are written before the response body, so they work for both streaming and non-streaming.

---

## 10. Files to Create / Modify

### New Files

| File | Purpose | Lines (est.) |
|---|---|---|
| `src/pii/patterns.ts` | PII regex definitions (from pii-vault) | ~80 |
| `src/pii/vault.ts` | SecretVault class (from pii-vault) | ~300 |
| `src/pii/vault-store.ts` | Session management (from pii-vault) | ~70 |
| `src/pii/middleware.ts` | `scrubMessages()`, `rehydrateText()`, `rehydrateChunk()`, `destroySession()` | ~150 |
| `src/pii/index.ts` | Barrel export | ~10 |
| `test/pii-middleware.test.ts` | Unit tests for middleware | ~300 |
| `test/pii-streaming.test.ts` | Streaming rehydration tests | ~200 |
| `test/pii-integration.test.ts` | End-to-end with mock external provider | ~250 |

### Modified Files

| File | Change | Lines changed (est.) |
|---|---|---|
| `src/config.ts` | Add `PiiConfig` type, extend `ProviderConfigEntry` with `pii` field, add `isPiiEnabled()` + `getPiiExclude()` helpers | ~30 |
| `src/server.ts` | Import PII middleware. Add scrub step in `handleChatCompletions()` between route and forward. Thread `piiSession` through to provider. | ~25 |
| `src/provider.ts` | Accept `piiSession` parameter in `forwardRequest()` and `forwardToOpenAI()`. Add rehydration in non-streaming response path. Add carry-buffer rehydration in streaming SSE loop. Add `finally` carry flush. | ~60 |
| `tierflow.config.json` | Add `openrouter` provider entry | ~10 |

**Total new code:** ~610 lines (pii core) + ~150 lines (middleware) + ~750 lines (tests)
**Total modified code:** ~115 lines across 3 existing files

---

## 11. Implementation Sequence

### Phase 1: PII Core (no TierFlow changes)

**Goal:** Get the pii-vault modules compiling and tested in TierFlow's build system.

| Step | Task |
|---|---|
| 1.1 | Create `src/pii/` directory |
| 1.2 | Copy `patterns.ts`, `vault.ts`, `vault-store.ts` from pii-vault |
| 1.3 | Adapt imports to TierFlow's module style (ESM, `.js` extensions) |
| 1.4 | Create `src/pii/index.ts` barrel export |
| 1.5 | Verify `npm run build` succeeds |
| 1.6 | Write unit tests for vault: redact, rehydrate, destroy, deduplication |

**Checkpoint:** PII module compiles and passes unit tests independently.

### Phase 2: Middleware Layer

**Goal:** Build the message-level scrub/rehydrate functions and the streaming carry buffer.

| Step | Task |
|---|---|
| 2.1 | Create `src/pii/middleware.ts` with `scrubMessages()`, `rehydrateText()`, `rehydrateChunk()`, `destroySession()` |
| 2.2 | Write unit tests for `scrubMessages()` — multi-message, system/user/assistant roles, tool calls with PII |
| 2.3 | Write unit tests for `rehydrateChunk()` — all edge cases from section 7.4 |
| 2.4 | Write carry buffer stress test — random chunk boundary splits |

**Checkpoint:** Middleware passes all unit tests. No TierFlow files touched yet.

### Phase 3: Config Extension

**Goal:** Add PII config types and provider setup.

| Step | Task |
|---|---|
| 3.1 | Add `PiiConfig` type and extend `ProviderConfigEntry` in `src/config.ts` |
| 3.2 | Add `isPiiEnabled()` and `getPiiExclude()` helpers in `src/config.ts` |
| 3.3 | Add `openrouter` provider to `tierflow.config.json` |
| 3.4 | Set `OPENROUTER_API_KEY` in `~/.zprofile` |
| 3.5 | Verify `POST /reload-config` picks up new provider |

**Checkpoint:** Config loads correctly. `/config` endpoint shows new provider (key redacted).

### Phase 4: Pipeline Integration

**Goal:** Wire PII into the request/response path.

| Step | Task |
|---|---|
| 4.1 | Modify `handleChatCompletions()` — add scrub step after routing |
| 4.2 | Thread `piiSession` parameter through `forwardRequest()` → `forwardToOpenAI()` |
| 4.3 | Add non-streaming rehydration in `forwardToOpenAI()` — conditional on actual responding provider having `pii: true` (not just whether scrub happened, since fallback may switch to a local provider) |
| 4.4 | Add streaming carry-buffer rehydration in `forwardToOpenAI()` SSE loop — same provider-conditional logic |
| 4.5 | Add `finally` block for carry flush + session cleanup |
| 4.6 | Add PII response headers |

**Checkpoint:** Full pipeline works. Ready for integration testing.

### Phase 5: Integration Testing & Hardening

**Goal:** End-to-end validation with real and mock providers.

| Step | Task |
|---|---|
| 5.1 | Write integration test with mock SSE server (simulates OpenRouter) |
| 5.2 | Test: message with PII → scrubbed → mock response with placeholders → rehydrated |
| 5.3 | Test: streaming with split placeholders across chunk boundaries |
| 5.4 | Test: fallback from external → local (PII disengages on local) |
| 5.5 | Test: scrub failure → 500, request never forwarded |
| 5.6 | Test: rehydrate failure → graceful degradation |
| 5.7 | Manual test with real OpenRouter endpoint |

**Checkpoint:** All tests pass. Feature ready for daily use.

---

## 12. QA & Testing Strategy

### 12.1 Test Levels

| Level | What | How | Files |
|---|---|---|---|
| **Unit** | PII vault: redact, rehydrate, crypto | Direct function calls with known inputs | `test/pii-middleware.test.ts` |
| **Unit** | Carry buffer: split handling, flush, edge cases | Feed chunks with artificial split points | `test/pii-streaming.test.ts` |
| **Integration** | Full pipeline: HTTP request → scrub → mock backend → rehydrate → HTTP response | Mock HTTP server simulating OpenRouter SSE | `test/pii-integration.test.ts` |
| **Manual** | Real OpenRouter call | `curl` with PII-laden messages | Documented below |

### 12.2 Unit Test Cases — Vault Core (`test/pii-middleware.test.ts`)

Tests the SecretVault class directly — pattern detection, encryption, dedup, lifecycle.

```
SecretVault — Pattern Detection (per-category):
  ✓ redact detects email addresses
  ✓ redact detects API keys (sk-ant-*, sk-*, ghp_*, AKIA*, JWTs)
  ✓ redact detects bearer tokens
  ✓ redact detects PEM blocks
  ✓ redact detects credentials (password=, secret=, api_key=)
  ✓ redact detects connection strings (postgres://, mongodb://, redis://)
  ✓ redact detects phone numbers (international formats)
  ✓ redact detects IP addresses
  ✓ redact detects credit card numbers
  ✓ redact detects UK NINOs
  ✓ redact detects UK postcodes
  ✓ redact detects file paths (/Users/..., /home/..., C:\Users\...)

SecretVault — Core Behaviour:
  ✓ redact replaces PII with <<category:hexid>> placeholder
  ✓ redact returns unchanged text when no PII found
  ✓ redact preserves surrounding text exactly (whitespace, punctuation)
  ✓ redact handles multiple PII types in single text
  ✓ rehydrate restores single placeholder to original value
  ✓ rehydrate restores multiple placeholders
  ✓ rehydrate leaves unknown placeholder IDs intact
  ✓ redact → rehydrate round-trip produces identical original text
  ✓ deduplicates same value across multiple redact calls (same ID)
  ✓ exclude list skips specified categories
  ✓ redact skips code blocks (``` fenced) on passes 2+
  ✓ redact handles overlapping patterns (priority by pass number)

SecretVault — Lifecycle:
  ✓ destroyed vault throws on redact
  ✓ destroyed vault throws on rehydrate
  ✓ vault.size reflects number of unique PII items stored
```

### 12.3 Unit Test Cases — scrubMessages() (`test/pii-middleware.test.ts`)

Tests the message-level scrubbing middleware.

```
scrubMessages() — Content Handling:
  ✓ scrubs PII from user message content (string)
  ✓ scrubs PII from assistant message content
  ✓ scrubs PII from multiple messages in conversation
  ✓ handles array-format content ([{ type: "text" }, { type: "image_url" }])
  ✓ only scrubs type: "text" entries in array content — images unchanged
  ✓ handles multiple text blocks in array content
  ✓ handles messages with only image content (no text) — passthrough
  ✓ scrubs tool_calls arguments (function args contain user data)
  ✓ scrubs tool result messages (role: "tool" with PII in content)

scrubMessages() — Role Handling:
  ✓ skips system role messages (design decision: no user PII)
  ✓ skips developer role messages
  ✓ processes user, assistant, and tool roles

scrubMessages() — Edge Cases:
  ✓ handles messages with no PII (passthrough, scrubbed=false)
  ✓ handles empty messages array
  ✓ handles null content gracefully
  ✓ deep-copies messages (original array untouched)
  ✓ deduplicates same email across different messages (same session)
  ✓ handles very long message content (10KB+)
  ✓ full multi-turn conversation: system → user → assistant → tool → user

scrubMessages() — Output:
  ✓ returns categories found (email, apikey, etc.)
  ✓ respects exclude list (e.g. exclude: ["phone"])
  ✓ sessionId is unique per call
  ✓ session auto-destroyed when no PII found (scrubbed=false)
```

### 12.4 Unit Test Cases — rehydrateText() (`test/pii-middleware.test.ts`)

```
rehydrateText():
  ✓ restores single placeholder
  ✓ restores multiple placeholders
  ✓ handles text with no placeholders (passthrough)
  ✓ handles unknown session ID gracefully (returns text as-is)
  ✓ handles destroyed session gracefully (returns text as-is)
  ✓ partial/malformed placeholders left as-is
  ✓ handles response with mixed model text + placeholders
  ✓ handles placeholder embedded in JSON structure (model returns structured output)
```

### 12.5 Unit Test Cases — Streaming (`test/pii-streaming.test.ts`)

Tests carry buffer logic for streaming rehydration.

```
rehydrateChunk() — Split Scenarios:
  ✓ full placeholder in single chunk → rehydrated immediately
  ✓ no placeholder in chunk → passthrough, empty carry
  ✓ placeholder split across chunks → carry buffer then rehydrate
  ✓ partial placeholder at chunk boundary → carry then rehydrate
  ✓ placeholder with trailing text split → carry then rehydrate + emit rest
  ✓ placeholder end marker at chunk boundary → carry then flush
  ✓ multiple placeholders in one chunk → all rehydrated
  ✓ mixed text and placeholder → text emitted, placeholder rehydrated
  ✓ adjacent placeholders → both rehydrated
  ✓ two placeholders split across different chunks

rehydrateChunk() — Carry Buffer Edge Cases:
  ✓ carry exceeds max placeholder length (25 chars) → flushed as text
  ✓ "<<" in normal text (not a placeholder) → flushed after next chunk confirms
  ✓ chunk ends with single "<" → held in carry (could be start of "<<")
  ✓ empty chunk with existing carry → carry maintained
  ✓ stream end flush: non-empty carry flushed as-is
  ✓ unknown session → carry + chunk flushed together (no rehydration)
  ✓ unicode text mixed with placeholders → text preserved, placeholder rehydrated
  ✓ single-character chunks (1 char at a time) → correct reassembly

Randomised split test (fuzz):
  ✓ 200 iterations: 1 placeholder, random 2-chunk split
  ✓ 200 iterations: 2 placeholders, random 3-chunk split
  ✓ 100 iterations: 2 PII types, 5-15 random small chunks
  ✓ 100 iterations: text with unicode + PII, single-char chunks
```

### 12.6 Integration Test Cases (`test/pii-integration.test.ts`)

End-to-end with mock HTTP servers.

```
Full pipeline (non-streaming):
  ✓ PII in request → scrubbed → mock echoes placeholders → rehydrated → client sees original
  ✓ No PII in request → forwarded unchanged → response unchanged
  ✓ Local provider (pii: false) → isPiiEnabled returns false
  ✓ Fallback: external → local — rehydrate is no-op (local response has no placeholders)

Full pipeline (streaming):
  ✓ PII scrubbed → streaming SSE with placeholders → rehydrated chunk by chunk
  ✓ Split placeholder across SSE chunks → correctly reassembled and rehydrated
  ✓ Stream ends → carry flushed → [DONE] sent

Config handling:
  ✓ pii: true → isPiiEnabled, strict mode, no exclude
  ✓ pii: { enabled: true, mode: "standard", exclude: [...] } → correct parsing
  ✓ pii: { enabled: false } → isPiiEnabled returns false
  ✓ no pii key → isPiiEnabled returns false (zero overhead)

Session lifecycle:
  ✓ session destroyed after successful request
  ✓ session destroyed after failed request (error path)
  ✓ session destroyed after client disconnect
  ✓ vault store sweep cleans expired sessions
  ✓ concurrent sessions don't interfere — each request gets isolated vault

Error handling:
  ✓ rehydrate with expired/destroyed session → placeholders retained (safe)
  ✓ mock server returns error → vault session still cleaned up
  ✓ standard mode: rehydrate failure → placeholders passed through + X-PII-Warning header

Security:
  ✓ mock server NEVER receives real PII (multi-type: email, API key, phone, IP)
  ✓ all fields in scrubbed output verified PII-free (content, tool_calls args)
  ✓ placeholder format is valid (<<category:12hex>>)

Mock HTTP server round-trips:
  ✓ non-streaming: full HTTP request/response with scrub/rehydrate
  ✓ streaming: full HTTP SSE with scrub/rehydrate per chunk
  ✓ PII leak verification: N PII values checked against raw server-received bytes
```

### 12.5 Manual Test Script

After implementation, validate with real OpenRouter:

```bash
# 1. Start TierFlow with OpenRouter configured
cd ~/Projects/tierflow && node dist/src/server.js

# Note: The Bearer token below ($OLLAMA_API_KEY) is TierFlow's own auth,
# NOT the OpenRouter API key. TierFlow handles provider auth internally
# using the keys configured in tierflow.config.json.

# 2. Non-streaming test with PII
curl -s http://127.0.0.1:18800/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $OLLAMA_API_KEY" \
  -d '{
    "model": "openrouter/deepseek/deepseek-chat",
    "messages": [{"role":"user","content":"Summarise this: John Smith (john@acme.com, +44 7911 123456) API key sk-abc123def456ghi789"}],
    "stream": false
  }' | jq .

# Expected: response contains "John Smith", "john@acme.com", etc. — rehydrated
# Verify: check TierFlow logs for [PII] scrub/rehydrate messages

# 3. Streaming test with PII
curl -N http://127.0.0.1:18800/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $OLLAMA_API_KEY" \
  -d '{
    "model": "openrouter/deepseek/deepseek-chat",
    "messages": [{"role":"user","content":"Reply with: Contact john@acme.com for help"}],
    "stream": true
  }'

# Expected: SSE stream with rehydrated email in content chunks

# 4. Verify PII never reaches OpenRouter — check with /stats
curl http://127.0.0.1:18800/stats | jq .

# 5. Test local model (should have zero PII overhead)
curl -s http://127.0.0.1:18800/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $OLLAMA_API_KEY" \
  -d '{
    "model": "auto",
    "messages": [{"role":"user","content":"hi"}],
    "stream": false
  }' | jq .

# Expected: routed to ollama/gemma3:1b, no PII headers in response
```

### 12.6 PII Leak Verification

To confirm PII never reaches the external provider, add a temporary debug flag:

```jsonc
"openrouter": {
  ...
  "pii": {
    "enabled": true,
    "debug_log_scrubbed": true   // TEMPORARY — logs scrubbed (safe) payload
  }
}
```

This logs the **scrubbed** request body (which contains only placeholders, never real PII) so you can visually verify what OpenRouter actually receives. Remove after validation.

---

## 13. Rollback Plan

The feature is fully opt-in. To disable:

**Option A — Config only (no rebuild):**
```jsonc
// Just remove the pii key or set it to false
"openrouter": {
  "baseUrl": "https://openrouter.ai/api/v1",
  "api": "openai",
  "auth": { "type": "env", "key": "OPENROUTER_API_KEY" }
  // pii removed → traffic flows unscrubbed
}
```
Then `curl -X POST http://127.0.0.1:18800/reload-config`.

**Option B — Remove OpenRouter entirely:**
Remove the `openrouter` provider from config + revert tier mappings to all-Ollama. Hot-reload. TierFlow operates exactly as before.

**Option C — Code revert:**
The PII module is self-contained in `src/pii/`. Removing that directory + reverting the ~115 lines changed in `server.ts`, `provider.ts`, `config.ts` restores the original codebase.

---

## 14. Open Questions

### Resolved Design Decisions

These were previously open questions, now resolved:

| # | Decision | Rationale |
|---|---|---|
| 1 | **System prompts are NOT scrubbed.** `scrubMessages()` skips `role: "system"` messages. | OpenClaw's system prompt contains tool schemas and skill descriptions — unlikely to have user PII. Scrubbing adds latency for no benefit. A config option can be added later if needed. |
| 2 | **Tool call arguments ARE scrubbed.** | Tool args can contain user data (e.g. email in a search query). |
| 3 | **OpenRouter double-slash naming works as-is.** `openrouter/deepseek/deepseek-chat` → provider=`openrouter`, model=`deepseek/deepseek-chat`. | `parseModelId()` already splits on first `/` only (`provider.ts:98`). No changes needed. |

### Remaining Open Questions

| # | Question | Options | Recommendation |
|---|---|---|---|
| 4 | **PII stats in /stats endpoint?** Track scrub/rehydrate counts. | A) Add PII section to stats. B) Skip for now. | **A — add it.** Low effort, high visibility for monitoring. |
| 5 | **Rate limiting for OpenRouter?** External API calls cost money. | A) Add rate limiting now. B) Defer. | **B — defer.** Single-user server. Monitor costs manually via OpenRouter dashboard first. |
| 6 | **Which OpenRouter models to start with?** | See below. | Start with 2 models, expand based on usage. |

### Recommended Starting Models (OpenRouter)

| Model | OpenRouter ID | Cost (input/output per 1M tokens) | Use Case |
|---|---|---|---|
| DeepSeek-V3 | `deepseek/deepseek-chat` | $0.14 / $0.28 | General chat, medium complexity |
| Qwen3 235B A22B | `qwen/qwen3-235b-a22b` | $0.14 / $0.28 | Complex tasks, code |

Both are ~100x cheaper than Claude and competitive on quality for many tasks. Route MEDIUM/COMPLEX tiers to these while keeping SIMPLE (local, fast) and REASONING (local, private) on Ollama.

---

## Appendix A — Placeholder Format Reference

```
Format:    <<type:hexid>>
Example:   <<email:a1b2c3d4e5f6>>
Regex:     /<<([a-z]{2,8}):([0-9a-f]{12})>>/g

Min length: << + 2 + : + 12 + >> = 18 chars
Max length: << + 8 + : + 12 + >> = 24 chars

Type values: apikey, cred, pem, conn, email, cc, nino, phone, ip, post, path, secret
```

## Appendix B — Threat Model

| Threat | Mitigation |
|---|---|
| PII sent to external model | Scrub layer intercepts. Fail-closed on error. |
| PII in TierFlow logs | Never log raw PII. Log placeholder IDs and categories only. |
| Placeholder leaks to user | Rehydration restores originals. On failure, `strict` mode blocks response. `standard` mode shows safe placeholder. |
| Vault key extraction | Keys are memory-only, never serialized. `destroy()` zeros the buffer. Process crash = keys gone. |
| Session hijacking | Sessions are request-scoped (created and destroyed within one HTTP request). No session ID exposed externally. |
| OpenRouter logging our prompts | OpenRouter sees only scrubbed text. Even if they log everything, no real PII is present. |
| Model reconstructs PII from context | Possible but unlikely. The scrubbed prompt lacks the actual values. Model might guess "this is an email" from `<<email:...>>` but can't recover `john@acme.com`. |
| Placeholder collision (two PII items get same ID) | 12 hex chars = 48 bits = ~281 trillion possible IDs. Collision probability within a single request (typically <100 PII items) is astronomically low (~1 in 2.8 billion). No mitigation needed. |
| Regex bypass (PII not detected) | Known limitation of regex-only detection (no NER). Mitigated by pii-vault's multi-pass detection pipeline which includes an entropy scanner (final pass) that catches unrecognised high-entropy secrets like tokens and keys. Names are explicitly not detected — this is a trade-off for precision over recall. |
