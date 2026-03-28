# TierFlow Community Release Plan

**Created:** 2026-03-28
**Status:** All 8 phases implemented (2026-03-28)

## Overview

7 improvements to make TierFlow attractive for open-source community release. Positioned as: _"The privacy-first intelligent router for developers who own their API keys"_.

---

## Build Sequence

| Phase | Improvement                    | Effort | Impact          |
| ----- | ------------------------------ | ------ | --------------- |
| 1     | Foundation fixes (deps, build) | Small  | Prerequisite    |
| 2     | GitHub Actions CI (#3)         | Medium | Trust signal    |
| 3     | Web Dashboard (#5)             | Medium | High visibility |
| 4     | Provider Plugins (#6)          | Small  | Adoption        |
| 5     | Benchmarks (#2)                | Medium | Credibility     |
| 6     | Docker Compose (#1)            | Medium | Onboarding      |
| 7     | npm Package (#4)               | Medium | Distribution    |
| 8     | Demo Page (#7)                 | Medium | Marketing       |

---

## Phase 1: Foundation Fixes (Prerequisite)

- [ ] Add `eslint`, `prettier`, `tsup` to `package.json` devDependencies (referenced but missing)
- [ ] Fix `npm run build` to use `tsup` (aligns with `tsup.config.ts`)
- [ ] Reconcile `dist/src/server.js` (tsc) vs `dist/server.js` (tsup) paths
- [ ] Verify `npm run typecheck` passes

---

## Phase 2: GitHub Actions CI (Improvement #3)

**Goal:** Automated CI on every PR/push — typecheck, lint, build, unit + integration tests.

### Files

| File                              | Action  |
| --------------------------------- | ------- |
| `.github/workflows/ci.yml`        | Replace |
| `test/unit/router.test.ts`        | Create  |
| `test/unit/pii.test.ts`           | Create  |
| `test/unit/cache.test.ts`         | Create  |
| `test/unit/config.test.ts`        | Create  |
| `test/fixtures/mock-ml-server.ts` | Create  |
| `package.json`                    | Modify  |

### Design

- **Unit tests**: Pure function tests for `router/rules.ts`, `pii/vault.ts`, `cache/store.ts`, `config.ts` using `node:test`
- **Integration tests**: Start server + mock ML classifier (Node.js HTTP server returning canned responses), send requests, verify `X-TierFlow-*` headers
- **Mock ML server**: Minimal HTTP server at `test/fixtures/mock-ml-server.ts` — maps known prompts to categories, returns `{ category, confidence, latency_ms }`
- **CI matrix**: Node 20 + 22, lint/prettier only on 22

### Workflow

```yaml
jobs:
  check:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        node-version: ["20", "22"]
    steps:
      - Install deps (npm ci, cached)
      - Prettier + ESLint (node 22 only)
      - Typecheck
      - Build
      - Unit tests (npm test)
      - Integration tests (npm run test:integration)
```

### Package.json additions

```json
"test": "npx tsx --test test/unit/*.test.ts",
"test:integration": "npx tsx test/integration/router-integration.test.ts"
```

---

## Phase 3: Web Dashboard (Improvement #5)

**Goal:** Lightweight monitoring UI at `GET /dashboard` — vanilla HTML/JS, no build step, auto-refreshes every 5s.

### Files

| File                | Action             |
| ------------------- | ------------------ |
| `src/dashboard.ts`  | Create             |
| `src/server.ts`     | Modify (add route) |
| `docs/dashboard.md` | Create             |

### Design

Single HTML string returned by `getDashboardHTML()`. Polls `GET /stats` via `fetch()`.

**Sections:**

1. **Header bar**: Router name, uptime, version, ML classifier status
2. **Top stats** (4 cards): Total Requests, Cache Hit Rate, Total Cost ($X.XX), Uptime
3. **Tier distribution**: Horizontal CSS bar chart (SIMPLE/MEDIUM/COMPLEX/REASONING %)
4. **Category table**: Requests, Tokens, Cost, Avg Cost per category
5. **Model usage table**: Per-model request counts and cost
6. **Hourly activity chart**: CSS-only 24-bar chart from `tokenUsage.hourly`
7. **PII & Compression stats**: Scrubbed/rehydrated counts, tokens saved
8. **Cache stats**: Hits, misses, hit rate, current size

**Features:**

- Auto-refresh: 5s/10s/30s/off selector (persisted in localStorage)
- Dark mode via `prefers-color-scheme: dark`
- Mobile-responsive CSS Grid
- `/` redirects to `/dashboard`, `/health` stays at `/health`

**Security:** Stats only, no secrets. Router binds `127.0.0.1` by default = localhost-only.

---

## Phase 4: Provider Plugins (Improvement #6)

**Goal:** Adding a new provider = config entry only. No code, no rebuild.

### Files

| File                | Action                |
| ------------------- | --------------------- |
| `src/config.ts`     | Modify                |
| `src/auth.ts`       | Modify                |
| `src/server.ts`     | Modify (`/v1/models`) |
| `docs/providers.md` | Create                |

### Design

**Current state is already mostly config-driven.** The gaps:

1. **Add `"none"` auth type** — for Ollama/LM Studio (no API key needed)
2. **Extend `ProviderConfigEntry`**:
   ```typescript
   timeout_ms?: number;   // per-provider timeout override
   models?: string[];     // hint for /v1/models
   disabled?: boolean;    // soft-disable
   ```
3. **Make `/v1/models` config-driven** — enumerate from `tiers` + `categories` + `providers[].models` instead of hardcoded list
4. **Provider cookbook** (`docs/providers.md`) — copy-paste configs for: Groq, Together, Mistral, DeepSeek, Ollama, LM Studio, Perplexity, Fireworks

### Example: Adding Groq (zero code)

```json
"providers": {
  "groq": {
    "baseUrl": "https://api.groq.com/openai",
    "api": "openai",
    "auth": { "type": "env", "key": "GROQ_API_KEY" }
  }
},
"tiers": {
  "SIMPLE": { "primary": "groq/llama-3.1-8b-instant" }
}
```

---

## Phase 5: Benchmarks (Improvement #2)

**Goal:** Reproducible benchmark proving routing accuracy + cost savings — JSON + Markdown output.

### Files

| File                 | Action                  |
| -------------------- | ----------------------- |
| `bench/dataset.ts`   | Create                  |
| `bench/runner.ts`    | Create                  |
| `bench/report.ts`    | Create                  |
| `bench/README.md`    | Create                  |
| `docs/benchmarks.md` | Create (auto-generated) |
| `package.json`       | Modify                  |

### Design

**Tests routing decisions, not model responses.** No API calls, no spending money.

- **100 curated prompts** with ground-truth `expected_category` and `expected_tier`
- **3 comparison scenarios** per prompt: always-cheap, TierFlow-routed, always-best
- **Metrics**: category accuracy, tier accuracy, cost savings %, latency p50/p95

**Dataset structure:**

```typescript
{ id, prompt, expected_category, expected_tier, difficulty: "easy"|"medium"|"hard", tags }
```

**Output** (`docs/benchmarks.md`):

```
Category accuracy: 94%  |  Cost savings: 93.5%  |  Latency p50: 42ms
```

**Scripts:** `npm run bench` (rule-based), `npm run bench:ml` (requires ML service)

---

## Phase 6: Docker Compose (Improvement #1)

**Goal:** `docker compose up` starts TierFlow + LLMRouter ML classifier.

### Files

| File                                 | Action                              |
| ------------------------------------ | ----------------------------------- |
| `Dockerfile`                         | Create                              |
| `../llmrouter-service/Dockerfile`    | Create                              |
| `docker-compose.yml`                 | Create                              |
| `.dockerignore`                      | Create                              |
| `../llmrouter-service/.dockerignore` | Create                              |
| `src/server.ts`                      | Modify (LLMROUTER_URL env override) |
| `../llmrouter-service/server.py`     | Modify (LLMROUTER_HOST env)         |
| `docs/docker.md`                     | Create                              |

### Design

**LLMRouter Dockerfile:**

- `python:3.12-slim` base
- Bakes `all-MiniLM-L6-v2` model into image layer (~600MB total)
- Named volume for KNN joblib cache
- Health check on `/health`

**TierFlow Dockerfile:**

- Multi-stage: builder (`npm ci` + `npm run build`) + runtime (copy `dist/` only)
- `node:22-slim` base

**docker-compose.yml:**

- `llmrouter` service: builds `../llmrouter-service`, exposes 18801, health check
- `tierflow` service: depends on llmrouter (service_healthy), exposes 18800
- Config via bind mount (`~/.config/tierflow/`) or env vars
- `LLMROUTER_URL=http://llmrouter:18801/classify` overrides config

**server.ts addition:**

```typescript
if (process.env.LLMROUTER_URL && appConfig.mlClassifier) {
  appConfig.mlClassifier.url = process.env.LLMROUTER_URL;
}
```

---

## Phase 7: npm Package (Improvement #4)

**Goal:** `npx tierflow` downloads and runs with zero cloning.

### Files

| File           | Action                             |
| -------------- | ---------------------------------- |
| `src/cli.ts`   | Create (already in tsup.config.ts) |
| `package.json` | Modify                             |
| `.npmignore`   | Create                             |

### Design

**CLI flags:**

```
npx tierflow              # start with default config
npx tierflow --port 8080  # custom port
npx tierflow --init       # generate ~/.config/tierflow/config.json template
npx tierflow --check      # validate config + ML service connectivity
npx tierflow --version
```

**`--init` generates:**

```json
{
  "port": 18800,
  "providers": {
    "anthropic": { "baseUrl": "...", "api": "anthropic", "auth": { "type": "env", "key": "ANTHROPIC_API_KEY" } },
    "openai": { "baseUrl": "...", "api": "openai", "auth": { "type": "env", "key": "OPENAI_API_KEY" } }
  },
  "tiers": { "SIMPLE": { "primary": "openai/gpt-4o-mini" }, ... }
}
```

**package.json additions:**

```json
"bin": { "tierflow": "dist/cli.js" },
"files": ["dist/", "README.md", "LICENSE"],
"engines": { "node": ">=20.0.0" }
```

**Note:** ML classifier is optional. CLI prints: "For ML-powered routing, also run llmrouter-service. Without it, TierFlow uses rule-based routing."

---

## Phase 8: Demo Page (Improvement #7)

**Goal:** Static comparison page: "same prompt, 3 models, show cost difference."

### Files

| File                                | Action                |
| ----------------------------------- | --------------------- |
| `demo/index.html`                   | Create                |
| `demo/data.json`                    | Create (pre-recorded) |
| `demo/generate-demo-data.ts`        | Create                |
| `demo/style.css`                    | Create                |
| `.github/workflows/deploy-demo.yml` | Create                |

### Design

**Pre-recorded, not live** (no API keys exposed).

**Layout per prompt:**

```
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│  Always Cheap   │  │   TierFlow    │  │  Always Best    │
│  gpt-4o-mini    │  │  kimi-for-code  │  │  claude-opus    │
│  [response]     │  │  [response]     │  │  [response]     │
│  $0.00002       │  │  $0.0001        │  │  $0.0032        │
└─────────────────┘  └─────────────────┘  └─────────────────┘
Savings: 96.9% cheaper
```

**8-10 prompts** covering: greeting, creative, code, reasoning, agentic, data, mixed signals.

**`generate-demo-data.ts`**: Run locally with real API keys, calls 3 models per prompt, saves to `data.json`.

**Deployment:** GitHub Pages via `peaceiris/actions-gh-pages@v4`, triggered on changes to `demo/`.

**Design:** Vanilla HTML/CSS, dark mode, mobile-responsive. Dropdown prompt selector, aggregate stats footer.

---

## Key Decisions

| Decision              | Choice                    | Why                                             |
| --------------------- | ------------------------- | ----------------------------------------------- |
| Test framework        | `node:test` (built-in)    | Zero deps, aligns with project philosophy       |
| Dashboard tech        | Inline HTML string        | No build step, no framework, zero deps          |
| Docker model strategy | Bake into image layer     | Bigger image (~600MB) but zero runtime download |
| Benchmark scope       | Routing decisions only    | No API calls needed, reproducible, free         |
| Demo data             | Pre-recorded              | Can't expose API keys publicly                  |
| Build tool            | tsup (already configured) | Handles CLI + library entry points              |

## Risks

| Risk                                   | Mitigation                                                             |
| -------------------------------------- | ---------------------------------------------------------------------- |
| Image size (600MB) for Docker          | Document volume-based alternative for size-sensitive users             |
| Stats reset on restart                 | Display "since restart" in dashboard, document limitation              |
| Stale demo data                        | Timestamp in data.json, regenerate quarterly                           |
| Existing tests reference deleted files | New tests in `test/unit/` and `test/integration/`, don't run old tests |
| Google Gemini API incompatible         | Document as unsupported, use OpenAI-compat providers                   |
