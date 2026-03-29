/**
 * TierFlow Config — loads external configuration
 * Zero external deps. Falls back to hardcoded defaults if no config file exists.
 *
 * Config file search order:
 *   1. TIERFLOW_CONFIG env var
 *   2. ./tierflow.config.json (working directory)
 *   3. ~/.config/tierflow/config.json
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { logger } from "./logger.js";

// ─── Config Types ───

export type AuthConfig = {
  type: "profiles" | "env" | "file" | "keychain" | "none";
  key?: string; // env var name for type=env
  profilesPath?: string; // for type=profiles
  filePath?: string; // for type=file
  service?: string; // for type=keychain
  account?: string; // for type=keychain
};

export type PiiConfig = {
  enabled: boolean;
  mode?: "strict" | "standard"; // strict = fail-closed, standard = log + pass
  exclude?: string[]; // categories to skip (e.g. ["postcode", "phone"])
  scrub_system?: boolean; // opt-in: scrub system/developer messages (default: false)
  debug_log_scrubbed?: boolean; // TEMPORARY — logs scrubbed payload for verification
};

export type CompressConfig = {
  enabled: boolean;
  passes?: string[]; // subset of: ansi, whitespace, json, dedup, comments, verbose
  compress_system?: boolean; // opt-in: compress system messages (default: false)
};

export type ProviderConfigEntry = {
  baseUrl: string;
  api: "anthropic" | "openai";
  headers?: Record<string, string>;
  auth?: AuthConfig;
  pii?: boolean | PiiConfig; // PII scrubbing — default: false (no overhead)
  compress?: boolean | CompressConfig; // CtxPack compression — default: false (no overhead)
  timeout_ms?: number; // per-provider timeout override
  models?: string[]; // hint: models this provider supports (for /v1/models)
  disabled?: boolean; // soft-disable without deleting config
};

export type TierMapping = {
  primary: string;
  fallback: string[];
};

export type ThinkingConfig = {
  adaptive?: string[];
  enabled?: { models: string[]; budget: number };
};

export type CategoryMapping = {
  primary: string;
  fallback: string[];
  timeout?: number;
};

export type MLClassifierConfig = {
  url: string;
  timeout_ms: number;
  fallback_category: string;
};

export type CacheGlobalConfig = {
  enabled: boolean;
  ttl_seconds?: number; // default: 300 (5 min)
  max_entries?: number; // default: 5000
  exclude_streaming?: boolean; // default: true
  exclude_tools?: boolean; // default: true
};

export type TierFlowConfig = {
  port: number;
  host: string;
  providers: Record<string, ProviderConfigEntry>;
  tiers: Record<string, TierMapping>;
  agenticTiers?: Record<string, TierMapping>;
  categories?: Record<string, CategoryMapping>;
  mlClassifier?: MLClassifierConfig;
  cache?: CacheGlobalConfig; // Response cache — default: disabled
  modeOverrides?: Record<string, string>; // v2: mode → category mapping
  tierBoundaries?: {
    simpleMedium: number;
    mediumComplex: number;
    complexReasoning: number;
  };
  thinking?: ThinkingConfig;
  auth: {
    default: string;
    [strategy: string]: unknown;
  };
  scoring?: Record<string, unknown>;
  security?: {
    enabled?: boolean;
    threshold?: string;
    categories?: Record<string, boolean>;
    allowlist?: string[];
    maxScanLength?: number;
    scanResponses?: boolean;
    logThreats?: boolean;
  };
};

// ─── Defaults (current hardcoded behavior) ───

const DEFAULT_CONFIG: TierFlowConfig = {
  port: 18800,
  host: "127.0.0.1",
  providers: {
    anthropic: {
      baseUrl: "https://api.anthropic.com",
      api: "anthropic",
    },
    openai: {
      baseUrl: "https://api.openai.com",
      api: "openai",
    },
    google: {
      baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
      api: "openai",
    },
    xai: {
      baseUrl: "https://api.x.ai/v1",
      api: "openai",
    },
    deepseek: {
      baseUrl: "https://api.deepseek.com",
      api: "openai",
    },
    mistral: {
      baseUrl: "https://api.mistral.ai/v1",
      api: "openai",
    },
    ollama: {
      baseUrl: "http://localhost:11434/v1",
      api: "openai",
    },
  },
  tiers: {
    SIMPLE: { primary: "ollama/llama3.2", fallback: ["openai/gpt-4o-mini"] },
    MEDIUM: { primary: "openai/gpt-4o", fallback: ["anthropic/claude-sonnet-4-5"] },
    COMPLEX: { primary: "anthropic/claude-sonnet-4-5", fallback: ["openai/gpt-4o"] },
    REASONING: { primary: "anthropic/claude-opus-4-6", fallback: ["openai/o1"] },
  },
  agenticTiers: {
    SIMPLE: { primary: "openai/gpt-4o-mini", fallback: ["ollama/llama3.2"] },
    MEDIUM: { primary: "openai/gpt-4o", fallback: ["anthropic/claude-sonnet-4-5"] },
    COMPLEX: { primary: "anthropic/claude-sonnet-4-5", fallback: ["openai/gpt-4o"] },
    REASONING: { primary: "anthropic/claude-opus-4-6", fallback: ["openai/o1"] },
  },
  thinking: {
    adaptive: ["claude-opus-4-6", "claude-opus-4.6"],
    enabled: { models: ["claude-sonnet-4-5"], budget: 4096 },
  },
  auth: {
    default: "env",
  },
};

// ─── Singleton ───

let _config: TierFlowConfig | null = null;
let _configPath: string | null = null;

/**
 * Deep-merge source into target (source wins). Arrays are replaced, not merged.
 */
