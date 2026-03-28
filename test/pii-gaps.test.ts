/**
 * Tests for PII gap fixes + type-preserving placeholders:
 *   1. Streaming tool call args carry-buffer (split placeholder handling)
 *   2. tool_result blocks with nested array content
 *   3. System/developer message scrubbing (opt-in)
 *   4. Fallback provider rehydration
 *   5. Dedup consistency across messages
 *   6. VaultStore capacity cap
 *   7. Type-preserving placeholder format validation
 *
 * Usage:
 *   npx tsx test/pii-gaps.test.ts
 */

import {
  scrubMessages,
  rehydrateText,
  rehydrateChunk,
  destroySession,
  piiVaultStore,
} from "../src/pii/index.js";
import { SecretVault } from "../src/pii/vault.js";
import { VaultStore } from "../src/pii/vault-store.js";
import { isPiiScrubSystem, type ProviderConfigEntry } from "../src/config.js";
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
  if (actual !== expected)
    throw new Error(msg || `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function assertIncludes(haystack: string, needle: string, msg?: string) {
  if (!haystack.includes(needle))
    throw new Error(msg || `Expected "${haystack}" to include "${needle}"`);
}

function assertNotIncludes(haystack: string, needle: string, msg?: string) {
  if (haystack.includes(needle))
    throw new Error(msg || `Expected "${haystack}" NOT to include "${needle}"`);
}

function assertMatch(text: string, regex: RegExp, msg?: string) {
  if (!regex.test(text)) throw new Error(msg || `Expected "${text}" to match ${regex}`);
}

// Universal marker regex for any placeholder
const P0_MARKER = /p0[0-9a-f]{12}/;
// Email placeholder regex
const EMAIL_PH = /p0([0-9a-f]{12})@maildomain\.com/;
const EMAIL_PH_G = /p0([0-9a-f]{12})@maildomain\.com/g;
// API key placeholder regex
const APIKEY_PH = /p0([0-9a-f]{12})-placeholder/;
// Phone placeholder regex
const PHONE_PH = /\+0-555-p0([0-9a-f]{12})/;
// Path placeholder regex
const PATH_PH = /\/pii\/p0([0-9a-f]{12})\/redacted/;

// Helper: simulate streaming tool call argument rehydration with carry buffer
function feedToolArgChunks(chunks: string[], sessionId: string): string {
  let carry = "";
  let output = "";
  for (const chunk of chunks) {
    const r = rehydrateChunk(chunk, sessionId, carry);
    output += r.output;
    carry = r.carry;
  }
  // Rehydrate remaining carry (matches provider.ts finally block behavior)
  if (carry) {
    const vault = piiVaultStore.get(sessionId);
    if (vault) {
      const rehydrated = vault.rehydrate(carry);
      output += rehydrated.text;
    } else {
      output += carry;
    }
  }
  return output;
}

// ═══════════════════════════════════════════
// Type-Preserving Placeholder Format Validation
// ═══════════════════════════════════════════

async function formatValidationTests() {
  console.log("\n=== Type-Preserving Placeholder Format ===\n");

  await test("email → p0{hex}@maildomain.com", () => {
    const vault = new SecretVault();
    const result = vault.redact("Contact john@acme.com ok");
    assertMatch(result.text, /p0[0-9a-f]{12}@maildomain\.com/);
    assertNotIncludes(result.text, "john@acme.com");
    vault.destroy();
  });

  await test("apikey → p0{hex}-placeholder", () => {
    const vault = new SecretVault();
    const result = vault.redact("Key: sk-ant-abcdefghijklmnopqrstuvwxyz");
    assertMatch(result.text, /p0[0-9a-f]{12}-placeholder-key/);
    vault.destroy();
  });

  await test("phone → p0{hex}-phone", () => {
    const vault = new SecretVault();
    const result = vault.redact("Call +44 7911 123456 please");
    assertMatch(result.text, /p0[0-9a-f]{12}-phone/);
    vault.destroy();
  });

  await test("ssn → p0{hex}-ssn", () => {
    const vault = new SecretVault();
    const result = vault.redact("SSN: 123-45-6789");
    assertMatch(result.text, /p0[0-9a-f]{12}-ssn/);
    vault.destroy();
  });

  await test("ip → p0{hex}.0.0.1", () => {
    const vault = new SecretVault();
    const result = vault.redact("Server at 192.168.1.100");
    assertMatch(result.text, /p0[0-9a-f]{12}\.0\.0\.1/);
    vault.destroy();
  });

  await test("path → p0{hex}/redacted", () => {
    const vault = new SecretVault();
    const result = vault.redact("File at /Users/testuser/secrets.txt");
    assertMatch(result.text, /p0[0-9a-f]{12}\/pii\/redacted/);
    vault.destroy();
  });

  await test("conn → p0{hex}://placeholder/db", () => {
    const vault = new SecretVault();
    const result = vault.redact("DB: postgres://admin:secret@localhost/mydb");
    assertMatch(result.text, /p0[0-9a-f]{12}:\/\/placeholder\/db/);
    vault.destroy();
  });

  await test("secret (password=) → p0{hex}-password", () => {
    const vault = new SecretVault();
    const result = vault.redact("Config: password=hunter2secret");
    assertMatch(result.text, /p0[0-9a-f]{12}-password/);
    vault.destroy();
  });

  await test("secret preserves keyword (token=) → p0{hex}-token", () => {
    const vault = new SecretVault();
    const result = vault.redact("Auth: token=mytoken1234");
    assertMatch(result.text, /p0[0-9a-f]{12}-token/);
    vault.destroy();
  });

  await test("all placeholders contain universal p0{hex} marker", () => {
    const vault = new SecretVault();
    const result = vault.redact("john@acme.com sk-ant-abcdefghijklmnopqrstuvwxyz 123-45-6789");
    const markers = result.text.match(/p0[0-9a-f]{12}/g) ?? [];
    assert(markers.length >= 3, `Expected ≥3 p0 markers, got ${markers.length}`);
    vault.destroy();
  });
}

// ═══════════════════════════════════════════
// Gap 1: Streaming Tool Call Args — Carry Buffer
// ═══════════════════════════════════════════

async function streamingToolCallCarryTests() {
  console.log("\n=== Gap 1: Streaming Tool Call Args Carry Buffer ===\n");

  await test("tool call arg: email placeholder split mid-way", () => {
    const scrubbed = scrubMessages([{ role: "user", content: "Email john@acme.com" }]);
    const placeholder = (scrubbed.messages[0].content as string).match(
      /p0[0-9a-f]{12}@maildomain\.com/,
    )![0];
    const argStr = `{"to":"${placeholder}"}`;

    const splitIdx = argStr.indexOf("p0") + 5;
    const result = feedToolArgChunks(
      [argStr.slice(0, splitIdx), argStr.slice(splitIdx)],
      scrubbed.sessionId,
    );
    assertIncludes(result, "john@acme.com");
    destroySession(scrubbed.sessionId);
  });

  await test("tool call arg: single character chunking (extreme fragmentation)", () => {
    const scrubbed = scrubMessages([{ role: "user", content: "Email john@acme.com" }]);
    const placeholder = (scrubbed.messages[0].content as string).match(
      /p0[0-9a-f]{12}@maildomain\.com/,
    )![0];
    const argStr = `{"to":"${placeholder}"}`;

    const chunks = argStr.split("");
    const result = feedToolArgChunks(chunks, scrubbed.sessionId);
    assertIncludes(result, "john@acme.com");
    destroySession(scrubbed.sessionId);
  });

  await test("tool call arg: no placeholder — passthrough", () => {
    const scrubbed = scrubMessages([{ role: "user", content: "Email john@acme.com" }]);
    const result = feedToolArgChunks(['{"query":"hello"}'], scrubbed.sessionId);
    assertEqual(result, '{"query":"hello"}');
    destroySession(scrubbed.sessionId);
  });

  await test("tool call arg: fuzz — 200 iterations, random 2-chunk split", () => {
    const scrubbed = scrubMessages([{ role: "user", content: "Email john@acme.com" }]);
    const placeholder = (scrubbed.messages[0].content as string).match(
      /p0[0-9a-f]{12}@maildomain\.com/,
    )![0];
    const argStr = `{"to":"${placeholder}","msg":"hello"}`;

    for (let i = 0; i < 200; i++) {
      const splitAt = Math.floor(Math.random() * (argStr.length + 1));
      const chunks = [argStr.slice(0, splitAt), argStr.slice(splitAt)];
      const result = feedToolArgChunks(chunks, scrubbed.sessionId);
      assertIncludes(result, "john@acme.com", `Fuzz iteration ${i}: split at ${splitAt}`);
    }
    destroySession(scrubbed.sessionId);
  });
}

// ═══════════════════════════════════════════
// Gap 2 & 3: tool_result with array content
// ═══════════════════════════════════════════

async function toolResultArrayContentTests() {
  console.log("\n=== Gap 2 & 3: tool_result Array Content Scrubbing ===\n");

  await test("scrubs tool_result with nested text array content", () => {
    const messages: ChatMessage[] = [
      {
        role: "user",
        content: [
          {
            type: "tool_result" as any,
            content: [
              { type: "text", text: "Found email: john@acme.com" },
              { type: "text", text: "Phone: +44 7911 123456" },
            ],
          } as any,
        ],
      },
    ];
    const result = scrubMessages(messages);
    assert(result.scrubbed, "Should scrub tool_result array content");
    const block = (result.messages[0].content as any[])[0];
    assertNotIncludes(block.content[0].text, "john@acme.com");
    assertNotIncludes(block.content[1].text, "+44 7911 123456");
    destroySession(result.sessionId);
  });

  await test("tool_result string content still works (backward compat)", () => {
    const messages: ChatMessage[] = [
      {
        role: "user",
        content: [{ type: "tool_result" as any, content: "Email: john@acme.com" } as any],
      },
    ];
    const result = scrubMessages(messages);
    assert(result.scrubbed, "Should scrub string content");
    assertNotIncludes((result.messages[0].content as any[])[0].content, "john@acme.com");
    destroySession(result.sessionId);
  });
}

// ═══════════════════════════════════════════
// Gap 4: System/Developer Message Scrubbing
// ═══════════════════════════════════════════

async function systemMessageScrubTests() {
  console.log("\n=== Gap 4: System/Developer Message Scrubbing (opt-in) ===\n");

  await test("scrubSystem=false: system messages pass through with PII", () => {
    const messages: ChatMessage[] = [
      { role: "system", content: "Contact admin@internal.com for help" },
      { role: "user", content: "Hello" },
    ];
    const result = scrubMessages(messages, undefined, false);
    assertIncludes(result.messages[0].content as string, "admin@internal.com");
  });

  await test("scrubSystem=true: scrubs system message string content", () => {
    const messages: ChatMessage[] = [
      {
        role: "system",
        content: "Admin email: admin@internal.com, key: sk-ant-abcdefghijklmnopqrstuvwxyz",
      },
      { role: "user", content: "Hello" },
    ];
    const result = scrubMessages(messages, undefined, true);
    assert(result.scrubbed, "Should scrub system message");
    assertNotIncludes(result.messages[0].content as string, "admin@internal.com");
    assertNotIncludes(result.messages[0].content as string, "sk-ant-");
    destroySession(result.sessionId);
  });

  await test("scrubSystem=true: scrubs system message array content", () => {
    const messages: ChatMessage[] = [
      {
        role: "system",
        content: [
          { type: "text", text: "User email: admin@internal.com" },
          { type: "text", text: "SSN: 123-45-6789" },
        ],
      },
      { role: "user", content: "Hello" },
    ];
    const result = scrubMessages(messages, undefined, true);
    assert(result.scrubbed, "Should scrub system array content");
    const blocks = result.messages[0].content as any[];
    assertNotIncludes(blocks[0].text, "admin@internal.com");
    assertNotIncludes(blocks[1].text, "123-45-6789");
    destroySession(result.sessionId);
  });

  await test("isPiiScrubSystem returns true when scrub_system is set", () => {
    const entry: ProviderConfigEntry = {
      baseUrl: "https://api.example.com",
      api: "openai",
      pii: { enabled: true, scrub_system: true },
    };
    assertEqual(isPiiScrubSystem(entry), true);
  });
}

// ═══════════════════════════════════════════
// Gap 5: Dedup Consistency
// ═══════════════════════════════════════════

async function dedupConsistencyTests() {
  console.log("\n=== Dedup Consistency ===\n");

  await test("same PII across user + tool + assistant messages → same placeholder", () => {
    const email = "john@acme.com";
    const messages: ChatMessage[] = [
      { role: "user", content: `Search ${email}` },
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "call_1",
            type: "function",
            function: { name: "search", arguments: `{"q":"${email}"}` },
          },
        ],
      },
      { role: "tool" as any, content: `Found: ${email}`, tool_call_id: "call_1" },
      { role: "user", content: `Now email ${email}` },
    ];
    const result = scrubMessages(messages);

    // Extract all p0 IDs for email placeholders
    const allText = JSON.stringify(result.messages);
    const idMatches = [...allText.matchAll(/p0([0-9a-f]{12})/g)];
    const uniqueIds = new Set(idMatches.map((m) => m[1]));

    // Should have exactly 1 unique ID for the same email
    assertEqual(uniqueIds.size, 1, `Expected 1 unique ID, got ${uniqueIds.size}`);
    destroySession(result.sessionId);
  });

  await test("different PII values get different placeholders", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "Email john@acme.com and jane@corp.org" },
    ];
    const result = scrubMessages(messages);
    const content = result.messages[0].content as string;
    const matches = [...content.matchAll(EMAIL_PH_G)];
    assertEqual(matches.length, 2, "Should have 2 email placeholders");
    assert(matches[0][1] !== matches[1][1], "Different emails should have different IDs");
    destroySession(result.sessionId);
  });
}

// ═══════════════════════════════════════════
// VaultStore Capacity Cap
// ═══════════════════════════════════════════

async function vaultStoreCapTests() {
  console.log("\n=== VaultStore Capacity Cap ===\n");

  await test("evicts oldest session when capacity reached", () => {
    const store = new VaultStore();
    const ids: string[] = [];
    for (let i = 0; i < 1001; i++) {
      const id = store.generateId();
      ids.push(id);
      store.getOrCreate(id);
    }
    assertEqual(store.get(ids[0]), undefined, "First session should be evicted");
    assert(store.get(ids[1000]) !== undefined, "Last session should exist");
    assert(store.size <= 1000, `Should be at most 1000, got ${store.size}`);
    store.shutdown();
  });
}

// ═══════════════════════════════════════════
// Full Multi-Turn Tool Call Flow
// ═══════════════════════════════════════════

async function fullToolCallFlowTests() {
  console.log("\n=== Full Tool Call Flow ===\n");

  await test("multi-turn: scrub → tool call → tool result → verify roundtrip", () => {
    const email = "john@acme.com";
    const apiKey = "sk-proj-abcdefghijklmnopqrstuvwxyz";

    const turn1 = scrubMessages([
      { role: "system", content: "You are a helpful assistant." },
      { role: "user", content: `Send email to ${email} using key ${apiKey}` },
    ]);
    assert(turn1.scrubbed, "Should be scrubbed");
    assertNotIncludes(turn1.messages[1].content as string, email);
    assertNotIncludes(turn1.messages[1].content as string, apiKey);

    // Simulate LLM response echoing placeholders in tool args
    const scrubbedContent = turn1.messages[1].content as string;
    const emailPh = scrubbedContent.match(/p0[0-9a-f]{12}@maildomain\.com/)![0];
    const keyPh = scrubbedContent.match(/p0[0-9a-f]{12}-placeholder-key/)![0];

    const llmToolArgs = `{"to":"${emailPh}","api_key":"${keyPh}"}`;
    const rehydratedArgs = rehydrateText(llmToolArgs, turn1.sessionId);
    assertIncludes(rehydratedArgs, email);
    assertIncludes(rehydratedArgs, apiKey);

    destroySession(turn1.sessionId);
  });

  await test("LLM generates text + tool_call: both rehydrate correctly", () => {
    const scrubbed = scrubMessages([
      { role: "user", content: "Look up john@acme.com and their file /Users/testuser/secrets.txt" },
    ]);
    const content = scrubbed.messages[0].content as string;
    const emailPh = content.match(/p0[0-9a-f]{12}@maildomain\.com/)![0];
    const pathPh = content.match(/p0[0-9a-f]{12}\/pii\/redacted/)![0];

    // Simulate LLM text response
    const llmText = `I'll look up ${emailPh} and read ${pathPh}`;
    const restoredText = rehydrateText(llmText, scrubbed.sessionId);
    assertIncludes(restoredText, "john@acme.com");
    assertIncludes(restoredText, "/Users/testuser/secrets.txt");

    destroySession(scrubbed.sessionId);
  });
}

