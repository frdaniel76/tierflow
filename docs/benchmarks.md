# TierFlow Routing Benchmarks

Generated: 2026-03-28 | Version: 2.0.0

## Summary

| Metric | Value |
|--------|-------|
| Prompts tested | 100 |
| Category accuracy | **54.0%** |
| Tier accuracy | **54.0%** |
| Avg cost (routed) | $0.074972 |
| Avg cost (always-best) | $0.307437 |
| **Average cost savings** | **75.6%** |
| Routing latency p50 | 0.04ms |
| Routing latency p95 | 0.06ms |

## Routing Methods Used

| Method | Count |
|--------|-------|
| rules | 100 |

## Accuracy by Category

| Category | Prompts | Correct | Accuracy |
|----------|---------|---------|----------|
| coding | 23 | 11 | 47.8% |
| general | 16 | 13 | 81.3% |
| simple_chat | 15 | 9 | 60.0% |
| reasoning | 15 | 6 | 40.0% |
| creative | 11 | 7 | 63.6% |
| data | 10 | 8 | 80.0% |
| agentic | 10 | 0 | 0.0% |

## Accuracy by Difficulty

| Difficulty | Prompts | Correct | Accuracy |
|------------|---------|---------|----------|
| easy | 73 | 44 | 60.3% |
| medium | 21 | 10 | 47.6% |
| hard | 6 | 0 | 0.0% |

## Cost Savings Illustration

For a workload of **1,000 requests/day** at average prompt size:
- Always Claude Opus: ~$307.44/day
- TierFlow routed: ~$74.97/day
- **Savings: $232.46/day (75.6%)**

---
*Benchmark tests routing decisions only (no actual API calls). Cost estimates based on model pricing.*
