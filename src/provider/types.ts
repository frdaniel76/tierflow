/**
 * Provider Types — shared across Anthropic and OpenAI providers.
 */

import type { ServerResponse } from "node:http";

// Provider configs loaded from tierflow.config.json
export type ProviderConfig = {
  baseUrl: string;
  api: "anthropic-messages" | "openai-completions";
  headers?: Record<string, string>;
};

// OpenAI tool types
export type OpenAIFunction = {
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
};

export type OpenAITool = {
  type: "function";
  function: OpenAIFunction;
};

export type OpenAIToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

// OpenAI-format message
export type ChatMessage = {
  role: "system" | "user" | "assistant" | "developer" | "tool";
  content: string | null | Array<{ type: string; text?: string; image_url?: { url: string } }>;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
  name?: string;
};

export type ChatRequest = {
  model: string;
  messages: ChatMessage[];
  max_tokens?: number;
  max_completion_tokens?: number;
  temperature?: number;
  stream?: boolean;
  stream_options?: { include_usage?: boolean };
  top_p?: number;
  stop?: string[];
  tools?: OpenAITool[];
  tool_choice?: unknown;
  store?: boolean;
  [key: string]: unknown; // passthrough for unknown fields
};

// Common forward function signature
export type ForwardFn = (
  req: ChatRequest,
  provider: string,
  modelName: string,
  tier: string,
  res: ServerResponse,
  stream: boolean,
  piiSession?: string | null,
  piiMode?: "strict" | "standard",
) => Promise<void>;
