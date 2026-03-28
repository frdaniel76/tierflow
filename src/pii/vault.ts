/**
 * SecretVault — PII redaction and rehydration with AES-256-GCM encryption.
 * PII redaction and rehydration engine for TierFlow.
 *
 * Detects PII in text using multi-pass regex scanning, replaces matches
 * with type-preserving placeholders, and encrypts the original values
 * in memory. Rehydration decrypts and restores originals.
 *
 * Placeholder format: type-preserving templates with embedded p0{12hex} ID.
 * Universal ID marker: p0[0-9a-f]{12}
 *
 * Examples:
 *   email  → p0a1b2c3d4e5f6@maildomain.com
 *   apikey → sk-p0a1b2c3d4e5f6-placeholder
 *   secret → password=p0a1b2c3d4e5f6-redacted
 *   path   → /pii/p0a1b2c3d4e5f6/redacted
 */

import { randomBytes, createCipheriv, createDecipheriv, createHmac } from "node:crypto";
import { PATTERNS, fresh, type PatternDef } from "./patterns.js";

// ─── Types ───

export interface RedactResult {
  text: string;
  count: number;
  categories: string[];
}

export interface RehydrateResult {
  text: string;
  count: number;
}

interface VaultEntry {
  category: string;
  encrypted: Buffer;
  iv: Buffer;
  tag: Buffer;
  keyword?: string; // For 'secret' category: the credential keyword (e.g. "password")
}

interface Match {
  start: number;
  end: number;
  text: string;
  category: string;
  pass: number;
}

// ─── Type-preserving placeholder templates ───
// Each template embeds the hex ID as p0{12hex}. The surrounding format
// matches the PII type so LLMs understand the data and echo it verbatim.

// All templates start with p0{hex} so the streaming carry buffer always
// captures from the very beginning of the placeholder. Type-hinting suffixes
// tell the LLM what kind of data this represents.
const PLACEHOLDER_TEMPLATES: Record<string, (id: string, keyword?: string) => string> = {
  email: (id) => `p0${id}@maildomain.com`,
  apikey: (id) => `p0${id}-placeholder-key`,
  conn: (id) => `p0${id}://placeholder/db`,
  cred: (id) => `p0${id}-placeholder-token`,
  cc: (id) => `p0${id}-0000-card`,
  ssn: (id) => `p0${id}-ssn`,
  phone: (id) => `p0${id}-phone`,
  ip: (id) => `p0${id}.0.0.1`,
  path: (id) => `p0${id}/pii/redacted`,
  pem: (id) => `p0${id}-PII-KEY`,
  nino: (id) => `p0${id}-nino`,
  post: (id) => `p0${id}-postcode`,
  secret: (id, keyword) => `p0${id}-${keyword ?? "secret"}`,
};

// Rehydration regexes per category — each captures the 12-hex ID.
// All patterns start with p0, ordered longest-suffix-first to avoid
// shorter patterns matching prematurely.
const REHYDRATE_PATTERNS: Array<{ regex: RegExp; idGroup: number }> = [
  { regex: /p0([0-9a-f]{12})@maildomain\.com/g, idGroup: 1 }, // email
  { regex: /p0([0-9a-f]{12})-placeholder-token/g, idGroup: 1 }, // cred
  { regex: /p0([0-9a-f]{12})-placeholder-key/g, idGroup: 1 }, // apikey
  { regex: /p0([0-9a-f]{12}):\/\/placeholder\/db/g, idGroup: 1 }, // conn
  { regex: /p0([0-9a-f]{12})-0000-card/g, idGroup: 1 }, // cc
  { regex: /p0([0-9a-f]{12})\/pii\/redacted/g, idGroup: 1 }, // path
  { regex: /p0([0-9a-f]{12})-postcode/g, idGroup: 1 }, // post
  { regex: /p0([0-9a-f]{12})-PII-KEY/g, idGroup: 1 }, // pem
  { regex: /p0([0-9a-f]{12})-phone/g, idGroup: 1 }, // phone
  { regex: /p0([0-9a-f]{12})-nino/g, idGroup: 1 }, // nino
  { regex: /p0([0-9a-f]{12})\.0\.0\.1/g, idGroup: 1 }, // ip
  { regex: /p0([0-9a-f]{12})-ssn/g, idGroup: 1 }, // ssn
  { regex: /p0([0-9a-f]{12})-\w+/g, idGroup: 1 }, // secret (keyword suffix)
];

