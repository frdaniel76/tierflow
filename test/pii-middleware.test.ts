/**
 * Unit tests for PII vault core, scrubMessages(), and rehydrateText().
 *
 * Usage:
 *   npx tsx test/pii-middleware.test.ts
 */

import { scrubMessages, rehydrateText, destroySession, piiVaultStore } from "../src/pii/index.js";
import { SecretVault } from "../src/pii/vault.js";
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
  if (!haystack.includes(needle)) throw new Error(msg || `Expected "${haystack}" to include "${needle}"`);
}

function assertNotIncludes(haystack: string, needle: string, msg?: string) {
  if (haystack.includes(needle)) throw new Error(msg || `Expected "${haystack}" NOT to include "${needle}"`);
}

function assertMatch(text: string, regex: RegExp, msg?: string) {
  if (!regex.test(text)) throw new Error(msg || `Expected "${text}" to match ${regex}`);
}

// ═══════════════════════════════════════════
// SecretVault — Pattern Detection (per-category)
// ═══════════════════════════════════════════

async function patternDetectionTests() {
  console.log("\n=== SecretVault — Pattern Detection ===\n");

  await test("detects email addresses", () => {
    const vault = new SecretVault();
    const result = vault.redact("Contact john@acme.com for help");
    assert(result.count >= 1, `Expected ≥1, got ${result.count}`);
    assertNotIncludes(result.text, "john@acme.com");
    assert(result.categories.includes("email"), "Should include email category");
    vault.destroy();
  });

  await test("detects API keys (sk-ant-*)", () => {
    const vault = new SecretVault();
    const result = vault.redact("Key: sk-ant-abcdefghijklmnopqrstuvwxyz");
    assert(result.count >= 1, `Expected ≥1, got ${result.count}`);
    assertNotIncludes(result.text, "sk-ant-");
    vault.destroy();
  });

  await test("detects API keys (sk-*)", () => {
    const vault = new SecretVault();
    const result = vault.redact("Key: sk-proj-abcdefghijklmnopqrstuvwxyz");
    assert(result.count >= 1, `Expected ≥1, got ${result.count}`);
    assertNotIncludes(result.text, "sk-proj-");
    vault.destroy();
  });

  await test("detects API keys (ghp_*)", () => {
    const vault = new SecretVault();
    const result = vault.redact("Token: ghp_ABCDEFGHIJKLMNOPQRSTuvwx");
    assert(result.count >= 1, `Expected ≥1, got ${result.count}`);
    assertNotIncludes(result.text, "ghp_");
    vault.destroy();
  });

  await test("detects API keys (AKIA*)", () => {
    const vault = new SecretVault();
    const result = vault.redact("AWS: AKIAIOSFODNN7EXAMPLE");
    assert(result.count >= 1, `Expected ≥1, got ${result.count}`);
    assertNotIncludes(result.text, "AKIA");
    vault.destroy();
  });

  await test("detects bearer tokens", () => {
    const vault = new SecretVault();
    const result = vault.redact("Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.test");
    assert(result.count >= 1, `Expected ≥1, got ${result.count}`);
    assertNotIncludes(result.text, "Bearer eyJ");
    vault.destroy();
  });

  await test("detects PEM blocks", () => {
    const vault = new SecretVault();
    const pem = "-----BEGIN RSA PRIVATE KEY-----\nMIIBogIBAAJBALRiMLAh\n-----END RSA PRIVATE KEY-----";
    const result = vault.redact(`Key: ${pem}`);
    assert(result.count >= 1, `Expected ≥1, got ${result.count}`);
    assertNotIncludes(result.text, "BEGIN RSA");
    vault.destroy();
  });

  await test("detects credentials (password=value)", () => {
    const vault = new SecretVault();
    const result = vault.redact("config: password=SuperSecret123!");
    assert(result.count >= 1, `Expected ≥1, got ${result.count}`);
    assertNotIncludes(result.text, "SuperSecret123");
    vault.destroy();
  });

  await test("detects connection strings (postgres://)", () => {
    const vault = new SecretVault();
    const result = vault.redact("Use postgres://admin:secret@db.internal:5432/mydb");
    assert(result.count >= 1, `Expected ≥1, got ${result.count}`);
    assertNotIncludes(result.text, "postgres://");
    vault.destroy();
  });

  await test("detects connection strings (mongodb://)", () => {
    const vault = new SecretVault();
    const result = vault.redact("Use mongodb://user:pass@cluster.example.com/db");
    assert(result.count >= 1, `Expected ≥1, got ${result.count}`);
    assertNotIncludes(result.text, "mongodb://");
    vault.destroy();
  });

  await test("detects phone numbers (international)", () => {
    const vault = new SecretVault();
    const result = vault.redact("Call +44 7911 123456 now");
    assert(result.count >= 1, `Expected ≥1, got ${result.count}`);
    assertNotIncludes(result.text, "7911 123456");
    vault.destroy();
  });

  await test("detects IP addresses", () => {
    const vault = new SecretVault();
    const result = vault.redact("Server at 192.168.1.100 is down");
    assert(result.count >= 1, `Expected ≥1, got ${result.count}`);
    assertNotIncludes(result.text, "192.168.1.100");
    vault.destroy();
  });

  await test("detects credit card numbers", () => {
    const vault = new SecretVault();
    const result = vault.redact("Card: 4111 1111 1111 1111");
    assert(result.count >= 1, `Expected ≥1, got ${result.count}`);
    assertNotIncludes(result.text, "4111 1111");
    vault.destroy();
  });

  await test("detects UK NINOs", () => {
    const vault = new SecretVault();
    const result = vault.redact("NINO: AB123456C");
    assert(result.count >= 1, `Expected ≥1, got ${result.count}`);
    assertNotIncludes(result.text, "AB123456C");
    vault.destroy();
  });

  await test("detects UK postcodes", () => {
    const vault = new SecretVault();
    const result = vault.redact("Address: SW1A 1AA London");
    assert(result.count >= 1, `Expected ≥1, got ${result.count}`);
    assertNotIncludes(result.text, "SW1A 1AA");
    vault.destroy();
  });

  await test("detects file paths (/Users/...)", () => {
    const vault = new SecretVault();
    const result = vault.redact("Located at /Users/testuser/Documents/secrets.txt");
    assert(result.count >= 1, `Expected ≥1, got ${result.count}`);
    assertNotIncludes(result.text, "/Users/testuser");
    vault.destroy();
  });

  // C-2: SSN detection
  await test("detects US Social Security Numbers (XXX-XX-XXXX)", () => {
    const vault = new SecretVault();
    const result = vault.redact("SSN: 123-45-6789");
    assert(result.count >= 1, `Expected ≥1, got ${result.count}`);
    assertNotIncludes(result.text, "123-45-6789");
    assert(result.categories.includes("ssn"), "Should include ssn category");
    vault.destroy();
  });

  await test("detects SSN without dashes (123456789)", () => {
    const vault = new SecretVault();
    const result = vault.redact("SSN: 123456789");
    assert(result.count >= 1, `Expected ≥1, got ${result.count}`);
    assertNotIncludes(result.text, "123456789");
    vault.destroy();
  });

  await test("detects SSN with spaces (123 45 6789)", () => {
    const vault = new SecretVault();
    const result = vault.redact("SSN: 123 45 6789");
    assert(result.count >= 1, `Expected ≥1, got ${result.count}`);
    assertNotIncludes(result.text, "123 45 6789");
    vault.destroy();
  });

  // C-3: credit card — tighter pattern
  await test("detects Visa card (4111111111111111)", () => {
    const vault = new SecretVault();
    const result = vault.redact("Card: 4111111111111111");
    assert(result.count >= 1, `Expected ≥1, got ${result.count}`);
    assertNotIncludes(result.text, "4111111111111111");
    vault.destroy();
  });

  await test("detects grouped card (4111 1111 1111 1111)", () => {
    const vault = new SecretVault();
    const result = vault.redact("Card: 4111 1111 1111 1111");
    assert(result.count >= 1, `Expected ≥1, got ${result.count}`);
    assertNotIncludes(result.text, "4111 1111");
    vault.destroy();
  });

  await test("detects Amex card (378282246310005)", () => {
    const vault = new SecretVault();
    const result = vault.redact("Amex: 378282246310005");
    assert(result.count >= 1, `Expected ≥1, got ${result.count}`);
    assertNotIncludes(result.text, "378282246310005");
    vault.destroy();
  });

  await test("does NOT false-positive on version strings as credit card", () => {
    const vault = new SecretVault();
    const result = vault.redact("Version 2.3.4.5 released today");
    const ccMatches = (result.text.match(/0000-p0/g) ?? []).length;
    assertEqual(ccMatches, 0, "Version string should NOT match as credit card");
    vault.destroy();
  });

  // H-3: IPv6 detection
  await test("detects full IPv6 address", () => {
    const vault = new SecretVault();
    const result = vault.redact("Server at 2001:0db8:85a3:0000:0000:8a2e:0370:7334");
    assert(result.count >= 1, `Expected ≥1, got ${result.count}`);
    assertNotIncludes(result.text, "2001:0db8");
    vault.destroy();
  });

  // H-4: JWT without signature
  await test("detects JWT with signature", () => {
    const vault = new SecretVault();
    const jwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
    const result = vault.redact(`Token: ${jwt}`);
    assert(result.count >= 1, `Expected ≥1, got ${result.count}`);
    assertNotIncludes(result.text, "eyJhbGci");
    vault.destroy();
  });

  await test("detects unsigned JWT (no signature segment)", () => {
    const vault = new SecretVault();
    const jwt = "eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIn0";
    const result = vault.redact(`Token: ${jwt}`);
    assert(result.count >= 1, `Expected ≥1, got ${result.count}`);
    assertNotIncludes(result.text, "eyJhbGci");
    vault.destroy();
  });

  // M-7: expanded credential keywords
  await test("detects credentials with 'pwd' keyword", () => {
    const vault = new SecretVault();
    const result = vault.redact("config: pwd=MySecret123!");
    assert(result.count >= 1, `Expected ≥1, got ${result.count}`);
    assertNotIncludes(result.text, "MySecret123");
    vault.destroy();
  });

  await test("detects credentials with 'private_key' keyword", () => {
    const vault = new SecretVault();
    const result = vault.redact("private_key=abcdefghijklmnop");
    assert(result.count >= 1, `Expected ≥1, got ${result.count}`);
    assertNotIncludes(result.text, "abcdefghijklmnop");
    vault.destroy();
  });

  await test("detects credentials with 'client_secret' keyword", () => {
    const vault = new SecretVault();
    const result = vault.redact("client_secret: xyzSecret999");
    assert(result.count >= 1, `Expected ≥1, got ${result.count}`);
    assertNotIncludes(result.text, "xyzSecret999");
    vault.destroy();
  });

  // L-3: expanded file paths
  await test("detects file paths (/root/...)", () => {
    const vault = new SecretVault();
    const result = vault.redact("Located at /root/.ssh/id_rsa");
    assert(result.count >= 1, `Expected ≥1, got ${result.count}`);
    assertNotIncludes(result.text, "/root/.ssh");
    vault.destroy();
  });

  await test("detects file paths (/etc/...)", () => {
    const vault = new SecretVault();
    const result = vault.redact("Check /etc/passwd for users");
    assert(result.count >= 1, `Expected ≥1, got ${result.count}`);
    assertNotIncludes(result.text, "/etc/passwd");
    vault.destroy();
  });

  await test("detects file paths (/var/...)", () => {
    const vault = new SecretVault();
    const result = vault.redact("Logs at /var/log/syslog");
    assert(result.count >= 1, `Expected ≥1, got ${result.count}`);
    assertNotIncludes(result.text, "/var/log");
    vault.destroy();
  });
}

