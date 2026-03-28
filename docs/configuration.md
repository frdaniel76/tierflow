# Configuration Reference

Complete reference for FreeRouter configuration.

## Config File Location

Search order:
1. `FREEROUTER_CONFIG` environment variable
2. `./freerouter.config.json` (working directory)
3. `~/.config/freerouter/config.json`

Generate a template: `npx freerouter --init`

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `FREEROUTER_CONFIG` | — | Path to config file |
| `CLAWROUTER_PORT` | 18800 | Override port |
| `CLAWROUTER_HOST` | 127.0.0.1 | Override bind host |
| `LLMROUTER_URL` | — | Override ML classifier URL (for Docker) |
| `ANTHROPIC_API_KEY` | — | API key (when using `auth.type: "env"`) |
| `OPENROUTER_API_KEY` | — | API key (when using `auth.type: "env"`) |

## Full Config Schema

```typescript
{
  port: number;                              // default: 18800
  host: string;                              // default: "127.0.0.1"

  providers: Record<string, {
    baseUrl: string;                         // API base URL
    api: "anthropic" | "openai";             // API format
    headers?: Record<string, string>;        // extra HTTP headers
    auth?: {
      type: "env" | "openclaw" | "file" | "keychain" | "none";
      key?: string;                          // env var name (for type=env)
      profilesPath?: string;                 // for type=openclaw
      filePath?: string;                     // for type=file
      service?: string;                      // for type=keychain
      account?: string;                      // for type=keychain
    };
    pii?: boolean | {                        // PII scrubbing (default: false)
      enabled: boolean;
      mode?: "strict" | "standard";          // default: "strict" (fail-closed)
      exclude?: string[];                    // categories to skip
      scrub_system?: boolean;                // scrub system messages (default: false)
      debug_log_scrubbed?: boolean;          // log scrubbed payload
    };
    compress?: boolean | {                   // CtxPack compression (default: false)
      enabled: boolean;
      passes?: string[];                     // subset of: ansi, whitespace, json, dedup, comments, verbose
      compress_system?: boolean;             // compress system messages (default: false)
    };
    timeout_ms?: number;                     // per-provider timeout override
    models?: string[];                       // model hints for /v1/models
    disabled?: boolean;                      // soft-disable without deleting
  }>;

  categories?: Record<string, {              // v2: ML-powered category routing
    primary: string;                         // "provider/model-name"
    fallback: string[];                      // ordered fallback models
    timeout?: number;                        // ms
  }>;

  mlClassifier?: {                           // ML classifier service config
    url: string;                             // "http://127.0.0.1:18801/classify"
    timeout_ms: number;                      // max wait (default: 500)
    fallback_category: string;               // when ML is down (default: "general")
  };

  tiers: Record<string, {                   // legacy tier-based routing
    primary: string;
    fallback: string[];
  }>;

  agenticTiers?: Record<string, {           // separate tiers when tools are present
    primary: string;
    fallback: string[];
  }>;

  modeOverrides?: Record<string, string>;   // alias → category mapping

  tierBoundaries?: {                         // keyword scorer thresholds
    simpleMedium: number;
    mediumComplex: number;
    complexReasoning: number;
  };

  cache?: {                                  // response cache
    enabled: boolean;
    ttl_seconds?: number;                    // default: 300 (5 min)
    max_entries?: number;                    // default: 5000
    exclude_streaming?: boolean;             // default: true
    exclude_tools?: boolean;                 // default: true
  };

  thinking?: {                               // thinking/reasoning config
    adaptive?: string[];                     // models that get adaptive thinking
    enabled?: { models: string[]; budget: number };
  };

  auth: {                                    // global auth config
    default: string;                         // default auth strategy name
    [strategy: string]: unknown;             // strategy configs
  };
}
```

## Auth Types

| Type | Usage | Example |
|------|-------|---------|
| `"env"` | Read from environment variable | `{ "type": "env", "key": "ANTHROPIC_API_KEY" }` |
| `"none"` | No auth (Ollama, LM Studio) | `{ "type": "none" }` |
| `"openclaw"` | Read from OpenClaw auth-profiles.json | `{ "type": "openclaw" }` |
| `"file"` | Read key from file | `{ "type": "file", "filePath": "/path/to/key" }` |
| `"keychain"` | macOS Keychain | `{ "type": "keychain", "service": "freerouter", "account": "anthropic" }` |

## Hot Reload

```bash
curl -X POST http://localhost:18800/reload-config
```

Reloads config file + auth keys + reinitializes cache. No restart needed.

## Testing Config

```bash
npx freerouter --check    # validate config, check API keys, ping ML service
```
