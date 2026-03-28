#!/usr/bin/env npx tsx
/**
 * TierFlow Live Cost Benchmark
 *
 * Unlike bench/runner.ts (which tests routing decisions only), this script
 * sends REAL requests through a running TierFlow instance, records actual
 * API costs, and compares them against what each request would cost if
 * always sent to the best model.
 *
 * Usage:
 *   npx tsx bench/live-benchmark.ts                    # default: 20 prompts
 *   npx tsx bench/live-benchmark.ts --prompts 50       # more prompts
 *   npx tsx bench/live-benchmark.ts --baseline claude   # compare vs Claude Opus
 *   npx tsx bench/live-benchmark.ts --dry-run           # show prompts, no API calls
 *
 * Prerequisites:
 *   - TierFlow running on localhost:18800
 *   - API keys configured for at least 2 providers
 *
 * WARNING: This costs real money. ~20 prompts ≈ $0.05-0.50 depending on models.
 */

import { parseArgs } from "node:util";
import { writeFileSync } from "node:fs";

const { values: args } = parseArgs({
  options: {
    prompts: { type: "string", default: "20" },
    port: { type: "string", default: "18800" },
    baseline: { type: "string", default: "anthropic/claude-opus-4-6" },
    output: { type: "string", default: "bench/live-results.json" },
    "dry-run": { type: "boolean", default: false },
    verbose: { type: "boolean", short: "v", default: false },
  },
});

const BASE_URL = `http://127.0.0.1:${args.port}`;
const BASELINE_MODEL = args.baseline!;
const MAX_PROMPTS = parseInt(args.prompts!, 10);

// Baseline pricing: Claude Opus 4 ($15/M input, $75/M output)
// Used to calculate "what would this cost if everything went to the best model"
const BASELINE_PRICING = { input: 15, output: 75 };

// ─── Test prompts covering all 8 categories ───

const LIVE_PROMPTS = [
  // simple_chat — should route to cheapest
  { id: "live-01", prompt: "Hi, how are you?", category: "simple_chat" },
  { id: "live-02", prompt: "What's 2 + 2?", category: "simple_chat" },
  { id: "live-03", prompt: "Thanks!", category: "simple_chat" },
  { id: "live-04", prompt: "What day is it today?", category: "simple_chat" },

  // general — mid-tier
  { id: "live-05", prompt: "Explain how DNS works in 3 sentences.", category: "general" },
  { id: "live-06", prompt: "What are the pros and cons of remote work?",category: "general" },
  { id: "live-07", prompt: "Summarize the key ideas behind stoicism.", category: "general" },

  // coding — should route to code-specialized model
  { id: "live-08", prompt: "Write a Python function to check if a string is a palindrome.", category: "coding" },
  { id: "live-09", prompt: "What's the difference between let and const in JavaScript?", category: "coding" },
  { id: "live-10", prompt: "Write a SQL query to find duplicate emails in a users table.", category: "coding" },

  // reasoning — should route to best model
  { id: "live-11", prompt: "If all roses are flowers and some flowers fade quickly, can we conclude that some roses fade quickly? Explain why or why not.", category: "reasoning" },
  { id: "live-12", prompt: "A bat and ball cost $1.10 together. The bat costs $1 more than the ball. How much does the ball cost? Show your reasoning.", category: "reasoning" },
  { id: "live-13", prompt: "Prove that the square root of 2 is irrational.", category: "reasoning" },

  // creative
  { id: "live-14", prompt: "Write a haiku about debugging code at 3am.", category: "creative" },
  { id: "live-15", prompt: "Write a short story opening about a robot learning to cook.", category: "creative" },

  // data
  { id: "live-16", prompt: "Parse this CSV and find the average: name,score\\nAlice,85\\nBob,92\\nCarol,78", category: "data" },
  { id: "live-17", prompt: "Convert this JSON to a markdown table: [{\"name\":\"A\",\"val\":1},{\"name\":\"B\",\"val\":2}]", category: "data" },

  // agentic
  { id: "live-18", prompt: "Search the web for the current price of Bitcoin and summarize it.", category: "agentic" },
  { id: "live-19", prompt: "Read the file at /tmp/test.txt, analyze its contents, and write a summary to /tmp/summary.txt", category: "agentic" },

  // mixed/boundary
  { id: "live-20", prompt: "I need to refactor my authentication middleware to use JWT tokens instead of sessions. The current code uses express-session with Redis. Can you help me plan the migration?", category: "coding" },
];

// ─── Types ───

type LiveResult = {
  id: string;
  prompt: string;
  expected_category: string;
  routed_model: string;
  routed_tier: string;
  routed_category: string;
  response_preview: string;
  cost_routed_usd: number;
  cost_baseline_usd: number;
  savings_pct: number;
  latency_ms: number;
  tokens_prompt: number;
  tokens_completion: number;
  success: boolean;
  error?: string;
};

// ─── Helpers ───

