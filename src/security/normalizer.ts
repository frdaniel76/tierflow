/**
 * Input normalizer for security scanning.
 * Defeats common evasion techniques before pattern matching.
 */

// Zero-width and invisible characters
const ZERO_WIDTH_RE = /[\u200B\u200C\u200D\u200E\u200F\u2060\u2061\u2062\u2063\u2064\uFEFF\u00AD\u034F\u061C\u180E]/g;

// Spaced-letter detection: "i g n o r e" → "ignore"
const SPACED_LETTERS_RE = /\b([a-zA-Z])\s+(?=[a-zA-Z]\s+[a-zA-Z])/g;

// Leet speak map
const LEET_MAP: Record<string, string> = {
  "0": "o", "1": "i", "3": "e", "4": "a", "5": "s",
  "7": "t", "8": "b", "9": "g", "@": "a", "$": "s",
  "!": "i", "|": "l", "+": "t",
};
const LEET_RE = /[01345789@$!|+]/g;

// HTML tags
const HTML_TAG_RE = /<[^>]{1,500}>/g;

// HTML entities
const HTML_ENTITIES: Record<string, string> = {
  "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"',
  "&#39;": "'", "&apos;": "'", "&nbsp;": " ",
};
const HTML_ENTITY_RE = /&(?:amp|lt|gt|quot|apos|nbsp|#39);/gi;

// Base64 detection: 20+ chars of base64 alphabet
const BASE64_BLOCK_RE = /[A-Za-z0-9+/]{20,}={0,2}/g;

/**
 * Normalize text to defeat evasion techniques.
 * Returns the normalized string for additional scanning.
 */
export function normalize(text: string): string {
  let result = text;

  // 1. Strip zero-width characters
  result = result.replace(ZERO_WIDTH_RE, "");

  // 2. Collapse spaced letters ("i g n o r e" → "ignore")
  result = collapseSpacedLetters(result);

  // 3. Leet speak → normal
  result = result.replace(LEET_RE, (ch) => LEET_MAP[ch] ?? ch);

  // 4. Strip HTML tags
  result = result.replace(HTML_TAG_RE, " ");

  // 5. Decode HTML entities
  result = result.replace(HTML_ENTITY_RE, (entity) => HTML_ENTITIES[entity.toLowerCase()] ?? entity);

  // 6. Try base64 decode on suspicious blocks
  result = decodeBase64Blocks(result);

  return result;
}

/**
 * Collapse sequences like "i g n o r e" into "ignore".
 * Only collapses runs of 4+ single characters separated by spaces.
 */
function collapseSpacedLetters(text: string): string {
  return text.replace(
    /(?<![a-zA-Z])([a-zA-Z])\s+([a-zA-Z])\s+([a-zA-Z])\s+([a-zA-Z])(?:\s+([a-zA-Z]))*/g,
    (match) => match.replace(/\s+/g, ""),
  );
}

/**
 * Find base64-encoded blocks and decode them inline.
 * Only decodes blocks that produce printable text.
 */
function decodeBase64Blocks(text: string): string {
  return text.replace(BASE64_BLOCK_RE, (block) => {
    try {
      const decoded = Buffer.from(block, "base64").toString("utf-8");
      // Only use decoded version if it's mostly printable ASCII/Unicode
      const printableRatio = [...decoded].filter((c) => c.charCodeAt(0) >= 32).length / decoded.length;
      if (printableRatio > 0.8 && decoded.length > 4) {
        return decoded + " " + block; // Keep original too for pattern matching
      }
    } catch {
      // Not valid base64
    }
    return block;
  });
}
