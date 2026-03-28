# Provider Cookbook

TierFlow supports any **OpenAI-compatible** API out of the box via config. No code changes needed.

## How It Works

Add a provider to `tierflow.config.json` under `providers`, then reference it in your `tiers` or `categories`:

```json
{
  "providers": {
    "groq": {
      "baseUrl": "https://api.groq.com/openai",
      "api": "openai",
      "auth": { "type": "env", "key": "GROQ_API_KEY" }
    }
  },
  "tiers": {
    "SIMPLE": { "primary": "groq/llama-3.1-8b-instant", "fallback": [] }
  }
}
```

## Provider Examples

### Groq

```json
"groq": {
  "baseUrl": "https://api.groq.com/openai",
  "api": "openai",
  "auth": { "type": "env", "key": "GROQ_API_KEY" }
}
```

Models: `groq/llama-3.3-70b-versatile`, `groq/llama-3.1-8b-instant`, `groq/mixtral-8x7b-32768`

### Together AI

```json
"together": {
  "baseUrl": "https://api.together.xyz",
  "api": "openai",
  "auth": { "type": "env", "key": "TOGETHER_API_KEY" }
}
```

Models: `together/meta-llama/Llama-3.3-70B-Instruct-Turbo`, `together/Qwen/Qwen2.5-72B-Instruct-Turbo`

### Mistral

```json
"mistral": {
  "baseUrl": "https://api.mistral.ai",
  "api": "openai",
  "auth": { "type": "env", "key": "MISTRAL_API_KEY" }
}
```

Models: `mistral/mistral-large-latest`, `mistral/mistral-small-latest`

### DeepSeek

```json
"deepseek": {
  "baseUrl": "https://api.deepseek.com",
  "api": "openai",
  "auth": { "type": "env", "key": "DEEPSEEK_API_KEY" }
}
```

Models: `deepseek/deepseek-chat`, `deepseek/deepseek-reasoner`

### Perplexity

```json
"perplexity": {
  "baseUrl": "https://api.perplexity.ai",
  "api": "openai",
  "auth": { "type": "env", "key": "PERPLEXITY_API_KEY" }
}
```

Models: `perplexity/sonar`, `perplexity/sonar-pro`

### Fireworks

```json
"fireworks": {
  "baseUrl": "https://api.fireworks.ai/inference",
  "api": "openai",
  "auth": { "type": "env", "key": "FIREWORKS_API_KEY" }
}
```

Models: `fireworks/accounts/fireworks/models/llama-v3p3-70b-instruct`

### Ollama (Local)

```json
"ollama": {
  "baseUrl": "http://localhost:11434",
  "api": "openai",
  "auth": { "type": "none" }
}
```

Models: `ollama/llama3.2`, `ollama/codellama`, `ollama/mistral`

No API key needed. Auth type `"none"` skips authentication.

### LM Studio (Local)

```json
"lmstudio": {
  "baseUrl": "http://localhost:1234",
  "api": "openai",
  "auth": { "type": "none" }
}
```

Models: whatever you have loaded in LM Studio.

### OpenRouter

```json
"openrouter": {
  "baseUrl": "https://openrouter.ai/api/v1",
  "api": "openai",
  "auth": { "type": "env", "key": "OPENROUTER_API_KEY" },
  "pii": { "enabled": true }
}
```

Models: 300+ models — see [openrouter.ai/models](https://openrouter.ai/models)

### Anthropic (Native)

```json
"anthropic": {
  "baseUrl": "https://api.anthropic.com",
  "api": "anthropic",
  "auth": { "type": "env", "key": "ANTHROPIC_API_KEY" }
}
```

Models: `anthropic/claude-opus-4-6`, `anthropic/claude-sonnet-4-5`, `anthropic/claude-haiku-4-5`

Uses the native Anthropic Messages API (not OpenAI-compat).

## Provider Config Reference

| Field        | Type                        | Required | Description                           |
| ------------ | --------------------------- | -------- | ------------------------------------- |
| `baseUrl`    | string                      | Yes      | API base URL                          |
| `api`        | `"openai"` or `"anthropic"` | Yes      | API format                            |
| `auth`       | AuthConfig                  | No       | Authentication config                 |
| `headers`    | object                      | No       | Extra HTTP headers                    |
| `pii`        | boolean or PiiConfig        | No       | PII scrubbing (default: false)        |
| `compress`   | boolean or CompressConfig   | No       | CtxPack compression (default: false)  |
| `timeout_ms` | number                      | No       | Request timeout override              |
| `models`     | string[]                    | No       | Model hints for `/v1/models` endpoint |
| `disabled`   | boolean                     | No       | Soft-disable without deleting         |

## Auth Types

| Type         | Usage                                  | Example                                                            |
| ------------ | -------------------------------------- | ------------------------------------------------------------------ |
| `"env"`      | Read API key from environment variable | `{ "type": "env", "key": "GROQ_API_KEY" }`                         |
| `"none"`     | No authentication (local providers)    | `{ "type": "none" }`                                               |
| `"openclaw"` | Read from OpenClaw auth-profiles.json  | `{ "type": "openclaw" }`                                           |
| `"file"`     | Read key from a file                   | `{ "type": "file", "filePath": "/path/to/key" }`                   |
| `"keychain"` | macOS Keychain                         | `{ "type": "keychain", "service": "tierflow", "account": "groq" }` |

## Custom Headers

Some providers need extra headers (e.g., User-Agent):

```json
"kimi-coding": {
  "baseUrl": "https://api.kimi.com/coding/v1",
  "api": "openai",
  "headers": { "User-Agent": "KimiCLI/0.77" }
}
```

## Unsupported

Google Gemini uses a different API format (`/v1/models/{model}:generateContent`) and is not supported directly. Use it via OpenRouter or a Gemini-to-OpenAI proxy.