// Universal fallback: matches p0{hex} marker with 10-12 hex chars.
// LLMs occasionally drop 1-2 chars from hex IDs, so we accept 10+ chars
// and do a prefix match against vault entries.
const FALLBACK_REHYDRATE = /p0([0-9a-f]{10,12})/g;

/** Universal ID marker pattern — use for carry buffer detection and counting */
export const PII_ID_MARKER = /p0[0-9a-f]{10,12}/;
export const PII_ID_MARKER_G = /p0[0-9a-f]{10,12}/g;

// Extract keyword from a credentials match (e.g. "password=hunter2" → "password")
const CREDENTIAL_KEYWORD_RE =
  /^(password|passwd|pwd|pass|secret|token|auth_token|access_key|private_key|client_secret|app_secret|api[_\s]?key|apikey)\s*[:=]/i;

// ─── Code block detection ───

const CODE_BLOCK_RE = /```[\s\S]*?```|`[^`\n]+`/g;

function findCodeBlocks(text: string): Array<{ start: number; end: number }> {
  const blocks: Array<{ start: number; end: number }> = [];
  const re = fresh(CODE_BLOCK_RE);
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    blocks.push({ start: m.index, end: m.index + m[0].length });
  }
  return blocks;
}

function insideCodeBlock(offset: number, blocks: Array<{ start: number; end: number }>): boolean {
  return blocks.some((b) => offset >= b.start && offset < b.end);
}

// ─── SecretVault ───

export class SecretVault {
  private key: Buffer;
  private entries = new Map<string, VaultEntry>();
  private valueToId = new Map<string, string>(); // dedup: HMAC(value) → id (M-6: no plaintext keys)
  private destroyed = false;
  private exclude: Set<string>;

  constructor(exclude?: string[]) {
    this.key = randomBytes(32); // AES-256 key, memory-only
    this.exclude = new Set(exclude ?? []);
  }

  /**
   * Generate a 12-char hex ID for a placeholder.
   */
  private generateId(): string {
    return randomBytes(6).toString("hex"); // 6 bytes = 12 hex chars
  }

  /**
   * Encrypt a PII value.
   */
  private encrypt(plaintext: string): { encrypted: Buffer; iv: Buffer; tag: Buffer } {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return { encrypted, iv, tag };
  }

  /**
   * Decrypt a PII value.
   */
  private decrypt(entry: VaultEntry): string {
    const decipher = createDecipheriv("aes-256-gcm", this.key, entry.iv);
    decipher.setAuthTag(entry.tag);
    return decipher.update(entry.encrypted) + decipher.final("utf8");
  }

  /**
   * Store a PII value, returning its placeholder ID.
   * Deduplicates: same value always gets the same placeholder.
   */
  /**
   * HMAC a value for dedup lookup — avoids storing plaintext PII as map keys (M-6).
   */
  private hmacValue(value: string): string {
    return createHmac("sha256", this.key).update(value).digest("hex");
  }

  private store(value: string, category: string, keyword?: string): string {
    // Check dedup cache using HMAC (no plaintext stored)
    const hash = this.hmacValue(value);
    const existing = this.valueToId.get(hash);
    if (existing) return existing;

    const id = this.generateId();
    const { encrypted, iv, tag } = this.encrypt(value);
    this.entries.set(id, { category, encrypted, iv, tag, keyword });
    this.valueToId.set(hash, id);
    return id;
  }

  /**
   * Run multi-pass PII detection on text, skipping code blocks on passes 2+.
   * Returns non-overlapping matches sorted by position.
   */
  private detect(text: string): Match[] {
    const codeBlocks = findCodeBlocks(text);
    const allMatches: Match[] = [];

    // Group patterns by pass
    const byPass = new Map<number, PatternDef[]>();
    for (const p of PATTERNS) {
      if (this.exclude.has(p.category)) continue;
      const group = byPass.get(p.pass) ?? [];
      group.push(p);
      byPass.set(p.pass, group);
    }

    const passes = [...byPass.keys()].sort((a, b) => a - b);

    for (const pass of passes) {
      const patterns = byPass.get(pass)!;
      for (const pat of patterns) {
        const re = fresh(pat.regex);
        let m: RegExpExecArray | null;
        while ((m = re.exec(text)) !== null) {
          const start = m.index;
          const end = start + m[0].length;

          // Skip code blocks on passes 2+
          if (pass > 1 && insideCodeBlock(start, codeBlocks)) continue;

          allMatches.push({ start, end, text: m[0], category: pat.category, pass });
        }
      }
    }

    // Resolve overlaps: earlier pass wins, then longer match wins
    allMatches.sort(
      (a, b) => a.start - b.start || a.pass - b.pass || b.end - b.start - (a.end - a.start),
    );

    const resolved: Match[] = [];
    let lastEnd = 0;
    for (const match of allMatches) {
      if (match.start >= lastEnd) {
        resolved.push(match);
        lastEnd = match.end;
      }
    }

    return resolved;
  }

  /**
   * Redact PII from text, replacing matches with type-preserving placeholders.
   */
  redact(text: string): RedactResult {
    if (this.destroyed) throw new Error("Vault has been destroyed");

    const matches = this.detect(text);
    if (matches.length === 0) {
      return { text, count: 0, categories: [] };
    }

    const categories = new Set<string>();
    let result = "";
    let lastEnd = 0;

    for (const match of matches) {
      result += text.slice(lastEnd, match.start);

      // For 'secret' category, extract the keyword prefix (e.g. "password" from "password=hunter2")
      let keyword: string | undefined;
      if (match.category === "secret") {
        const kwMatch = match.text.match(CREDENTIAL_KEYWORD_RE);
        keyword = kwMatch ? kwMatch[1].toLowerCase().replace(/\s/g, "_") : "secret";
      }

      const id = this.store(match.text, match.category, keyword);
      const template = PLACEHOLDER_TEMPLATES[match.category];
      result += template ? template(id, keyword) : `p0${id}`;
      categories.add(match.category);
      lastEnd = match.end;
    }

    result += text.slice(lastEnd);

    return {
      text: result,
      count: matches.length,
      categories: [...categories],
    };
  }

  /**
   * Rehydrate text containing type-preserving placeholders.
   * Tries all per-type patterns first, then falls back to universal p0{hex} marker.
   */
  rehydrate(text: string): RehydrateResult {
    if (this.destroyed) throw new Error("Vault has been destroyed");
    if (this.entries.size === 0) return { text, count: 0 };

    let count = 0;
    let result = text;

    // Try each type-specific rehydration pattern
    for (const { regex } of REHYDRATE_PATTERNS) {
      const re = new RegExp(regex.source, regex.flags); // fresh instance
      result = result.replace(re, (fullMatch, id) => {
        const entry = this.entries.get(id);
        if (!entry) return fullMatch;
        count++;
        return this.decrypt(entry);
      });
    }

    // Fallback: universal p0{hex} marker match (10-12 hex chars).
    // Only run if there are still unrehydrated entries.
    // Supports prefix matching for truncated IDs (LLMs sometimes drop chars).
    if (count < this.entries.size) {
      const fallback = new RegExp(FALLBACK_REHYDRATE.source, FALLBACK_REHYDRATE.flags);
      result = result.replace(fallback, (fullMatch, id: string) => {
        // Exact match first
        let entry = this.entries.get(id);
        if (entry) {
          count++;
          return this.decrypt(entry);
        }

        // Prefix match for truncated IDs (10-11 chars)
        if (id.length < 12) {
          for (const [vaultId, vaultEntry] of this.entries) {
            if (vaultId.startsWith(id)) {
              entry = vaultEntry;
              break;
            }
          }
          if (entry) {
            count++;
            return this.decrypt(entry);
          }
        }

        return fullMatch;
      });
    }

    return { text: result, count };
  }

  /**
   * Rehydrate using only per-type patterns (no fallback).
   * Safe for streaming where partial placeholders may exist.
   */
  rehydrateStrict(text: string): RehydrateResult {
    if (this.destroyed) throw new Error("Vault has been destroyed");
    if (this.entries.size === 0) return { text, count: 0 };

    let count = 0;
    let result = text;

    for (const { regex } of REHYDRATE_PATTERNS) {
      const re = new RegExp(regex.source, regex.flags);
      result = result.replace(re, (fullMatch, id) => {
        const entry = this.entries.get(id);
        if (!entry) return fullMatch;
        count++;
        return this.decrypt(entry);
      });
    }

    return { text: result, count };
  }

  /**
   * Destroy the vault: zero the key and clear all entries.
   */
  destroy(): void {
    this.key.fill(0);
    this.entries.clear();
    this.valueToId.clear();
    this.destroyed = true;
  }

  /**
   * Number of stored PII entries.
   */
  get size(): number {
    return this.entries.size;
  }

  /**
   * Whether this vault has been destroyed.
   */
  get isDestroyed(): boolean {
    return this.destroyed;
  }
}
