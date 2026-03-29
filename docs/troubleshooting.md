# Troubleshooting

## Quick Checklist

```bash
# 1. Check server is running
curl http://localhost:18800/health

# 2. Validate config + API keys
npx tierflow --check

# 3. Check ML classifier status (built into TierFlow)
curl http://localhost:18800/health | jq '.mlClassifier'

# 4. View current config (secrets redacted)
curl http://localhost:18800/config

# 5. Check stats
curl http://localhost:18800/stats
```

## Common Issues

### "Unsupported provider: xxx"

The model ID format is `provider/model-name`. The `provider` part must match a key in your `providers` config.

```json
"providers": {
  "openrouter": { "baseUrl": "https://openrouter.ai/api/v1", ... }
}
```

Model ID: `openrouter/google/gemini-2.5-flash-lite` → looks up `openrouter` provider.

### ML classifier unavailable

TierFlow uses a local ONNX classifier (KNN + MiniLM-L6-v2) built into the process. If this fails to load, it falls back to the 14-dimension keyword scorer. Check the health endpoint to verify:

```bash
curl http://localhost:18800/health | jq '.mlClassifier'
# Should show: { "available": true, "method": "local-onnx-knn" }
```

### API key not found

Check your auth config matches your env vars:

```json
"auth": { "type": "env", "key": "ANTHROPIC_API_KEY" }
```

Then: `export ANTHROPIC_API_KEY=sk-ant-...`

For local providers (Ollama), use `"auth": { "type": "none" }`.

### Port already in use

```bash
# Check what's using port 18800
lsof -i :18800

# Use a different port
npx tierflow --port 18900
# or set TIERFLOW_PORT=18900
```

### Config not loading

Check the search order:

1. `TIERFLOW_CONFIG` env var (explicit path)
2. `./tierflow.config.json` (current directory)
3. `~/.config/tierflow/config.json`

Verify: `curl http://localhost:18800/config` shows which config path was loaded.

### Timeout errors

Increase per-tier timeouts in your config or check upstream provider health:

```json
"categories": {
  "reasoning": { "primary": "...", "fallback": [...], "timeout": 180000 }
}
```

Default timeouts: SIMPLE 30s, MEDIUM 60s, COMPLEX/REASONING 120s.

### PII scrubbing issues

- **Placeholders in response:** Check rehydration is working. Look for `X-PII-Warning` header.
- **False positives:** Exclude specific categories: `"pii": { "enabled": true, "exclude": ["postcode", "phone"] }`
- **Debug mode:** `"pii": { "enabled": true, "debug_log_scrubbed": true }` logs scrubbed payloads.

### Cache not working

Verify cache is enabled:

```json
"cache": { "enabled": true, "ttl_seconds": 300, "max_entries": 5000 }
```

Cache skips: streaming requests, tool call requests (by default). Check `X-Cache: HIT/MISS` header.

## Logs

TierFlow logs to stdout. Each routed request shows:

```
[N] Classified: tier=SIMPLE category=simple_chat model=openrouter/google/gemini-2.5-flash-lite confidence=0.98 | ml: simple_chat (conf=0.98, 35ms)
```

Enable debug logging: `npx tierflow --debug` or pass `--debug` flag.

## Getting Help

- GitHub Issues: report bugs or request features
- `curl http://localhost:18800/health` — version, uptime, stats
- `curl http://localhost:18800/stats` — detailed request breakdown
