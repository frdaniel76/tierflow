/**
 * TierFlow Security Scanner.
 * Scans text for threats using 252 pre-compiled regex patterns.
 *
 * Patterns from Claw Sentinel v1.0.4 by oleglegegg (MIT License).
 */

import { normalize } from "./normalizer.js";
import { PATTERN_GROUPS, TOTAL_PATTERNS, LANGUAGES } from "./patterns.js";
import {
  DEFAULT_SECURITY_CONFIG,
  SEVERITY_ORDER,
  type ScanResult,
  type ThreatMatch,
  type SecurityConfig,
  type Severity,
} from "./types.js";

/**
 * Scan text for security threats.
 *
 * Normalizes the input to defeat evasion, then runs all enabled
 * pattern categories against both original and normalized text.
 *
 * @param text - The text to scan
 * @param config - Optional partial config overrides
 * @returns ScanResult with severity, threats, and scan time
 */
export function scan(text: string, config?: Partial<SecurityConfig>): ScanResult {
  const cfg = { ...DEFAULT_SECURITY_CONFIG, ...config };
  const start = performance.now();

  if (!cfg.enabled || !text || text.length === 0) {
    return { severity: "CLEAN", threats: [], scan_time_ms: 0 };
  }

  // Truncate to max scan length
  const input = text.length > cfg.maxScanLength ? text.slice(0, cfg.maxScanLength) : text;

  // Normalize for evasion detection
  const normalized = normalize(input);

  const threats: ThreatMatch[] = [];
  let highestSeverity: Severity = "CLEAN";

  for (const group of PATTERN_GROUPS) {
    // Skip disabled categories
    if (!cfg.categories[group.category]) continue;

    for (const pattern of group.patterns) {
      // Test both original and normalized text
      const matchOriginal = pattern.test(input);
      const matchNormalized = !matchOriginal && input !== normalized ? pattern.test(normalized) : false;

      if (matchOriginal || matchNormalized) {
        const matchedText = matchOriginal ? input : normalized;
        const match = pattern.exec(matchedText);
        const snippet = match ? match[0].slice(0, 100) : "";

        threats.push({
          category: group.category,
          severity: group.severity,
          pattern: pattern.source.slice(0, 80),
          snippet,
        });

        // Track highest severity
        if (SEVERITY_ORDER[group.severity] > SEVERITY_ORDER[highestSeverity]) {
          highestSeverity = group.severity;
        }

        // Reset regex lastIndex (in case of global flag)
        pattern.lastIndex = 0;

        // Early exit optimization: stop this category after first match
        break;
      }

      // Reset regex lastIndex
      pattern.lastIndex = 0;
    }
  }

  const scan_time_ms = Math.round((performance.now() - start) * 100) / 100;

  return { severity: highestSeverity, threats, scan_time_ms };
}

/**
 * Check if a scan result should block the request based on threshold.
 */
export function shouldBlock(result: ScanResult, threshold: Severity = "HIGH"): boolean {
  return SEVERITY_ORDER[result.severity] >= SEVERITY_ORDER[threshold];
}

/**
 * Get scanner info for health/status endpoints.
 */
export function getScannerStatus(): {
  available: boolean;
  totalPatterns: number;
  categories: number;
  languages: string[];
} {
  return {
    available: true,
    totalPatterns: TOTAL_PATTERNS,
    categories: PATTERN_GROUPS.length,
    languages: LANGUAGES,
  };
}
