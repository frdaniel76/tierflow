/**
 * PII Middleware — glue between FreeRouter's request pipeline and the vault.
 *
 * Provides message-level scrub/rehydrate functions and a streaming-safe
 * carry-buffer rehydration for SSE chunks.
 */

import { SecretVault } from "./vault.js";
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
 * Extract text content from a message, handling both string and array formats.
 */
function getTextContent(content: ChatMessage["content"]): string {
  if (typeof content === "string") return content;
  if (content === null || content === undefined) return "";
  return content
    .filter(b => b.type === "text")
    .map(b => b.text ?? "")
    .join("\n");
}

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
): ScrubResult {
  const sessionId = piiVaultStore.generateId();
  const vault = piiVaultStore.getOrCreate(sessionId, exclude);

  const allCategories = new Set<string>();
  let totalScrubbed = false;
  const scrubbedMessages: ChatMessage[] = [];

  // M-1: simple PII-like check for system messages (warn-only, no scrub)
  const piiHintRe = /[\w.+'-]+@[\w-]+\.[\w.]{2,}|\b\d{3}[- ]?\d{2}[- ]?\d{4}\b|\+\d{1,3}[\s.-]?\d/;

  for (const msg of messages) {
    // Skip system/developer messages but warn if PII-like content detected
    if (msg.role === "system" || msg.role === "developer") {
      const text = typeof msg.content === "string" ? msg.content : "";
      if (text && piiHintRe.test(text)) {
        logger.warn(`[PII] WARNING: system/developer message may contain PII — not scrubbed by design`);
      }
      scrubbedMessages.push(msg); // pass through unmodified
      continue;
    }

    const clone = cloneMessage(msg);

    // Scrub content
    if (typeof clone.content === "string" && clone.content) {
      const result = vault.redact(clone.content);
      if (result.count > 0) {
        clone.content = result.text;
        totalScrubbed = true;
        result.categories.forEach(c => allCategories.add(c));
      }
    } else if (Array.isArray(clone.content)) {
      for (const block of clone.content) {
        if (block.type === "text" && block.text) {
          const result = vault.redact(block.text);
          if (result.count > 0) {
            block.text = result.text;
            totalScrubbed = true;
            result.categories.forEach(c => allCategories.add(c));
          }
        } else if (block.type === "tool_result" && typeof (block as any).content === "string" && (block as any).content) {
          // C-4 fix: scrub Anthropic tool_result content blocks
          const result = vault.redact((block as any).content);
          if (result.count > 0) {
            (block as any).content = result.text;
            totalScrubbed = true;
            result.categories.forEach(c => allCategories.add(c));
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
            result.categories.forEach(c => allCategories.add(c));
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
    logger.info(`[PII] Scrubbed ${vault.size} items (${categories.join(", ")}) for session ${sessionId.slice(0, 8)}`);
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
export function rehydrateText(
  text: string,
  sessionId: string,
): string {
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

/**
 * Rehydrate a streaming chunk, handling split placeholders via carry buffer.
 *
 * Returns { output, carry } where carry is an incomplete placeholder suffix
 * to prepend to the next chunk.
 *
 * Carry buffer max size: 24 chars (<<type:hexid>> max = 24).
 * If carry exceeds this, it's not a placeholder — flush it.
 */
export function rehydrateChunk(
  chunk: string,
  sessionId: string,
  carry: string,
): { output: string; carry: string } {
  const vault = piiVaultStore.get(sessionId);
  if (!vault) return { output: carry + chunk, carry: "" };

  const text = carry + chunk;

  // Find all complete placeholders and rehydrate them
  const placeholderRegex = /<<([a-z]{2,8}):([0-9a-f]{12})>>/g;
  let result = "";
  let lastEnd = 0;

  for (const match of text.matchAll(placeholderRegex)) {
    result += text.slice(lastEnd, match.index!);
    const rehydrated = vault.rehydrate(match[0]);
    result += rehydrated.text;
    lastEnd = match.index! + match[0].length;
  }

  // Check for a partial placeholder at the end
  const remaining = text.slice(lastEnd);
  const partialStart = remaining.lastIndexOf("<<");

  if (partialStart !== -1) {
    const afterPartial = remaining.slice(partialStart);
    // Max placeholder length: << (2) + type (8) + : (1) + hexid (12) + >> (2) = 25 chars
    // M-4 fix: use <= 25 to avoid off-by-one on max-length partial
    if (afterPartial.length <= 25 && !afterPartial.includes(">>")) {
      // Partial match — hold it in carry
      result += remaining.slice(0, partialStart);
      return { output: result, carry: afterPartial };
    }
  }

  // Check for a trailing single "<" that could be the first char of "<<"
  if (remaining.endsWith("<") && partialStart === -1) {
    result += remaining.slice(0, -1);
    return { output: result, carry: "<" };
  }

  // No partial — flush everything
  result += remaining;
  return { output: result, carry: "" };
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