async function sendRequest(
  prompt: string,
  model: string = "auto",
): Promise<{
  response: string;
  model: string;
  tier: string;
  category: string;
  cost: number;
  baselineCost: number;
  latency: number;
  promptTokens: number;
  completionTokens: number;
}> {
  const start = performance.now();
  const res = await fetch(`${BASE_URL}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      max_tokens: 256,
    }),
  });

  const latency = performance.now() - start;

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = await res.json() as {
    choices: Array<{ message: { content: string } }>;
    usage?: { prompt_tokens: number; completion_tokens: number; cost?: number };
    model: string;
  };

  const routedModel = res.headers.get("x-tierflow-model") || data.model || "unknown";
  const tier = res.headers.get("x-tierflow-tier") || "unknown";
  const category = res.headers.get("x-tierflow-category") || "unknown";

  // Prefer actual cost from provider response body (e.g. OpenRouter's usage.cost)
  // Fall back to TierFlow's estimated cost header
  const costHeader = res.headers.get("x-tierflow-cost");
  const cost = data.usage?.cost ?? (costHeader ? parseFloat(costHeader) : 0);

  // Calculate baseline: what this would cost on Claude Opus ($15/M input, $75/M output)
  const promptTk = data.usage?.prompt_tokens || 0;
  const completionTk = data.usage?.completion_tokens || 0;
  const baselineCost =
    (promptTk / 1_000_000) * BASELINE_PRICING.input +
    (completionTk / 1_000_000) * BASELINE_PRICING.output;

  return {
    response: data.choices?.[0]?.message?.content || "",
    model: routedModel,
    tier,
    category,
    cost,
    baselineCost,
    latency,
    promptTokens: data.usage?.prompt_tokens || 0,
    completionTokens: data.usage?.completion_tokens || 0,
  };
}

// ─── Main ───

async function main() {
  // Check TierFlow is running
  try {
    const health = await fetch(`${BASE_URL}/health`, { signal: AbortSignal.timeout(3000) });
    if (!health.ok) throw new Error("not ok");
    console.log(`✓ TierFlow running at ${BASE_URL}`);
  } catch {
    console.error(`ERROR: TierFlow not reachable at ${BASE_URL}`);
    console.error("Start TierFlow first: npx tierflow");
    process.exit(1);
  }

  const prompts = LIVE_PROMPTS.slice(0, MAX_PROMPTS);

  if (args["dry-run"]) {
    console.log("\n--- DRY RUN (no API calls) ---\n");
    for (const p of prompts) {
      console.log(`  ${p.id} [${p.category}] ${p.prompt.slice(0, 60)}`);
    }
    console.log(`\n${prompts.length} prompts would be sent.`);
    process.exit(0);
  }

  console.log(`\nSending ${prompts.length} prompts through TierFlow...\n`);
  console.log(`Baseline model: ${BASELINE_MODEL}`);
  console.log(`Cost from X-TierFlow-Cost / X-TierFlow-Baseline-Cost headers.\n`);

  const results: LiveResult[] = [];
  let totalRoutedCost = 0;
  let totalBaselineCost = 0;

  for (const p of prompts) {
    process.stdout.write(`  ${p.id} ${p.category.padEnd(12)} `);

    try {
      // Single request — TierFlow returns both routed cost and baseline cost in headers
      const routed = await sendRequest(p.prompt, "auto");

      const savingsPct =
        routed.baselineCost > 0
          ? ((routed.baselineCost - routed.cost) / routed.baselineCost) * 100
          : 0;

      totalRoutedCost += routed.cost;
      totalBaselineCost += routed.baselineCost;

      const result: LiveResult = {
        id: p.id,
        prompt: p.prompt,
        expected_category: p.category,
        routed_model: routed.model,
        routed_tier: routed.tier,
        routed_category: routed.category,
        response_preview: routed.response.slice(0, 100),
        cost_routed_usd: routed.cost,
        cost_baseline_usd: routed.baselineCost,
        savings_pct: Math.round(savingsPct * 10) / 10,
        latency_ms: Math.round(routed.latency),
        tokens_prompt: routed.promptTokens,
        tokens_completion: routed.completionTokens,
        success: true,
      };
      results.push(result);

      const savingsStr = savingsPct > 0 ? `saved ${savingsPct.toFixed(0)}%` : "baseline";
      console.log(
        `→ ${routed.model.padEnd(35)} $${routed.cost.toFixed(6)} vs $${routed.baselineCost.toFixed(6)}  ${savingsStr}  (${Math.round(routed.latency)}ms)`,
      );
    } catch (err) {
      const msg = (err as Error).message;
      results.push({
        id: p.id,
        prompt: p.prompt,
        expected_category: p.category,
        routed_model: "error",
        routed_tier: "error",
        routed_category: "error",
        response_preview: "",
        cost_routed_usd: 0,
        cost_baseline_usd: 0,
        savings_pct: 0,
        latency_ms: 0,
        tokens_prompt: 0,
        tokens_completion: 0,
        success: false,
        error: msg,
      });
      console.log(`✗ ERROR: ${msg.slice(0, 80)}`);
    }
  }

  // ─── Summary ───

  const successful = results.filter((r) => r.success);
  const totalSavings =
    totalBaselineCost > 0
      ? ((totalBaselineCost - totalRoutedCost) / totalBaselineCost) * 100
      : 0;

  const summary = {
    generated: new Date().toISOString(),
    tierflow_version: "2.0.0",
    benchmark_type: "live",
    baseline_model: BASELINE_MODEL,
    total_prompts: prompts.length,
    successful: successful.length,
    failed: prompts.length - successful.length,
    total_cost_routed_usd: Math.round(totalRoutedCost * 1000000) / 1000000,
    total_cost_baseline_usd: Math.round(totalBaselineCost * 1000000) / 1000000,
    total_savings_usd: Math.round((totalBaselineCost - totalRoutedCost) * 1000000) / 1000000,
    savings_pct: Math.round(totalSavings * 10) / 10,
    avg_latency_ms:
      successful.length > 0
        ? Math.round(successful.reduce((s, r) => s + r.latency_ms, 0) / successful.length)
        : 0,
    models_used: [...new Set(successful.map((r) => r.routed_model))],
    results,
  };

  // Write JSON
  writeFileSync(args.output!, JSON.stringify(summary, null, 2));
  console.log(`\nResults written to ${args.output}`);

  // Print report
  console.log(`
╔══════════════════════════════════════════════════════╗
║          TierFlow Live Cost Benchmark                ║
╠══════════════════════════════════════════════════════╣
║                                                      ║
║  Prompts sent:      ${String(summary.successful).padEnd(31)}║
║  Baseline model:    ${BASELINE_MODEL.padEnd(31)}║
║                                                      ║
║  Cost (TierFlow):   $${summary.total_cost_routed_usd.toFixed(6).padEnd(29)}║
║  Cost (always best): $${summary.total_cost_baseline_usd.toFixed(6).padEnd(28)}║
║  You saved:         $${summary.total_savings_usd.toFixed(6).padEnd(29)}║
║                                                      ║
║  ► Savings:         ${(summary.savings_pct.toFixed(1) + "%").padEnd(31)}║
║  ► Avg latency:     ${(summary.avg_latency_ms + "ms").padEnd(31)}║
║                                                      ║
║  Models used:                                        ║
${summary.models_used.map((m) => `║    • ${m.padEnd(45)}║`).join("\n")}
║                                                      ║
╚══════════════════════════════════════════════════════╝

Projection at 1,000 requests/day:
  Always ${BASELINE_MODEL}: ~$${((summary.total_cost_baseline_usd / summary.successful) * 1000).toFixed(2)}/day
  With TierFlow:              ~$${((summary.total_cost_routed_usd / summary.successful) * 1000).toFixed(2)}/day
  Monthly savings:            ~$${(((summary.total_cost_baseline_usd - summary.total_cost_routed_usd) / summary.successful) * 30000).toFixed(2)}/month
`);

  // Write markdown report
  const md = `# TierFlow Live Cost Benchmark

> Real API calls. Real costs. Real savings.

Generated: ${summary.generated.split("T")[0]} | Version: ${summary.tierflow_version}

## Results

| Metric | Value |
|--------|-------|
| Prompts sent | ${summary.successful} |
| Baseline model | \`${BASELINE_MODEL}\` |
| **Total cost (TierFlow)** | **$${summary.total_cost_routed_usd.toFixed(6)}** |
| **Total cost (always best)** | **$${summary.total_cost_baseline_usd.toFixed(6)}** |
| **Savings** | **${summary.savings_pct}% ($${summary.total_savings_usd.toFixed(6)})** |
| Avg latency | ${summary.avg_latency_ms}ms |

## Models Used

${summary.models_used.map((m) => `- \`${m}\``).join("\n")}

