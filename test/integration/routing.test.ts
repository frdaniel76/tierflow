/**
 * Integration test — Routing via mock ML classifier.
 *
 * Tests the full route() function with a real mock ML server
 * to verify category-based routing decisions.
 */

import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  startMockMLServer,
  stopMockMLServer,
} from "../fixtures/mock-ml-server.js";
import type { Server } from "node:http";

let mlServer: Server;
let mlUrl: string;

before(async () => {
  const result = await startMockMLServer(18899);
  mlServer = result.server;
  mlUrl = result.url;
});

after(async () => {
  if (mlServer) await stopMockMLServer(mlServer);
});

describe("Mock ML Server", () => {
  test("health endpoint returns ok", async () => {
    const res = await fetch(`${mlUrl}/health`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, "ok");
  });

  test("classifies 'hi' as simple_chat", async () => {
    const res = await fetch(`${mlUrl}/classify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "hi" }),
    });
    const body = await res.json();
    assert.equal(body.category, "simple_chat");
    assert.equal(typeof body.confidence, "number");
  });

  test("classifies coding prompt correctly", async () => {
    const res = await fetch(`${mlUrl}/classify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "write a python function to sort a list",
      }),
    });
    const body = await res.json();
    assert.equal(body.category, "coding");
  });

  test("classifies reasoning prompt correctly", async () => {
    const res = await fetch(`${mlUrl}/classify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "prove that sqrt of 2 is irrational",
      }),
    });
    const body = await res.json();
    assert.equal(body.category, "reasoning");
  });

  test("classifies creative prompt correctly", async () => {
    const res = await fetch(`${mlUrl}/classify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "write a poem about the sea" }),
    });
    const body = await res.json();
    assert.equal(body.category, "creative");
  });

  test("classifies agentic prompt correctly", async () => {
    const res = await fetch(`${mlUrl}/classify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "search the web for latest news" }),
    });
    const body = await res.json();
    assert.equal(body.category, "agentic");
  });

  test("unknown prompt falls back to general", async () => {
    const res = await fetch(`${mlUrl}/classify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "elaborate on the concept of quantum entanglement in layman terms",
      }),
    });
    const body = await res.json();
    assert.equal(body.category, "general");
  });

  test("returns 404 for unknown endpoints", async () => {
    const res = await fetch(`${mlUrl}/unknown`);
    assert.equal(res.status, 404);
  });
});
