/**
 * SecretVault — PII redaction and rehydration with AES-256-GCM encryption.
 * Vendored from pii-vault (github.com/frdaniel76/pii-vault).
 *
 * Detects PII in text using multi-pass regex scanning, replaces matches
 * with deterministic placeholders (<<type:hexid>>), and encrypts the
 * original values in memory. Rehydration decrypts and restores originals.
 *
 * Placeholder format: <<category:12-hex-chars>>
 *   e.g. <<email:a1b2c3d4e5f6>>
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
}

interface Match {
  start: number;
  end: number;
  text: string;
  category: string;
  pass: number;
}

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
  return blocks.some(b => offset >= b.start && offset < b.end);
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

  private store(value: string, category: string): string {
    // Check dedup cache using HMAC (no plaintext stored)
    const hash = this.hmacValue(value);
    const existing = this.valueToId.get(hash);
    if (existing) return existing;

    const id = this.generateId();
    const { encrypted, iv, tag } = this.encrypt(value);
    this.entries.set(id, { category, encrypted, iv, tag });
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
    allMatches.sort((a, b) => a.start - b.start || a.pass - b.pass || (b.end - b.start) - (a.end - a.start));

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
   * Redact PII from text, replacing matches with <<category:id>> placeholders.
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
      const id = this.store(match.text, match.category);
      result += `<<${match.category}:${id}>>`;
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
   * Rehydrate a single placeholder or text containing placeholders.
   * Returns the text with all <<category:id>> replaced with original values.
   */
  rehydrate(text: string): RehydrateResult {
    if (this.destroyed) throw new Error("Vault has been destroyed");

    const placeholderRe = /<<([a-z]{2,8}):([0-9a-f]{12})>>/g;
    let count = 0;

    const result = text.replace(placeholderRe, (_match, _category, id) => {
      const entry = this.entries.get(id);
      if (!entry) return _match; // unknown placeholder, leave as-is
      count++;
      return this.decrypt(entry);
    });

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
