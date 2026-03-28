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

# Load .env file if present
cd "$(dirname "$0")"
if [ -f .env ]; then
  set -a
  source .env
  set +a
fi

# Run TierFlow
exec node dist/server.js