// ═══════════════════════════════════════════
// Security: No PII Leaks
// ═══════════════════════════════════════════

async function securityTests() {
  console.log("\n=== Security: No PII Leak Verification ===\n");

  await test("scrubbed messages contain zero plaintext PII", () => {
    const piiValues = [
      "john@acme.com",
      "sk-ant-abcdefghijklmnopqrstuvwxyz",
      "123-45-6789",
      "+44 7911 123456",
      "4532 1234 5678 9012",
      "postgres://admin:s3cret@localhost/db",
      "/Users/testuser/secret.txt",
    ];
    const messages: ChatMessage[] = [
      { role: "user", content: piiValues.join(" | ") },
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "call_1",
            type: "function",
            function: {
              name: "process",
              arguments: JSON.stringify({ data: piiValues.join(", ") }),
            },
          },
        ],
      },
      { role: "tool" as any, content: `Result: ${piiValues.join("; ")}`, tool_call_id: "call_1" },
    ];

    const result = scrubMessages(messages);
    const allText = JSON.stringify(result.messages);

    for (const pii of piiValues) {
      assertNotIncludes(allText, pii, `PII leaked: ${pii}`);
    }
    destroySession(result.sessionId);
  });

  await test("cross-session rehydration fails safely", () => {
    const session1 = scrubMessages([{ role: "user", content: "Email john@acme.com" }]);
    const session2 = scrubMessages([{ role: "user", content: "Email jane@corp.org" }]);

    const ph1 = (session1.messages[0].content as string).match(
      /p0[0-9a-f]{12}@maildomain\.com/,
    )![0];
    const result = rehydrateText(`Found ${ph1}`, session2.sessionId);
    assertNotIncludes(result, "john@acme.com");

    destroySession(session1.sessionId);
    destroySession(session2.sessionId);
  });

  await test("fallback rehydration catches LLM-stripped placeholders", () => {
    const scrubbed = scrubMessages([{ role: "user", content: "Email john@acme.com" }]);
    const content = scrubbed.messages[0].content as string;
    // Extract just the p0{hex} marker (simulating LLM stripping the surrounding format)
    const marker = content.match(/p0[0-9a-f]{12}/)![0];
    const result = rehydrateText(`Found ${marker} in db`, scrubbed.sessionId);
    assertIncludes(result, "john@acme.com");
    destroySession(scrubbed.sessionId);
  });
}

