#!/bin/bash
# TierFlow startup script — loads nvm + API keys from environment

# Load nvm
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

# Load API keys from environment or secrets file
# Set these in your shell profile or .env file:
#   export OPENROUTER_API_KEY="sk-or-..."
#   export ANTHROPIC_API_KEY="sk-ant-..."
#   export OLLAMA_API_KEY="ollama"

# Load secrets from ~/.env.keys (central secrets file)
[ -f "$HOME/.env.keys" ] && set -a && source "$HOME/.env.keys" && set +a

# Load project .env overrides if present
cd "$(dirname "$0")"
[ -f .env ] && set -a && source .env && set +a

# Run TierFlow
exec node dist/server.js
