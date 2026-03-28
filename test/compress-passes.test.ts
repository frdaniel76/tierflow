/**
 * Unit tests for CtxPack compression passes.
 *
 * Usage:
 *   npx tsx test/compress-passes.test.ts
 */

import {
  stripAnsi,
  collapseWhitespace,
  compactJson,
  deduplicateLines,
  stripComments,
  trimVerbose,
} from "../src/compress/passes.js";

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>) {
  process.stdout.write(`  ${name} ... `);
  try {
    await fn();
    console.log("PASS");
    passed++;
  } catch (err) {
    console.log("FAIL");
    console.error(`    ${err instanceof Error ? err.message : String(err)}`);
    failed++;
  }
}

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(msg);
}

function assertEqual<T>(actual: T, expected: T, msg?: string) {
  if (actual !== expected)
    throw new Error(msg || `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function assertNotIncludes(haystack: string, needle: string, msg?: string) {
  if (haystack.includes(needle)) throw new Error(msg || `Expected NOT to include "${needle}"`);
}

function assertIncludes(haystack: string, needle: string, msg?: string) {
  if (!haystack.includes(needle)) throw new Error(msg || `Expected to include "${needle}"`);
}

// ═══════════════════════════════════════════
// Pass 1: Strip ANSI
// ═══════════════════════════════════════════

async function ansiTests() {
  console.log("\n=== Pass 1: Strip ANSI ===\n");

  await test("strips color codes", () => {
    assertEqual(stripAnsi("\x1b[31merror\x1b[0m"), "error");
  });

  await test("strips bold/underline", () => {
    assertEqual(stripAnsi("\x1b[1mbold\x1b[0m \x1b[4munderline\x1b[0m"), "bold underline");
  });

  await test("strips 256-color codes", () => {
    assertEqual(stripAnsi("\x1b[38;5;196mred\x1b[0m"), "red");
  });

  await test("strips OSC sequences", () => {
    assertEqual(stripAnsi("\x1b]0;title\x07text"), "text");
  });

  await test("passes through clean text unchanged", () => {
    const clean = "Hello, world!";
    assertEqual(stripAnsi(clean), clean);
  });

  await test("handles empty string", () => {
    assertEqual(stripAnsi(""), "");
  });
}

// ═══════════════════════════════════════════
// Pass 2: Collapse Whitespace
// ═══════════════════════════════════════════

async function whitespaceTests() {
  console.log("\n=== Pass 2: Collapse Whitespace ===\n");

  await test("trims trailing spaces", () => {
    assertEqual(collapseWhitespace("hello   \nworld  "), "hello\nworld");
  });

  await test("trims trailing tabs", () => {
    assertEqual(collapseWhitespace("hello\t\t\nworld"), "hello\nworld");
  });

  await test("collapses 3+ blank lines to 1", () => {
    assertEqual(collapseWhitespace("a\n\n\n\nb"), "a\n\nb");
  });

  await test("keeps 2 blank lines", () => {
    assertEqual(collapseWhitespace("a\n\nb"), "a\n\nb");
  });

  await test("collapses 5 blank lines", () => {
    assertEqual(collapseWhitespace("a\n\n\n\n\nb"), "a\n\nb");
  });

  await test("preserves leading indentation", () => {
    assertEqual(collapseWhitespace("  hello\n    world"), "  hello\n    world");
  });
}

// ═══════════════════════════════════════════
// Pass 3: Compact JSON
// ═══════════════════════════════════════════

async function jsonTests() {
  console.log("\n=== Pass 3: Compact JSON ===\n");

  await test("compacts fenced JSON block", () => {
    const input = '```json\n{\n  "name": "Alice",\n  "age": 30\n}\n```';
    const result = compactJson(input);
    assertIncludes(result, '{"name":"Alice","age":30}');
    assertNotIncludes(result, "  ");
  });

  await test("preserves invalid JSON in fenced block", () => {
    const input = "```json\n{ invalid json\n```";
    assertEqual(compactJson(input), input);
  });

  await test("compacts loose multi-line JSON", () => {
    const input = '{\n  "key": "value",\n  "num": 42\n}';
    const result = compactJson(input);
    assertEqual(result, '{"key":"value","num":42}');
  });

  await test("leaves short JSON alone", () => {
    const input = '{"a": 1}';
    assertEqual(compactJson(input), input);
  });

  await test("handles nested objects", () => {
    const input = '```json\n{\n  "user": {\n    "name": "Bob"\n  }\n}\n```';
    const result = compactJson(input);
    assertIncludes(result, '{"user":{"name":"Bob"}}');
  });

  await test("handles arrays", () => {
    const input = "```json\n[\n  1,\n  2,\n  3\n]\n```";
    const result = compactJson(input);
    assertIncludes(result, "[1,2,3]");
  });

  await test("passes through non-JSON text", () => {
    const input = "Hello world, this is not JSON";
    assertEqual(compactJson(input), input);
  });
}

// ═══════════════════════════════════════════
// Pass 4: Deduplicate Lines
// ═══════════════════════════════════════════

async function dedupTests() {
  console.log("\n=== Pass 4: Deduplicate Lines ===\n");

  await test("collapses 3+ identical lines", () => {
    const input = "ok\nok\nok";
    assertEqual(deduplicateLines(input), "ok (×3)");
  });

  await test("collapses 5 identical lines", () => {
    const input = "line\nline\nline\nline\nline";
    assertEqual(deduplicateLines(input), "line (×5)");
  });

  await test("keeps 2 identical lines as-is", () => {
    const input = "a\na\nb";
    assertEqual(deduplicateLines(input), "a\na\nb");
  });

  await test("handles multiple runs", () => {
    const input = "x\nx\nx\ny\ny\ny";
    const result = deduplicateLines(input);
    assertIncludes(result, "x (×3)");
    assertIncludes(result, "y (×3)");
  });

  await test("preserves unique lines", () => {
    const input = "a\nb\nc";
    assertEqual(deduplicateLines(input), input);
  });

  await test("handles empty lines in a run", () => {
    const input = "\n\n\n";
    assertEqual(deduplicateLines(input), " (×4)");
  });
}

// ═══════════════════════════════════════════
// Pass 5: Strip Comments
// ═══════════════════════════════════════════

async function commentTests() {
  console.log("\n=== Pass 5: Strip Comments ===\n");

  await test("strips // comments from JS code block", () => {
    const input =
      "```js\n// This is a comment\nconst x = 1;\n// Another comment\nconst y = 2;\n```";
    const result = stripComments(input);
    assertNotIncludes(result, "This is a comment");
    assertIncludes(result, "const x = 1;");
    assertIncludes(result, "const y = 2;");
  });

  await test("strips # comments from Python code block", () => {
    const input = "```python\n# This is a comment\nx = 1\n# Another\ny = 2\n```";
    const result = stripComments(input);
    assertNotIncludes(result, "This is a comment");
    assertIncludes(result, "x = 1");
  });

  await test("preserves shebangs", () => {
    const input = "```bash\n#!/bin/bash\n# comment\necho hello\n```";
    const result = stripComments(input);
    assertIncludes(result, "#!/bin/bash");
    assertNotIncludes(result, "# comment");
  });

  await test("does not strip comments outside code blocks", () => {
    const input = "// This should stay\n# And this too";
    assertEqual(stripComments(input), input);
  });

  await test("handles typescript fence", () => {
    const input = "```typescript\n// comment\nconst a = 1;\n```";
    const result = stripComments(input);
    assertNotIncludes(result, "// comment");
    assertIncludes(result, "const a = 1;");
  });

  await test("handles yaml fence with # comments", () => {
    const input = "```yaml\n# comment\nkey: value\n```";
    const result = stripComments(input);
    assertNotIncludes(result, "# comment");
    assertIncludes(result, "key: value");
  });
}