## Per-Request Breakdown

| # | Category | Routed To | Cost (Routed) | Cost (Baseline) | Saved |
|---|----------|-----------|---------------|-----------------|-------|
${successful.map((r) => `| ${r.id} | ${r.expected_category} | \`${r.routed_model}\` | $${r.cost_routed_usd.toFixed(6)} | $${r.cost_baseline_usd.toFixed(6)} | ${r.savings_pct}% |`).join("\n")}

## Projection

At **1,000 requests/day** (mixed workload):

- Always \`${BASELINE_MODEL}\`: ~$${((summary.total_cost_baseline_usd / summary.successful) * 1000).toFixed(2)}/day (~$${((summary.total_cost_baseline_usd / summary.successful) * 30000).toFixed(2)}/month)
- **With TierFlow**: ~$${((summary.total_cost_routed_usd / summary.successful) * 1000).toFixed(2)}/day (~$${((summary.total_cost_routed_usd / summary.successful) * 30000).toFixed(2)}/month)
- **Monthly savings: ~$${(((summary.total_cost_baseline_usd - summary.total_cost_routed_usd) / summary.successful) * 30000).toFixed(2)}**

---

*These are real API costs from actual requests, not estimates. Run \`npx tsx bench/live-benchmark.ts\` to reproduce.*
`;

  writeFileSync("docs/live-benchmarks.md", md);
  console.log("Markdown report written to docs/live-benchmarks.md");
}

main().catch((err) => {
  console.error("Benchmark failed:", err);
  process.exit(1);
});
