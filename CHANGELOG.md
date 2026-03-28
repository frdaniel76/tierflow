# Changelog

## [2.0.0] — 2026-03-23

### ML-Powered Category Routing

Replaced the 14-dimension keyword scorer with an ML classifier service.

#### Architecture
- LLMRouter microservice (Python FastAPI) on localhost:18801
- KNN classifier with sentence-transformers embeddings (all-MiniLM-L6-v2, 80MB)
- 160 curated training examples across 8 categories
- ~40ms classification latency, graceful fallback when ML service is down

#### 8 Categories → Specialized Models
| Category | Model | Cost |
|----------|-------|------|
| simple_chat | Gemini Flash | $0.50/M |
| general | DeepSeek V3.2 | $2.74/M |
| coding | Qwen3 Coder | Free |
| reasoning | DeepSeek R1 | $4.36/M |
| creative | Step 3.5 Flash | Free |
| data | Gemini Flash | $0.50/M |
| agentic | DeepSeek V3.2 | $2.74/M |
| transcription | Local whisper | Free |

#### Key Improvements
- "Tell me a joke" → simple_chat (was REASONING due to keyword matching)
- Voice messages → transcription (was REASONING due to session context bleed)
- Code queries → specialized coding model (free, better quality)
- Creative queries → specialized creative model (free)
- ~57% cost reduction from free model routing

---

## [1.5.0] — 2026-03-22

### Type-Preserving PII Placeholders

Placeholders now look like the original data type — LLMs understand what the data IS and echo it correctly in tool calls.

#### Placeholder Templates
| Category | Template | Example |
|----------|----------|---------|
| email | `p0{hex}@maildomain.com` | `p0a1b2c3d4e5f6@maildomain.com` |
| apikey | `sk-p0{hex}-placeholder` | `sk-p0a1b2c3d4e5f6-placeholder` |
| conn | `p0{hex}://placeholder/db` | `p0a1b2c3d4e5f6://placeholder/db` |
| cred | `Bearer p0{hex}-placeholder` | `Bearer p0a1b2c3d4e5f6-placeholder` |
| cc | `0000-p0{hex}-0000` | `0000-p0a1b2c3d4e5f6-0000` |
| ssn | `900-p0{hex}` | `900-p0a1b2c3d4e5f6` |
| phone | `+0-555-p0{hex}` | `+0-555-p0a1b2c3d4e5f6` |
| ip | `p0{hex}.0.0.1` | `p0a1b2c3d4e5f6.0.0.1` |
| path | `/pii/p0{hex}/redacted` | `/pii/p0a1b2c3d4e5f6/redacted` |
| pem | `-----BEGIN PII p0{hex} KEY-----` | `-----BEGIN PII p0a1b2... KEY-----` |
| nino | `QQp0{hex}C` | `QQp0a1b2c3d4e5f6C` |
| post | `ZZp0{hex}` | `ZZp0a1b2c3d4e5f6` |
| secret | `{keyword}=p0{hex}-redacted` | `password=p0a1b2c3d4e5f6-redacted` |

- Universal ID marker: `p0[0-9a-f]{12}` — present in every placeholder
- `secret` category preserves the keyword prefix (password, token, api_key, etc.)
- Per-type rehydration regexes + contextual fallback patterns
- Carry buffer rewritten for streaming with type-aware partial detection

---

## [1.4.0] — 2026-03-22

### PII Tool Call Hardening & Placeholder Format Change

#### Placeholder Format
- Changed from `<<category:hexid>>` to `__PII_category_hexid__`
- Old format was parsed/stripped by LLMs (especially DeepSeek) which broke tool call rehydration
- New format is treated as an opaque identifier — LLMs echo it verbatim
- Added fallback regex to handle cases where LLMs strip the `__` delimiters

