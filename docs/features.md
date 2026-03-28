# Features

## ML-Powered Routing (v2)

8-category classification via external ML service (LLMRouter):

| Category      | Typical Use                  | Default Model              |
| ------------- | ---------------------------- | -------------------------- |
| simple_chat   | Greetings, factual Q&A       | Gemini Flash Lite (cheap)  |
| general       | Explanations, summaries      | DeepSeek V3 (balanced)     |
| coding        | Write/fix/refactor code      | Qwen3 Coder (free)         |
| reasoning     | Math proofs, logic puzzles   | GPT-oss / DeepSeek R1      |
| creative      | Poetry, stories, scripts     | Step 3.5 Flash (free)      |
| data          | Analysis, charts, ETL        | Gemini Flash Lite (cheap)  |
| agentic       | Tool calls, multi-step tasks | DeepSeek V3 (tool-capable) |
| transcription | Audio processing             | Gemini Flash Lite          |

All model assignments are configurable via `categories` in config.

## Agentic Routing

Auto-detects tool calls (`tools` array in request) and routes to agentic-capable models. Separate `agenticTiers` config allows different model selection when tools are present.

## Mode Overrides

Force a category with prompt prefixes:

| Prefix Style | Example                                  |
| ------------ | ---------------------------------------- |
| Slash        | `/code Write a parser`                   |
| Bracket      | `[reasoning] Prove this theorem`         |
| Word         | `deep mode: Analyze for race conditions` |

Aliases: `simple`, `basic`, `cheap`, `medium`, `balanced`, `complex`, `code`, `max`, `reasoning`, `think`, `deep`, `creative`, `data`

The prefix is stripped before forwarding.

## PII Scrubbing

Per-provider opt-in (`"pii": true`). 15 detection patterns across 5 ordered passes:

1. High-confidence: PEM blocks, API keys (sk-ant-, ghp\_, etc.), connection strings, Bearer tokens
2. Structured IDs: emails, credit cards, SSNs, UK NINOs
3. Semi-structured: phone numbers, IPv4/IPv6, UK postcodes, file paths
4. PEM headers (stray BEGIN lines)
5. Entropy catch-all: password=, secret=, token= patterns

**Type-preserving placeholders:** `p0{12hex}@maildomain.com` (email), `p0{12hex}-placeholder-key` (API key), etc. LLMs echo these correctly in tool calls.

**Encryption:** AES-256-GCM, memory-only (no persistence). Dedup via HMAC-SHA256.

**Streaming:** Carry buffer (max 40 chars) handles placeholders split across SSE chunks.

**Modes:** `strict` (default, fail-closed) or `standard` (log + pass through).

Zero overhead when disabled.

## CtxPack Compression

6 algorithmic passes applied to message content:

| Pass         | What It Does                                   |
| ------------ | ---------------------------------------------- |
| `ansi`       | Strip ANSI escape codes                        |
| `whitespace` | Collapse blank lines, trim trailing whitespace |
| `json`       | Minify fenced JSON blocks                      |
| `dedup`      | Replace 3+ identical lines with `line (xN)`    |
| `comments`   | Strip single-line comments from code fences    |
| `verbose`    | Collapse long stack traces, shorten home paths |

30-70% token savings on typical messages. Per-provider opt-in (`"compress": true`).

## Response Cache

- **Key:** SHA-256 hash of (model + normalized messages + tools flag)
- **Policy:** LRU eviction with configurable TTL (default 300s) and max entries (default 5000)
- **Excludes:** Streaming responses and tool call responses by default
- **Headers:** `X-Cache: HIT` or `X-Cache: MISS`
- **On hit:** Skips entire pipeline (no routing, no ML, no forwarding)

## Request Timeouts + Fallback

Per-tier timeouts: SIMPLE 30s, MEDIUM 60s, COMPLEX/REASONING 120s.

On timeout or provider error, automatically tries fallback models from the tier/category config. Streaming stall timeout: 60s.

## Web Dashboard

Built-in monitoring at `GET /dashboard`:

- Request counts, error rates, cache hit rate
- Tier distribution bar chart
- Category and model usage tables
- Hourly activity chart (24h)
- PII scrubbed/rehydrated counts
- Compression stats (tokens saved)
- Auto-refresh (5s/10s/30s), dark mode, responsive

## CLI

```bash
npx tierflow              # start server
npx tierflow --init       # generate config template
npx tierflow --check      # validate config + connectivity
npx tierflow --port 8080  # custom port
npx tierflow --debug      # verbose logging
```

## Tool Call Translation

Bidirectional Anthropic ↔ OpenAI format:

- `tool_use` blocks ↔ `tool_calls` array
- `input_json_delta` ↔ `arguments` (streaming)
- Thinking block handling per provider
