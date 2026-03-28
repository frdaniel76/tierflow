/**
 * Anthropic Messages API provider.
 *
 * Handles forwarding to Anthropic's Messages API with:
 * - OpenAI → Anthropic message format conversion
 * - Tool format conversion
 * - Thinking/adaptive mode
 * - Streaming SSE (Anthropic → OpenAI format)
 * - PII rehydration (streaming + non-streaming)
 */

import type { ServerResponse } from "node:http";
import { getAuth } from "../auth.js";
import { supportsAdaptiveThinking } from "../config.js";
import { logger } from "../logger.js";
import { rehydrateText, rehydrateChunk } from "../pii/index.js";
import type { ChatMessage, ChatRequest, OpenAITool, OpenAIToolCall } from "./types.js";
import {
  getProviderConfig,
  getTierTimeout,
  readStreamWithStallDetection,
  recordProviderUsage,
  TimeoutError,
} from "./shared.js";

// ─── Anthropic-specific Helpers ───

function getThinkingConfig(
  tier: string,
  modelId: string,
): { type: string; budget_tokens?: number; effort?: string } | undefined {
  if (supportsAdaptiveThinking(modelId) && (tier === "COMPLEX" || tier === "REASONING")) {
    return { type: "adaptive" };
  }
  if (tier === "MEDIUM") {
    return { type: "enabled", budget_tokens: 4096 };
  }
  return undefined;
}

function convertToolsToAnthropic(
  tools: OpenAITool[],
): Array<{ name: string; description?: string; input_schema: Record<string, unknown> }> {
  return tools.map((t) => ({
    name: t.function.name,
    ...(t.function.description ? { description: t.function.description } : {}),
    input_schema: t.function.parameters ?? { type: "object", properties: {} },
  }));
}

function convertToolChoiceToAnthropic(
  toolChoice: unknown,
): { type: string; name?: string } | undefined {
  if (toolChoice === "none") return { type: "none" };
  if (toolChoice === "auto" || toolChoice === undefined) return { type: "auto" };
  if (toolChoice === "required") return { type: "any" };
  if (typeof toolChoice === "object" && toolChoice !== null) {
    const tc = toolChoice as { type?: string; function?: { name: string } };
    if (tc.function?.name) return { type: "tool", name: tc.function.name };
  }
  return { type: "auto" };
}

function convertMessagesToAnthropic(openaiMessages: ChatMessage[]): {
  system: string;
  messages: Array<{ role: string; content: unknown }>;
} {
  let systemContent = "";
  const messages: Array<{ role: string; content: unknown }> = [];

  for (const msg of openaiMessages) {
    if (msg.role === "system" || msg.role === "developer") {
      const text =
        typeof msg.content === "string"
          ? msg.content
          : (msg.content ?? [])
              .filter((b: { type: string }) => b.type === "text")
              .map((b: { type: string; text?: string }) => b.text)
              .join("\n");
      systemContent += (systemContent ? "\n" : "") + text;
      continue;
    }

    if (msg.role === "tool") {
      const toolResult = {
        type: "tool_result" as const,
        tool_use_id: msg.tool_call_id ?? "",
        content: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content ?? ""),
      };
      const last = messages[messages.length - 1];
      if (
        last &&
        last.role === "user" &&
        Array.isArray(last.content) &&
        (last.content as Array<{ type: string }>).every((b) => b.type === "tool_result")
      ) {
        (last.content as Array<{ type: string }>).push(toolResult);
      } else {
        messages.push({ role: "user", content: [toolResult] });
      }
      continue;
    }

    if (msg.role === "assistant" && msg.tool_calls && msg.tool_calls.length > 0) {
      const contentBlocks: Array<Record<string, unknown>> = [];
      if (msg.content) {
        const text =
          typeof msg.content === "string"
            ? msg.content
            : msg.content
                .filter((b: { type: string }) => b.type === "text")
                .map((b: { type: string; text?: string }) => b.text)
                .join("");
        if (text) contentBlocks.push({ type: "text", text });
      }
      for (const tc of msg.tool_calls) {
        let input: unknown = {};
        try {
          input = JSON.parse(tc.function.arguments);
        } catch {
          input = {};
        }
        contentBlocks.push({ type: "tool_use", id: tc.id, name: tc.function.name, input });
      }
      messages.push({ role: "assistant", content: contentBlocks });
      continue;
    }

    const text =
      typeof msg.content === "string"
        ? msg.content
        : (msg.content ?? [])
            .filter((b: { type: string }) => b.type === "text")
            .map((b: { type: string; text?: string }) => b.text)
            .join("\n");
    messages.push({ role: msg.role === "assistant" ? "assistant" : "user", content: text || "" });
  }

  return { system: systemContent, messages };
}