// ═══════════════════════════════════════════
// Missing Roundtrip Tests (cc, pem, nino, post)
// ═══════════════════════════════════════════

async function missingRoundtripTests() {
  console.log("\n=== Missing Roundtrip Tests ===\n");

  await test("cc: redact → rehydrate roundtrip", () => {
    const vault = new SecretVault();
    const r = vault.redact("Card: 4532 1234 5678 9012");
    assertMatch(r.text, /p0[0-9a-f]{12}-0000-card/);
    const rh = vault.rehydrate(r.text);
    assertIncludes(rh.text, "4532 1234 5678 9012");
    vault.destroy();
  });

  await test("pem: redact → rehydrate roundtrip", () => {
    const vault = new SecretVault();
    const pem = "-----BEGIN RSA PRIVATE KEY-----\nMIIBogIBAAJ\n-----END RSA PRIVATE KEY-----";
    const r = vault.redact(`Key: ${pem}`);
    assertMatch(r.text, /p0[0-9a-f]{12}-PII-KEY/);
    const rh = vault.rehydrate(r.text);
    assertIncludes(rh.text, "BEGIN RSA PRIVATE KEY");
    vault.destroy();
  });

  await test("nino: redact → rehydrate roundtrip", () => {
    const vault = new SecretVault();
    const r = vault.redact("NINO: AB123456C");
    assertMatch(r.text, /p0[0-9a-f]{12}-nino/);
    const rh = vault.rehydrate(r.text);
    assertIncludes(rh.text, "AB123456C");
    vault.destroy();
  });

  await test("post: redact → rehydrate roundtrip", () => {
    const vault = new SecretVault();
    const r = vault.redact("Postcode: SW1A 1AA");
    assertMatch(r.text, /p0[0-9a-f]{12}-postcode/);
    const rh = vault.rehydrate(r.text);
    assertIncludes(rh.text, "SW1A 1AA");
    vault.destroy();
  });

  await test("cred (Bearer): redact → rehydrate roundtrip", () => {
    const vault = new SecretVault();
    const r = vault.redact(
      "Auth: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0",
    );
    assertMatch(r.text, /p0[0-9a-f]{12}-placeholder-token/);
    const rh = vault.rehydrate(r.text);
    assertIncludes(rh.text, "Bearer eyJhbGci");
    vault.destroy();
  });
}