#### Streaming Tool Call Carry Buffer
- Added per-tool-call carry buffers for streaming argument deltas (OpenAI + Anthropic paths)
- Previously used `rehydrateText()` which couldn't handle placeholders split across SSE chunks
- Now uses `rehydrateChunk()` with proper carry buffer per tool index
- Carry buffers flushed in `finally` blocks on stream end

#### Tool Result Array Content
- `tool_result` blocks with nested array content (e.g. `[{type:"text",text:"..."}]`) are now scrubbed
- Previously only string content was handled

#### System Message Scrubbing (opt-in)
- New `scrub_system: true` config option in PII config
- When enabled, scrubs system/developer messages (both string and array content)
- Default: false (backward compatible)

#### Fallback Provider Rehydration
- Always rehydrate if data was scrubbed, even when falling back to a non-PII provider (e.g. Ollama)
- Previously, fallback to a provider without `pii: true` returned raw placeholders to the client
- `piiMode` now consistently uses the primary provider's config, not the fallback's

#### Tests
- 41 new tests across `pii-gaps.test.ts` (33) and updated streaming tests (8)
- **166/166 tests passing** (up from 125/125)

---

## [1.3.0] — 2026-02-14

### 🎛️ Mode Overrides — Take Control When You Want It

#### Mode Override Prefixes
Users can now force a specific routing tier by prefixing their prompt. The directive is stripped before forwarding to the LLM.

**Three syntax styles supported:**
- **Slash:** `/simple`, `/medium`, `/complex`, `/max`, `/reasoning`, `/think`, `/deep`, `/basic`, `/cheap`, `/balanced`, `/advanced`
- **Word prefix:** `complex mode: ...`, `deep mode, ...`
- **Bracket:** `[reasoning] ...`, `[simple] ...`

When no prefix is detected, falls back to normal 14-dimension classification — fully backward compatible.

#### Alias Mapping
| Input | Routes to |
|-------|-----------|
| `/simple`, `/basic`, `/cheap` | SIMPLE |
| `/medium`, `/balanced` | MEDIUM |
| `/complex`, `/advanced` | COMPLEX |
| `/max`, `/reasoning`, `/think`, `/deep` | REASONING |

#### Tests
- 5 new mode override tests added
- **75/75 tests passing** (up from 70/70)

---

## [1.2.0] — 2026-02-14

### 🔧 External Config + Reliability Improvements

#### Config-Driven Architecture
- **New: `freerouter.config.json`** — all providers, tiers, boundaries, thinking, and auth are now configurable without editing source code
- **New: `src/config.ts`** — config loader with file search priority: `FREEROUTER_CONFIG` env → `./freerouter.config.json` → `~/.config/freerouter/config.json`
- Deep-merges file config over built-in defaults — fully backward compatible (works without config file)
- New `/config` endpoint — view current config with secrets redacted
- New `/reload-config` endpoint — reload config without restarting the proxy
- Auth types: `openclaw` (reads auth-profiles.json), `env` (environment variables), per-provider overrides

#### Reliability
- **Request timeouts** — `AbortSignal.timeout()` per tier: SIMPLE 30s, MEDIUM 60s, COMPLEX/REASONING 120s
- **Streaming stall detection** — aborts if no data received for 30s mid-stream
- **Auto-fallback on timeout** — if primary model times out, fallback model is tried automatically
- **Timeout counter** — visible in `/health` and `/stats` responses
- **`TimeoutError` class** — clean error identification for fallback logic

#### Smarter Classification
- **Token estimation fix** — complexity scoring now uses user prompt length only (not system+user). Long system prompts (AGENTS.md, SOUL.md) no longer inflate complexity scores. A "hello" with a 40K system prompt correctly routes to SIMPLE, not COMPLEX
- **Structured output fix** — detection now checks user prompt only. System prompts mentioning "json" no longer force tier upgrades
- Total token count still used for context window checks (large input → force COMPLEX)

