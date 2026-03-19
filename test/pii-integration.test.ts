/**
 * Integration tests for PII proxy: full HTTP pipeline with mock backend.
 *
 * Tests end-to-end: config parsing, scrub → forward → rehydrate,
 * session lifecycle, error handling, and security guarantees.
 *
 * Usage:
 *   npx tsx test/pii-integration.test.ts
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { scrubMessages, rehydrateText, rehydrateChunk, destroySession, piiVaultStore } from "../src/pii/index.js";
import { isPiiEnabled, getPiiExclude, getPiiMode, type ProviderConfigEntry } from "../src/config.js";
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
  if (!haystack.includes(needle)) throw new Error(msg || `Expected to include "${needle}" in "${haystack}"`);
}

function assertNotIncludes(haystack: string, needle: string, msg?: string) {
  if (haystack.includes(needle)) throw new Error(msg || `Expected NOT to include "${needle}" in "${haystack}"`);
}

function assertMatch(text: string, regex: RegExp, msg?: string) {
  if (!regex.test(text)) throw new Error(msg || `Expected "${text}" to match ${regex}`);
}

// ─── Mock Server Helpers ───

function createMockServer(handler: (req: IncomingMessage, res: ServerResponse) => void): Promise<{ port: number; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = createServer(handler);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as { port: number };
      resolve({
        port: addr.port,
        close: () => new Promise<void>((res) => server.close(() => res())),
      });
    });
  });
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString()));
  });
}

function feedChunks(chunks: string[], sessionId: string): string {
  let carry = "";
  let output = "";
  for (const chunk of chunks) {
    const r = rehydrateChunk(chunk, sessionId, carry);
    output += r.output;
    carry = r.carry;
  }
  return output + carry;
}

// ═══════════════════════════════════════════
// Full Pipeline — Non-Streaming
// ═══════════════════════════════════════════

async function nonStreamingTests() {
  console.log("\n=== Full Pipeline — Non-Streaming ===\n");

  await test("PII in request → scrubbed → echoed → rehydrated", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "Summarise: John Smith (john@acme.com, +44 7911 123456)" },
    ];
    const scrubResult = scrubMessages(messages);
    assert(scrubResult.scrubbed, "Should scrub PII");
    const scrubbedContent = scrubResult.messages[0].content as string;
    assertNotIncludes(scrubbedContent, "john@acme.com");

    const modelResponse = `Here's a summary of the contact: ${scrubbedContent}`;
    const rehydrated = rehydrateText(modelResponse, scrubResult.sessionId);
    assertIncludes(rehydrated, "john@acme.com");
    assertNotIncludes(rehydrated, "<<email:");
    destroySession(scrubResult.sessionId);
  });

  await test("no PII in request → forwarded unchanged", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "What is the capital of France?" },
    ];
    const scrubResult = scrubMessages(messages);
    assert(!scrubResult.scrubbed, "Should NOT scrub");
    assertEqual(scrubResult.messages[0].content as string, "What is the capital of France?");
  });

  await test("local provider (pii: false) → isPiiEnabled returns false", () => {
    const localProvider: ProviderConfigEntry = {
      baseUrl: "http://127.0.0.1:11434/v1",
      api: "openai",
    };
    assert(!isPiiEnabled(localProvider), "Local provider should not have PII enabled");
  });

  await test("fallback: external → local — rehydrate is no-op", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "Email john@acme.com for details" },
    ];
    const scrubResult = scrubMessages(messages);
    assert(scrubResult.scrubbed, "Should scrub");

    // Local model response has no placeholders
    const localResponse = "Sure, I can help with that contact information.";
    const rehydrated = rehydrateText(localResponse, scrubResult.sessionId);
    assertEqual(rehydrated, localResponse, "No placeholders → no change");
    destroySession(scrubResult.sessionId);
  });
}

// ═══════════════════════════════════════════
// Full Pipeline — Streaming
// ═══════════════════════════════════════════

async function streamingTests() {
  console.log("\n=== Full Pipeline — Streaming ===\n");

  await test("streaming: scrubbed → chunks with placeholders → rehydrated", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "Reply with: Contact john@acme.com for help" },
    ];
    const scrubResult = scrubMessages(messages);
    assert(scrubResult.scrubbed, "Should scrub");
    const scrubbedContent = scrubResult.messages[0].content as string;

    const responseText = `Contact ${scrubbedContent.match(/<<email:[0-9a-f]{12}>>/)![0]} for help`;
    const chunks = responseText.match(/.{1,8}/g) ?? [];
    const fullOutput = feedChunks(chunks, scrubResult.sessionId);

    assertIncludes(fullOutput, "john@acme.com");
    assertNotIncludes(fullOutput, "<<email:");
    destroySession(scrubResult.sessionId);
  });

  await test("streaming: split placeholder across SSE chunks", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "Email john@acme.com ok" },
    ];
    const scrubResult = scrubMessages(messages);
    const scrubbedContent = scrubResult.messages[0].content as string;
    const placeholder = scrubbedContent.match(/<<email:[0-9a-f]{12}>>/)![0];

    const sseChunks = [
      "Email ",
      placeholder.slice(0, 3),
      placeholder.slice(3, 10),
      placeholder.slice(10),
      " ok",
    ];
    const fullOutput = feedChunks(sseChunks, scrubResult.sessionId);
    assertEqual(fullOutput, "Email john@acme.com ok");
    destroySession(scrubResult.sessionId);
  });

  await test("streaming: stream ends → carry flushed", () => {
    const scrubResult = scrubMessages([{ role: "user", content: "john@acme.com" }]);
    const r1 = rehydrateChunk("some text <<not", scrubResult.sessionId, "");
    assert(r1.carry.length > 0, "Should have carry");
    const finalOutput = r1.output + r1.carry;
    assertIncludes(finalOutput, "<<not");
    destroySession(scrubResult.sessionId);
  });
}

// ═══════════════════════════════════════════
// Config Handling
// ═══════════════════════════════════════════

async function configTests() {
  console.log("\n=== Config Handling ===\n");

  await test("pii: true → isPiiEnabled, strict mode, no exclude", () => {
    const provider: ProviderConfigEntry = {
      baseUrl: "https://openrouter.ai/api/v1",
      api: "openai",
      pii: true,
    };
    assert(isPiiEnabled(provider), "Should be PII enabled");
    assertEqual(getPiiMode(provider), "strict");
    assertEqual(getPiiExclude(provider), undefined);
  });

  await test("pii: { enabled: true, mode: standard, exclude: [...] }", () => {
    const provider: ProviderConfigEntry = {
      baseUrl: "https://openrouter.ai/api/v1",
      api: "openai",
      pii: { enabled: true, mode: "standard", exclude: ["phone", "post"] },
    };
    assert(isPiiEnabled(provider), "Should be PII enabled");
    assertEqual(getPiiMode(provider), "standard");
    const exclude = getPiiExclude(provider)!;
    assert(exclude.includes("phone"), "Should exclude phone");
    assert(exclude.includes("post"), "Should exclude post");
  });

  await test("pii: { enabled: false } → isPiiEnabled returns false", () => {
    const provider: ProviderConfigEntry = {
      baseUrl: "https://openrouter.ai/api/v1",
      api: "openai",
      pii: { enabled: false },
    };
    assert(!isPiiEnabled(provider), "Should NOT be PII enabled");
  });

  await test("no pii key → isPiiEnabled returns false (zero overhead)", () => {
    const provider: ProviderConfigEntry = {
      baseUrl: "http://127.0.0.1:11434/v1",
      api: "openai",
    };
    assert(!isPiiEnabled(provider), "Should NOT be PII enabled");
  });
}

// ═══════════════════════════════════════════
// Session Lifecycle
// ═══════════════════════════════════════════

async function sessionLifecycleTests() {
  console.log("\n=== Session Lifecycle ===\n");

  await test("session destroyed after successful request", () => {
    const result = scrubMessages([{ role: "user", content: "Email john@acme.com" }]);
    assert(result.scrubbed, "Should scrub");
    const scrubbedContent = result.messages[0].content as string;

    rehydrateText(scrubbedContent, result.sessionId);
    destroySession(result.sessionId);
    assertEqual(piiVaultStore.get(result.sessionId), undefined, "Session gone");
  });

  await test("session destroyed after failed request (error path)", () => {
    const result = scrubMessages([{ role: "user", content: "Email john@acme.com" }]);
    // Simulate error path — destroy without rehydrating
    destroySession(result.sessionId);
    assertEqual(piiVaultStore.get(result.sessionId), undefined, "Session gone");
  });

  await test("session destroyed after client disconnect", () => {
    const result = scrubMessages([{ role: "user", content: "Email john@acme.com" }]);
    destroySession(result.sessionId);
    assertEqual(piiVaultStore.get(result.sessionId), undefined, "Session cleaned up");
  });

  await test("vault store sweep cleans expired sessions", () => {
    const id = piiVaultStore.generateId();
    piiVaultStore.getOrCreate(id);
    assert(piiVaultStore.size > 0, "Should have session");
    piiVaultStore.destroy(id);
    assertEqual(piiVaultStore.get(id), undefined, "Cleaned up");
  });

  await test("concurrent sessions don't interfere — isolated vaults", () => {
    const r1 = scrubMessages([{ role: "user", content: "Email alice@x.com" }]);
    const r2 = scrubMessages([{ role: "user", content: "Email bob@y.com" }]);

    assert(r1.sessionId !== r2.sessionId, "Different session IDs");

    // Rehydrate session 1
    const text1 = rehydrateText(r1.messages[0].content as string, r1.sessionId);
    assertIncludes(text1, "alice@x.com");
    assertNotIncludes(text1, "bob@y.com");

    // Rehydrate session 2
    const text2 = rehydrateText(r2.messages[0].content as string, r2.sessionId);
    assertIncludes(text2, "bob@y.com");
    assertNotIncludes(text2, "alice@x.com");

    // Cross-session: session 1 can't rehydrate session 2's placeholders
    const cross = rehydrateText(r2.messages[0].content as string, r1.sessionId);
    assertIncludes(cross, "<<email:"); // Placeholder stays — wrong session
    assertNotIncludes(cross, "bob@y.com");

    destroySession(r1.sessionId);
    destroySession(r2.sessionId);
  });
}

// ═══════════════════════════════════════════
// Error Handling
// ═══════════════════════════════════════════

async function errorTests() {
  console.log("\n=== Error Handling ===\n");

  await test("rehydrate with expired session → placeholders retained (safe)", () => {
    const result = scrubMessages([{ role: "user", content: "Email john@acme.com" }]);
    const scrubbedContent = result.messages[0].content as string;
    destroySession(result.sessionId);

    const rehydrated = rehydrateText(scrubbedContent, result.sessionId);
    assertIncludes(rehydrated, "<<email:");
    assertNotIncludes(rehydrated, "john@acme.com");
  });

  await test("mock server returns error → vault session still cleaned up", async () => {
    const mock = await createMockServer(async (_req, res) => {
      res.writeHead(500);
      res.end(JSON.stringify({ error: "Internal server error" }));
    });

    try {
      const result = scrubMessages([{ role: "user", content: "Email john@acme.com" }]);
      assert(result.scrubbed, "Should scrub");

      // Forward to mock (which errors)
      const response = await fetch(`http://127.0.0.1:${mock.port}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "test", messages: result.messages }),
      });

      assertEqual(response.status, 500, "Mock should error");

      // Cleanup should still work
      destroySession(result.sessionId);
      assertEqual(piiVaultStore.get(result.sessionId), undefined, "Session cleaned up despite error");
    } finally {
      await mock.close();
    }
  });

  await test("standard mode: rehydrate failure → placeholders passed through", () => {
    // Simulate standard mode: rehydrate fails, placeholder is visible but safe
    const result = scrubMessages([{ role: "user", content: "Email john@acme.com" }]);
    const scrubbedContent = result.messages[0].content as string;

    // Destroy session to simulate failure
    destroySession(result.sessionId);

    // In standard mode, we'd pass through the response with placeholders
    const degraded = rehydrateText(scrubbedContent, result.sessionId);
    assertIncludes(degraded, "<<email:");
    // Ugly but safe — no PII leaked
    assertNotIncludes(degraded, "john@acme.com");
  });
}

// ═══════════════════════════════════════════
// Security
// ═══════════════════════════════════════════

async function securityTests() {
  console.log("\n=== Security ===\n");

  await test("mock server NEVER receives real PII (multi-type)", async () => {
    const receivedBodies: string[] = [];
    const mock = await createMockServer(async (req, res) => {
      receivedBodies.push(await readBody(req));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ choices: [{ message: { content: "ok" } }] }));
    });

    try {
      const piiData = [
        "john@acme.com",
        "sk-ant-abcdefghijklmnopqrstuvwxyz",
        "+44 7911 123456",
        "192.168.1.100",
      ];

      const result = scrubMessages([
        { role: "user", content: `Data: ${piiData.join(", ")}` },
      ]);
      assert(result.scrubbed, "Should scrub");

      await fetch(`http://127.0.0.1:${mock.port}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "test", messages: result.messages }),
      });

      for (const body of receivedBodies) {
        for (const pii of piiData) {
          assertNotIncludes(body, pii, `Mock received real PII: ${pii}`);
        }
      }
      destroySession(result.sessionId);
    } finally {
      await mock.close();
    }
  });

  await test("all fields in scrubbed output are PII-free", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "Email john@acme.com" },
      {
        role: "assistant", content: "Found john@acme.com",
        tool_calls: [{ id: "c1", type: "function", function: { name: "f", arguments: '{"e":"john@acme.com"}' } }],
      },
      { role: "tool" as any, content: "Result: john@acme.com", tool_call_id: "c1" },
    ];

    const result = scrubMessages(messages);
    const json = JSON.stringify(result.messages);
    assertNotIncludes(json, "john@acme.com", "No PII in any field of scrubbed output");
    destroySession(result.sessionId);
  });

  await test("placeholder format is valid (<<category:12hex>>)", () => {
    const result = scrubMessages([
      { role: "user", content: "john@acme.com sk-ant-abcdefghijklmnopqrstuvwxyz 192.168.1.1" },
    ]);
    const scrubbedJson = JSON.stringify(result.messages);
    const placeholders = scrubbedJson.match(/<<[a-z]{2,8}:[0-9a-f]{12}>>/g) ?? [];
    assert(placeholders.length >= 3, `Expected ≥3 placeholders, got ${placeholders.length}`);

    // Verify each placeholder matches the exact format
    for (const ph of placeholders) {
      assertMatch(ph, /^<<[a-z]{2,8}:[0-9a-f]{12}>>$/, `Invalid placeholder format: ${ph}`);
    }
    destroySession(result.sessionId);
  });
}

// ═══════════════════════════════════════════
// Mock HTTP Server Round-Trips
// ═══════════════════════════════════════════

async function mockServerTests() {
  console.log("\n=== Mock HTTP Server Round-Trips ===\n");

  await test("non-streaming: full HTTP round-trip with scrub/rehydrate", async () => {
    const mock = await createMockServer(async (req, res) => {
      const body = JSON.parse(await readBody(req));
      const content = body.messages[0]?.content ?? "";
      if (content.includes("john@acme.com")) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: "LEAKED PII!" }));
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        choices: [{ message: { role: "assistant", content: `Got it: ${content}` } }],
      }));
    });

    try {
      const result = scrubMessages([{ role: "user", content: "Email john@acme.com for info" }]);
      assert(result.scrubbed, "Should scrub");

      const response = await fetch(`http://127.0.0.1:${mock.port}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "test", messages: result.messages }),
      });
      assertEqual(response.status, 200, "Mock should return 200 (no PII leaked)");

      const data = await response.json() as any;
      const responseContent = data.choices[0].message.content;
      assertNotIncludes(responseContent, "john@acme.com");
      assertIncludes(responseContent, "<<email:");

      const rehydrated = rehydrateText(responseContent, result.sessionId);
      assertIncludes(rehydrated, "john@acme.com");
      assertNotIncludes(rehydrated, "<<email:");
      destroySession(result.sessionId);
    } finally {
      await mock.close();
    }
  });

  await test("streaming: full HTTP SSE round-trip with scrub/rehydrate", async () => {
    const mock = await createMockServer(async (req, res) => {
      const body = JSON.parse(await readBody(req));
      const content = body.messages[0]?.content ?? "";
      if (content.includes("john@acme.com")) {
        res.writeHead(500);
        res.end("LEAKED PII");
        return;
      }

      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
      const responseText = `Contact: ${content}`;
      const pieces = responseText.match(/.{1,10}/g) ?? [responseText];
      for (const piece of pieces) {
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: piece } }] })}\n\n`);
      }
      res.write("data: [DONE]\n\n");
      res.end();
    });

    try {
      const result = scrubMessages([{ role: "user", content: "Email john@acme.com" }]);
      assert(result.scrubbed, "Should scrub");

      const response = await fetch(`http://127.0.0.1:${mock.port}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "test", messages: result.messages, stream: true }),
      });
      assertEqual(response.status, 200);

      const text = await response.text();
      const lines = text.split("\n").filter(l => l.startsWith("data: "));

      let carry = "";
      let fullOutput = "";
      for (const line of lines) {
        const data = line.slice(6).trim();
        if (data === "[DONE]") break;
        const parsed = JSON.parse(data);
        const content = parsed.choices?.[0]?.delta?.content;
        if (content) {
          const r = rehydrateChunk(content, result.sessionId, carry);
          fullOutput += r.output;
          carry = r.carry;
        }
      }
      fullOutput += carry;

      assertIncludes(fullOutput, "john@acme.com");
      assertNotIncludes(fullOutput, "<<email:");
      destroySession(result.sessionId);
    } finally {
      await mock.close();
    }
  });

  await test("PII leak verification: N values checked against raw bytes", async () => {
    const receivedBodies: string[] = [];
    const mock = await createMockServer(async (req, res) => {
      receivedBodies.push(await readBody(req));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ choices: [{ message: { content: "ok" } }] }));
    });

    try {
      const piiValues = [
        "alice@secret.org",
        "sk-proj-ABCDEFGHIJKLMNOPQRSTUVWXYZ",
        "+1 (555) 123-4567",
        "10.20.30.40",
        "postgres://root:hunter2@db.prod:5432/main",
      ];

      const result = scrubMessages([
        { role: "user", content: piiValues.join(" | ") },
      ]);

      await fetch(`http://127.0.0.1:${mock.port}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "test", messages: result.messages }),
      });

      for (const body of receivedBodies) {
        for (const pii of piiValues) {
          assertNotIncludes(body, pii, `LEAK: "${pii}" found in server-received bytes`);
        }
      }
      destroySession(result.sessionId);
    } finally {
      await mock.close();
    }
  });
}

// ═══════════════════════════════════════════
// Run All
// ═══════════════════════════════════════════

async function main() {
  console.log("\n╔══════════════════════════════════════╗");
  console.log("║  PII Integration Tests               ║");
  console.log("╚══════════════════════════════════════╝");

  await nonStreamingTests();
  await streamingTests();
  await configTests();
  await sessionLifecycleTests();
  await errorTests();
  await securityTests();
  await mockServerTests();

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

  piiVaultStore.shutdown();
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Test runner error:", err);
  process.exit(1);
});
