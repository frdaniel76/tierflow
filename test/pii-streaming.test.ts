/**
 * Unit tests for PII streaming rehydration: rehydrateChunk() carry buffer.
 *
 * Usage:
 *   npx tsx test/pii-streaming.test.ts
 */

import { scrubMessages, rehydrateChunk, destroySession } from "../src/pii/index.js";
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

function assertEqual<T>(actual: T, expected: T, msg?: string) {
  if (actual !== expected) throw new Error(msg || `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(msg);
}

function assertIncludes(haystack: string, needle: string, msg?: string) {
  if (!haystack.includes(needle)) throw new Error(msg || `Expected to include "${needle}" in "${haystack}"`);
}

/**
 * Helper: scrub a known text and return the session + scrubbed content.
 */
function setupSession(text: string): { sessionId: string; scrubbed: string } {
  const messages: ChatMessage[] = [{ role: "user", content: text }];
  const result = scrubMessages(messages);
  return { sessionId: result.sessionId, scrubbed: result.messages[0].content as string };
}

/**
 * Helper: feed chunks through rehydrateChunk and collect output.
 */
function feedChunks(chunks: string[], sessionId: string): string {
  let carry = "";
  let output = "";
  for (const chunk of chunks) {
    const r = rehydrateChunk(chunk, sessionId, carry);
    output += r.output;
    carry = r.carry;
  }
  return output + carry; // flush remaining carry
}

// ═══════════════════════════════════════════
// rehydrateChunk() — Split Scenarios
// ═══════════════════════════════════════════

async function splitScenarioTests() {
  console.log("\n=== rehydrateChunk() — Split Scenarios ===\n");

  await test("full placeholder in single chunk → rehydrated", () => {
    const { sessionId, scrubbed } = setupSession("Email john@acme.com ok");
    const { output, carry } = rehydrateChunk(scrubbed, sessionId, "");
    assertEqual(carry, "");
    assertEqual(output, "Email john@acme.com ok");
    destroySession(sessionId);
  });

  await test("no placeholder in chunk → passthrough, empty carry", () => {
    const { sessionId } = setupSession("Email john@acme.com");
    const { output, carry } = rehydrateChunk("Just plain text", sessionId, "");
    assertEqual(output, "Just plain text");
    assertEqual(carry, "");
    destroySession(sessionId);
  });

  await test("placeholder split: <<ema | il:...>> → carry then rehydrate", () => {
    const { sessionId, scrubbed } = setupSession("Email john@acme.com rest");
    const match = scrubbed.match(/(<<email:[0-9a-f]{12}>>)/)!;
    const placeholder = match[1];
    const idx = scrubbed.indexOf(placeholder);

    const splitAt = idx + 5; // "<<ema"
    const chunk1 = scrubbed.slice(0, splitAt);
    const chunk2 = scrubbed.slice(splitAt);

    const r1 = rehydrateChunk(chunk1, sessionId, "");
    assert(r1.carry.length > 0, `Should have carry`);

    const r2 = rehydrateChunk(chunk2, sessionId, r1.carry);
    assertEqual(r2.carry, "");
    assertEqual(r1.output + r2.output, "Email john@acme.com rest");
    destroySession(sessionId);
  });

  await test("placeholder split: << | email:...>> → carry then rehydrate", () => {
    const { sessionId, scrubbed } = setupSession("Hi john@acme.com bye");
    const match = scrubbed.match(/(<<email:[0-9a-f]{12}>>)/)!;
    const idx = scrubbed.indexOf(match[1]);

    const splitAt = idx + 2; // just "<<"
    const r1 = rehydrateChunk(scrubbed.slice(0, splitAt), sessionId, "");
    assert(r1.carry.length > 0, "Should carry '<<'");

    const r2 = rehydrateChunk(scrubbed.slice(splitAt), sessionId, r1.carry);
    assertEqual(r1.output + r2.output, "Hi john@acme.com bye");
    destroySession(sessionId);
  });

  await test("placeholder split near end of hex ID", () => {
    const { sessionId, scrubbed } = setupSession("X john@acme.com Y");
    const match = scrubbed.match(/(<<email:[0-9a-f]{12}>>)/)!;
    const placeholder = match[1];
    const idx = scrubbed.indexOf(placeholder);

    const splitAt = idx + placeholder.length - 4; // 4 chars before end
    const r1 = rehydrateChunk(scrubbed.slice(0, splitAt), sessionId, "");
    assert(r1.carry.length > 0, "Should carry partial");

    const r2 = rehydrateChunk(scrubbed.slice(splitAt), sessionId, r1.carry);
    assertEqual(r1.output + r2.output, "X john@acme.com Y");
    destroySession(sessionId);
  });

  await test("placeholder split at >> boundary", () => {
    const { sessionId, scrubbed } = setupSession("A john@acme.com B");
    const match = scrubbed.match(/(<<email:[0-9a-f]{12}>>)/)!;
    const placeholder = match[1];
    const idx = scrubbed.indexOf(placeholder);

    // Split right before ">>"
    const splitAt = idx + placeholder.length - 2;
    const r1 = rehydrateChunk(scrubbed.slice(0, splitAt), sessionId, "");
    assert(r1.carry.length > 0, "Should carry up to >>");

    const r2 = rehydrateChunk(scrubbed.slice(splitAt), sessionId, r1.carry);
    assertEqual(r1.output + r2.output, "A john@acme.com B");
    destroySession(sessionId);
  });

  await test("multiple placeholders in one chunk → all rehydrated", () => {
    const { sessionId, scrubbed } = setupSession("A john@acme.com B jane@corp.org C");
    const { output, carry } = rehydrateChunk(scrubbed, sessionId, "");
    assertEqual(carry, "");
    assertEqual(output, "A john@acme.com B jane@corp.org C");
    destroySession(sessionId);
  });

  await test("mixed text and placeholder → text emitted, placeholder rehydrated", () => {
    const { sessionId, scrubbed } = setupSession("Hello john@acme.com world");
    // Feed text before placeholder, then the placeholder, then text after
    const match = scrubbed.match(/(<<email:[0-9a-f]{12}>>)/)!;
    const idx = scrubbed.indexOf(match[1]);

    const chunk1 = scrubbed.slice(0, idx); // "Hello "
    const chunk2 = scrubbed.slice(idx);    // "<<email:...>> world"

    const r1 = rehydrateChunk(chunk1, sessionId, "");
    assertEqual(r1.carry, "");
    assertEqual(r1.output, "Hello ");

    const r2 = rehydrateChunk(chunk2, sessionId, r1.carry);
    assertEqual(r2.output, "john@acme.com world");
    destroySession(sessionId);
  });

  await test("adjacent placeholders → both rehydrated", () => {
    const { sessionId, scrubbed } = setupSession("john@acme.comjane@corp.org");
    const { output, carry } = rehydrateChunk(scrubbed, sessionId, "");
    assertEqual(carry, "");
    assertEqual(output, "john@acme.comjane@corp.org");
    destroySession(sessionId);
  });

  await test("two placeholders split across different chunks", () => {
    const { sessionId, scrubbed } = setupSession("A john@acme.com B jane@corp.org C");
    const matches = [...scrubbed.matchAll(/<<email:[0-9a-f]{12}>>/g)];
    assert(matches.length === 2, "Should have 2 placeholders");

    // Split between the two placeholders, mid-way through the second
    const secondIdx = matches[1].index!;
    const splitAt = secondIdx + 5;
    const chunk1 = scrubbed.slice(0, splitAt);
    const chunk2 = scrubbed.slice(splitAt);

    const r1 = rehydrateChunk(chunk1, sessionId, "");
    const r2 = rehydrateChunk(chunk2, sessionId, r1.carry);
    assertEqual(r1.output + r2.output, "A john@acme.com B jane@corp.org C");
    destroySession(sessionId);
  });
}

// ═══════════════════════════════════════════
// rehydrateChunk() — Carry Buffer Edge Cases
// ═══════════════════════════════════════════

async function carryEdgeCaseTests() {
  console.log("\n=== rehydrateChunk() — Carry Buffer Edge Cases ===\n");

  await test("carry exceeds max placeholder length → flushed as text", () => {
    const { sessionId } = setupSession("john@acme.com");
    const longFake = "<<thisissomeverylongfakecategory:aaaa";
    const { output } = rehydrateChunk("more text", sessionId, longFake);
    assertIncludes(output, "<<this");
    destroySession(sessionId);
  });

  await test("<< in normal text → eventually flushed", () => {
    const { sessionId } = setupSession("john@acme.com");
    const r1 = rehydrateChunk("text with <<important", sessionId, "");
    assert(r1.carry.startsWith("<<"), "Should carry from <<");

    const r2 = rehydrateChunk(">> stuff", sessionId, r1.carry);
    const full = r1.output + r2.output;
    assertIncludes(full, "<<important>>");
    destroySession(sessionId);
  });

  await test("chunk ends with single < → held in carry", () => {
    const { sessionId, scrubbed } = setupSession("Hi john@acme.com end");
    const match = scrubbed.match(/(<<email:[0-9a-f]{12}>>)/)!;
    const idx = scrubbed.indexOf(match[1]);

    const splitAt = idx + 1; // just first "<"
    const r1 = rehydrateChunk(scrubbed.slice(0, splitAt), sessionId, "");
    assertEqual(r1.carry, "<", "Should carry single <");

    const r2 = rehydrateChunk(scrubbed.slice(splitAt), sessionId, r1.carry);
    assertEqual(r1.output + r2.output, "Hi john@acme.com end");
    destroySession(sessionId);
  });

  await test("empty chunk with existing carry → carry maintained", () => {
    const { sessionId } = setupSession("john@acme.com");
    const r1 = rehydrateChunk("", sessionId, "<<ema");
    assertEqual(r1.carry, "<<ema");
    assertEqual(r1.output, "");
    destroySession(sessionId);
  });

  await test("stream end flush: non-empty carry flushed as-is", () => {
    const { sessionId } = setupSession("john@acme.com");
    const r = rehydrateChunk("", sessionId, "<<fake");
    assertEqual(r.carry, "<<fake");
    // Caller is responsible for flushing carry on stream end
    destroySession(sessionId);
  });

  await test("unknown session → carry + chunk flushed together", () => {
    const { output, carry } = rehydrateChunk("hello", "nonexistent", "world");
    assertEqual(output, "worldhello");
    assertEqual(carry, "");
  });

  await test("unicode text mixed with placeholders → preserved", () => {
    const { sessionId, scrubbed } = setupSession("こんにちは john@acme.com さようなら");
    const { output, carry } = rehydrateChunk(scrubbed, sessionId, "");
    assertEqual(carry, "");
    assertEqual(output, "こんにちは john@acme.com さようなら");
    destroySession(sessionId);
  });

  await test("single-character chunks → correct reassembly", () => {
    const { sessionId, scrubbed } = setupSession("A john@acme.com B");
    // Feed one char at a time
    const chars = scrubbed.split("");
    const result = feedChunks(chars, sessionId);
    assertEqual(result, "A john@acme.com B");
    destroySession(sessionId);
  });
}

// ═══════════════════════════════════════════
// Randomized Split Tests (Fuzz)
// ═══════════════════════════════════════════

async function randomSplitTests() {
  console.log("\n=== Randomized Split Tests (Fuzz) ===\n");

  await test("fuzz: 200 iterations, 1 placeholder, random 2-chunk split", () => {
    const original = "Before john@acme.com after text here";
    const { sessionId, scrubbed } = setupSession(original);

    for (let i = 0; i < 200; i++) {
      const splitPoint = Math.floor(Math.random() * (scrubbed.length + 1));
      const chunks = [scrubbed.slice(0, splitPoint), scrubbed.slice(splitPoint)];
      const result = feedChunks(chunks, sessionId);
      if (result !== original) {
        throw new Error(`Iter ${i}: split at ${splitPoint}, got "${result}"`);
      }
    }
    destroySession(sessionId);
  });

  await test("fuzz: 200 iterations, 2 placeholders, random 3-chunk split", () => {
    const original = "A john@acme.com B jane@corp.org C";
    const { sessionId, scrubbed } = setupSession(original);

    for (let i = 0; i < 200; i++) {
      const points = [
        Math.floor(Math.random() * (scrubbed.length + 1)),
        Math.floor(Math.random() * (scrubbed.length + 1)),
      ].sort((a, b) => a - b);

      const chunks = [
        scrubbed.slice(0, points[0]),
        scrubbed.slice(points[0], points[1]),
        scrubbed.slice(points[1]),
      ];

      const result = feedChunks(chunks, sessionId);
      if (result !== original) {
        throw new Error(`Iter ${i}: splits at [${points}], got "${result}"`);
      }
    }
    destroySession(sessionId);
  });

  await test("fuzz: 100 iterations, 2 PII types, 5-15 random small chunks", () => {
    const original = "Email john@acme.com and visit 192.168.1.1 please";
    const { sessionId, scrubbed } = setupSession(original);

    for (let i = 0; i < 100; i++) {
      const numChunks = 5 + Math.floor(Math.random() * 11);
      const points: number[] = [];
      for (let j = 0; j < numChunks - 1; j++) {
        points.push(Math.floor(Math.random() * (scrubbed.length + 1)));
      }
      points.sort((a, b) => a - b);

      const chunks: string[] = [];
      let prev = 0;
      for (const p of points) {
        chunks.push(scrubbed.slice(prev, p));
        prev = p;
      }
      chunks.push(scrubbed.slice(prev));

      const result = feedChunks(chunks, sessionId);
      if (result !== original) {
        throw new Error(`Iter ${i}: ${numChunks} chunks, got "${result}"`);
      }
    }
    destroySession(sessionId);
  });

  await test("fuzz: 100 iterations, unicode + PII, single-char chunks", () => {
    const original = "Café john@acme.com résumé 192.168.0.1 naïve";
    const { sessionId, scrubbed } = setupSession(original);

    for (let i = 0; i < 100; i++) {
      // Random chunk size 1-4 chars
      const chunks: string[] = [];
      let pos = 0;
      while (pos < scrubbed.length) {
        const size = 1 + Math.floor(Math.random() * 4);
        chunks.push(scrubbed.slice(pos, pos + size));
        pos += size;
      }

      const result = feedChunks(chunks, sessionId);
      if (result !== original) {
        throw new Error(`Iter ${i}: ${chunks.length} chunks, got "${result}"`);
      }
    }
    destroySession(sessionId);
  });
}

// ═══════════════════════════════════════════
// Run All
// ═══════════════════════════════════════════

async function main() {
  console.log("\n╔══════════════════════════════════════╗");
  console.log("║  PII Streaming Rehydration Tests     ║");
  console.log("╚══════════════════════════════════════╝");

  await splitScenarioTests();
  await carryEdgeCaseTests();
  await randomSplitTests();

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Test runner error:", err);
  process.exit(1);
});
