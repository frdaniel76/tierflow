/**
 * Unit tests for CtxPack compressMessages() middleware.
 *
 * Usage:
 *   npx tsx test/compress-middleware.test.ts
 */

import { compressMessages, compressText } from "../src/compress/index.js";
import type { ChatMessage } from "../src/provider.js";

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
  if (actual !== expected) throw new Error(msg || `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function assertIncludes(haystack: string, needle: string, msg?: string) {
  if (!haystack.includes(needle)) throw new Error(msg || `Expected to include "${needle}"`);
}

function assertNotIncludes(haystack: string, needle: string, msg?: string) {
  if (haystack.includes(needle)) throw new Error(msg || `Expected NOT to include "${needle}"`);
}

// ═══════════════════════════════════════════
// compressText()
// ═══════════════════════════════════════════

async function compressTextTests() {
  console.log("\n=== compressText() ===\n");

  await test("applies all passes by default", () => {
    const input = "\x1b[31merror\x1b[0m\n\n\n\nmore   ";
    const result = compressText(input);
    assertNotIncludes(result, "\x1b");
    // Should not have 3+ blank lines
    assert(!result.includes("\n\n\n"), "Should collapse blank lines");
  });

  await test("applies only selected passes", () => {
    const input = "\x1b[31merror\x1b[0m\n\n\n\nmore   ";
    const result = compressText(input, ["ansi"]);
    // ANSI stripped but whitespace NOT collapsed
    assertNotIncludes(result, "\x1b");
    assertIncludes(result, "\n\n\n");
  });

  await test("handles empty string", () => {
    assertEqual(compressText(""), "");
  });

  await test("handles plain text with nothing to compress", () => {
    const input = "Hello world";
    assertEqual(compressText(input), input);
  });
}

// ═══════════════════════════════════════════
// compressMessages() — system message handling
// ═══════════════════════════════════════════

async function systemMessageTests() {
  console.log("\n=== compressMessages() — System Messages ===\n");

  await test("skips system messages by default", () => {
    const msgs: ChatMessage[] = [
      { role: "system", content: "\x1b[31msystem with ANSI\x1b[0m   " },
      { role: "user", content: "\x1b[31muser with ANSI\x1b[0m   " },
    ];
    const result = compressMessages(msgs);
    const sysContent = result.messages[0].content as string;
    const userContent = result.messages[1].content as string;
    assertIncludes(sysContent, "\x1b", "System should still have ANSI");
    assertNotIncludes(userContent, "\x1b", "User should be cleaned");
  });

  await test("compresses system messages when opted in", () => {
    const msgs: ChatMessage[] = [
      { role: "system", content: "\x1b[31msystem with ANSI\x1b[0m   " },
    ];
    const result = compressMessages(msgs, undefined, true);
    const content = result.messages[0].content as string;
    assertNotIncludes(content, "\x1b", "System should be cleaned when opted in");
  });

  await test("skips developer messages by default", () => {
    const msgs: ChatMessage[] = [
      { role: "developer", content: "\x1b[31mdev with ANSI\x1b[0m" },
    ];
    const result = compressMessages(msgs);
    assertIncludes(result.messages[0].content as string, "\x1b");
  });
}

// ═══════════════════════════════════════════
// compressMessages() — content formats
// ═══════════════════════════════════════════

async function contentFormatTests() {
  console.log("\n=== compressMessages() — Content Formats ===\n");

  await test("handles string content", () => {
    const msgs: ChatMessage[] = [
      { role: "user", content: "hello\n\n\n\nworld   " },
    ];
    const result = compressMessages(msgs);
    const content = result.messages[0].content as string;
    assertEqual(content, "hello\n\nworld");
    assert(result.compressed, "Should be marked compressed");
  });

  await test("handles array content with text blocks", () => {
    const msgs: ChatMessage[] = [
      {
        role: "user",
        content: [
          { type: "text", text: "\x1b[31mred text\x1b[0m   " },
          { type: "image_url", image_url: { url: "data:..." } },
        ],
      },
    ];
    const result = compressMessages(msgs);
    const blocks = result.messages[0].content as any[];
    assertNotIncludes(blocks[0].text, "\x1b");
    assertEqual(blocks[1].type, "image_url"); // untouched
  });

  await test("handles null content", () => {
    const msgs: ChatMessage[] = [
      { role: "assistant", content: null },
    ];
    const result = compressMessages(msgs);
    assertEqual(result.messages[0].content, null);
    assert(!result.compressed, "Null content should not count as compressed");
  });

  await test("handles tool_calls with JSON arguments", () => {
    const msgs: ChatMessage[] = [
      {
        role: "assistant",
        content: null,
        tool_calls: [{
          id: "call_1",
          type: "function" as const,
          function: {
            name: "test",
            arguments: '{\n  "key": "value",\n  "num": 42\n}',
          },
        }],
      },
    ];
    const result = compressMessages(msgs);
    const args = result.messages[0].tool_calls![0].function.arguments;
    assertEqual(args, '{"key":"value","num":42}');
  });
}

// ═══════════════════════════════════════════
// compressMessages() — savings tracking
// ═══════════════════════════════════════════

async function savingsTests() {
  console.log("\n=== compressMessages() — Savings Tracking ===\n");

  await test("reports token savings", () => {
    const verbose = "line\n".repeat(100) + "\n\n\n\n\n";
    const msgs: ChatMessage[] = [{ role: "user", content: verbose }];
    const result = compressMessages(msgs);
    assert(result.tokensBefore > result.tokensAfter, "Should save tokens");
    assert(result.savings > 0, "Savings should be positive");
  });

  await test("reports 0% savings when nothing compressible", () => {
    const msgs: ChatMessage[] = [{ role: "user", content: "hello" }];
    const result = compressMessages(msgs);
    assertEqual(result.savings, 0);
    assert(!result.compressed, "Should not be marked compressed");
  });

  await test("does not mutate original messages", () => {
    const original: ChatMessage[] = [
      { role: "user", content: "\x1b[31mred\x1b[0m" },
    ];
    const originalContent = original[0].content;
    compressMessages(original);
    assertEqual(original[0].content, originalContent, "Original should be unchanged");
  });
}

// ═══════════════════════════════════════════
// compressMessages() — real-world patterns
// ═══════════════════════════════════════════

async function realWorldTests() {
  console.log("\n=== compressMessages() — Real-World Patterns ===\n");

  await test("compresses verbose shell output", () => {
    const shellOutput = [
      "\x1b[32m✓\x1b[0m test1 passed",
      "\x1b[32m✓\x1b[0m test2 passed",
      "\x1b[32m✓\x1b[0m test3 passed",
      "",
      "",
      "",
      "",
      "Done.",
    ].join("\n");
    const msgs: ChatMessage[] = [{ role: "user", content: shellOutput }];
    const result = compressMessages(msgs);
    const content = result.messages[0].content as string;
    assertNotIncludes(content, "\x1b");
    assert(!content.includes("\n\n\n"), "Should collapse blank lines");
  });

  await test("compresses pretty-printed JSON response", () => {
    const json = '```json\n{\n  "users": [\n    {\n      "id": 1,\n      "name": "Alice"\n    }\n  ]\n}\n```';
    const msgs: ChatMessage[] = [{ role: "user", content: json }];
    const result = compressMessages(msgs);
    const content = result.messages[0].content as string;
    assertIncludes(content, '"users":[{"id":1,"name":"Alice"}]');
  });

  await test("compresses code with comments", () => {
    const code = "```js\n// Initialize the app\nconst app = express();\n// Set up routes\napp.get('/', handler);\n```";
    const msgs: ChatMessage[] = [{ role: "user", content: code }];
    const result = compressMessages(msgs);
    const content = result.messages[0].content as string;
    assertNotIncludes(content, "Initialize the app");
    assertIncludes(content, "const app = express();");
  });

  await test("compresses repeated log lines", () => {
    const logs = "Processing...\n".repeat(10) + "Done.";
    const msgs: ChatMessage[] = [{ role: "user", content: logs }];
    const result = compressMessages(msgs);
    const content = result.messages[0].content as string;
    assertIncludes(content, "×");
    assert(result.savings > 0, "Should report savings");
  });

  await test("handles multi-message conversation", () => {
    const msgs: ChatMessage[] = [
      { role: "system", content: "You are a helper." },
      { role: "user", content: "\x1b[31mHello\x1b[0m\n\n\n\n" },
      { role: "assistant", content: "Hi there!" },
      { role: "user", content: "```json\n{\n  \"a\": 1\n}\n```" },
    ];
    const result = compressMessages(msgs);
    // System untouched
    assertIncludes(result.messages[0].content as string, "You are a helper.");
    // User messages compressed
    assertNotIncludes(result.messages[1].content as string, "\x1b");
    // Assistant passes through
    assertEqual(result.messages[2].content, "Hi there!");
    // JSON compacted
    assertIncludes(result.messages[3].content as string, '{"a":1}');
  });
}

// ═══════════════════════════════════════════
// Run all
// ═══════════════════════════════════════════

(async () => {
  console.log("CtxPack — Middleware Tests");

  await compressTextTests();
  await systemMessageTests();
  await contentFormatTests();
  await savingsTests();
  await realWorldTests();

  console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
})();