function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    const sv = source[key];
    const tv = target[key];
    if (
      sv &&
      typeof sv === "object" &&
      !Array.isArray(sv) &&
      tv &&
      typeof tv === "object" &&
      !Array.isArray(tv)
    ) {
      result[key] = deepMerge(tv as Record<string, unknown>, sv as Record<string, unknown>);
    } else {
      result[key] = sv;
    }
  }
  return result;
}

/**
 * Find config file path.
 */
function findConfigFile(): string | null {
  // 1. Env var (new name first, then legacy)
  const envPath = process.env.TIERFLOW_CONFIG ?? process.env.FREEROUTER_CONFIG;
  if (envPath && existsSync(envPath)) return envPath;

  // 2. CWD (new name first, then legacy)
  for (const name of ["tierflow.config.json", "freerouter.config.json"]) {
    const cwdPath = join(process.cwd(), name);
    if (existsSync(cwdPath)) return cwdPath;
  }

  // 3. Home config (new path first, then legacy)
  for (const dir of ["tierflow", "freerouter"]) {
    const homePath = join(homedir(), ".config", dir, "config.json");
    if (existsSync(homePath)) return homePath;
  }

  return null;
}

/**
 * Load config from file, merging with defaults.
 */
export function loadConfig(): TierFlowConfig {
  const configPath = findConfigFile();

  if (!configPath) {
    logger.info("No tierflow.config.json found, using built-in defaults");
    _config = { ...DEFAULT_CONFIG };
    _configPath = null;
    return _config;
  }

  try {
    const raw = readFileSync(configPath, "utf-8");
    const fileConfig = JSON.parse(raw) as Partial<TierFlowConfig>;

    // Deep-merge file config over defaults
    _config = deepMerge(
      DEFAULT_CONFIG as unknown as Record<string, unknown>,
      fileConfig as unknown as Record<string, unknown>,
    ) as unknown as TierFlowConfig;
    _configPath = configPath;

    logger.info(`Loaded config from ${configPath}`);
    logger.info(`  Providers: ${Object.keys(_config.providers).join(", ")}`);
    logger.info(`  Tiers: ${Object.keys(_config.tiers).join(", ")}`);

    return _config;
  } catch (err) {
    logger.error(`Failed to load config from ${configPath}:`, err);
    logger.info("Falling back to built-in defaults");
    _config = { ...DEFAULT_CONFIG };
    _configPath = null;
    return _config;
  }
}

/**
 * Reload config from file (for /reload endpoint).
 */
export function reloadConfig(): TierFlowConfig {
  _config = null;
  return loadConfig();
}

/**
 * Get the current config (loads if not yet loaded).
 */
