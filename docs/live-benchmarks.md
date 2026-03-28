# TierFlow Live Cost Benchmark

> Real API calls. Real costs. Real savings.

Generated: 2026-03-28 | Version: 2.0.0

## Results

| Metric | Value |
|--------|-------|
| Prompts sent | 20 |
| Baseline model | `anthropic/claude-opus-4-6` |
| **Total cost (TierFlow)** | **$0.002770** |
| **Total cost (always best)** | **$0.273570** |
| **Savings** | **99% ($0.270800)** |
| Avg latency | 12909ms |

## Models Used

- `openrouter/google/gemini-2.5-flash-lite`
- `openrouter/qwen/qwen3-235b-a22b-2507`
- `openrouter/mistralai/devstral-2512`
- `openrouter/openai/gpt-oss-120b`
- `openrouter/deepseek/deepseek-v3.2`

## Per-Request Breakdown

| # | Category | Routed To | Cost (Routed) | Cost (Baseline) | Saved |
|---|----------|-----------|---------------|-----------------|-------|
| live-01 | simple_chat | `openrouter/google/gemini-2.5-flash-lite` | $0.000019 | $0.003465 | 99.5% |
| live-02 | simple_chat | `openrouter/google/gemini-2.5-flash-lite` | $0.000005 | $0.000885 | 99.4% |
| live-03 | simple_chat | `openrouter/google/gemini-2.5-flash-lite` | $0.000009 | $0.001755 | 99.5% |
| live-04 | simple_chat | `openrouter/google/gemini-2.5-flash-lite` | $0.000013 | $0.002490 | 99.5% |
| live-05 | general | `openrouter/qwen/qwen3-235b-a22b-2507` | $0.000011 | $0.007920 | 99.9% |
| live-06 | general | `openrouter/qwen/qwen3-235b-a22b-2507` | $0.000027 | $0.019470 | 99.9% |
| live-07 | general | `openrouter/google/gemini-2.5-flash-lite` | $0.000103 | $0.019335 | 99.5% |
| live-08 | coding | `openrouter/mistralai/devstral-2512` | $0.000519 | $0.019455 | 97.3% |
| live-09 | coding | `openrouter/qwen/qwen3-235b-a22b-2507` | $0.000027 | $0.019485 | 99.9% |
| live-10 | coding | `openrouter/mistralai/devstral-2512` | $0.000518 | $0.019440 | 97.3% |
| live-11 | reasoning | `openrouter/openai/gpt-oss-120b` | $0.000052 | $0.020400 | 99.7% |
| live-12 | reasoning | `openrouter/openai/gpt-oss-120b` | $0.000052 | $0.020490 | 99.7% |
| live-13 | reasoning | `openrouter/openai/gpt-oss-120b` | $0.000051 | $0.020190 | 99.7% |
| live-14 | creative | `openrouter/deepseek/deepseek-v3.2` | $0.000011 | $0.001890 | 99.4% |
| live-15 | creative | `openrouter/deepseek/deepseek-v3.2` | $0.000100 | $0.019440 | 99.5% |
| live-16 | data | `openrouter/google/gemini-2.5-flash-lite` | $0.000105 | $0.019635 | 99.5% |
| live-17 | data | `openrouter/google/gemini-2.5-flash-lite` | $0.000014 | $0.002475 | 99.4% |
| live-18 | agentic | `openrouter/deepseek/deepseek-v3.2` | $0.000083 | $0.016005 | 99.5% |
| live-19 | agentic | `openrouter/mistralai/devstral-2512` | $0.000523 | $0.019605 | 97.3% |
| live-20 | coding | `openrouter/mistralai/devstral-2512` | $0.000526 | $0.019740 | 97.3% |

## Projection

At **1,000 requests/day** (mixed workload):

- Always `anthropic/claude-opus-4-6`: ~$13.68/day (~$410.36/month)
- **With TierFlow**: ~$0.14/day (~$4.16/month)
- **Monthly savings: ~$406.20**

---

*These are real API costs from actual requests, not estimates. Run `npx tsx bench/live-benchmark.ts` to reproduce.*
