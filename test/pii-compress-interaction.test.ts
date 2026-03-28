/**
 * Tests for PII + CtxPack compression interaction.
 *
 * Verifies that PII placeholders survive compression passes intact,
 * and that the combined pipeline works correctly.
 *
 * Usage:
 *   npx tsx test/pii-compress-interaction.test.ts
 */

import { scrubMessages, rehydrateText, destroySession } from "../src/pii/index.js";
import { compressMessages, compressText } from "../src/compress/index.js";
import type { PassName } from "../src/compress/index.js";
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

function assertIncludes(haystack: string, needle: string, msg?: string) {
  if (!haystack.includes(needle)) throw new Error(msg || `Expected to include "${needle}"`);
}

function assertNotIncludes(haystack: string, needle: string, msg?: string) {
  if (haystack.includes(needle)) throw new Error(msg || `Expected NOT to include "${needle}"`);
}

// ═══════════════════════════════════════════
// PII placeholders survive all compression passes
// ═══════════════════════════════════════════

async function placeholderSurvivalTests() {
  console.log("\n=== PII Placeholders Survive Compression ===\n");

  await test("email placeholder survives all passes", async () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "Contact john@acme.com about the project" },
    ];
    const scrubResult = scrubMessages(messages);
    assert(scrubResult.scrubbed, "Should scrub email");
    const scrubbed = scrubResult.messages[0].content as string;
    assertNotIncludes(scrubbed, "john@acme.com");

    // Compress the scrubbed content
    const compressResult = compressMessages(scrubResult.messages);
    const compressed = compressResult.messages[0].content as string;

    // Placeholder must still be present and rehydratable
    const rehydrated = rehydrateText(compressed, scrubResult.sessionId);
    assertIncludes(rehydrated, "john@acme.com");
    destroySession(scrubResult.sessionId);
  });

  await test("API key placeholder survives compression", async () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "My key is sk-ant-api03-abcdefghijklmnop and it works" },
    ];
    const scrubResult = scrubMessages(messages);
    assert(scrubResult.scrubbed, "Should scrub API key");

    const compressResult = compressMessages(scrubResult.messages);
    const compressed = compressResult.messages[0].content as string;

    const rehydrated = rehydrateText(compressed, scrubResult.sessionId);
    assertIncludes(rehydrated, "sk-ant-api03-abcdefghijklmnop");
    destroySession(scrubResult.sessionId);
  });

  await test("phone placeholder survives compression", async () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "Call me at +44 7911 123456 please" },
    ];
    const scrubResult = scrubMessages(messages);
    assert(scrubResult.scrubbed, "Should scrub phone");

    const compressResult = compressMessages(scrubResult.messages);
    const compressed = compressResult.messages[0].content as string;

    const rehydrated = rehydrateText(compressed, scrubResult.sessionId);
    assertIncludes(rehydrated, "+44 7911 123456");
    destroySession(scrubResult.sessionId);
  });

  await test("IP address placeholder survives compression", async () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "The server is at 192.168.1.100 on port 8080" },
    ];
    const scrubResult = scrubMessages(messages);
    assert(scrubResult.scrubbed, "Should scrub IP");

    const compressResult = compressMessages(scrubResult.messages);
    const compressed = compressResult.messages[0].content as string;

    const rehydrated = rehydrateText(compressed, scrubResult.sessionId);
    assertIncludes(rehydrated, "192.168.1.100");
    destroySession(scrubResult.sessionId);
  });
}

// ═══════════════════════════════════════════
// PII + compression combined on verbose content
// ═══════════════════════════════════════════