// ─── Forward to Anthropic ───

export async function forwardToAnthropic(
  req: ChatRequest,
  modelName: string,
  tier: string,
  res: ServerResponse,
  stream: boolean,
  piiSession?: string | null,
  _piiMode?: "strict" | "standard",
): Promise<void> {
  const auth = getAuth("anthropic");
  if (!auth?.token) throw new Error("No Anthropic auth token");

  const config = getProviderConfig("anthropic");
  if (!config) throw new Error("Anthropic provider not configured");
  const { system: systemContent, messages } = convertMessagesToAnthropic(req.messages);

  const isOAuth = auth.token!.startsWith("sk-ant-oat");
  const thinkingConfig = getThinkingConfig(tier, modelName);
  const maxTokens = req.max_tokens ?? 4096;

  const body: Record<string, unknown> = {
    model: modelName,
    messages,
    max_tokens:
      thinkingConfig?.type === "enabled" && thinkingConfig.budget_tokens
        ? maxTokens + thinkingConfig.budget_tokens
        : maxTokens,
    stream: stream,
  };

  if (req.tools && req.tools.length > 0) {
    body.tools = convertToolsToAnthropic(req.tools);
    if (req.tool_choice !== undefined) {
      body.tool_choice = convertToolChoiceToAnthropic(req.tool_choice);
    }
  }

  if (isOAuth) {
    const systemBlocks: Array<{ type: string; text: string; cache_control?: { type: string } }> = [
      {
        type: "text",
        text: "You are Claude Code, Anthropic's official CLI for Claude.",
        cache_control: { type: "ephemeral" },
      },
    ];
    if (systemContent) {
      systemBlocks.push({
        type: "text",
        text: systemContent,
        cache_control: { type: "ephemeral" },
      });
    }
    body.system = systemBlocks;
  } else if (systemContent) {
    body.system = systemContent;
  }

  if (thinkingConfig) {
    if (thinkingConfig.type === "adaptive") {
      body.thinking = { type: "adaptive" };
    } else {
      body.thinking = { type: "enabled", budget_tokens: thinkingConfig.budget_tokens };
    }
  }

  if (req.temperature !== undefined && !thinkingConfig) {
    body.temperature = req.temperature;
  }

  const url = `${config.baseUrl}/v1/messages`;
  const timeoutMs = getTierTimeout(tier);
  logger.info(
    `-> Anthropic: ${modelName} (tier=${tier}, thinking=${thinkingConfig?.type ?? "off"}, stream=${stream}, tools=${req.tools?.length ?? 0}, timeout=${timeoutMs / 1000}s)`,
  );

  const authHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    "anthropic-version": "2023-06-01",
    accept: "application/json",
  };

  if (isOAuth) {
    authHeaders["Authorization"] = `Bearer ${auth.token}`;
    authHeaders["anthropic-beta"] =
      "claude-code-20250219,oauth-2025-04-20,fine-grained-tool-streaming-2025-05-14,interleaved-thinking-2025-05-14";
    authHeaders["user-agent"] = "claude-cli/2.1.2 (external, cli)";
    authHeaders["x-app"] = "cli";
    authHeaders["anthropic-dangerous-direct-browser-access"] = "true";
  } else {
    authHeaders["x-api-key"] = auth.token!;
  }

  const abortController = new AbortController();
  const timeoutId = setTimeout(() => abortController.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify(body),
      signal: abortController.signal,
    });
  } catch (err: unknown) {
    clearTimeout(timeoutId);
    const error = err as { name?: string };
    if (error?.name === "AbortError" || abortController.signal.aborted) {
      logger.error(
        `\u23f1 TIMEOUT: Anthropic ${modelName} after ${timeoutMs / 1000}s (tier=${tier})`,
      );
      throw new TimeoutError(
        `Anthropic request timed out after ${timeoutMs / 1000}s (model=${modelName}, tier=${tier})`,
      );
    }
    throw err;
  }

  if (!response.ok) {
    clearTimeout(timeoutId);
    const errText = await response.text();
    logger.error(`Anthropic ${response.status}: ${errText}`);
    throw new Error(`Anthropic API error ${response.status}: ${errText}`);
  }

  if (!stream) {
    clearTimeout(timeoutId);
    await handleAnthropicNonStreaming(response, req, modelName, tier, res, piiSession);
    return;
  }

  // Streaming
  clearTimeout(timeoutId);
  await handleAnthropicStreaming(response, modelName, tier, res, piiSession, abortController);
}

