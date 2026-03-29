<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/logo-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="assets/logo.svg">
    <img src="assets/logo.svg" width="400" alt="TierFlow — Self-hosted AI model router">
  </picture>
</p>

<h1 align="center">Cut Your LLM API Bill by 75% — Automatically</h1>

<p align="center">
  <strong>Self-hosted AI router that classifies every request and sends it to the cheapest model that can handle it. Zero dependencies. Built-in PII scrubbing. Your API keys stay on your machine.</strong>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-green.svg" alt="MIT License"></a>
  <a href="package.json"><img src="https://img.shields.io/badge/node-%3E%3D20-blue.svg" alt="Node 20+"></a>
  <a href="#zero-dependencies"><img src="https://img.shields.io/badge/dependencies-0-brightgreen.svg" alt="Zero Dependencies"></a>
  <a href="#quick-start"><img src="https://img.shields.io/badge/setup-2_minutes-orange.svg" alt="2 min setup"></a>
</p>

<p align="center">
  <a href="#quick-start">Quick Start</a> &middot;
  <a href="#how-it-works">How It Works</a> &middot;
  <a href="#features">Features</a> &middot;
  <a href="#configuration">Configuration</a> &middot;
  <a href="docs/">Documentation</a>
</p>

---

## The Problem

You're paying $15/M tokens for Claude Opus on "What's the weather?" You're sending API keys in plaintext to third-party proxies. Your app crashes when one provider has an outage.

## The Solution

TierFlow sits between your app and your LLM providers. It classifies every request, routes it to the cheapest model that can handle it, scrubs PII before forwarding, and automatically fails over when providers go down.

```
Your App  -->  TierFlow  -->  Classifier  -->  Best Model for the Job
                  |
                  ├── "Hi there"        --> Ollama llama3.2     (free, local)
                  ├── "Write a parser"  --> Qwen3 Coder         (free tier)
                  ├── "Prove P=NP"      --> Claude Opus          (when it matters)
                  └── "Summarize CSV"   --> Gemini Flash Lite    ($0.01/M)
```

**Result:** [99% cost reduction on 20 real API calls](docs/live-benchmarks.md) ($0.003 instead of $0.27). Same quality. Your keys never leave your infrastructure.

---

## Quick Start

```bash
npx tierflow --init     # generate config template
npx tierflow            # start on localhost:18800
```

Then point any OpenAI-compatible client at it:

```bash
curl http://localhost:18800/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"auto","messages":[{"role":"user","content":"Hello!"}]}'
```

That's it. TierFlow exposes a standard `/v1/chat/completions` endpoint. Any app that works with OpenAI works with TierFlow.

### Other Install Options

<details>
<summary><strong>Clone & Build</strong></summary>

```bash
git clone https://github.com/frdaniel76/tierflow.git
cd tierflow
npm install && npm run build
npm start
```

</details>

<details>
<summary><strong>Docker Compose</strong></summary>

```bash
docker compose up -d      # starts router + ML classifier
```

See [docs/docker.md](docs/docker.md) for details.

</details>

---

<!-- TODO: After recording, uncomment this block and add the GIF:
<p align="center">
  <img src="demo/tierflow-demo.gif" alt="TierFlow demo — install, route, save" width="700">
</p>

<p align="center"><em>Install → First request → See routing in action. 30 seconds.</em></p>

---
-->

## How It Works

### Two-Layer Classification

**Layer 1: ML Classifier (primary)** — Sentence embeddings (all-MiniLM-L6-v2) + KNN classify queries into 8 categories in ~40ms with 96%+ accuracy.

**Layer 2: Rule-Based Scorer (fallback)** — 14-dimension weighted keyword analysis in <1ms when the ML service is unavailable.

### 8 Routing Categories

| Category | Best For | Example Models |
|----------|----------|----------------|
| `simple_chat` | Greetings, yes/no, definitions | Gemini Flash Lite, Ollama |
| `general` | Moderate questions, summaries | GPT-4o, DeepSeek V3 |
| `coding` | Code generation, debugging | Qwen3 Coder, Codestral |
| `reasoning` | Proofs, logic, step-by-step | Claude Opus, o1 |
| `creative` | Stories, poetry, brainstorming | GPT-4o, Claude Sonnet |
| `data` | CSV analysis, data extraction | Gemini Flash, GPT-4o-mini |
| `agentic` | Tool use, multi-step tasks | Claude Sonnet, GPT-4o |
| `transcription` | Audio/voice routing | Gemini Flash Lite |

Every category is fully configurable — primary model, fallback chain, and timeout.

---

## Features

### Smart Routing
- **ML-powered 8-category classification** — sentence-transformer embeddings + KNN (~40ms)
- **14-dimension keyword fallback** — zero-dependency rule engine (<1ms)
- **Agentic detection** — auto-routes tool-calling requests to capable models
- **Mode overrides** — `/simple`, `/max`, `[code]`, `deep mode:` prefixes to force routing
- **Automatic fallback** — per-tier fallback chains when primary models fail