// ═══════════════════════════════════════════
// SecretVault — Core Behaviour
// ═══════════════════════════════════════════

async function vaultCoreTests() {
  console.log("\n=== SecretVault — Core Behaviour ===\n");

  await test("redact produces type-preserving placeholder with p0{hex} marker", () => {
    const vault = new SecretVault();
    const result = vault.redact("Contact john@acme.com ok");
    assertMatch(result.text, /p0[0-9a-f]{12}@maildomain\.com/);
    vault.destroy();
  });

  await test("redact returns unchanged text when no PII found", () => {
    const vault = new SecretVault();
    const result = vault.redact("Hello world, how are you?");
    assertEqual(result.count, 0);
    assertEqual(result.text, "Hello world, how are you?");
    vault.destroy();
  });

  await test("redact preserves surrounding text exactly", () => {
    const vault = new SecretVault();
    const result = vault.redact("  Before  john@acme.com  After  ");
    assertIncludes(result.text, "  Before  ");
    assertIncludes(result.text, "  After  ");
    vault.destroy();
  });

  await test("redact handles multiple PII types in single text", () => {
    const vault = new SecretVault();
    const result = vault.redact("Email john@acme.com, key sk-ant-abcdefghijklmnopqrstuvwxyz, IP 10.0.0.1");
    assert(result.count >= 3, `Expected ≥3, got ${result.count}`);
    assertNotIncludes(result.text, "john@acme.com");
    assertNotIncludes(result.text, "sk-ant-");
    assertNotIncludes(result.text, "10.0.0.1");
    vault.destroy();
  });

  await test("rehydrate restores original value exactly", () => {
    const vault = new SecretVault();
    const original = "Contact john@acme.com for help";
    const redacted = vault.redact(original);
    const restored = vault.rehydrate(redacted.text);
    assertEqual(restored.text, original);
    assertEqual(restored.count, 1);
    vault.destroy();
  });

  await test("rehydrate restores multiple placeholders", () => {
    const vault = new SecretVault();
    const original = "Email john@acme.com and jane@corp.org please";
    const redacted = vault.redact(original);
    const restored = vault.rehydrate(redacted.text);
    assertEqual(restored.text, original);
    vault.destroy();
  });

  await test("rehydrate leaves unknown placeholder IDs intact", () => {
    const vault = new SecretVault();
    const text = "p0[0-9a-f]{12} is unknown";
    const result = vault.rehydrate(text);
    assertEqual(result.text, text);
    assertEqual(result.count, 0);
    vault.destroy();
  });

  await test("redact → rehydrate round-trip produces identical original", () => {
    const vault = new SecretVault();
    const original = "User john@acme.com at 192.168.1.1 with key sk-ant-abcdefghijklmnopqrstuvwxyz says hi";
    const redacted = vault.redact(original);
    const restored = vault.rehydrate(redacted.text);
    assertEqual(restored.text, original);
    vault.destroy();
  });

  await test("deduplicates same value across multiple redact calls", () => {
    const vault = new SecretVault();
    const r1 = vault.redact("Contact john@acme.com");
    const r2 = vault.redact("Also john@acme.com");
    const id1 = r1.text.match(/p0([0-9a-f]{12})@maildomain\.com/)![1];
    const id2 = r2.text.match(/p0([0-9a-f]{12})@maildomain\.com/)![1];
    assertEqual(id1, id2, "Same value should get same placeholder ID");
    assertEqual(vault.size, 1, "Should only store 1 entry");
    vault.destroy();
  });

  await test("exclude list skips specified categories", () => {
    const vault = new SecretVault(["email"]);
    const result = vault.redact("Contact john@acme.com, key sk-ant-abcdefghijklmnopqrstuvwxyz");
    assertIncludes(result.text, "john@acme.com");
    assertNotIncludes(result.text, "sk-ant-");
    vault.destroy();
  });

  await test("redact skips code blocks on passes 2+", () => {
    const vault = new SecretVault();
    const result = vault.redact("```\njohn@acme.com\n```");
    assertEqual(result.count, 0, "Should skip email inside code block");
    vault.destroy();
  });

  await test("redact handles overlapping patterns (earlier pass wins)", () => {
    const vault = new SecretVault();
    // Bearer token contains what could match as a credential pattern
    const result = vault.redact("Authorization: Bearer sk-ant-abcdefghijklmnopqrstuvwxyz");
    assert(result.count >= 1, "Should detect at least one pattern");
    vault.destroy();
  });
}