// ═══════════════════════════════════════════
// rehydrateStrict vs rehydrate Contract
// ═══════════════════════════════════════════

async function strictVsFullTests() {
  console.log("\n=== rehydrateStrict vs rehydrate ===\n");

  await test("rehydrateStrict does NOT match bare p0{hex}", () => {
    const vault = new SecretVault();
    vault.redact("john@acme.com");
    // Get the hex ID from the vault
    const scrubbed = vault.redact("john@acme.com");
    const marker = scrubbed.text.match(/p0([0-9a-f]{12})/)![0];
    // rehydrateStrict should NOT match bare p0{hex} (no type suffix)
    const strict = vault.rehydrateStrict(`Found ${marker} in db`);
    assertEqual(strict.count, 0, "Strict should not match bare p0{hex}");
    assertIncludes(strict.text, marker);
    vault.destroy();
  });

  await test("rehydrate DOES match bare p0{hex} via fallback", () => {
    const vault = new SecretVault();
    vault.redact("john@acme.com");
    const scrubbed = vault.redact("john@acme.com");
    const marker = scrubbed.text.match(/p0([0-9a-f]{12})/)![0];
    // Full rehydrate should match via fallback
    const full = vault.rehydrate(`Found ${marker} in db`);
    assert(full.count > 0, "Full rehydrate should match via fallback");
    assertIncludes(full.text, "john@acme.com");
    vault.destroy();
  });
}