// ═══════════════════════════════════════════
// Pass 6: Trim Verbose
// ═══════════════════════════════════════════

async function verboseTests() {
  console.log("\n=== Pass 6: Trim Verbose ===\n");

  await test("collapses long stack traces", () => {
    const frames = Array.from({ length: 8 }, (_, i) => `    at func${i} (file.js:${i}:1)`);
    const input = "Error: something\n" + frames.join("\n") + "\n";
    const result = trimVerbose(input);
    assertIncludes(result, "at func0");
    assertIncludes(result, "at func1");
    assertIncludes(result, "at func2");
    assertIncludes(result, "4 more frames");
    assertIncludes(result, "at func7");
  });

  await test("keeps short stack traces (4 or fewer)", () => {
    const frames = Array.from({ length: 4 }, (_, i) => `    at func${i} (file.js:${i}:1)`);
    const input = frames.join("\n") + "\n";
    assertEqual(trimVerbose(input), input);
  });

  await test("shortens home directory paths", () => {
    const result = trimVerbose("/Users/testuser/Projects/test.js", "$HOME");
    assertEqual(result, "~/Projects/test.js");
  });

  await test("no change without home dir", () => {
    const input = "/Users/testuser/test.js";
    assertEqual(trimVerbose(input), input);
  });
}

// ═══════════════════════════════════════════
// Run all
// ═══════════════════════════════════════════

(async () => {
  console.log("CtxPack — Compression Passes Tests");

  await ansiTests();
  await whitespaceTests();
  await jsonTests();
  await dedupTests();
  await commentTests();
  await verboseTests();

  console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
})();
