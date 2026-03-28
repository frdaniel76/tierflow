/**
 * LRU Cache Store — in-memory hash cache with TTL and LRU eviction.
 *
 * Zero external dependencies. Uses Node.js crypto for hashing.
 * Designed for caching LLM responses keyed by normalized prompt hash.
 */

import { createHash } from "node:crypto";

// ─── Types ───

export interface CacheEntry {
  response: string;      // full JSON response body
  model: string;         // model that generated the response
  createdAt: number;     // Date.now() when stored
  hits: number;          // times this entry was served
}

export interface CacheConfig {
  enabled: boolean;
  ttl_seconds?: number;          // default: 300 (5 min)
  max_entries?: number;          // default: 5000
  exclude_streaming?: boolean;   // default: true
  exclude_tools?: boolean;       // default: true (tool calls are context-dependent)
}

export interface CacheStats {
  hits: number;
  misses: number;
  stores: number;
  evictions: number;
  size: number;
  hitRate: string;
}

// ─── Normalization ───

/**
 * Normalize a prompt for cache key generation.
 * - Lowercase
 * - Collapse whitespace
 * - Trim
 */
export function normalizePrompt(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Build a cache key from request parameters.
 * Key = SHA-256 of (model + normalized messages content + tools flag).
 */
export function buildCacheKey(
  model: string,
  messages: Array<{ role: string; content: string | null | unknown }>,
  hasTools: boolean,
): string {
  const parts: string[] = [model];

  for (const msg of messages) {
    const content = typeof msg.content === "string"
      ? normalizePrompt(msg.content)
      : msg.content === null
        ? ""
        : JSON.stringify(msg.content);
    parts.push(`${msg.role}:${content}`);
  }

  if (hasTools) parts.push("tools:true");

  return createHash("sha256").update(parts.join("|")).digest("hex");
}

// ─── LRU Cache ───

export class LRUCache {
  private map = new Map<string, CacheEntry>();
  private ttlMs: number;
  private maxEntries: number;
  private stats = { hits: 0, misses: 0, stores: 0, evictions: 0 };

  constructor(ttlSeconds = 300, maxEntries = 5000) {
    this.ttlMs = ttlSeconds * 1000;
    this.maxEntries = maxEntries;
  }

  /**
   * Look up a cache entry by key.
   * Returns the cached response string if found and not expired, null otherwise.
   * Moves the entry to the end of the map (most recent) on hit.
   */
  get(key: string): string | null {
    const entry = this.map.get(key);

    if (!entry) {
      this.stats.misses++;
      return null;
    }

    // TTL check
    if (Date.now() - entry.createdAt > this.ttlMs) {
      this.map.delete(key);
      this.stats.misses++;
      return null;
    }

    // LRU: move to end (most recently used)
    this.map.delete(key);
    entry.hits++;
    this.map.set(key, entry);

    this.stats.hits++;
    return entry.response;
  }

  /**
   * Store a response in the cache.
   * Evicts the oldest entry if at capacity.
   */
  set(key: string, response: string, model: string): void {
    // If key exists, delete first (to re-insert at end)
    if (this.map.has(key)) {
      this.map.delete(key);
    }

    // Evict oldest if at capacity
    while (this.map.size >= this.maxEntries) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) {
        this.map.delete(oldest);
        this.stats.evictions++;
      }
    }

    this.map.set(key, {
      response,
      model,
      createdAt: Date.now(),
      hits: 0,
    });

    this.stats.stores++;
  }

  /**
   * Clear all entries.
   */
  clear(): void {
    this.map.clear();
  }

  /**
   * Get cache statistics.
   */
  getStats(): CacheStats {
    const total = this.stats.hits + this.stats.misses;
    return {
      ...this.stats,
      size: this.map.size,
      hitRate: total > 0 ? `${((this.stats.hits / total) * 100).toFixed(1)}%` : "0.0%",
    };
  }

  /**
   * Sweep expired entries (call periodically to free memory).
   */
  sweep(): number {
    const now = Date.now();
    let swept = 0;
    for (const [key, entry] of this.map) {
      if (now - entry.createdAt > this.ttlMs) {
        this.map.delete(key);
        swept++;
      }
    }
    return swept;
  }
}