// ═══════════════════════════════════════════
// SecretVault — Lifecycle
// ═══════════════════════════════════════════

async function vaultLifecycleTests() {
  console.log("\n=== SecretVault — Lifecycle ===\n");

  await test("destroyed vault throws on redact", () => {
    const vault = new SecretVault();
    vault.destroy();
    try {
      vault.redact("john@acme.com");
      throw new Error("Should have thrown");
    } catch (err) {
      assertIncludes((err as Error).message, "destroyed");
    }
  });

  await test("destroyed vault throws on rehydrate", () => {
    const vault = new SecretVault();
    vault.destroy();
    try {
      vault.rehydrate("p0[0-9a-f]{12}");
      throw new Error("Should have thrown");
    } catch (err) {
      assertIncludes((err as Error).message, "destroyed");
    }
  });

  await test("vault.size reflects stored PII items", () => {
    const vault = new SecretVault();
    assertEqual(vault.size, 0);
    vault.redact("Email john@acme.com");
    assertEqual(vault.size, 1);
    vault.redact("Also jane@corp.org");
    assertEqual(vault.size, 2);
    // Dedup: same email doesn't increase count
    vault.redact("Again john@acme.com");
    assertEqual(vault.size, 2);
    vault.destroy();
  });
}

// ═══════════════════════════════════════════
// scrubMessages() Tests
// ═══════════════════════════════════════════

