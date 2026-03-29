/**
 * TierFlow Auth — API key management.
 * Supports: environment variables, files, macOS keychain, profiles JSON, or none.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { getConfig, getConfigPath } from "./config.js";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { logger } from "./logger.js";

export type ProviderAuth = {
  provider: string;
  profileName: string;
  token?: string; // Anthropic OAuth token
  apiKey?: string; // API key (Kimi, OpenAI)
};

type AuthProfilesFile = {
  version: number;
  profiles: Record<
    string,
    {
      type: "token" | "api_key";
      provider: string;
      token?: string;
      key?: string;
    }
  >;
  lastGood?: Record<string, string>;
};

let authCache: Map<string, ProviderAuth> | null = null;

function loadAuthProfiles(): Map<string, ProviderAuth> {
  // Get path from config, fall back to default
  const cfg = getConfig();
  const authCfg = cfg.auth;
  const defaultAuth = authCfg[authCfg.default] as
    | { type?: string; profilesPath?: string }
    | undefined;
  let filePath: string;
  if (defaultAuth?.profilesPath) {
    const p = defaultAuth.profilesPath;
    filePath = p.startsWith("~/") ? join(homedir(), p.slice(2)) : p;
  } else {
    filePath = join(homedir(), ".config", "tierflow", "auth-profiles.json");
  }
  try {
    const raw = readFileSync(filePath, "utf-8");
    const data: AuthProfilesFile = JSON.parse(raw);
    const map = new Map<string, ProviderAuth>();

    // Build a map of provider → best profile (prefer lastGood)
    const lastGood = data.lastGood ?? {};

    for (const [name, profile] of Object.entries(data.profiles)) {
      const provider = profile.provider;
      const existing = map.get(provider);

      // Prefer lastGood profile
      const isLastGood = lastGood[provider] === name;
      if (existing && !isLastGood) continue;

      map.set(provider, {
        provider,
        profileName: name,
        token: profile.type === "token" ? profile.token : undefined,
        apiKey: profile.type === "api_key" ? profile.key : undefined,
      });
    }

    logger.info(`Loaded auth for providers: ${[...map.keys()].join(", ")}`);
    return map;
  } catch (err) {
    logger.error("Failed to load auth-profiles.json:", err);
    return new Map();
  }
}

export function getAuth(provider: string): ProviderAuth | undefined {
  // Check env var auth first (per-provider config override)
  const envAuth = getEnvAuth(provider);
  if (envAuth) return envAuth;

  // Fall back to auth-profiles.json
  if (!authCache) {
    authCache = loadAuthProfiles();
  }
  return authCache.get(provider);
}

/**
 * Get auth from environment variable (for providers with auth.type=env in config).
 */
function getEnvAuth(provider: string): ProviderAuth | undefined {
  const cfg = getConfig();
  const providerCfg = cfg.providers[provider];
  if (!providerCfg?.auth) return undefined;

  // "none" auth — for local providers like Ollama that don't need auth
  if (providerCfg.auth.type === "none") {
    return { provider, profileName: "none", apiKey: "no-key-required" };
  }

  if (providerCfg.auth.type !== "env") return undefined;
  const envKey = providerCfg.auth.key;
  if (!envKey) return undefined;
  const value = process.env[envKey];
  if (!value) return undefined;
  return {
    provider,
    profileName: envKey,
    apiKey: value,
  };
}

export function reloadAuth(): void {
  authCache = null;
  logger.info("Auth cache cleared, will reload on next access");
}

/**
 * Save an API key for a provider. Updates the config to use env-style auth
 * and sets the key in process.env so it takes effect immediately.
 */
export function setProviderKey(provider: string, apiKey: string): void {
  const envKey = providerEnvKey(provider);

  // Set in process.env for immediate effect
  process.env[envKey] = apiKey;

  // Ensure provider config has auth.type=env pointing to this key
  const cfg = getConfig();
  if (cfg.providers[provider]) {
    cfg.providers[provider].auth = { type: "env", key: envKey };
  }

  // Clear auth cache so next getAuth() picks up the new key
  authCache = null;

  // Persist to .env file so key survives restarts
  persistToEnvFile(envKey, apiKey);

  logger.info(`API key set for provider: ${provider} (env: ${envKey})`);
}

/**
 * Check which providers have API keys configured.
 */
export function getProviderKeyStatus(): Record<string, { configured: boolean; envKey: string }> {
  const cfg = getConfig();
  const result: Record<string, { configured: boolean; envKey: string }> = {};

  for (const [name, prov] of Object.entries(cfg.providers)) {
    const envKey = prov.auth?.type === "env" && prov.auth.key
      ? prov.auth.key
      : providerEnvKey(name);
    const hasKey = prov.auth?.type === "none" || !!process.env[envKey];
    result[name] = { configured: hasKey, envKey };
  }

  return result;
}

/**
 * Persist an env var to the .env file next to the config.
 * Creates the file if it doesn't exist. Updates in-place if the key already exists.
 */
function persistToEnvFile(key: string, value: string): void {
  // Find .env next to config file, or in CWD
  const configPath = getConfigPath();
  const envPath = configPath ? join(dirname(configPath), ".env") : join(process.cwd(), ".env");

  try {
    let lines: string[] = [];
    if (existsSync(envPath)) {
      lines = readFileSync(envPath, "utf-8").split("\n");
    }

    // Update or append
    const prefix = key + "=";
    let found = false;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith(prefix)) {
        lines[i] = `${key}=${value}`;
        found = true;
        break;
      }
    }
    if (!found) {
      // Remove empty trailing lines before appending
      while (lines.length > 0 && lines[lines.length - 1].trim() === "") lines.pop();
      lines.push(`${key}=${value}`);
    }

    writeFileSync(envPath, lines.join("\n") + "\n", { mode: 0o600 });
    logger.info(`Saved ${key} to ${envPath}`);
  } catch (err) {
    logger.warn(`Could not persist ${key} to .env: ${(err as Error).message}`);
  }
}

function providerEnvKey(provider: string): string {
  const map: Record<string, string> = {
    anthropic: "ANTHROPIC_API_KEY",
    openai: "OPENAI_API_KEY",
    google: "GOOGLE_API_KEY",
    xai: "XAI_API_KEY",
    deepseek: "DEEPSEEK_API_KEY",
    mistral: "MISTRAL_API_KEY",
    openrouter: "OPENROUTER_API_KEY",
    ollama: "OLLAMA_API_KEY",
  };
  return map[provider] ?? `${provider.toUpperCase()}_API_KEY`;
}

/**
 * Get the authorization header value for a provider.
 */
export function getAuthHeader(provider: string): string | undefined {
  const auth = getAuth(provider);
  if (!auth) return undefined;

  if (auth.token) {
    // Anthropic uses x-api-key header, not Authorization
    return auth.token;
  }
  if (auth.apiKey) {
    return auth.apiKey;
  }
  return undefined;
}
