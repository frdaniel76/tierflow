/**
 * Security scanner types for TierFlow.
 */

export type Severity = "CLEAN" | "WARNING" | "HIGH" | "CRITICAL";

export type ThreatCategory =
  | "prompt_injection"
  | "data_exfil"
  | "command_injection"
  | "social_engineering"
  | "secret_leakage"
  | "metadata_ssrf"
  | "encoding_evasion"
  | "file_system_attack";

export type ThreatMatch = {
  category: ThreatCategory;
  severity: Severity;
  pattern: string;
  snippet: string;
};

export type ScanResult = {
  severity: Severity;
  threats: ThreatMatch[];
  scan_time_ms: number;
};

export type SecurityConfig = {
  enabled: boolean;
  threshold: Severity;
  categories: Record<ThreatCategory, boolean>;
  allowlist: string[];
  maxScanLength: number;
  scanResponses: boolean;
  logThreats: boolean;
};

export const DEFAULT_SECURITY_CONFIG: SecurityConfig = {
  enabled: true,
  threshold: "HIGH",
  categories: {
    prompt_injection: true,
    data_exfil: true,
    command_injection: true,
    social_engineering: true,
    secret_leakage: true,
    metadata_ssrf: true,
    encoding_evasion: true,
    file_system_attack: true,
  },
  allowlist: [],
  maxScanLength: 100_000,
  scanResponses: false,
  logThreats: true,
};

export const SEVERITY_ORDER: Record<Severity, number> = {
  CLEAN: 0,
  WARNING: 1,
  HIGH: 2,
  CRITICAL: 3,
};