#### Provider Configuration
- Providers defined in config with `baseUrl`, `api` type (`"anthropic"` or `"openai"`), optional `headers`
- Any OpenAI-compatible provider works out of the box — just add baseUrl + API key
- Anthropic gets automatic format translation (tool calls, streaming, thinking)
- Thinking config is now data-driven: specify which models support adaptive thinking and budget amounts

### Migration
No action needed — if no `freerouter.config.json` exists, all previous defaults apply. To customize:

```bash
cp freerouter.config.json ~/.config/freerouter/config.json
# Edit providers, tiers, boundaries to taste
curl http://localhost:18800/reload-config  # Apply without restart
```

---

## [1.0.0] — 2026-02-14

### 🚀 First Full Release — Proxy Server + Smart Routing

The first complete release of FreeRouter: a self-hosted, OpenAI-compatible proxy that classifies requests by complexity and routes them to the best model using your own API keys.

### Added

- **Proxy server** (`src/server.ts`) — zero-dependency HTTP server exposing OpenAI-compatible `/v1/chat/completions` endpoint
- **Provider translation** (`src/provider.ts`) — translates between Anthropic Messages API and OpenAI format:
  - `content_block` / `tool_use` → OpenAI `tool_calls` / `function` format
  - Streaming `input_json_delta` → streamed `arguments` chunks
  - Thinking block filtering (no XML/thinking leak to clients)
  - Non-streaming tool call support with proper `finish_reason: "tool_calls"`
- **Auth module** (`src/auth.ts`) — reads OpenClaw's `auth-profiles.json` for API keys
  - Supports Anthropic OAuth tokens (`sk-ant-oat*`) with Claude Code identity headers
  - Supports standard API keys for any provider
- **Logger** (`src/logger.ts`) — minimal, zero-dep request logging with configurable levels
- **Model definitions** (`src/models.ts`) — model catalog with pricing for cost estimation
- **14-dimension weighted classifier** (`src/router/`) — scores requests across:
  - Token count, code presence, reasoning markers, technical terms, creative markers
  - Simple indicators, multi-step patterns, question complexity, imperative verbs
  - Constraint count, output format, reference complexity, negation, domain specificity
  - Agentic task detection (auto-switches to agentic tier configs)
- **Tier-based routing**:
  - SIMPLE → Kimi K2.5 (near-zero cost)
  - MEDIUM → Claude Sonnet 4.5 (balanced)
  - COMPLEX → Claude Opus 4.6 (powerful)
  - REASONING → Claude Opus 4.6 (max thinking)
- **Fallback chains** — automatic retry with fallback model on failure
- **Adaptive thinking** — auto-configures thinking per model:
  - Sonnet: `{ type: "enabled", budget_tokens: 4096 }`
  - Opus: `{ type: "adaptive" }`
- **Context-aware classification** — includes last 3 conversation messages in scoring
- **Multilingual keyword support** — English, Chinese, Japanese, Russian, German
- **Test suites** — 70/70 tests passing:
  - `tests/test-proxy.sh` — 33 core tests (health, validation, routing, streaming, tools, concurrency)
  - `tests/test-proxy-extended.sh` — 37 extended tests (unicode, edge cases, stress, alternate endpoints)
- **Management endpoints**: `/health`, `/stats`, `/reload`, `/v1/models`
- **CORS support** for browser-based clients
- **Zero external dependencies** — only TypeScript + @types/node as dev deps

### Architecture

```
Client (OpenAI format) → FreeRouter (:18800) → 14-dim Classifier → Route to best model
                                                                     ├── Simple → Kimi K2.5
                                                                     ├── Medium → Sonnet 4.5
                                                                     ├── Complex → Opus 4.6
                                                                     └── Reasoning → Opus 4.6
```

### Credits

Forked from [BlockRunAI/ClawRouter](https://github.com/BlockRunAI/ClawRouter) (MIT License). Routing engine preserved; x402 payment protocol removed entirely.
