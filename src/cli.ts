#!/usr/bin/env node
/**
 * TierFlow CLI — npx tierflow
 *
 * Usage:
 *   npx tierflow              # start with default config
 *   npx tierflow --port 8080  # custom port
 *   npx tierflow --init       # generate config template
 *   npx tierflow --check      # validate config + ML service
 *   npx tierflow --version
 */

import { parseArgs } from "node:util";
import { existsSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const VERSION = "2.0.0";

const { values: args } = parseArgs({
  options: {
    port: { type: "string", short: "p" },
    host: { type: "string" },
    init: { type: "boolean" },
    check: { type: "boolean" },
    debug: { type: "boolean" },
    help: { type: "boolean", short: "h" },
    version: { type: "boolean", short: "v" },
  },
  allowPositionals: false,
});

if (args.help) {
  console.log(`
  TierFlow v${VERSION} — ML-powered AI model router

  Usage:
    npx tierflow              Start with default/detected config
    npx tierflow --port 8080  Custom port
    npx tierflow --init       Generate config template
    npx tierflow --check      Validate config + connectivity
    npx tierflow --debug      Enable debug logging

  Options:
    -p, --port <port>   Port to listen on (default: 18800)
    --host <host>       Host to bind to (default: 127.0.0.1)
    --init              Generate ~/.config/tierflow/config.json
    --check             Validate config and check ML service
    --debug             Enable debug logging
    -v, --version       Print version
    -h, --help          Show this help

  Docs: https://github.com/frdaniel76/tierflow
`);
  process.exit(0);
}

if (args.version) {
  console.log(VERSION);
  process.exit(0);
}

if (args.init) {
  await generateConfig();
  process.exit(0);
}

if (args.check) {
  await checkSetup();
  process.exit(0);
}

// Set env vars from CLI flags before importing server
if (args.port) process.env.TIERFLOW_PORT = args.port;
if (args.host) process.env.TIERFLOW_HOST = args.host;
if (args.debug) process.argv.push("--debug");

// Check for first run (check new + legacy config names)
const configPaths = [
  process.env.TIERFLOW_CONFIG,
  process.env.FREEROUTER_CONFIG,
  join(process.cwd(), "tierflow.config.json"),
  join(process.cwd(), "freerouter.config.json"),
  join(homedir(), ".config", "tierflow", "config.json"),
  join(homedir(), ".config", "freerouter", "config.json"),
].filter(Boolean);

const hasConfig = configPaths.some((p) => p && existsSync(p));
if (!hasConfig) {
  console.log("\n  No config found. Starting with built-in defaults.");
  console.log("  Run: npx tierflow --init  to generate a config template.\n");
}

// Start the server
await import("./server.js");

// ─── Commands ───

async function generateConfig() {
  const configDir = join(homedir(), ".config", "tierflow");
  const configPath = join(configDir, "config.json");

  if (existsSync(configPath)) {
    console.log(`  Config already exists: ${configPath}`);
    console.log("  Delete it first to regenerate.");
    return;
  }

  mkdirSync(configDir, { recursive: true });

  const template = {
    port: 18800,
    host: "127.0.0.1",
    providers: {
      anthropic: {
        baseUrl: "https://api.anthropic.com",
        api: "anthropic",
        auth: { type: "env", key: "ANTHROPIC_API_KEY" },
      },
      openai: {
        baseUrl: "https://api.openai.com",
        api: "openai",
        auth: { type: "env", key: "OPENAI_API_KEY" },
      },
      ollama: {
        baseUrl: "http://localhost:11434",
        api: "openai",
        auth: { type: "none" },
      },
    },
    tiers: {
      SIMPLE: {
        primary: "ollama/llama3.2",
        fallback: ["openai/gpt-4o-mini"],
      },
      MEDIUM: {
        primary: "openai/gpt-4o",
        fallback: ["anthropic/claude-sonnet-4-5"],
      },
      COMPLEX: {
        primary: "anthropic/claude-sonnet-4-5",
        fallback: ["openai/gpt-4o"],
      },
      REASONING: {
        primary: "anthropic/claude-opus-4-6",
        fallback: ["openai/o1"],
      },
    },
    auth: { default: "env" },
  };

  writeFileSync(configPath, JSON.stringify(template, null, 2) + "\n");
  console.log(`\n  Config created: ${configPath}`);
  console.log("  Edit it with your preferred providers and models.");
  console.log("  Set API keys as environment variables, then run: npx tierflow\n");
}

async function checkSetup() {
  console.log(`\n  TierFlow v${VERSION} — Setup Check\n`);

  // 1. Config file
  const paths = [
    { label: "TIERFLOW_CONFIG env", path: process.env.TIERFLOW_CONFIG },
    { label: "Local config", path: join(process.cwd(), "tierflow.config.json") },
    { label: "User config", path: join(homedir(), ".config", "tierflow", "config.json") },
  ];

  let configFound = false;
  for (const { label, path } of paths) {
    if (path && existsSync(path)) {
      console.log(`  Config: ${label} (${path})`);
      configFound = true;

      try {
        const cfg = JSON.parse(readFileSync(path, "utf-8"));
        const providers = Object.entries(cfg.providers || {});
        console.log(`  Providers: ${providers.length} configured`);
        for (const [name, p] of providers) {
          const prov = p as Record<string, unknown>;
          const auth = prov.auth as Record<string, string> | undefined;
          if (auth?.type === "env" && auth.key) {
            const hasKey = !!process.env[auth.key];
            console.log(`    ${name}: ${hasKey ? "OK" : "MISSING"} (${auth.key})`);
          } else if (auth?.type === "none") {
            console.log(`    ${name}: OK (no auth needed)`);
          } else {
            console.log(`    ${name}: ${auth?.type || "default auth"}`);
          }
        }
      } catch {
        console.log("  Warning: could not parse config file");
      }
      break;
    }
  }

  if (!configFound) {
    console.log("  Config: NOT FOUND (will use built-in defaults)");
    console.log("  Run: npx tierflow --init  to generate one");
  }

  // 2. ML classifier
  console.log("");
  try {
    const res = await fetch("http://127.0.0.1:18801/health", {
      signal: AbortSignal.timeout(2000),
    });
    if (res.ok) {
      const body = (await res.json()) as Record<string, unknown>;
      console.log(`  ML Classifier: CONNECTED (${body.classifier}, trained: ${body.trained})`);
    } else {
      console.log("  ML Classifier: ERROR (responded but not healthy)");
    }
  } catch {
    console.log("  ML Classifier: NOT RUNNING (will use rule-based routing)");
    console.log("  Optional: start llmrouter-service on :18801 for ML-powered routing");
  }

  console.log("");
}
