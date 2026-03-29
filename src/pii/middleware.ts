/**
 * PII Middleware — glue between TierFlow's request pipeline and the vault.
 *
 * Provides message-level scrub/rehydrate functions and a streaming-safe
 * carry-buffer rehydration for SSE chunks.
 */

import { VaultStore } from "./vault-store.js";
import { logger } from "../logger.js";
import type { ChatMessage } from "../provider.js";

// ─── Singleton vault store ───

export const piiVaultStore = new VaultStore();

// ─── Types ───

export interface ScrubResult {
  messages: ChatMessage[];
  sessionId: string;
  scrubbed: boolean;
  categories: string[];
}

// ─── Message Scrubbing ───

/**
 * Deep-clone a ChatMessage to avoid mutating the original.
 */
function cloneMessage(msg: ChatMessage): ChatMessage {
  return JSON.parse(JSON.stringify(msg));
}

/**
 * Scrub PII from all message content fields.
 * - Skips system/developer role messages (warns if PII-like patterns detected)
 * - Handles both string content and OpenAI array-format content
 * - Scrubs type: "text" and type: "tool_result" entries in array content
 * - Scrubs tool_calls arguments (can contain user data)
 * - Deep-copies messages (originals untouched)
 */
export function scrubMessages(
  messages: ChatMessage[],
  exclude?: string[],
  scrubSystem?: boolean,
): ScrubResult {
  const sessionId = piiVaultStore.generateId();
  const vault = piiVaultStore.getOrCreate(sessionId, exclude);

  const allCategories = new Set<string>();
  let totalScrubbed = false;
  const scrubbedMessages: ChatMessage[] = [];

  // M-1: PII-like check for system messages (warn-only, no scrub)
  // Covers: emails, SSNs, phones, API keys, connection strings, Bearer tokens, PEM blocks
  const piiHintRe =
    /[\w.+'-]+@[\w-]+\.[\w.]{2,}|\b\d{3}[- ]\d{2}[- ]\d{4}\b|\+\d{1,3}[\s.-]?\d|sk-ant-[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{20,}|(?:postgres|mysql|mongodb|redis):\/\/|Bearer\s+[A-Za-z0-9._~+\/=-]{20,}|-----BEGIN [A-Z ]+-----/;

  for (const msg of messages) {
    // System/developer messages: scrub if opt-in, otherwise warn-only
    if (msg.role === "system" || msg.role === "developer") {
      if (scrubSystem) {
        // Opt-in: scrub system/developer messages like any other message
        const clone = cloneMessage(msg);
        if (typeof clone.content === "string" && clone.content) {
          const result = vault.redact(clone.content);
          if (result.count > 0) {
            clone.content = result.text;
            totalScrubbed = true;
            result.categories.forEach((c) => allCategories.add(c));
            logger.info(`[PII] Scrubbed ${result.count} items from ${msg.role} message`);
          }
        } else if (Array.isArray(clone.content)) {
          for (const block of clone.content) {
            if (block.type === "text" && block.text) {
              const result = vault.redact(block.text);
              if (result.count > 0) {
                block.text = result.text;
                totalScrubbed = true;
                result.categories.forEach((c) => allCategories.add(c));
                logger.info(
                  `[PII] Scrubbed ${result.count} items from ${msg.role} message (array)`,
                );
              }
            }
          }
        }
        scrubbedMessages.push(clone);
      } else {
        const text = typeof msg.content === "string" ? msg.content : "";
        if (text && piiHintRe.test(text)) {
          logger.warn(
            `[PII] WARNING: system/developer message may contain PII — not scrubbed (enable scrub_system to scrub)`,
          );
        }
        scrubbedMessages.push(msg); // pass through unmodified
      }
      continue;
    }

    const clone = cloneMessage(msg);

    // Scrub content
    if (typeof clone.content === "string" && clone.content) {
      const result = vault.redact(clone.content);
      if (result.count > 0) {
        clone.content = result.text;
        totalScrubbed = true;
        result.categories.forEach((c) => allCategories.add(c));
      }
    } else if (Array.isArray(clone.content)) {
      for (const block of clone.content) {
        if (block.type === "text" && block.text) {
          const result = vault.redact(block.text);
          if (result.count > 0) {
            block.text = result.text;
            totalScrubbed = true;
            result.categories.forEach((c) => allCategories.add(c));
          }
        } else if (block.type === "tool_result" && (block as any).content) {
          // C-4 fix: scrub Anthropic tool_result content blocks (string or array)
          const trContent = (block as any).content;
          if (typeof trContent === "string") {
            const result = vault.redact(trContent);
            if (result.count > 0) {
              (block as any).content = result.text;
              totalScrubbed = true;
              result.categories.forEach((c) => allCategories.add(c));
            }
          } else if (Array.isArray(trContent)) {
            // Handle nested array content in tool_result (e.g. [{type:"text",text:"..."}])
            for (const nested of trContent) {
              if (nested.type === "text" && nested.text) {
                const result = vault.redact(nested.text);
                if (result.count > 0) {
                  nested.text = result.text;
                  totalScrubbed = true;
                  result.categories.forEach((c) => allCategories.add(c));
                }
              }
            }
          }
        }
        // Images and other types pass through unchanged
      }
    }

    // Scrub tool_calls arguments
    if (clone.tool_calls) {
      for (const tc of clone.tool_calls) {
        if (tc.function?.arguments) {
          const result = vault.redact(tc.function.arguments);
          if (result.count > 0) {
            tc.function.arguments = result.text;
            totalScrubbed = true;
            result.categories.forEach((c) => allCategories.add(c));
          }
        }
      }
    }

    scrubbedMessages.push(clone);
  }

  // If nothing was scrubbed, destroy the session immediately
  if (!totalScrubbed) {
    piiVaultStore.destroy(sessionId);
  }

  const categories = [...allCategories];
  if (totalScrubbed) {
    logger.info(
      `[PII] Scrubbed ${vault.size} items (${categories.join(", ")}) for session ${sessionId.slice(0, 8)}`,
    );
  }

  return {
    messages: scrubbedMessages,
    sessionId,
    scrubbed: totalScrubbed,
    categories,
  };
}

// ─── Rehydration (Non-Streaming) ───

/**
 * Rehydrate a complete (non-streaming) response string.
 */
export function rehydrateText(text: string, sessionId: string): string {
  const vault = piiVaultStore.get(sessionId);
  if (!vault) {
    logger.warn(`[PII] WARNING: Rehydrate failed — session ${sessionId.slice(0, 8)} not found`);
    return text;
  }

  const result = vault.rehydrate(text);
  if (result.count > 0) {
    logger.info(`[PII] Rehydrated ${result.count} items — session ${sessionId.slice(0, 8)}`);
  }
  return result.text;
}

// ─── Rehydration (Streaming) ───

// Max placeholder length across all templates:
// p0{12hex}://placeholder/db = 33 chars (conn is longest)
const MAX_PLACEHOLDER_LEN = 40;

/**
 * Rehydrate a streaming chunk, handling split placeholders via carry buffer.
 *
 * Strategy: use vault.rehydrate() on the combined text, then check if the
 * remaining text could end with a partial placeholder by looking for the
 * universal p0 marker or characters that could start one.
 *
 * Returns { output, carry } where carry is a potential partial placeholder
 * to prepend to the next chunk.
 */
export function rehydrateChunk(
  chunk: string,
  sessionId: string,
  carry: string,
): { output: string; carry: string } {
  const vault = piiVaultStore.get(sessionId);
  if (!vault) return { output: carry + chunk, carry: "" };

  const text = carry + chunk;

  // 1. Split out any partial placeholder at the end
  const { output: safeOutput, carry: newCarry } = splitAtPartial(text);

  // 3. Rehydrate safe output (per-type patterns + guarded fallback).
  //    vault.rehydrate() skips fallback when all entries were matched by per-type
  //    patterns, avoiding unnecessary scanning of rehydrated text.
  if (safeOutput) {
    const result = vault.rehydrate(safeOutput);
    return { output: result.text, carry: newCarry };
  }

  return { output: "", carry: newCarry };
}

/**
 * Split text at a potential partial placeholder near the end.
 *
 * All placeholders start with p0{12hex}, so we only need to find
 * a trailing p0 + partial hex or p0{12hex} + partial suffix.
 */
function splitAtPartial(text: string): { output: string; carry: string } {
  // Search for p0 within the last MAX_PLACEHOLDER_LEN chars
  const searchStart = Math.max(0, text.length - MAX_PLACEHOLDER_LEN);
  const window = text.slice(searchStart);

  const p0Idx = window.lastIndexOf("p0");
  if (p0Idx !== -1) {
    const afterP0 = window.slice(p0Idx + 2);
    const hexMatch = afterP0.match(/^[0-9a-f]{0,12}/);
    const hexLen = hexMatch ? hexMatch[0].length : 0;

    if (hexLen < 12) {
      // Incomplete hex ID — definitely partial, hold in carry from p0
      const globalCarryStart = searchStart + p0Idx;
      return {
        output: text.slice(0, globalCarryStart),
        carry: text.slice(globalCarryStart),
      };
    }

    if (hexLen === 12) {
      // Full hex ID. Check if the suffix is complete.
      const afterHex = afterP0.slice(12);
      if (isPartialSuffix(afterHex)) {
        const globalCarryStart = searchStart + p0Idx;
        return {
          output: text.slice(0, globalCarryStart),
          carry: text.slice(globalCarryStart),
        };
      }
    }
  }

  // Check for trailing "p" that could start "p0"
  if (text.endsWith("p") && text.length > 0) {
    return { output: text.slice(0, -1), carry: "p" };
  }

  return { output: text, carry: "" };
}

/**
 * Check if a string after p0{12hex} is a partial (incomplete) suffix.
 * All suffixes start with a non-hex character, so an empty string means
 * we're waiting for the suffix to arrive.
 */
function isPartialSuffix(s: string): boolean {
  // All templates have a suffix after p0{hex}. If nothing follows yet, hold in carry.
  if (s.length === 0) return true;

  const completeSuffixes = [
    "@maildomain.com", // email
    "-placeholder-token", // cred
    "-placeholder-key", // apikey
    "://placeholder/db", // conn
    "-0000-card", // cc
    // path: no suffix — placeholder is bare p0{hex}, rehydrated via (?=/) lookahead
    "-postcode", // post
    "-PII-KEY", // pem
    "-phone", // phone
    "-nino", // nino
    ".0.0.1", // ip
    "-ssn", // ssn
  ];
  // secret: -keyword (variable suffix, matched by p0{hex}-\w+ regex)

  // Check if s is a prefix of any complete suffix (partial → hold)
  for (const suffix of completeSuffixes) {
    if (suffix.startsWith(s) && s.length < suffix.length) {
      return true;
    }
  }

  // Check if s starts with "-" followed by word chars (could be secret keyword suffix)
  if (/^-\w*$/.test(s) && s.length < 20) {
    return true; // could be -password, -token, etc.
  }

  return false;
}

// ─── Session Cleanup ───

/**
 * Clean up a vault session after request completes.
 */
export function destroySession(sessionId: string): void {
  const hadSession = piiVaultStore.get(sessionId) !== undefined;
  piiVaultStore.destroy(sessionId);
  if (hadSession) {
    logger.info(`[PII] Session ${sessionId.slice(0, 8)} destroyed`);
  }
}
