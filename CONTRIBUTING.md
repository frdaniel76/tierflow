# Contributing to TierFlow

Thanks for your interest in TierFlow! We welcome contributions of all sizes.

## Getting Started

```bash
git clone https://github.com/frdaniel76/tierflow.git
cd tierflow
npm install
npm run dev          # start with tsx (auto-reload on changes)
```

## Development Commands

| Command | What it does |
|---------|-------------|
| `npm run dev` | Start dev server with hot reload |
| `npm test` | Run unit + integration tests |
| `npm run typecheck` | TypeScript type checking |
| `npm run lint` | ESLint |
| `npm run format` | Prettier formatting |
| `npm run bench` | Run benchmark suite (100 prompts) |

## Project Layout

```
src/
├── server.ts        # HTTP server + request routing
├── provider.ts      # Multi-provider forwarding + SSE
├── config.ts        # Config loader + types
├── auth.ts          # API key management
├── router/          # ML classifier + rule-based scorer
├── pii/             # PII detection + AES-256-GCM vault
├── compress/        # CtxPack 6-pass compression
└── cache/           # LRU response cache
test/
├── unit/            # Fast unit tests (node:test)
├── integration/     # Tests with mock ML server
└── *.test.ts        # Feature-level integration tests
```

## Pull Request Guidelines

1. **Fork** the repo and create a branch from `main`
2. **Add tests** for new features — we use `node:test` (no test framework dependencies)
3. **Run checks** — `npm test && npm run typecheck` must both pass
4. **One PR, one thing** — keep PRs focused on a single feature or fix
5. **Update docs** if you change behavior or add config options
6. **Zero dependencies** — TierFlow uses only Node.js built-ins. Don't add npm dependencies.

## Architecture Principles

- **Zero runtime dependencies** — everything uses `node:*` built-ins
- **Config-driven** — behavior should be configurable via JSON, not hardcoded
- **Provider-agnostic** — no provider-specific logic outside of `provider.ts`
- **Opt-in features** — PII, compression, caching are all disabled by default with zero overhead

## Reporting Issues

[Open an issue](https://github.com/frdaniel76/tierflow/issues) with:

- TierFlow version (`npx tierflow --version`)
- Node.js version (`node --version`)
- Steps to reproduce
- Expected vs actual behavior
- Relevant config (redact API keys)

## Code of Conduct

Please read our [Code of Conduct](CODE_OF_CONDUCT.md). Be respectful — we're building useful software together.