async function scrubMessagesTests() {
  console.log("\n=== scrubMessages() ===\n");

  // --- Content Handling ---

  await test("scrubs PII from user message content (string)", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "Email me at john@acme.com" },
    ];
    const result = scrubMessages(messages);
    assert(result.scrubbed, "Should flag as scrubbed");
    assertNotIncludes(result.messages[0].content as string, "john@acme.com");
    assertIncludes(result.messages[0].content as string, "@maildomain.com");
    destroySession(result.sessionId);
  });

  await test("scrubs PII from assistant message content", () => {
    const messages: ChatMessage[] = [
      { role: "assistant", content: "The email is john@acme.com" },
    ];
    const result = scrubMessages(messages);
    assert(result.scrubbed, "Should scrub assistant content");
    assertNotIncludes(result.messages[0].content as string, "john@acme.com");
    destroySession(result.sessionId);
  });

  await test("scrubs PII from multiple messages in conversation", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "My email is john@acme.com" },
      { role: "assistant", content: "Got it, john@acme.com" },
      { role: "user", content: "Also call +44 7911 123456" },
    ];
    const result = scrubMessages(messages);
    assert(result.scrubbed, "Should be scrubbed");
    assertNotIncludes(result.messages[0].content as string, "john@acme.com");
    assertNotIncludes(result.messages[1].content as string, "john@acme.com");
    destroySession(result.sessionId);
  });

  await test("handles array-format content (text + image)", () => {
    const messages: ChatMessage[] = [
      {
        role: "user",
        content: [
          { type: "text", text: "Email john@acme.com" },
          { type: "image_url", image_url: { url: "data:image/png;base64,abc" } },
        ],
      },
    ];
    const result = scrubMessages(messages);
    assert(result.scrubbed, "Should be scrubbed");
    const textBlock = (result.messages[0].content as any[])[0];
    assertNotIncludes(textBlock.text, "john@acme.com");
    const imageBlock = (result.messages[0].content as any[])[1];
    assertEqual(imageBlock.type, "image_url");
    destroySession(result.sessionId);
  });

  await test("handles multiple text blocks in array content", () => {
    const messages: ChatMessage[] = [
      {
        role: "user",
        content: [
          { type: "text", text: "Part 1: john@acme.com" },
          { type: "text", text: "Part 2: 192.168.1.100" },
        ],
      },
    ];
    const result = scrubMessages(messages);
    assert(result.scrubbed, "Should scrub both text blocks");
    assertNotIncludes((result.messages[0].content as any[])[0].text, "john@acme.com");
    assertNotIncludes((result.messages[0].content as any[])[1].text, "192.168.1.100");
    destroySession(result.sessionId);
  });

  await test("handles messages with only image content (no text)", () => {
    const messages: ChatMessage[] = [
      {
        role: "user",
        content: [
          { type: "image_url", image_url: { url: "data:image/png;base64,abc" } },
        ],
      },
    ];
    const result = scrubMessages(messages);
    assert(!result.scrubbed, "Should NOT scrub (no text)");
    assertEqual((result.messages[0].content as any[])[0].type, "image_url");
  });

  await test("scrubs tool_calls arguments", () => {
    const messages: ChatMessage[] = [
      {
        role: "assistant",
        content: null,
        tool_calls: [{
          id: "call_1",
          type: "function",
          function: { name: "search", arguments: '{"query":"john@acme.com"}' },
        }],
      },
    ];
    const result = scrubMessages(messages);
    assert(result.scrubbed, "Should scrub tool args");
    assertNotIncludes(result.messages[0].tool_calls![0].function.arguments, "john@acme.com");
    destroySession(result.sessionId);
  });

  await test("scrubs tool result messages (role: tool)", () => {
    const messages: ChatMessage[] = [
      { role: "tool" as any, content: "Result: john@acme.com found", tool_call_id: "call_1" },
    ];
    const result = scrubMessages(messages);
    assert(result.scrubbed, "Should scrub tool result");
    assertNotIncludes(result.messages[0].content as string, "john@acme.com");
    destroySession(result.sessionId);
  });

  // --- Role Handling ---

  await test("skips system messages", () => {
    const messages: ChatMessage[] = [
      { role: "system", content: "You are helpful. Contact admin@internal.com" },
      { role: "user", content: "Email john@acme.com" },
    ];
    const result = scrubMessages(messages);
    assertIncludes(result.messages[0].content as string, "admin@internal.com");
    assertNotIncludes(result.messages[1].content as string, "john@acme.com");
    destroySession(result.sessionId);
  });

  await test("skips developer messages", () => {
    const messages: ChatMessage[] = [
      { role: "developer", content: "API key: sk-ant-abcdefghijklmnopqrstuvwxyz" },
      { role: "user", content: "hi" },
    ];
    const result = scrubMessages(messages);
    assertIncludes(result.messages[0].content as string, "sk-ant-");
    destroySession(result.sessionId);
  });

  // --- Edge Cases ---

  await test("handles messages with no PII (passthrough)", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "What is the capital of France?" },
    ];
    const result = scrubMessages(messages);
    assert(!result.scrubbed, "Should NOT be scrubbed");
    assertEqual(result.messages[0].content as string, "What is the capital of France?");
  });

  await test("handles empty messages array", () => {
    const result = scrubMessages([]);
    assert(!result.scrubbed, "Should NOT be scrubbed");
    assertEqual(result.messages.length, 0);
  });

  await test("handles null content gracefully", () => {
    const messages: ChatMessage[] = [
      { role: "assistant", content: null },
    ];
    const result = scrubMessages(messages);
    assert(!result.scrubbed, "Should NOT be scrubbed");
  });

  await test("deep-copies messages (original untouched)", () => {
    const original: ChatMessage[] = [
      { role: "user", content: "Email john@acme.com" },
    ];
    const originalContent = original[0].content;
    const result = scrubMessages(original);
    assertEqual(original[0].content as string, originalContent as string);
    assertNotIncludes(result.messages[0].content as string, "john@acme.com");
    destroySession(result.sessionId);
  });

  await test("deduplicates same email across different messages", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "Email john@acme.com" },
      { role: "user", content: "Again john@acme.com" },
    ];
    const result = scrubMessages(messages);
    const id1 = (result.messages[0].content as string).match(/p0([0-9a-f]{12})@maildomain\.com/)![1];
    const id2 = (result.messages[1].content as string).match(/p0([0-9a-f]{12})@maildomain\.com/)![1];
    assertEqual(id1, id2, "Same email should produce same placeholder across messages");
    destroySession(result.sessionId);
  });

  await test("handles very long message content (10KB+)", () => {
    const longPrefix = "A".repeat(10_000);
    const messages: ChatMessage[] = [
      { role: "user", content: `${longPrefix} john@acme.com end` },
    ];
    const result = scrubMessages(messages);
    assert(result.scrubbed, "Should scrub PII in long message");
    assertNotIncludes(result.messages[0].content as string, "john@acme.com");
    assertEqual((result.messages[0].content as string).length > 10_000, true, "Content should still be long");
    destroySession(result.sessionId);
  });

  await test("full multi-turn conversation: system → user → assistant → tool → user", () => {
    const messages: ChatMessage[] = [
      { role: "system", content: "You are a helpful assistant." },
      { role: "user", content: "Search for john@acme.com" },
      {
        role: "assistant", content: null,
        tool_calls: [{ id: "call_1", type: "function", function: { name: "search", arguments: '{"q":"john@acme.com"}' } }],
      },
      { role: "tool" as any, content: "Found: john@acme.com, +44 7911 123456", tool_call_id: "call_1" },
      { role: "user", content: "Great, now email john@acme.com about it" },
    ];
    const result = scrubMessages(messages);
    assert(result.scrubbed, "Should scrub the conversation");
    // System untouched
    assertEqual(result.messages[0].content as string, "You are a helpful assistant.");
    // User messages scrubbed
    assertNotIncludes(result.messages[1].content as string, "john@acme.com");
    // Tool args scrubbed
    assertNotIncludes(result.messages[2].tool_calls![0].function.arguments, "john@acme.com");
    // Tool result scrubbed
    assertNotIncludes(result.messages[3].content as string, "john@acme.com");
    // Last user message scrubbed
    assertNotIncludes(result.messages[4].content as string, "john@acme.com");
    destroySession(result.sessionId);
  });

  // --- Output ---

  await test("returns categories found", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "Email john@acme.com, key sk-ant-abcdefghijklmnopqrstuvwxyz" },
    ];
    const result = scrubMessages(messages);
    assert(result.categories.includes("email"), "Should include email");
    assert(result.categories.includes("apikey"), "Should include apikey");
    destroySession(result.sessionId);
  });

  // C-4: tool_result array content scrubbing
  await test("scrubs tool_result blocks in array content (Anthropic format)", () => {
    const messages: ChatMessage[] = [
      {
        role: "user",
        content: [
          { type: "tool_result" as any, content: "Email: john@acme.com" } as any,
        ],
      },
    ];
    const result = scrubMessages(messages);
    assert(result.scrubbed, "Should scrub tool_result content");
    const block = (result.messages[0].content as any[])[0];
    assertNotIncludes(block.content, "john@acme.com");
    destroySession(result.sessionId);
  });

  // SSN in integration context
  await test("scrubs SSN from user messages", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "My SSN is 123-45-6789" },
    ];
    const result = scrubMessages(messages);
    assert(result.scrubbed, "Should scrub SSN");
    assertNotIncludes(result.messages[0].content as string, "123-45-6789");
    destroySession(result.sessionId);
  });

  await test("respects exclude list", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "Email john@acme.com, call +44 7911 123456" },
    ];
    const result = scrubMessages(messages, ["phone"]);
    assertNotIncludes(result.messages[0].content as string, "john@acme.com");
    assertIncludes(result.messages[0].content as string, "+44 7911 123456");
    destroySession(result.sessionId);
  });

  await test("sessionId is unique per call", () => {
    const r1 = scrubMessages([{ role: "user", content: "john@acme.com" }]);
    const r2 = scrubMessages([{ role: "user", content: "jane@corp.org" }]);
    assert(r1.sessionId !== r2.sessionId, "Session IDs should be unique");
    destroySession(r1.sessionId);
    destroySession(r2.sessionId);
  });

  await test("session auto-destroyed when no PII found", () => {
    const result = scrubMessages([{ role: "user", content: "Hello world" }]);
    assert(!result.scrubbed, "Should not be scrubbed");
    // Session should already be cleaned up
    assertEqual(piiVaultStore.get(result.sessionId), undefined, "Session should be auto-destroyed");
  });
}

