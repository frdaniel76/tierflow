# Docker Setup

Run the full FreeRouter stack (router + ML classifier) with Docker Compose.

## Quick Start

```bash
# Clone both repos
git clone <freerouter-repo> freerouter
git clone <llmrouter-service-repo> llmrouter-service

# Start everything
cd freerouter
docker compose up -d

# Check status
docker compose ps
docker compose logs -f
```

FreeRouter will be available at `http://localhost:18800`.

## Architecture

```
                   docker network
┌──────────────┐      ┌────────────────┐
│  freerouter  │─────▶│  llmrouter     │
│  :18800      │      │  :18801        │
│  (Node.js)   │      │  (Python)      │
└──────────────┘      └────────────────┘
```

- **freerouter** waits for llmrouter to be healthy before starting
- They communicate via `http://llmrouter:18801/classify` (Docker DNS)
- Both bind to `127.0.0.1` on the host (localhost only)

## Configuration

### API Keys

Pass API keys as environment variables:

```bash
# Option 1: .env file
echo "ANTHROPIC_API_KEY=sk-ant-..." > .env
docker compose up -d

# Option 2: inline
ANTHROPIC_API_KEY=sk-ant-... docker compose up -d
```

### Custom Config

Mount your config file:

```bash
# Default: mounts ./freerouter.config.json
docker compose up -d

# Custom path:
FREEROUTER_CONFIG=/path/to/config.json docker compose up -d
```

### Without ML Classifier

If you only want the router (rule-based routing):

```bash
docker compose up freerouter -d
```

FreeRouter falls back to the 14-dimension keyword scorer when the ML classifier is unavailable.

## Image Sizes

| Image | Size | Why |
|-------|------|-----|
| freerouter | ~180MB | Node.js slim + built JS |
| freerouter-llmrouter | ~600MB | Python + sentence-transformers model (80MB) baked in |

The ML model is baked into the image to avoid downloading at runtime.

## Health Checks

```bash
# Router health
curl http://localhost:18800/health

# ML classifier health
curl http://localhost:18801/health

# Dashboard
open http://localhost:18800/dashboard
```

## Rebuilding

```bash
docker compose build --no-cache
docker compose up -d
```