### Security
- **Prompt injection detection** — 252 patterns across 9 languages (EN, RU, ZH, KO, JA, AR, DE, FR, PT)
- **8 threat categories** — prompt injection, data exfiltration, command injection, social engineering, secret leakage, SSRF, encoding evasion, file system attacks
- **Evasion-resistant** — normalizer defeats base64, leet speak, zero-width characters, spaced letters, HTML obfuscation
- **Configurable threshold** — block CRITICAL only, or WARNING and above
- **Security headers** — `X-TierFlow-Security: CLEAN|WARNING|BLOCKED` on every response

### Privacy
- **PII scrubbing** — 15 detection patterns (emails, API keys, SSNs, credit cards, IPs, PEM keys, etc.)
- **Type-preserving placeholders** — `p0abc@maildomain.com` for emails so LLMs maintain format
- **AES-256-GCM encryption** — PII vault is encrypted in memory, never written to disk
- **Streaming-safe rehydration** — works with SSE streaming responses
- **Per-provider control** — enable PII scrubbing only for external providers, skip for local Ollama

### Performance
- **CtxPack compression** — 6-pass context compression (ANSI, whitespace, JSON, dedup, comments, stack traces), 30-70% token savings
- **Response cache** — LRU with TTL, SHA-256 exact-match keys, `X-Cache: HIT/MISS` headers
- **Zero runtime dependencies** — pure Node.js built-ins, ~2MB installed
- **Hot reload** — `POST /reload-config` to update models and providers without restart

### Observability
- **Web dashboard** — built-in monitoring at `/dashboard` with auto-refresh
- **Request stats** — per-tier, per-model, PII, cache, and cost tracking at `/stats`
- **Routing headers** — `X-TierFlow-Model`, `X-TierFlow-Tier`, `X-TierFlow-Reasoning` on every response
- **Token cost tracking** — real-time cost estimation per request

### Developer Experience
- **OpenAI-compatible API** — drop-in `/v1/chat/completions` proxy, works with any client
- **CLI** — `npx tierflow --init`, `--check`, `--port`, `--debug`
- **Docker Compose** — one command for router + ML classifier
- **Streaming support** — full SSE pass-through with PII rehydration
- **Multi-provider** — Anthropic, OpenAI, Ollama, OpenRouter, Groq, Together, Mistral, DeepSeek, and any OpenAI-compatible API

---

## Configuration

TierFlow uses a single JSON config file:

```bash
npx tierflow --init    # generates ~/.config/tierflow/config.json
```

```json
{
  "port": 18800,
  "host": "127.0.0.1",
  "providers": {
    "anthropic": {
      "baseUrl": "https://api.anthropic.com",
      "api": "anthropic",
      "auth": { "type": "env", "key": "ANTHROPIC_API_KEY" }
    },
    "openrouter": {
      "baseUrl": "https://openrouter.ai/api/v1",
      "api": "openai",
      "auth": { "type": "env", "key": "OPENROUTER_API_KEY" },
      "pii": true
    },
    "ollama": {
      "baseUrl": "http://localhost:11434/v1",
      "api": "openai",
      "auth": { "type": "none" }
    }
  },
  "categories": {
    "simple_chat": { "primary": "ollama/llama3.2", "fallback": ["openrouter/google/gemini-2.5-flash-lite"] },
    "coding": { "primary": "openrouter/qwen/qwen3-coder:free", "fallback": ["anthropic/claude-sonnet-4-5"] },
    "reasoning": { "primary": "anthropic/claude-opus-4-6", "fallback": ["openrouter/deepseek/deepseek-r1"] }
  },
  "cache": { "enabled": true, "ttl_seconds": 300 }
}
```

See [docs/providers.md](docs/providers.md) for the full provider cookbook.

### Mode Overrides

Force a category when you know better than the classifier:

| Prefix | Routes To | Example |
|--------|-----------|---------|
| `/simple`, `/basic`, `/cheap` | simple_chat | `/simple What's 2+2?` |
| `/code`, `/advanced` | coding | `/code Binary search in TypeScript` |
| `/max`, `/think`, `/deep` | reasoning | `/max Prove Bayes' theorem` |
| `/creative` | creative | `/creative Haiku about debugging` |

Prefixes are stripped before forwarding — the LLM never sees them.

---

