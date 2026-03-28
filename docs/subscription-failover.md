# Failover & Fallback Chains

How FreeRouter handles provider failures and model fallbacks.

## How Fallback Works

Each tier/category config has a `primary` model and an ordered `fallback` array:

```json
"coding": {
  "primary": "openrouter/qwen/qwen3-coder:free",
  "fallback": ["openrouter/mistralai/devstral-2512", "anthropic/claude-sonnet-4-5"],
  "timeout": 120000
}
```

When the primary model fails (error or timeout), FreeRouter automatically tries the next model in the fallback chain.

## Fallback Flow

```
Request → Primary Model
            ├── Success → Return response
            ├── Timeout → Try fallback[0]
            │               ├── Success → Return response
            │               └── Error → Try fallback[1]
            │                             └── ...
            └── Error → Try fallback[0]
                          └── ...
```

**Stops when:**
- A model succeeds
- All models exhausted (returns error to client)
- Streaming already started (`res.headersSent`) — can't switch mid-stream

## Timeout Configuration

Per-tier defaults (in milliseconds):

| Tier | Default Timeout |
|------|----------------|
| SIMPLE | 30,000 (30s) |
| MEDIUM | 60,000 (60s) |
| COMPLEX | 120,000 (120s) |
| REASONING | 120,000 (120s) |

Per-category override:
```json
"reasoning": {
  "primary": "anthropic/claude-opus-4-6",
  "fallback": ["openrouter/deepseek/deepseek-r1"],
  "timeout": 180000
}
```

## Multi-Provider Fallback

Fallback models can be from different providers:

```json
"complex": {
  "primary": "anthropic/claude-sonnet-4-5",
  "fallback": ["openrouter/deepseek/deepseek-v3.2", "ollama/llama3.2"]
}
```

This provides resilience: if Anthropic is down, falls back to OpenRouter, then to local Ollama.

## Agentic Fallback

When tools are present, FreeRouter uses `agenticTiers` instead of `tiers` (if configured). This ensures tool-capable models are used even in fallback:

```json
"agenticTiers": {
  "SIMPLE": { "primary": "openrouter/deepseek/deepseek-v3.2", "fallback": [] },
  "COMPLEX": { "primary": "anthropic/claude-sonnet-4-5", "fallback": [] }
}
```

## Monitoring Fallbacks

Check `/stats` for timeout and error counts:

```bash
curl http://localhost:18800/stats | jq '{timeouts, errors, byModel}'
```

The dashboard at `/dashboard` also shows error rates and model usage distribution.

## Designing Good Fallback Chains

1. **Primary:** Best model for the category (quality-first)
2. **Fallback 1:** Different provider, similar quality (resilience)
3. **Fallback 2:** Cheaper/local model (availability guarantee)

Example:
```json
"coding": {
  "primary": "anthropic/claude-sonnet-4-5",
  "fallback": ["openrouter/qwen/qwen3-coder:free", "ollama/codellama"]
}
```
