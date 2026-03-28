# Contributing to TierFlow

Thanks for your interest! Here's how to get started.

## Development Setup

```bash
git clone https://github.com/frdaniel76/tierflow.git
cd tierflow
npm install
npm run dev          # start with tsx (hot reload)
npm test             # run unit + integration tests
npm run typecheck    # TypeScript check
npm run lint         # ESLint
```

## Project Structure

- `src/` — TypeScript source (server, router, PII, cache, compress, dashboard, CLI)
- `test/unit/` — Unit tests (node:test)
- `test/integration/` — Integration tests with mock ML server
- `bench/` — Benchmark suite
- `docs/` — Documentation

## Pull Request Guidelines

1. Fork the repo and create a branch from `main`
2. Add tests for new features
3. Run `npm test` and `npm run typecheck` — both must pass
4. Keep PRs focused — one feature or fix per PR
5. Update docs if behavior changes

## Code Style

- TypeScript strict mode
- Zero runtime dependencies (Node.js built-ins only)
- Prettier for formatting (`npm run format`)
- ESLint for linting (`npm run lint`)

## Running Tests

```bash
npm test                  # unit + integration
npm run test:all          # everything
npm run bench             # benchmark (rule-based)
npm run bench:ml          # benchmark (requires ML classifier on :18801)
```

## Reporting Issues

Use GitHub Issues. Include:
- TierFlow version (`npx tierflow --version`)
- Node.js version (`node --version`)
- Steps to reproduce
- Expected vs actual behavior