export function getConfig(): TierFlowConfig {
  if (!_config) return loadConfig();
  return _config;
}

/**
 * Get config path (null if using defaults).
 */
export function getConfigPath(): string | null {
  return _configPath;
}

/**
 * Get sanitized config for display (no secrets).
 */
export function getSanitizedConfig(): Record<string, unknown> {
  const cfg = getConfig();
  const sanitized = JSON.parse(JSON.stringify(cfg));

  // Redact auth keys
  if (sanitized.auth) {
    for (const [key, val] of Object.entries(sanitized.auth)) {
      if (key === "default") continue;
      if (val && typeof val === "object" && (val as any).profilesPath) {
        (val as any).profilesPath = "***";
      }
    }
  }

  // Redact provider auth
  for (const prov of Object.values(sanitized.providers ?? {})) {
    if ((prov as any).auth?.key) {
      (prov as any).auth.key = "***";
    }
  }

  return sanitized;
}

/**
 * Convert config api type to internal provider api type.
 */
export function toInternalApiType(
  api: "anthropic" | "openai",
): "anthropic-messages" | "openai-completions" {
  return api === "anthropic" ? "anthropic-messages" : "openai-completions";
}

/**
 * Check if a model supports adaptive thinking based on config.
 */
export function supportsAdaptiveThinking(modelId: string): boolean {
  const cfg = getConfig();
  const patterns = cfg.thinking?.adaptive ?? ["claude-opus-4-6", "claude-opus-4.6"];
  return patterns.some((p) => modelId.includes(p));
}

/**
 * Check if a model has thinking enabled and get the budget.
 */
export function getThinkingBudget(modelId: string): number | null {
  const cfg = getConfig();
  const enabled = cfg.thinking?.enabled;
  if (!enabled) return null;
  if (enabled.models.some((m) => modelId.includes(m))) {
    return enabled.budget;
  }
  return null;
}

// ─── PII Helpers ───

/**
 * Check if PII scrubbing is enabled for a provider config entry.
 */
export function isPiiEnabled(entry: ProviderConfigEntry): boolean {
  if (entry.pii === true) return true;
  if (typeof entry.pii === "object" && entry.pii.enabled) return true;
  return false;
}

/**
 * Get PII exclude list for a provider (categories to skip).
 */
export function getPiiExclude(entry: ProviderConfigEntry): string[] | undefined {
  if (typeof entry.pii === "object" && entry.pii.exclude) return entry.pii.exclude;
  return undefined;
}

/**
 * Get PII mode for a provider (strict or standard).
 */
export function getPiiMode(entry: ProviderConfigEntry): "strict" | "standard" {
  if (typeof entry.pii === "object" && entry.pii.mode) return entry.pii.mode;
  return "strict"; // default: fail-closed
}

/**
 * Check if PII system message scrubbing is enabled for a provider.
 */
export function isPiiScrubSystem(entry: ProviderConfigEntry): boolean {
  if (typeof entry.pii === "object" && entry.pii.scrub_system) return true;
  return false;
}

/**
 * Check if PII debug logging is enabled for a provider.
 */
export function isPiiDebugLog(entry: ProviderConfigEntry): boolean {
  if (typeof entry.pii === "object" && entry.pii.debug_log_scrubbed) return true;
  return false;
}

// ─── CtxPack compression helpers ───

/**
 * Check if CtxPack compression is enabled for a provider config entry.
 */
export function isCompressEnabled(entry: ProviderConfigEntry): boolean {
  if (entry.compress === true) return true;
  if (typeof entry.compress === "object" && entry.compress.enabled) return true;
  return false;
}

/**
 * Get CtxPack passes for a provider (which compression techniques to apply).
 */
export function getCompressPasses(entry: ProviderConfigEntry): string[] | undefined {
  if (typeof entry.compress === "object" && entry.compress.passes) return entry.compress.passes;
  return undefined; // all passes by default
}

/**
 * Check if system message compression is enabled for a provider.
 */
export function isCompressSystem(entry: ProviderConfigEntry): boolean {
  if (typeof entry.compress === "object" && entry.compress.compress_system) return true;
  return false;
}

// Export defaults for backward compat
export { DEFAULT_CONFIG };