// ═══════════════════════════════════════════
// rehydrateText() Tests
// ═══════════════════════════════════════════

async function rehydrateTextTests() {
  console.log("\n=== rehydrateText() ===\n");

  await test("restores single placeholder", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "Email john@acme.com" },
    ];
    const scrubbed = scrubMessages(messages);
    const restored = rehydrateText(scrubbed.messages[0].content as string, scrubbed.sessionId);
    assertEqual(restored, "Email john@acme.com");
    destroySession(scrubbed.sessionId);
  });

  await test("restores multiple placeholders", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "Email john@acme.com and jane@corp.org" },
    ];
    const scrubbed = scrubMessages(messages);
    const restored = rehydrateText(scrubbed.messages[0].content as string, scrubbed.sessionId);
    assertIncludes(restored, "john@acme.com");
    assertIncludes(restored, "jane@corp.org");
    destroySession(scrubbed.sessionId);
  });

  await test("handles text with no placeholders (passthrough)", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "Email john@acme.com" },
    ];
    const scrubbed = scrubMessages(messages);
    const result = rehydrateText("Just normal text", scrubbed.sessionId);
    assertEqual(result, "Just normal text");
    destroySession(scrubbed.sessionId);
  });

  await test("handles unknown session ID gracefully", () => {
    const result = rehydrateText("p0[0-9a-f]{12} test", "nonexistent");
    assertEqual(result, "p0[0-9a-f]{12} test");
  });

  await test("handles destroyed session gracefully", () => {
    const scrubbed = scrubMessages([{ role: "user", content: "Email john@acme.com" }]);
    destroySession(scrubbed.sessionId);
    const result = rehydrateText(scrubbed.messages[0].content as string, scrubbed.sessionId);
    // Placeholder should remain since session is destroyed
    assertIncludes(result, "@maildomain.com");
  });

  await test("partial/malformed placeholders left as-is", () => {
    const scrubbed = scrubMessages([{ role: "user", content: "Email john@acme.com" }]);
    const result = rehydrateText("p0short@maildomain.com and random_text_here", scrubbed.sessionId);
    assertIncludes(result, "p0short@maildomain.com");
    destroySession(scrubbed.sessionId);
  });

  await test("handles response with mixed model text + placeholders", () => {
    const scrubbed = scrubMessages([{ role: "user", content: "Find john@acme.com" }]);
    const placeholder = (scrubbed.messages[0].content as string).match(/p0[0-9a-f]{12}@maildomain\.com/)![0];
    const modelResponse = `I found the contact ${placeholder} in our database. They work at Acme Corp.`;
    const restored = rehydrateText(modelResponse, scrubbed.sessionId);
    assertIncludes(restored, "john@acme.com");
    assertIncludes(restored, "I found the contact");
    assertIncludes(restored, "in our database");
    destroySession(scrubbed.sessionId);
  });

  await test("handles placeholder embedded in JSON structure", () => {
    const scrubbed = scrubMessages([{ role: "user", content: "Look up john@acme.com" }]);
    const placeholder = (scrubbed.messages[0].content as string).match(/p0[0-9a-f]{12}@maildomain\.com/)![0];
    const jsonResponse = `{"email": "${placeholder}", "found": true}`;
    const restored = rehydrateText(jsonResponse, scrubbed.sessionId);
    assertIncludes(restored, '"email": "john@acme.com"');
    destroySession(scrubbed.sessionId);
  });
}

// ═══════════════════════════════════════════
// Run All
// ═══════════════════════════════════════════

async function main() {
  console.log("\n╔══════════════════════════════════════╗");
  console.log("║  PII Middleware Unit Tests            ║");
  console.log("╚══════════════════════════════════════╝");

  await patternDetectionTests();
  await vaultCoreTests();
  await vaultLifecycleTests();
  await scrubMessagesTests();
  await rehydrateTextTests();

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Test runner error:", err);
  process.exit(1);
});
