/**
 * OpenAI-compatible API provider.
 *
 * Handles forwarding to OpenAI-compatible APIs (OpenAI, OpenRouter, Kimi, Ollama, etc.)
 * with:
 * - SSE streaming passthrough with model name rewrite
 * - Response normalization (strip non-standard fields from providers like Gemini)
 * - PII rehydration (streaming + non-streaming)
 */

import type { ServerResponse } from "node:http";
import { getAuth } from "../auth.js";
import { logger } from "../logger.js";
import { rehydrateText, rehydrateChunk } from "../pii/index.js";
import type { ChatRequest } from "./types.js";
import {
  getProviderConfig,
  getTierTimeout,
  readStreamWithStallDetection,
  recordProviderUsage,
  TimeoutError,
} from "./shared.js";

// ─── Forward to OpenAI-compatible API ───

export async function forwardToOpenAI(
  req: ChatRequest,
  provider: string,
  modelName: string,
  tier: string,
  res: ServerResponse,
  stream: boolean,
  piiSession?: string | null,
  piiMode?: "strict" | "standard",
): Promise<void> {
  const auth = getAuth(provider);
  if (!auth?.apiKey) throw new Error(`No API key for ${provider}`);

  const config = getProviderConfig(provider);
  if (!config) throw new Error(`Unknown provider: ${provider}`);

  const body: Record<string, unknown> = {
    model: modelName,
    messages: req.messages,
    stream: stream,
  };

  if (req.max_tokens) body.max_tokens = req.max_tokens;
  if (req.max_completion_tokens) body.max_completion_tokens = req.max_completion_tokens;
  if (req.temperature !== undefined) body.temperature = req.temperature;
  if (req.top_p !== undefined) body.top_p = req.top_p;
  if (req.tools && req.tools.length > 0) body.tools = req.tools;
  if (req.tool_choice !== undefined) body.tool_choice = req.tool_choice;
  if (req.stream_options) body.stream_options = req.stream_options;
  if (req.store !== undefined) body.store = req.store;

  const url = `${config.baseUrl}/chat/completions`;
  logger.info(`-> ${provider}: ${modelName} (tier=${tier}, stream=${stream})`);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${auth.apiKey}`,
    ...config.headers,
  };

  const timeoutMs = getTierTimeout(tier);
  const abortController = new AbortController();
  const timeoutId = setTimeout(() => abortController.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: abortController.signal,
    });
  } catch (err: unknown) {
    clearTimeout(timeoutId);
    const error = err as { name?: string };
    if (error?.name === "AbortError" || abortController.signal.aborted) {
      logger.error(
        `\u23f1 TIMEOUT: ${provider} ${modelName} after ${timeoutMs / 1000}s (tier=${tier})`,
      );
      throw new TimeoutError(
        `${provider} request timed out after ${timeoutMs / 1000}s (model=${modelName}, tier=${tier})`,
      );
    }
    throw err;
  }

  if (!response.ok) {
    clearTimeout(timeoutId);
    const errText = await response.text();
    logger.error(`${provider} ${response.status}: ${errText}`);
    throw new Error(`${provider} API error ${response.status}: ${errText}`);
  }

  clearTimeout(timeoutId);

  if (!stream) {
    await handleOpenAINonStreaming(response, provider, modelName, tier, res, piiSession, piiMode);
    return;
  }

  await handleOpenAIStreaming(response, provider, modelName, tier, res, piiSession, piiMode, abortController);
}

// ─── Non-Streaming Response ───

async function handleOpenAINonStreaming(
  response: Response,
  provider: string,
  modelName: string,
  tier: string,
  res: ServerResponse,
  piiSession?: string | null,
  piiMode?: "strict" | "standard",
): Promise<void> {
  const data = (await response.json()) as Record<string, unknown>;
  if (data.model) data.model = `${provider}/${modelName}`;

  // Normalize non-standard fields from providers (e.g. Gemini via OpenRouter)
  delete (data as Record<string, unknown>).provider;
  for (const choice of ((data as Record<string, unknown>).choices as Array<Record<string, unknown>> ?? [])) {
    delete choice.native_finish_reason;
    delete choice.logprobs;
    if (choice.message && typeof choice.message === "object") {
      const msg = choice.message as Record<string, unknown>;
      delete msg.reasoning;
      delete msg.reasoning_details;
      delete msg.refusal;
    }
  }

  // PII Rehydration
  if (piiSession) {
    try {
      const choices = (data as Record<string, unknown>).choices as
        | Array<{
            message?: {
              content?: string;
              tool_calls?: Array<{ function?: { arguments?: string } }>;
            };
          }>
        | undefined;
      for (const choice of choices ?? []) {
        if (choice.message?.content) {
          choice.message.content = rehydrateText(choice.message.content, piiSession);
        }
        if (choice.message?.tool_calls) {
          for (const tc of choice.message.tool_calls) {
            if (tc.function?.arguments) {
              tc.function.arguments = rehydrateText(tc.function.arguments, piiSession);
            }
          }
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`[PII] Rehydrate failed: ${msg}`);
      if (piiMode === "strict") {
        res.writeHead(502, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({ error: { message: "PII rehydrate failed", type: "pii_error" } }),
        );
        return;
      }
      res.setHeader("X-PII-Warning", "rehydration-failed");
    }
  }

  // Record token usage
  const respUsage = (data as Record<string, unknown>).usage as
    | { prompt_tokens?: number; completion_tokens?: number }
    | undefined;
  if (respUsage) {
    recordProviderUsage(modelName, tier, {
      prompt_tokens: respUsage.prompt_tokens ?? 0,
      completion_tokens: respUsage.completion_tokens ?? 0,
      ...respUsage,
    });
  }

  const responseBody = JSON.stringify(data);
  res.writeHead(200, {
    "Content-Type": "application/json",
    "Content-Length": String(Buffer.byteLength(responseBody)),
  });
  res.end(responseBody);
}

// ─── Streaming Response ───

async function handleOpenAIStreaming(
  response: Response,
  provider: string,
  modelName: string,
  tier: string,
  res: ServerResponse,
  piiSession: string | null | undefined,
  piiMode: "strict" | "standard" | undefined,
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
  let piiCarry = "";
  const piiToolCarries = new Map<number, string>();
  let sentDone = false;
  const streamState = { usage: null as Record<string, unknown> | null };

  try {
    await readStreamWithStallDetection(
      reader,
      (value) => {
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const jsonStr = line.slice(6).trim();
            if (jsonStr === "[DONE]") {
              if (!sentDone) {
                res.write("data: [DONE]\n\n");
                sentDone = true;
              }
              continue;
            }
            try {
              const chunk = JSON.parse(jsonStr);
              if (chunk.model) chunk.model = `${provider}/${modelName}`;

              if (chunk.usage) streamState.usage = chunk.usage;

              // Normalize non-standard fields
              delete chunk.provider;
              const choice = chunk.choices?.[0];
              if (choice) {
                delete choice.native_finish_reason;
                delete choice.logprobs;
                const delta = choice.delta;
                if (delta) {
                  delete delta.reasoning;
                  delete delta.reasoning_details;
                  delete delta.refusal;
                }
              }

              // PII Rehydration — streaming: tool_calls arguments
              let skipToolChunk = false;
              if (piiSession && chunk.choices?.[0]?.delta?.tool_calls) {
                for (const tc of chunk.choices[0].delta.tool_calls) {
                  if (tc.function?.arguments) {
                    const idx = tc.index ?? 0;
                    const carry = piiToolCarries.get(idx) ?? "";
                    logger.debug(
                      `[PII] stream tool arg: raw="${tc.function.arguments}" carry="${carry}"`,
                    );
                    const { output, carry: newCarry } = rehydrateChunk(
                      tc.function.arguments,
                      piiSession,
                      carry,
                    );
                    logger.debug(
                      `[PII] stream tool arg: output="${output}" newCarry="${newCarry}"`,
                    );
                    piiToolCarries.set(idx, newCarry);
                    tc.function.arguments = output;
                  }
                }
                skipToolChunk =
                  chunk.choices[0].delta.tool_calls.every(
                    (tc: { function?: { arguments?: string } }) =>
                      tc.function?.arguments === "" || tc.function?.arguments === undefined,
                  ) &&
                  piiToolCarries.size > 0 &&
                  [...piiToolCarries.values()].some((c) => c.length > 0);
                if (skipToolChunk) logger.debug(`[PII] stream tool chunk suppressed (in carry)`);
              }
              if (skipToolChunk) continue;

              // PII Rehydration — streaming: text content
              if (piiSession && chunk.choices?.[0]?.delta?.content) {
                try {
                  const { output, carry } = rehydrateChunk(
                    chunk.choices[0].delta.content,
                    piiSession,
                    piiCarry,
                  );
                  piiCarry = carry;
                  chunk.choices[0].delta.content = output;
                  if (!output && carry) continue;
                } catch (err) {
                  const msg = err instanceof Error ? err.message : String(err);
                  logger.error(`[PII] Streaming rehydrate error: ${msg}`);
                  if (piiMode === "strict") {
                    res.write(
                      `data: ${JSON.stringify({ error: { message: "PII rehydrate failed" } })}\n\n`,
                    );
                    res.write("data: [DONE]\n\n");
                    res.end();
                    return;
                  }
                }
              }

              res.write(`data: ${JSON.stringify(chunk)}\n\n`);
            } catch {
              res.write(line + "\n");
            }
          } else if (line.trim()) {
            res.write(line + "\n");
          } else {
            res.write("\n");
          }
        }
      },
      abortController,
    );
  } catch (err) {
    if (err instanceof TimeoutError) {
      logger.error(`\u23f1 STREAM STALL: ${provider} ${modelName} - ${(err as Error).message}`);
    }
    throw err;
  } finally {
    // Flush remaining PII carry buffers
    if (piiCarry && !res.writableEnded) {
      const flushed = piiSession ? rehydrateText(piiCarry, piiSession) : piiCarry;
      const flushChunk = {
        id: `chatcmpl-${Date.now()}`,
        object: "chat.completion.chunk",
        created: Math.floor(Date.now() / 1000),
        model: `${provider}/${modelName}`,
        choices: [{ index: 0, delta: { content: flushed }, finish_reason: null }],
      };
      res.write(`data: ${JSON.stringify(flushChunk)}\n\n`);
    }
    if (piiToolCarries.size > 0 && !res.writableEnded) {
      for (const [idx, carry] of piiToolCarries) {
        if (carry) {
          const flushed = piiSession ? rehydrateText(carry, piiSession) : carry;
          const flushChunk = {
            id: `chatcmpl-${Date.now()}`,
            object: "chat.completion.chunk",
            created: Math.floor(Date.now() / 1000),
            model: `${provider}/${modelName}`,
            choices: [
              {
                index: 0,
                delta: { tool_calls: [{ index: idx, function: { arguments: flushed } }] },
                finish_reason: null,
              },
            ],
          };
          res.write(`data: ${JSON.stringify(flushChunk)}\n\n`);
        }
      }
    }
    if (streamState.usage) {
      const suPrompt = (streamState.usage.prompt_tokens as number) ?? 0;
      const suComp = (streamState.usage.completion_tokens as number) ?? 0;
      recordProviderUsage(modelName, tier, {
        prompt_tokens: suPrompt,
        completion_tokens: suComp,
      });
    }

    if (!res.writableEnded) {
      if (!sentDone) res.write("data: [DONE]\n\n");
      res.end();
    }
  }
}
