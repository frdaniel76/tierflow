#!/usr/bin/env npx tsx
/**
 * Demo Data Generator
 *
 * Generates pre-recorded comparison data for the demo page.
 * Requires real API keys and a running TierFlow instance.
 *
 * Usage:
 *   npm run demo:generate
 *
 * This script:
 * 1. Sends each prompt through TierFlow to get routing decisions
 * 2. Calls 3 models directly (cheapest, routed, best) for responses
 * 3. Saves results to demo/data.json
 *
 * NOTE: This costs real money for API calls. Run sparingly.
 */

console.log(`
  Demo Data Generator

  This script calls real LLM APIs to generate comparison data.
  It requires:
    - A running TierFlow instance at :18800
    - API keys for Anthropic, OpenAI (or configured providers)

  For now, demo/data.json ships with pre-recorded results.
  Edit demo/data.json manually to update prompts or responses.

  To implement live generation:
    1. Define test prompts
    2. For each prompt, call TierFlow /v1/chat/completions
    3. Also call cheapest + best model directly
    4. Record responses, costs, latencies
    5. Write to demo/data.json
`);

process.exit(0);
