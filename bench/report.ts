/**
 * TierFlow Benchmark Report Generator
 * Outputs JSON + Markdown from benchmark results.
 */

export type BenchResults = {
  generated: string;
  tierflow_version: string;
  total_prompts: number;
  prompts_routed: number;
  category_accuracy: number;
  tier_accuracy: number;
  total_cost_routed: number;
  total_cost_baseline: number;
  avg_savings_pct: number;
  latency_p50_ms: number;
  latency_p95_ms: number;
  latency_p99_ms: number;
  routing_methods: Record<string, number>;
  by_category: Record<string, { total: number; correct: number; accuracy: number }>;
  by_difficulty: Record<string, { total: number; correct: number; accuracy: number }>;
  results: Array<Record<string, unknown>>;
};

export function generateReport(data: BenchResults): { markdown: string; json: string } {
  const pct = (n: number) => (n * 100).toFixed(1) + "%";
  const cost = (n: number) => "$" + n.toFixed(6);

  const md = `# TierFlow Routing Benchmarks

Generated: ${data.generated.split("T")[0]} | Version: ${data.tierflow_version}

## Summary

| Metric | Value |
|--------|-------|
| Prompts tested | ${data.total_prompts} |
| Category accuracy | **${pct(data.category_accuracy)}** |
| Tier accuracy | **${pct(data.tier_accuracy)}** |
| Avg cost (routed) | ${cost(data.total_cost_routed / data.prompts_routed)} |
| Avg cost (always-best) | ${cost(data.total_cost_baseline / data.prompts_routed)} |
| **Average cost savings** | **${data.avg_savings_pct.toFixed(1)}%** |
| Routing latency p50 | ${data.latency_p50_ms}ms |
| Routing latency p95 | ${data.latency_p95_ms}ms |

## Routing Methods Used

| Method | Count |
|--------|-------|
${Object.entries(data.routing_methods)
  .map(([m, c]) => `| ${m} | ${c} |`)
  .join("\n")}

## Accuracy by Category

| Category | Prompts | Correct | Accuracy |
|----------|---------|---------|----------|
${Object.entries(data.by_category)
  .sort(([, a], [, b]) => b.total - a.total)
  .map(([cat, d]) => `| ${cat} | ${d.total} | ${d.correct} | ${pct(d.accuracy)} |`)
  .join("\n")}

## Accuracy by Difficulty

| Difficulty | Prompts | Correct | Accuracy |
|------------|---------|---------|----------|
${Object.entries(data.by_difficulty)
  .map(([diff, d]) => `| ${diff} | ${d.total} | ${d.correct} | ${pct(d.accuracy)} |`)
  .join("\n")}

## Cost Savings Illustration

For a workload of **1,000 requests/day** at average prompt size:
- Always Claude Opus: ~$${((data.total_cost_baseline / data.prompts_routed) * 1000).toFixed(2)}/day
- TierFlow routed: ~$${((data.total_cost_routed / data.prompts_routed) * 1000).toFixed(2)}/day
- **Savings: $${(((data.total_cost_baseline - data.total_cost_routed) / data.prompts_routed) * 1000).toFixed(2)}/day (${data.avg_savings_pct.toFixed(1)}%)**

---
*Benchmark tests routing decisions only (no actual API calls). Cost estimates based on model pricing.*
`;

  const json = JSON.stringify(data, null, 2);
  return { markdown: md, json };
}
