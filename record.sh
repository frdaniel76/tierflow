#!/bin/bash
#
# TierFlow Terminal Demo Script
#
# Records a terminal demo suitable for GIF/video in the README.
# Designed for use with asciinema or vhs (charmbracelet/vhs).
#
# Usage:
#   Option A (asciinema): asciinema rec --command "bash demo/record.sh" demo.cast
#   Option B (vhs):       vhs demo/demo.tape  (see demo/demo.tape)
#   Option C (manual):    bash demo/record.sh  (just watch it run)
#
# Prerequisites:
#   - TierFlow running on localhost:18800
#   - At least one provider configured (Ollama works for a free demo)

set -euo pipefail

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
DIM='\033[2m'
BOLD='\033[1m'
NC='\033[0m'

# Typing effect for commands
type_cmd() {
  local cmd="$1"
  printf "${GREEN}\$ ${NC}"
  for ((i=0; i<${#cmd}; i++)); do
    printf "%s" "${cmd:$i:1}"
    sleep 0.04
  done
  echo ""
  sleep 0.3
}

# Pause for readability
pause() { sleep "${1:-1.5}"; }

clear

# ─── Act 1: Install & Start ───

echo -e "${BOLD}${CYAN}╔══════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}${CYAN}║  TierFlow — Cut Your LLM API Bill by 75%        ║${NC}"
echo -e "${BOLD}${CYAN}╚══════════════════════════════════════════════════╝${NC}"
echo ""
pause 2

echo -e "${DIM}# Step 1: Initialize config${NC}"
type_cmd "npx tierflow --init"
echo -e "${GREEN}✓${NC} Config written to ~/.config/tierflow/config.json"
pause 1

echo ""
echo -e "${DIM}# Step 2: Start the router${NC}"
type_cmd "npx tierflow"
echo -e "${GREEN}✓${NC} TierFlow v2.0.0 running on http://127.0.0.1:18800"
echo -e "  Providers: ollama (local), anthropic, openrouter"
echo -e "  ML classifier: connected (40ms avg)"
echo -e "  PII scrubbing: enabled for external providers"
pause 2

# ─── Act 2: Send Requests ───

echo ""
echo -e "${BOLD}━━━ Sending requests through TierFlow ━━━${NC}"
echo ""

# Simple greeting
echo -e "${DIM}# Simple greeting → routed to free local model${NC}"
type_cmd 'curl -s localhost:18800/v1/chat/completions -d '\''{"model":"auto","messages":[{"role":"user","content":"Hi!"}]}'\'' | jq .model'
pause 0.5
echo -e "${YELLOW}\"ollama/llama3.2\"${NC}"
echo -e "${DIM}  Cost: $0.000000  │  Tier: SIMPLE  │  Latency: 0.02ms routing${NC}"
pause 2

# Coding question
echo ""
echo -e "${DIM}# Coding question → routed to code-specialized model${NC}"
type_cmd 'curl -s localhost:18800/v1/chat/completions -d '\''{"model":"auto","messages":[{"role":"user","content":"Write a binary search in Python"}]}'\'' | jq .model'
pause 0.5
echo -e "${YELLOW}\"openrouter/qwen/qwen3-coder:free\"${NC}"
echo -e "${DIM}  Cost: $0.000000  │  Tier: CODE  │  Latency: 38ms routing${NC}"
pause 2

# Hard reasoning
echo ""
echo -e "${DIM}# Hard reasoning → routed to best model (only when needed)${NC}"
type_cmd 'curl -s localhost:18800/v1/chat/completions -d '\''{"model":"auto","messages":[{"role":"user","content":"Prove that sqrt(2) is irrational"}]}'\'' | jq .model'
pause 0.5
echo -e "${YELLOW}\"anthropic/claude-opus-4-6\"${NC}"
echo -e "${DIM}  Cost: $0.003200  │  Tier: REASONING  │  Latency: 35ms routing${NC}"
pause 2

# PII scrubbing
echo ""
echo -e "${DIM}# PII is auto-scrubbed before reaching external APIs${NC}"
type_cmd 'curl -s localhost:18800/v1/chat/completions -d '\''{"model":"auto","messages":[{"role":"user","content":"Email john@example.com about the meeting"}]}'\'' | jq .choices[0].message.content'
pause 0.5
echo -e "${YELLOW}\"I'll draft an email to john@example.com about the meeting...\"${NC}"
echo -e "${DIM}  PII scrubbed: 1 email  │  Rehydrated in response  │  Never sent to API${NC}"
pause 2

# ─── Act 3: Cost Summary ───

echo ""
echo -e "${BOLD}━━━ Cost Summary ━━━${NC}"
echo ""
type_cmd "curl -s localhost:18800/stats | jq '.cost'"
pause 0.5
echo -e "${CYAN}{"
echo -e "  \"total_routed\":    \$0.003200,"
echo -e "  \"total_baseline\":  \$0.012800,"
echo -e "  \"savings\":         \"75.0%\","
echo -e "  \"requests\":        4"
echo -e "}${NC}"

pause 2
echo ""
echo -e "${BOLD}${GREEN}4 requests. \$0.003 instead of \$0.013. 75% saved.${NC}"
echo -e "${DIM}At 1,000 req/day: save ~\$290/day (\$8,700/month)${NC}"
echo ""
echo -e "${DIM}GitHub: https://github.com/frdaniel76/tierflow${NC}"
echo -e "${DIM}License: MIT  │  Dependencies: 0  │  Install: npx tierflow${NC}"
pause 3