// ─── Non-Streaming Response ───

async function handleAnthropicNonStreaming(
  response: Response,
  req: ChatRequest,
  modelName: string,
  tier: string,
  res: ServerResponse,
  piiSession?: string | null,
): Promise<void> {
  const data = (await response.json()) as {
    content: Array<{
      type: string;
      text?: string;
      thinking?: string;
      id?: string;
      name?: string;
      input?: unknown;
    }>;
    usage?: { input_tokens: number; output_tokens: number };
    model: string;
    stop_reason?: string;
  };

  if (piiSession) {
    for (const block of data.content) {
      if (block.type === "text" && block.text) {
        block.text = rehydrateText(block.text, piiSession);
      } else if (block.type === "tool_use" && block.input) {
        const inputStr = rehydrateText(JSON.stringify(block.input), piiSession);
        try {
          block.input = JSON.parse(inputStr);
        } catch {
          /* keep original */
        }
      }
    }
  }

  const textContent = data.content
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("");

  const toolUseBlocks = data.content.filter((b) => b.type === "tool_use");
  const toolCalls: OpenAIToolCall[] = toolUseBlocks.map((b, idx) => ({
    id: b.id ?? `call_${Date.now()}_${idx}`,
    type: "function" as const,
    function: { name: b.name ?? "", arguments: JSON.stringify(b.input ?? {}) },
  }));

  const finishReason =
    data.stop_reason === "tool_use"
      ? "tool_calls"
      : data.stop_reason === "end_turn"
        ? "stop"
        : (data.stop_reason ?? "stop");

  const message: Record<string, unknown> = {
    role: "assistant",
    content: textContent || (toolCalls.length > 0 ? null : ""),
  };
  if (toolCalls.length > 0) message.tool_calls = toolCalls;

  const openaiResponse = {
    id: `chatcmpl-${Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: `anthropic/${modelName}`,
    choices: [{ index: 0, message, finish_reason: finishReason }],
    usage: {
      prompt_tokens: data.usage?.input_tokens ?? 0,
      completion_tokens: data.usage?.output_tokens ?? 0,
      total_tokens: (data.usage?.input_tokens ?? 0) + (data.usage?.output_tokens ?? 0),
    },
  };

  recordProviderUsage(modelName, tier, {
    prompt_tokens: data.usage?.input_tokens ?? 0,
    completion_tokens: data.usage?.output_tokens ?? 0,
  });

  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(openaiResponse));
}

// ─── Streaming Response ───

async function handleAnthropicStreaming(
  response: Response,
  modelName: string,
  tier: string,
  res: ServerResponse,
  piiSession: string | null | undefined,
  abortController: AbortController,
): Promise<void> {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  const reader = response.body?.getReader();
  if (!reader) throw new Error("No response body");

  const decoder = new TextDecoder();
  let buffer = "";
  let insideThinking = false;
  let currentBlockType: string | null = null;
  let currentToolIndex = -1;
  let stopReason: string | null = null;
  let piiCarry = "";
  const piiToolCarries = new Map<number, string>();

  const makeChunk = (delta: Record<string, unknown>, finish: string | null = null) => ({
    id: `chatcmpl-${Date.now()}`,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model: `anthropic/${modelName}`,
    choices: [{ index: 0, delta, finish_reason: finish }],
  });

  try {
    await readStreamWithStallDetection(
      reader,
      (value) => {
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const jsonStr = line.slice(6).trim();
          if (jsonStr === "[DONE]" || !jsonStr) continue;

          try {
            const event = JSON.parse(jsonStr);

            if (event.type === "content_block_start") {
              const block = event.content_block;
              if (block?.type === "thinking") {
                insideThinking = true;
                currentBlockType = "thinking";
              } else if (block?.type === "tool_use") {
                insideThinking = false;
                currentBlockType = "tool_use";
                currentToolIndex++;
                const chunk = makeChunk({
                  tool_calls: [
                    {
                      index: currentToolIndex,
                      id: block.id,
                      type: "function",
                      function: { name: block.name, arguments: "" },
                    },
                  ],
                });
                res.write(`data: ${JSON.stringify(chunk)}\n\n`);
              } else {
                insideThinking = false;
                currentBlockType = block?.type ?? "text";
              }
              continue;
            }

            if (event.type === "content_block_stop") {
              insideThinking = false;
              currentBlockType = null;
              continue;
            }

            if (event.type === "content_block_delta") {
              if (insideThinking) continue;

              if (currentBlockType === "tool_use" && event.delta?.type === "input_json_delta") {
                let args = event.delta.partial_json ?? "";
                if (piiSession && args) {
                  const carry = piiToolCarries.get(currentToolIndex) ?? "";
                  const result = rehydrateChunk(args, piiSession, carry);
                  piiToolCarries.set(currentToolIndex, result.carry);
                  args = result.output;
                  if (!args && result.carry) continue;
                }
                const chunk = makeChunk({
                  tool_calls: [
                    {
                      index: currentToolIndex,
                      function: { arguments: args },
                    },
                  ],
                });
                res.write(`data: ${JSON.stringify(chunk)}\n\n`);
                continue;
              }

              let text = event.delta?.text;
              if (text) {
                if (piiSession) {
                  const result = rehydrateChunk(text, piiSession, piiCarry);
                  piiCarry = result.carry;
                  text = result.output;
                  if (!text && result.carry) continue;
                }
                res.write(`data: ${JSON.stringify(makeChunk({ content: text }))}\n\n`);
              }
            }

            if (event.type === "message_delta") {
              stopReason = event.delta?.stop_reason ?? null;
              if (event.usage) {
                recordProviderUsage(modelName, tier, {
                  prompt_tokens: event.usage.input_tokens ?? 0,
                  completion_tokens: event.usage.output_tokens ?? 0,
                });
              }
            }

            if (event.type === "message_stop") {
              const finish = stopReason === "tool_use" ? "tool_calls" : "stop";
              res.write(`data: ${JSON.stringify(makeChunk({}, finish))}\n\n`);
            }
          } catch {
            // skip unparseable lines
          }
        }
      },
      abortController,
    );
  } catch (err) {
    if (err instanceof TimeoutError) {
      logger.error(`\u23f1 STREAM STALL: Anthropic ${modelName} - ${(err as Error).message}`);
    }
    throw err;
  } finally {
    if (piiCarry && !res.writableEnded) {
      const flushed = piiSession ? rehydrateText(piiCarry, piiSession) : piiCarry;
      res.write(`data: ${JSON.stringify(makeChunk({ content: flushed }))}\n\n`);
    }
    if (piiToolCarries.size > 0 && !res.writableEnded) {
      for (const [idx, carry] of piiToolCarries) {
        if (carry) {
          const flushed = piiSession ? rehydrateText(carry, piiSession) : carry;
          res.write(
            `data: ${JSON.stringify(
              makeChunk({
                tool_calls: [{ index: idx, function: { arguments: flushed } }],
              }),
            )}\n\n`,
          );
        }
      }
    }
    res.write("data: [DONE]\n\n");
    res.end();
  }
}
