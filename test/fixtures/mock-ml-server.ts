/**
 * Mock ML Classifier Server — returns canned responses for known prompts.
 * Used by integration tests to avoid Python dependency.
 */

import { createServer, type Server } from "node:http";

const CANNED_RESPONSES: Record<string, string> = {
  hi: "simple_chat",
  hello: "simple_chat",
  "how are you": "simple_chat",
  "tell me a joke": "simple_chat",
  "what is the capital of france": "simple_chat",
  "write a python function": "coding",
  "implement a binary search": "coding",
  "fix this bug": "coding",
  "refactor this code": "coding",
  "prove that sqrt": "reasoning",
  "solve this equation": "reasoning",
  "analyze the complexity": "reasoning",
  "write a poem": "creative",
  "write a haiku": "creative",
  "compose a song": "creative",
  "analyze this dataset": "data",
  "create a chart": "data",
  "search the web": "agentic",
  "book a meeting": "agentic",
  "send an email": "agentic",
  transcribe: "transcription",
};

function classifyPrompt(message: string): string {
  const lower = message.toLowerCase();
  for (const [prefix, category] of Object.entries(CANNED_RESPONSES)) {
    if (lower.includes(prefix)) return category;
  }
  return "general";
}

export function startMockMLServer(
  port = 18899,
): Promise<{ server: Server; url: string }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      if (req.url === "/classify" && req.method === "POST") {
        let body = "";
        req.on("data", (c: Buffer) => (body += c.toString()));
        req.on("end", () => {
          const { message } = JSON.parse(body);
          const category = classifyPrompt(message);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              category,
              confidence: 0.95,
              alternatives: [],
              latency_ms: 1,
            }),
          );
        });
      } else if (req.url === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok", trained: true }));
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    server.listen(port, "127.0.0.1", () =>
      resolve({ server, url: `http://127.0.0.1:${port}` }),
    );
  });
}

export function stopMockMLServer(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}
