#!/bin/bash
# FreeRouter startup script — loads nvm + Keychain secrets

# Load nvm
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

# Load API keys
export OPENROUTER_API_KEY="$(cat /Users/medme/.openclaw/secrets/openrouter-api-key 2>/dev/null | tr -d '\n')"
export OLLAMA_API_KEY="ollama"

# Run FreeRouter
cd /Users/medme/Projects/freerouter
exec node dist/server.js