async function combinedPipelineTests() {
  console.log("\n=== Combined PII + Compression Pipeline ===\n");

  await test("PII in repeated lines: scrub then dedup preserves placeholder", async () => {
    // Same email repeated many times (e.g. log output)
    const lines = Array.from({ length: 5 }, () => "User john@acme.com logged in").join("\n");
    const messages: ChatMessage[] = [{ role: "user", content: lines }];

    const scrubResult = scrubMessages(messages);
    assert(scrubResult.scrubbed, "Should scrub");
    const scrubbed = scrubResult.messages[0].content as string;

    // All lines should have the same placeholder (dedup in vault)
    const compressResult = compressMessages(scrubResult.messages);
    const compressed = compressResult.messages[0].content as string;

    // Rehydrate should recover the email
    const rehydrated = rehydrateText(compressed, scrubResult.sessionId);
    assertIncludes(rehydrated, "john@acme.com");
    destroySession(scrubResult.sessionId);
  });

  await test("PII in prose + JSON: scrub then compact preserves placeholder", async () => {
    // PII outside code block (scrubbed) + JSON inside code block (compacted)
    const content = 'Contact alice@example.com about:\n```json\n{\n  "task": "review",\n  "priority": "high"\n}\n```';
    const messages: ChatMessage[] = [{ role: "user", content: content }];

    const scrubResult = scrubMessages(messages);
    assert(scrubResult.scrubbed, "Should scrub email in prose");
    const scrubbed = scrubResult.messages[0].content as string;
    assertNotIncludes(scrubbed, "alice@example.com");

    // Compress (JSON compact pass)
    const compressResult = compressMessages(scrubResult.messages);
    const compressed = compressResult.messages[0].content as string;
    // JSON should be compacted
    assertIncludes(compressed, '"task":"review"');

    // Rehydrate
    const rehydrated = rehydrateText(compressed, scrubResult.sessionId);
    assertIncludes(rehydrated, "alice@example.com");
    destroySession(scrubResult.sessionId);
  });

  await test("PII + ANSI codes + whitespace: all transforms chain correctly", async () => {
    const content = "\x1b[32m✓\x1b[0m Email: bob@test.com\n\n\n\n\nPhone: +1 555 123 4567\n\n\n\n\nDone.";
    const messages: ChatMessage[] = [{ role: "user", content: content }];

    // PII scrub first
    const scrubResult = scrubMessages(messages);
    assert(scrubResult.scrubbed, "Should scrub email and phone");
    const scrubbed = scrubResult.messages[0].content as string;
    assertNotIncludes(scrubbed, "bob@test.com");

    // Compress (strips ANSI, collapses whitespace)
    const compressResult = compressMessages(scrubResult.messages);
    const compressed = compressResult.messages[0].content as string;
    assertNotIncludes(compressed, "\x1b", "ANSI should be stripped");
    assert(!compressed.includes("\n\n\n"), "Should collapse blank lines");

    // Rehydrate
    const rehydrated = rehydrateText(compressed, scrubResult.sessionId);
    assertIncludes(rehydrated, "bob@test.com");
    destroySession(scrubResult.sessionId);
  });

  await test("multiple PII types in verbose content all survive", async () => {
    const content = [
      "Report:",
      "Email: admin@corp.com",
      "API: sk-ant-api03-testkey1234567890",
      "Server: 10.0.0.1",
      "Same line repeated",
      "Same line repeated",
      "Same line repeated",
      "Same line repeated",
      "",
      "",
      "",
      "",
      "End.",
    ].join("\n");
    const messages: ChatMessage[] = [{ role: "user", content: content }];

    const scrubResult = scrubMessages(messages);
    assert(scrubResult.scrubbed, "Should scrub multiple PII types");

    const compressResult = compressMessages(scrubResult.messages);
    const compressed = compressResult.messages[0].content as string;

    const rehydrated = rehydrateText(compressed, scrubResult.sessionId);
    assertIncludes(rehydrated, "admin@corp.com");
    assertIncludes(rehydrated, "10.0.0.1");
    destroySession(scrubResult.sessionId);
  });
}

// ═══════════════════════════════════════════
// Edge cases
// ═══════════════════════════════════════════

async function edgeCaseTests() {
  console.log("\n=== Edge Cases ===\n");

  await test("p0 hex marker not stripped by comment pass", async () => {
    // Ensure the p0{hex} format isn't mistaken for a code comment
    const messages: ChatMessage[] = [
      { role: "user", content: "```js\n// comment\nconst email = 'test@example.com';\n```" },
    ];
    const scrubResult = scrubMessages(messages);
    const compressResult = compressMessages(scrubResult.messages);
    const compressed = compressResult.messages[0].content as string;

    // The placeholder (p0{hex}...) should still be present
    const rehydrated = rehydrateText(compressed, scrubResult.sessionId);
    assertIncludes(rehydrated, "test@example.com");
    destroySession(scrubResult.sessionId);
  });

  await test("dedup does not collapse lines with different placeholders", async () => {
    const content = "User: alice@a.com\nUser: bob@b.com\nUser: carol@c.com";
    const messages: ChatMessage[] = [{ role: "user", content: content }];

    const scrubResult = scrubMessages(messages);
    const compressResult = compressMessages(scrubResult.messages);
    const compressed = compressResult.messages[0].content as string;

    // All three emails should have different placeholders, so dedup shouldn't collapse
    const rehydrated = rehydrateText(compressed, scrubResult.sessionId);
    assertIncludes(rehydrated, "alice@a.com");
    assertIncludes(rehydrated, "bob@b.com");
    assertIncludes(rehydrated, "carol@c.com");
    destroySession(scrubResult.sessionId);
  });

  await test("compression with system message (PII in system stays if compress_system=false)", async () => {
    const messages: ChatMessage[] = [
      { role: "system", content: "Contact support@company.com for help" },
      { role: "user", content: "Hello\n\n\n\nthere" },
    ];
    // PII scrub with scrubSystem=false (default)
    const scrubResult = scrubMessages(messages, undefined, false);
    // Compress with compressSystem=false (default)
    const compressResult = compressMessages(scrubResult.messages, undefined, false);
    // System message should be untouched
    const sysContent = compressResult.messages[0].content as string;
    assertIncludes(sysContent, "support@company.com");
    // User message should be compressed
    const userContent = compressResult.messages[1].content as string;
    assert(!userContent.includes("\n\n\n"), "User message should be compressed");
    destroySession(scrubResult.sessionId);
  });
}

// ═══════════════════════════════════════════
// Run all
// ═══════════════════════════════════════════

(async () => {
  console.log("PII + CtxPack Interaction Tests");

  await placeholderSurvivalTests();
  await combinedPipelineTests();
  await edgeCaseTests();

  console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
})();