## API Reference

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/chat/completions` | POST | OpenAI-compatible chat endpoint |
| `/v1/models` | GET | List configured models |
| `/health` | GET | Health check + uptime + stats |
| `/stats` | GET | Detailed request statistics |
| `/config` | GET | Current config (secrets redacted) |
| `/reload-config` | POST | Hot-reload config + auth |
| `/dashboard` | GET | Web monitoring dashboard |

---

## Comparison

| Feature | TierFlow | LiteLLM | OpenRouter | Portkey |
|---------|----------|---------|------------|---------|
| Self-hosted | Yes | Yes | No (SaaS) | No (SaaS) |
| ML-powered routing | Yes (8 categories) | No | No | No |
| Prompt injection detection | Built-in (252 patterns, 9 languages) | No | No | No |
| PII scrubbing | Built-in (15 patterns) | No | No | No |
| Context compression | Built-in (30-70% savings) | No | No | No |
| Zero dependencies | Yes | No (200+) | N/A | N/A |
| Your API keys | Yes | Yes | Pooled | Pooled |
| Cost | Free (MIT) | Free (MIT) | Markup on usage | Markup on usage |
| Response caching | Built-in LRU | Redis/in-memory | No | No |
| Web dashboard | Built-in | Separate | Web app | Web app |

<details>
<summary><strong>Why TierFlow instead of LiteLLM?</strong></summary>

LiteLLM is a mature, full-featured proxy with 100+ provider integrations and a large community. If you need broad provider support and don't mind the dependency footprint, it's a great choice.

TierFlow takes a different approach:

- **Smart routing** — TierFlow classifies every request and routes to the cheapest capable model automatically. LiteLLM routes to whichever model you specify.
- **Zero dependencies** — TierFlow is ~2MB with zero npm dependencies. LiteLLM installs 200+ Python packages.
- **Built-in PII scrubbing** — auto-redact sensitive data before it leaves your infrastructure. Not available in LiteLLM.
- **Context compression** — 30-70% token savings on verbose prompts. Not available in LiteLLM.

**Choose LiteLLM if:** you need 100+ provider integrations, Python ecosystem, or team management features.

**Choose TierFlow if:** you want automatic cost optimization, PII protection, and a lightweight self-hosted router with zero dependencies.

</details>

---

## Architecture

```
tierflow/
├── src/
│   ├── server.ts          # HTTP server, routing, stats
│   ├── provider.ts        # Multi-provider forwarding + SSE translation
│   ├── config.ts          # Config loader + types
│   ├── auth.ts            # API key management (env, file, keychain)
│   ├── cli.ts             # CLI entry point
│   ├── dashboard.ts       # Built-in web dashboard
│   ├── router/            # ML classifier + 14-dimension fallback scorer
│   ├── pii/               # AES-256-GCM vault + type-preserving scrubber
│   ├── compress/          # 6-pass context compression (CtxPack)
│   └── cache/             # LRU response cache with TTL
├── test/                  # Unit + integration tests
├── bench/                 # Benchmark suite (100 prompts)
├── Dockerfile             # Multi-stage build
└── docker-compose.yml     # Router + ML classifier stack
```

---

## Security Considerations

- **Localhost by default** — binds to `127.0.0.1`, not `0.0.0.0`
- **No auth on management endpoints** — `/reload-config`, `/stats`, `/config` are unauthenticated. This is safe on localhost but if you expose TierFlow on a network, place it behind a reverse proxy with authentication.
- **PII is memory-only** — the encryption vault is never written to disk
- **API keys stay local** — TierFlow reads your keys from environment variables and forwards them directly to providers. Keys are never logged, cached, or stored.

For responsible disclosure of security issues, see [SECURITY.md](SECURITY.md).

---

## Used in Production

TierFlow powers the routing layer of [OpenClaw](https://github.com/frdaniel76/openclaw), a self-hosted AI agent platform running 24/7 on consumer hardware. Every request — WhatsApp messages, calendar commands, coding tasks — is classified and routed through TierFlow before reaching any LLM provider.

**Real-world results on a MacBook Pro M2 server:**
- [99% cost reduction](docs/live-benchmarks.md) — 20 real API calls cost $0.003 instead of $0.27 on Claude Opus
- Projected savings: **~$406/month** at 1,000 requests/day
- Simple queries routed to Gemini Flash Lite ($0.00001/req), reasoning to GPT-OSS/DeepSeek
- PII scrubbed from all requests sent to external providers

---

## Credits

Routing engine originally forked from [BlockRunAI/ClawRouter](https://github.com/BlockRunAI/ClawRouter) (MIT License). The 14-dimension keyword scorer is preserved and extended. Credit to BlockRunAI for the original classifier design.

Security scanning patterns from [Claw Sentinel](https://github.com/Oleglegegg) by oleglegegg (MIT License). 252 patterns covering prompt injection (9 languages), data exfiltration, command injection, and secret leakage.

**Built on top:** ML-powered 8-category routing, security scanner, PII scrubbing, CtxPack compression, response caching, agentic detection, web dashboard, CLI, and Docker support.

## License

[MIT](LICENSE)
