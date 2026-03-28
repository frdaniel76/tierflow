# Windows Installation Guide

## Prerequisites

- **Node.js 20+** — download from [nodejs.org](https://nodejs.org/)
- **Git** — download from [git-scm.com](https://git-scm.com/)
- **Python 3.10+** (optional, for ML classifier) — download from [python.org](https://python.org/)

## Option A: npm (Recommended)

```powershell
# Install and run
npx tierflow --init
npx tierflow
```

## Option B: Clone & Build

```powershell
git clone https://github.com/frdaniel76/tierflow.git
cd tierflow
npm install
npm run build
npm start
```

## Option C: Docker

Requires Docker Desktop for Windows.

```powershell
docker compose up -d
```

## Configuration

Generate a config template:

```powershell
npx tierflow --init
# Creates: %USERPROFILE%\.config\tierflow\config.json
```

Set API keys:

```powershell
$env:ANTHROPIC_API_KEY = "sk-ant-..."
$env:OPENROUTER_API_KEY = "sk-or-..."
```

Or in `.env` file for Docker.

## ML Classifier (Optional)

For ML-powered routing, also start the LLMRouter service:

```powershell
cd llmrouter-service
pip install -r requirements.txt
python server.py
```

Without it, TierFlow uses the 14-dimension keyword scorer (still works, just less accurate).

## Verify

```powershell
# Health check
curl http://localhost:18800/health

# Dashboard
start http://localhost:18800/dashboard

# Validate setup
npx tierflow --check
```

## Firewall

TierFlow binds to `127.0.0.1` by default (localhost only). If you need network access, change `host` in config to `"0.0.0.0"` and allow port 18800 in Windows Firewall.
