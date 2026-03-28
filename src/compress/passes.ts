/**
 * CtxPack — Compression passes.
 *
 * Each pass is a pure function: string → string.
 * Passes are ordered by safety (least lossy first).
 * Zero external dependencies.
 */

// ─── Pass 1: Strip ANSI escape codes ───

const ANSI_RE = /\x1b\[[0-9;]*[A-Za-z]|\x1b\][^\x07]*\x07|\x1b\(B/g;

export function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, "");
}

// ─── Pass 2: Collapse whitespace ───

export function collapseWhitespace(text: string): string {
  // Trim trailing whitespace on each line
  let result = text.replace(/[ \t]+$/gm, "");
  // Collapse 3+ consecutive blank lines into 1
  result = result.replace(/\n{3,}/g, "\n\n");
  return result;
}

// ─── Pass 3: Compact JSON blocks ───

const JSON_BLOCK_RE = /```json\s*\n([\s\S]*?)```/g;
const LOOSE_JSON_RE = /^(\s*)\{[\s\S]*?\n\1\}/gm;

/**
 * Compact pretty-printed JSON found in the text.
 * Handles both fenced ```json blocks and loose JSON objects.
 * If JSON.parse fails, the block is left unchanged.
 */
export function compactJson(text: string): string {
  // Fenced JSON blocks
  let result = text.replace(JSON_BLOCK_RE, (_match, body: string) => {
    try {
      const parsed = JSON.parse(body.trim());
      return "```json\n" + JSON.stringify(parsed) + "\n```";
    } catch {
      return _match;
    }
  });

  // Loose multi-line JSON (indented objects spanning 3+ lines)
  result = result.replace(LOOSE_JSON_RE, (match) => {
    // Only compact if it spans multiple lines (worth compacting)
    if (match.split("\n").length < 3) return match;
    try {
      const parsed = JSON.parse(match.trim());
      return JSON.stringify(parsed);
    } catch {
      return match;
    }
  });

  return result;
}

// ─── Pass 4: Deduplicate consecutive lines ───

/**
 * Collapse runs of 3+ identical consecutive lines into `line (×N)`.
 */
export function deduplicateLines(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  let i = 0;

  while (i < lines.length) {
    let runLen = 1;
    while (i + runLen < lines.length && lines[i + runLen] === lines[i]) {
      runLen++;
    }
    if (runLen >= 3) {
      out.push(`${lines[i]} (×${runLen})`);
    } else {
      for (let j = 0; j < runLen; j++) out.push(lines[i]);
    }
    i += runLen;
  }

  return out.join("\n");
}

// ─── Pass 5: Strip code comments ───

// Matches // comments but NOT inside strings or URLs (://),
// and only within fenced code blocks
const CODE_BLOCK_RE = /```(\w*)\s*\n([\s\S]*?)```/g;
const LINE_COMMENT_RE = /^(\s*)\/\/(?!\/).*$/gm;
const HASH_COMMENT_RE = /^(\s*)#(?!!).*$/gm;

/**
 * Strip single-line comments from fenced code blocks.
 * Detects language from fence and applies appropriate comment syntax.
 * Preserves shebangs (#!) and doc comments (///).
 */
export function stripComments(text: string): string {
  return text.replace(CODE_BLOCK_RE, (match, lang: string, body: string) => {
    const l = lang.toLowerCase();
    let stripped = body;

    // JS/TS/Java/C/Go/Rust style: // comments
    if (
      [
        "js",
        "ts",
        "javascript",
        "typescript",
        "java",
        "c",
        "cpp",
        "go",
        "rust",
        "swift",
        "kotlin",
        "",
      ].includes(l)
    ) {
      stripped = stripped.replace(LINE_COMMENT_RE, (m, indent: string) => {
        // Keep if it looks like a URL was on the line
        return "";
      });
    }

    // Python/Ruby/Shell style: # comments
    if (["py", "python", "rb", "ruby", "sh", "bash", "zsh", "yaml", "yml", "toml"].includes(l)) {
      stripped = stripped.replace(HASH_COMMENT_RE, "");
    }

    // Clean up resulting blank lines
    stripped = stripped.replace(/\n{3,}/g, "\n\n");

    return "```" + lang + "\n" + stripped + "```";
  });
}

// ─── Pass 6: Trim verbose patterns ───

// Collapse repeated stack frames
const STACK_FRAME_RE = /^(\s+at\s+.+\n){4,}/gm;

/**
 * Trim verbose patterns:
 * - Collapse long stack traces (keep first 3 + last 1 + count)
 * - Shorten absolute home directory paths to ~/
 */
export function trimVerbose(text: string, homeDir?: string): string {
  let result = text;

  // Collapse stack traces: keep first 3 frames + last + "... (N more)"
  result = result.replace(STACK_FRAME_RE, (match) => {
    const frames = match.trimEnd().split("\n");
    if (frames.length <= 4) return match;
    const kept = [
      ...frames.slice(0, 3),
      `    ... (${frames.length - 4} more frames)`,
      frames[frames.length - 1],
    ];
    return kept.join("\n") + "\n";
  });

  // Shorten home directory paths
  if (homeDir) {
    const escaped = homeDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    result = result.replace(new RegExp(escaped, "g"), "~");
  }

  return result;
}

// ─── Pass registry ───

export type PassName = "ansi" | "whitespace" | "json" | "dedup" | "comments" | "verbose";

export const ALL_PASSES: PassName[] = [
  "ansi",
  "whitespace",
  "json",
  "dedup",
  "comments",
  "verbose",
];

export const PASS_FNS: Record<PassName, (text: string) => string> = {
  ansi: stripAnsi,
  whitespace: collapseWhitespace,
  json: compactJson,
  dedup: deduplicateLines,
  comments: stripComments,
  verbose: (text) => trimVerbose(text, process.env.HOME),
};
