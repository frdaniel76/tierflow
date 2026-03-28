/**
 * CtxPack Middleware — message-level context compression for TierFlow.
 *
 * Runs after PII scrub, before provider forwarding.
 * One-way transform (no rehydration needed on response).
 * Fail-open: on error, logs and passes uncompressed.
 */

import { ALL_PASSES, PASS_FNS } from "./passes.js";
import type { PassName } from "./passes.js";
import type { ChatMessage } from "../provider.js";

// ─── Types ───

export interface CompressResult {
  messages: ChatMessage[];
  compressed: boolean;
  tokensBefore: number;
  tokensAfter: number;
  savings: number; // percentage
}

// ─── Token estimation ───

/**
 * Fast token estimate: ~4 chars per token (GPT/Claude average).
 * Good enough for savings tracking — exact counting would need tiktoken.
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// ─── Text extraction helpers ───

function getTextContent(content: ChatMessage["content"]): string {
  if (typeof content === "string") return content;
  if (content === null || content === undefined) return "";
  return content
    .filter((b: any) => b.type === "text")
    .map((b: any) => b.text ?? "")
    .join("\n");
}

function cloneMessage(msg: ChatMessage): ChatMessage {
  return JSON.parse(JSON.stringify(msg));
}

// ─── Compression engine ───

/**
 * Apply selected compression passes to a text string.
 */
export function compressText(text: string, passes: PassName[] = ALL_PASSES): string {
  let result = text;
  for (const pass of passes) {
    const fn = PASS_FNS[pass];
    if (fn) result = fn(result);
  }
  return result;
}

/**
 * Compress all message content fields.
 * - Skips system/developer role messages by default
 * - Handles both string content and OpenAI array-format content
 * - Deep-copies messages (originals untouched)
 */
export function compressMessages(
  messages: ChatMessage[],
  passes: PassName[] = ALL_PASSES,
  compressSystem = false,
): CompressResult {
  let totalBefore = 0;
  let totalAfter = 0;
  let anyCompressed = false;

  const compressed = messages.map((msg) => {
    // Skip system/developer messages unless opted in
    if (!compressSystem && (msg.role === "system" || msg.role === "developer")) {
      const text = getTextContent(msg.content);
      const tokens = estimateTokens(text);
      totalBefore += tokens;
      totalAfter += tokens;
      return msg;
    }

    const clone = cloneMessage(msg);

    if (typeof clone.content === "string") {
      const before = clone.content;
      totalBefore += estimateTokens(before);
      clone.content = compressText(before, passes);
      totalAfter += estimateTokens(clone.content);
      if (clone.content !== before) anyCompressed = true;
    } else if (Array.isArray(clone.content)) {
      for (const block of clone.content) {
        if (typeof block.text === "string") {
          const before = block.text;
          totalBefore += estimateTokens(before);
          block.text = compressText(before, passes);
          totalAfter += estimateTokens(block.text);
          if (block.text !== before) anyCompressed = true;
        }
      }
    }

    // Compress tool call arguments (often contain verbose JSON)
    if (clone.tool_calls) {
      for (const tc of clone.tool_calls) {
        if (tc.function?.arguments && typeof tc.function.arguments === "string") {
          const before = tc.function.arguments;
          totalBefore += estimateTokens(before);
          tc.function.arguments = compressText(before, ["json", "whitespace"]);
          totalAfter += estimateTokens(tc.function.arguments);
          if (tc.function.arguments !== before) anyCompressed = true;
        }
      }
    }

    return clone;
  });

  const savings = totalBefore > 0 ? Math.round((1 - totalAfter / totalBefore) * 100) : 0;

  return {
    messages: compressed,
    compressed: anyCompressed,
    tokensBefore: totalBefore,
    tokensAfter: totalAfter,
    savings,
  };
}
