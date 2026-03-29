/**
 * TierFlow Security Scanner — prompt injection, data exfiltration,
 * command injection, and secret leakage detection.
 *
 * 252 patterns across 8 categories and 9 languages.
 * Patterns from Claw Sentinel v1.0.4 by oleglegegg (MIT License).
 */

export { scan, shouldBlock, getScannerStatus } from "./scanner.js";
export { normalize } from "./normalizer.js";
export { PATTERN_GROUPS, TOTAL_PATTERNS, LANGUAGES } from "./patterns.js";
export {
  DEFAULT_SECURITY_CONFIG,
  SEVERITY_ORDER,
  type Severity,
  type ThreatCategory,
  type ThreatMatch,
  type ScanResult,
  type SecurityConfig,
} from "./types.js";