// ═══════════════════════════════════════════
// Streaming Tests for Non-Email Types
// ═══════════════════════════════════════════

async function streamingMultiTypeTests() {
  console.log("\n=== Streaming: Non-Email Types ===\n");

  await test("streaming: apikey placeholder split and rehydrated", () => {
    const scrubbed = scrubMessages([
      { role: "user", content: "Key: sk-ant-abcdefghijklmnopqrstuvwxyz" },
    ]);
    const content = scrubbed.messages[0].content as string;
    assertMatch(content, /p0[0-9a-f]{12}-placeholder-key/);
    // Split mid-way
    const mid = Math.floor(content.length / 2);
    const result = feedToolArgChunks(
      [content.slice(0, mid), content.slice(mid)],
      scrubbed.sessionId,
    );
    assertIncludes(result, "sk-ant-abcdefghijklmnopqrstuvwxyz");
    destroySession(scrubbed.sessionId);
  });

  await test("streaming: path placeholder split and rehydrated", () => {
    const scrubbed = scrubMessages([{ role: "user", content: "File: /Users/testuser/secret.txt" }]);
    const content = scrubbed.messages[0].content as string;
    assertMatch(content, /p0[0-9a-f]{12}\/pii\/redacted/);
    const mid = Math.floor(content.length / 2);
    const result = feedToolArgChunks(
      [content.slice(0, mid), content.slice(mid)],
      scrubbed.sessionId,
    );
    assertIncludes(result, "/Users/testuser/secret.txt");
    destroySession(scrubbed.sessionId);
  });

  await test("streaming: conn placeholder split and rehydrated", () => {
    const scrubbed = scrubMessages([
      { role: "user", content: "DB: postgres://admin:s3cret@localhost/mydb" },
    ]);
    const content = scrubbed.messages[0].content as string;
    assertMatch(content, /p0[0-9a-f]{12}:\/\/placeholder\/db/);
    const mid = Math.floor(content.length / 2);
    const result = feedToolArgChunks(
      [content.slice(0, mid), content.slice(mid)],
      scrubbed.sessionId,
    );
    assertIncludes(result, "postgres://admin:s3cret@localhost/mydb");
    destroySession(scrubbed.sessionId);
  });

  await test("streaming: secret (password=) placeholder split and rehydrated", () => {
    const scrubbed = scrubMessages([{ role: "user", content: "Config: password=hunter2secret" }]);
    const content = scrubbed.messages[0].content as string;
    assertMatch(content, /p0[0-9a-f]{12}-password/);
    const mid = Math.floor(content.length / 2);
    const result = feedToolArgChunks(
      [content.slice(0, mid), content.slice(mid)],
      scrubbed.sessionId,
    );
    assertIncludes(result, "password=hunter2secret");
    destroySession(scrubbed.sessionId);
  });

  await test("streaming: secret preserves different keywords", () => {
    const vault = new SecretVault();
    const r1 = vault.redact("token=abc123secret");
    assertMatch(r1.text, /p0[0-9a-f]{12}-token/);
    const r2 = vault.redact("client_secret=xyz789abc");
    assertMatch(r2.text, /p0[0-9a-f]{12}-client_secret/);
    vault.destroy();
  });
}

// ═══════════════════════════════════════════
// Run All
// ═══════════════════════════════════════════

async function main() {
  console.log("\n╔══════════════════════════════════════╗");
  console.log("║  PII Gap Fixes + Type-Preserving     ║");
  console.log("╚══════════════════════════════════════╝");

  await formatValidationTests();
  await streamingToolCallCarryTests();
  await toolResultArrayContentTests();
  await systemMessageScrubTests();
  await dedupConsistencyTests();
  await vaultStoreCapTests();
  await fullToolCallFlowTests();
  await securityTests();
  await missingRoundtripTests();
  await strictVsFullTests();
  await streamingMultiTypeTests();

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Test runner error:", err);
  process.exit(1);
});
