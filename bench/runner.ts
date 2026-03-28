#!/usr/bin/env npx tsx
/**
 * TierFlow Benchmark Runner
 *
 * Tests routing decisions (no API calls, no spending money).
 * Measures: category accuracy, tier accuracy, cost savings, latency.
 *
 * Usage:
 *   npm run bench           # rule-based routing
 *   npm run bench:ml        # require ML classifier service
 */

import { parseArgs } from "node:util";
import { writeFileSync } from "node:fs";
import { route, DEFAULT_ROUTING_CONFIG, buildPricingMap } from "../src/index.js";
import { BENCH_DATASET, type BenchPrompt } from "./dataset.js";
import { generateReport, type BenchResults } from "./report.js";
import type { RoutingDecision } from "../src/router/types.js";

const { values: args } = parseArgs({
  options: {
    ml: { type: "boolean", default: false },
    output: { type: "string", default: "bench/results.json" },
    verbose: { type: "boolean", short: "v", default: false },
  },
  allowPositionals: false,
});

// Check ML classifier availability if --ml
if (args.ml) {
  try {
    const res = await fetch("http://127.0.0.1:18801/health", { signal: AbortSignal.timeout(2000) });
    if (!res.ok) throw new Error("not ok");
    console.log("ML classifier: connected");
  } catch {
    console.error("ERROR: ML classifier not available at :18801. Start llmrouter-service or omit --ml.");
    process.exit(1);
  }
}

const modelPricing = buildPricingMap();

type BenchResult = {
  id: string;
  prompt: string;
  expected_category: string;
  expected_tier: string;
  routed_category: string | undefined;
  routed_tier: string;
  routed_model: string;
  routing_method: string;
  confidence: number;
  latency_ms: number;
  cost_routed: number;
  cost_baseline: number;
  savings_pct: number;
  category_correct: boolean;
  tier_correct: boolean;
  difficulty: string;
};

console.log(`\nTierFlow Benchmark — ${BENCH_DATASET.length} prompts\n`);

const results: BenchResult[] = [];
let categoryCorrect = 0;
let tierCorrect = 0;
let totalCostRouted = 0;
let totalCostBaseline = 0;
const latencies: number[] = [];
const methodCounts: Record<string, number> = {};

for (const bp of BENCH_DATASET) {
  const start = performance.now();
  let decision: RoutingDecision;
  try {
    decision = await route(bp.prompt, undefined, 4096, {
      config: DEFAULT_ROUTING_CONFIG,
      modelPricing,
    });
  } catch (err) {
    console.error(`  FAIL: ${bp.id} — ${(err as Error).message}`);
    continue;
  }
  const latency = performance.now() - start;

  // Category is only set when ML classifier is active; for rules, compare tier only
  const catCorrect = decision.category
    ? decision.category === bp.expected_category
    : decision.tier === bp.expected_tier; // use tier as proxy when no category
  const tCorrect = decision.tier === bp.expected_tier;
  if (catCorrect) categoryCorrect++;
  if (tCorrect) tierCorrect++;
  totalCostRouted += decision.costEstimate;
  totalCostBaseline += decision.baselineCost;
  latencies.push(latency);
  methodCounts[decision.method] = (methodCounts[decision.method] || 0) + 1;

  const savingsPct = decision.baselineCost > 0
    ? ((decision.baselineCost - decision.costEstimate) / decision.baselineCost) * 100
    : 0;

  results.push({
    id: bp.id,
    prompt: bp.prompt.slice(0, 80),
    expected_category: bp.expected_category,
    expected_tier: bp.expected_tier,
    routed_category: decision.category,
    routed_tier: decision.tier,
    routed_model: decision.model,
    routing_method: decision.method,
    confidence: decision.confidence,
    latency_ms: Math.round(latency * 100) / 100,
    cost_routed: decision.costEstimate,
    cost_baseline: decision.baselineCost,
    savings_pct: Math.round(savingsPct * 10) / 10,
    category_correct: catCorrect,
    tier_correct: tCorrect,
    difficulty: bp.difficulty,
  });

  if (args.verbose) {
    const mark = catCorrect ? "OK" : "MISS";
    console.log(`  ${mark} ${bp.id}: ${bp.expected_category} -> ${decision.category ?? decision.tier} (${decision.method}, ${latency.toFixed(1)}ms)`);
  }
}

// Compute summary stats
const sortedLatencies = [...latencies].sort((a, b) => a - b);
const p50 = sortedLatencies[Math.floor(sortedLatencies.length * 0.5)] ?? 0;
const p95 = sortedLatencies[Math.floor(sortedLatencies.length * 0.95)] ?? 0;
const p99 = sortedLatencies[Math.floor(sortedLatencies.length * 0.99)] ?? 0;
const avgSavings = totalCostBaseline > 0
  ? ((totalCostBaseline - totalCostRouted) / totalCostBaseline) * 100
  : 0;

const summary: BenchResults = {
  generated: new Date().toISOString(),
  tierflow_version: "2.0.0",
  total_prompts: BENCH_DATASET.length,
  prompts_routed: results.length,
  category_accuracy: results.length > 0 ? categoryCorrect / results.length : 0,
  tier_accuracy: results.length > 0 ? tierCorrect / results.length : 0,
  total_cost_routed: totalCostRouted,
  total_cost_baseline: totalCostBaseline,
  avg_savings_pct: avgSavings,
  latency_p50_ms: Math.round(p50 * 100) / 100,
  latency_p95_ms: Math.round(p95 * 100) / 100,
  latency_p99_ms: Math.round(p99 * 100) / 100,
  routing_methods: methodCounts,
  by_category: computeByCategory(results),
  by_difficulty: computeByDifficulty(results),
  results,
};

// Output
const { markdown, json } = generateReport(summary);

writeFileSync(args.output!, json);
console.log(markdown);
console.log(`\nResults written to ${args.output}`);

// Also write markdown report
const mdPath = "docs/benchmarks.md";
writeFileSync(mdPath, markdown);
console.log(`Report written to ${mdPath}`);

// ─── Helpers ───

function computeByCategory(results: BenchResult[]) {
  const cats: Record<string, { total: number; correct: number; accuracy: number }> = {};
  for (const r of results) {
    if (!cats[r.expected_category]) cats[r.expected_category] = { total: 0, correct: 0, accuracy: 0 };
    cats[r.expected_category].total++;
    if (r.category_correct) cats[r.expected_category].correct++;
  }
  for (const cat of Object.values(cats)) {
    cat.accuracy = cat.total > 0 ? cat.correct / cat.total : 0;
  }
  return cats;
}

function computeByDifficulty(results: BenchResult[]) {
  const diffs: Record<string, { total: number; correct: number; accuracy: number }> = {};
  for (const r of results) {
    if (!diffs[r.difficulty]) diffs[r.difficulty] = { total: 0, correct: 0, accuracy: 0 };
    diffs[r.difficulty].total++;
    if (r.category_correct) diffs[r.difficulty].correct++;
  }
  for (const d of Object.values(diffs)) {
    d.accuracy = d.total > 0 ? d.correct / d.total : 0;
  }
  return diffs;
}
