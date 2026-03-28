/**
 * Provider — backwards-compatible re-export.
 *
 * The provider logic has been split into:
 *   - provider/types.ts    — shared types
 *   - provider/shared.ts   — shared utilities (timeouts, parsing, stream helpers)
 *   - provider/anthropic.ts — Anthropic Messages API
 *   - provider/openai.ts   — OpenAI-compatible APIs
 *   - provider/index.ts    — barrel export + request dispatcher
 */

export {
  forwardRequest,
  TimeoutError,
  parseModelId,
  setCurrentCategory,
  type ChatRequest,
  type ChatMessage,
  type OpenAITool,
  type OpenAIToolCall,
  type ProviderConfig,
} from "./provider/index.js";
