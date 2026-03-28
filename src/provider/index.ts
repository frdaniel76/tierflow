/**
 * Provider barrel export.
 *
 * Routes requests to the correct provider (Anthropic or OpenAI-compatible)
 * based on the provider config's API type.
 */

import type { ServerResponse } from "node:http";
import type { ChatRequest } from "./types.js";
import { parseModelId, getProviderConfig } from "./shared.js";
import { forwardToAnthropic } from "./anthropic.js";
import { forwardToOpenAI } from "./openai.js";

export async function forwardRequest(
  chatReq: ChatRequest,
  routedModel: string,
  tier: string,
  res: ServerResponse,
  stream: boolean,
  piiSession?: string | null,
  piiMode?: "strict" | "standard",
): Promise<void> {
  const { provider, model } = parseModelId(routedModel);

  const providerConfig = getProviderConfig(provider);
  if (!providerConfig) {
    throw new Error(`Unsupported provider: ${provider}`);
  }

  if (providerConfig.api === "anthropic-messages") {
    await forwardToAnthropic(chatReq, model, tier, res, stream, piiSession, piiMode);
  } else {
    await forwardToOpenAI(chatReq, provider, model, tier, res, stream, piiSession, piiMode);
  }
}

// Re-export everything consumers need
export { TimeoutError, parseModelId, setCurrentCategory } from "./shared.js";
export type {
  ChatRequest,
  ChatMessage,
  OpenAITool,
  OpenAIToolCall,
  ProviderConfig,
} from "./types.js";
