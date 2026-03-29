/**
 * TierFlow Proxy Server
 *
 * OpenAI-compatible HTTP server that classifies incoming requests
 * using the 14-dimension weighted scorer and routes to the best backend.
 *
 * Endpoints:
 *   POST /v1/chat/completions  — OpenAI-compatible chat completions
 *   GET  /v1/models            — list available models
 *   GET  /health               — health check
 *
 * Zero external deps. Uses Node.js built-in http + native fetch.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { route } from "./router/index.js";
import { getRoutingConfig } from "./router/config.js";
import { buildPricingMap, MODELS } from "./models.js";
import {
  forwardRequest,
  TimeoutError,
  parseModelId,
  setCurrentCategory,
  type ChatRequest,
} from "./provider.js";
import { reloadAuth, setProviderKey, getProviderKeyStatus } from "./auth.js";
import {
  loadConfig,
  getConfig,
  reloadConfig,
  getSanitizedConfig,
  getConfigPath,
  isPiiEnabled,
  getPiiExclude,
  getPiiMode,
  isPiiScrubSystem,
  isPiiDebugLog,
  isCompressEnabled,
  getCompressPasses,
  isCompressSystem,
} from "./config.js";
import { logger, setLogLevel } from "./logger.js";
import { scrubMessages, destroySession, piiVaultStore } from "./pii/index.js";
import { compressMessages } from "./compress/index.js";
import type { PassName } from "./compress/index.js";
import { LRUCache, buildCacheKey } from "./cache/index.js";
import { getUsageStats } from "./usage.js";
import { getDashboardHTML } from "./dashboard.js";
import { initClassifier, getClassifierStatus } from "./ml/index.js";
import { scan, shouldBlock, getScannerStatus, type ScanResult } from "./security/index.js";
import { startPeriodicSync, getLastSyncResult } from "./models-sync.js";
import {
  getQualityTiersResponse,
  applyPreset,
  setQualityLevel,
  setGlobalLevel,
  testProvider,
  type PresetName,
  type QualityLevel,
} from "./quality.js";

// Load config at startup
const appConfig = loadConfig();

// Docker/env override: allow LLMROUTER_URL to override ML classifier URL
if (process.env.LLMROUTER_URL && appConfig.mlClassifier) {
  appConfig.mlClassifier.url = process.env.LLMROUTER_URL;
}
const PORT = parseInt(
  process.env.TIERFLOW_PORT ?? String(appConfig.port),
  10,
);
const HOST =
  process.env.TIERFLOW_HOST ?? appConfig.host ?? "127.0.0.1";

// Build pricing map once at startup
const modelPricing = buildPricingMap();

// Stats
const stats = {
  started: new Date().toISOString(),
  requests: 0,
  errors: 0,
  timeouts: 0,
  byTier: { SIMPLE: 0, MEDIUM: 0, COMPLEX: 0, REASONING: 0 } as Record<string, number>,
  byModel: {} as Record<string, number>,
  pii: { scrubbed: 0, rehydrated: 0, errors: 0 },
  compress: { compressed: 0, tokensSaved: 0, errors: 0 },
  security: {
    scanned: 0,
    clean: 0,
    warnings: 0,
    blocked: 0,
    byCategory: {} as Record<string, number>,
    avgScanTimeMs: 0,
    totalScanTimeMs: 0,
  },
};

// ─── Response Cache ───

function initCache(): LRUCache | null {
  const cfg = getConfig();
  const cacheConfig = cfg.cache;
  if (!cacheConfig?.enabled) return null;
  const cache = new LRUCache(cacheConfig.ttl_seconds ?? 300, cacheConfig.max_entries ?? 5000);
  // Sweep expired entries every 60 seconds
  setInterval(() => cache.sweep(), 60_000);
  return cache;
}

let responseCache: LRUCache | null = null;

/**
 * Read request body as JSON.
 */
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

/**
 * Send JSON error response.
 */
function sendError(res: ServerResponse, status: number, message: string, type = "server_error") {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(
    JSON.stringify({
      error: { message, type, code: status },
    }),
  );
}

/**
 * Extract the user's prompt text from messages for classification.
 */
function extractPromptForClassification(messages: ChatRequest["messages"]): {
  prompt: string;
  systemPrompt: string | undefined;
} {
  let systemPrompt: string | undefined;
  const contextWindow = 3; // Include last N non-system messages for context-aware classification

  // Separate system messages from conversation
  const conversationMsgs: Array<{ role: string; text: string }> = [];
  for (const msg of messages) {
    const text =
      typeof msg.content === "string"
        ? msg.content
        : (msg.content ?? [])
            .filter((b) => b.type === "text")
            .map((b) => b.text ?? "")
            .join("\n");

    if (msg.role === "system" || msg.role === "developer") {
      systemPrompt = (systemPrompt ? systemPrompt + "\n" : "") + text;
    } else {
      conversationMsgs.push({ role: msg.role, text });
    }
  }

  // Take the last N messages for classification context
  const recentMsgs = conversationMsgs.slice(-contextWindow);

  // Build classification prompt: weight the last user message most,
  // but include recent context so quoted/replied content gets scored too
  const lastUserMsg = recentMsgs.filter((m) => m.role === "user").pop()?.text ?? "";
  const contextParts: string[] = [];
  for (const msg of recentMsgs) {
    if (msg.text !== lastUserMsg) {
      // Truncate context messages to avoid over-counting long assistant replies
      contextParts.push(msg.text.slice(0, 500));
    }
  }

  // Combine: context (truncated) + full last user message
  const prompt =
    contextParts.length > 0 ? contextParts.join("\n") + "\n" + lastUserMsg : lastUserMsg;

  return { prompt, systemPrompt };
}

/**
 * Handle POST /v1/chat/completions
 */
async function handleChatCompletions(req: IncomingMessage, res: ServerResponse) {
  const bodyStr = await readBody(req);
  let chatReq: ChatRequest;

  try {
    chatReq = JSON.parse(bodyStr);
  } catch {
    return sendError(res, 400, "Invalid JSON body");
  }

  if (!chatReq.model) {
    return sendError(res, 400, "model field is required");
  }

  if (!chatReq.messages || !Array.isArray(chatReq.messages) || chatReq.messages.length === 0) {
    return sendError(res, 400, "messages array is required");
  }

  const stream = chatReq.stream ?? false;
  const maxTokens = chatReq.max_tokens ?? 4096;
  const hasTools = !!(chatReq.tools && chatReq.tools.length > 0);

  // ─── Cache Check (before routing — skip entire pipeline on hit) ───
  const cacheConfig = getConfig().cache;
  let cacheKey: string | null = null;

  if (responseCache && cacheConfig?.enabled && !stream) {
    const excludeTools = cacheConfig.exclude_tools !== false; // default true
    if (!(excludeTools && hasTools)) {
      cacheKey = buildCacheKey(chatReq.model, chatReq.messages, hasTools);
      const cached = responseCache.get(cacheKey);
      if (cached) {
        res.setHeader("X-Cache", "HIT");
        res.setHeader("Content-Type", "application/json");
        res.end(cached);
        stats.requests++;
        return;
      }
    }
  }

  // Log tool presence for routing visibility
  if (chatReq.tools && chatReq.tools.length > 0) {
    logger.info(
      `[tools] ${chatReq.tools.length} tools: ${chatReq.tools.map((t: any) => t.function?.name ?? "?").join(", ")}`,
    );
  }

  // Extract prompt for classification
  const { prompt, systemPrompt } = extractPromptForClassification(chatReq.messages);

  if (!prompt) {
    return sendError(res, 400, "No user message found");
  }

  // ─── Security Scan ───
  const securityCfg = getConfig().security;
  if (securityCfg?.enabled !== false) {
    const scanText = systemPrompt ? systemPrompt + "\n" + prompt : prompt;
    const scanResult: ScanResult = scan(scanText, securityCfg);

    // Update stats
    stats.security.scanned++;
    stats.security.totalScanTimeMs += scanResult.scan_time_ms;
    stats.security.avgScanTimeMs =
      Math.round((stats.security.totalScanTimeMs / stats.security.scanned) * 100) / 100;

    if (scanResult.severity === "CLEAN") {
      stats.security.clean++;
      res.setHeader("X-TierFlow-Security", "CLEAN");
    } else {
      // Track categories
      for (const threat of scanResult.threats) {
        stats.security.byCategory[threat.category] =
          (stats.security.byCategory[threat.category] || 0) + 1;
      }

      const categories = [...new Set(scanResult.threats.map((t) => t.category))].join(",");

      if (shouldBlock(scanResult, securityCfg?.threshold || "HIGH")) {
        stats.security.blocked++;
        res.setHeader("X-TierFlow-Security", `BLOCKED:${categories}`);
        if (securityCfg?.logThreats !== false) {
          logger.warn(
            `[security] BLOCKED ${scanResult.severity}: ${categories} (${scanResult.scan_time_ms}ms)`,
          );
        }
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            error: {
              message: "Request blocked by TierFlow security scanner",
              type: "security_blocked",
              categories: [...new Set(scanResult.threats.map((t) => t.category))],
              severity: scanResult.severity,
              code: "security_threat_detected",
            },
          }),
        );
        return;
      } else {
        stats.security.warnings++;
        res.setHeader("X-TierFlow-Security", `WARNING:${categories}`);
        if (securityCfg?.logThreats !== false) {
          logger.info(
            `[security] WARNING: ${categories} (${scanResult.scan_time_ms}ms) — forwarding`,
          );
        }
      }
    }
  }

  // Route through classifier
  const requestedModel = chatReq.model ?? "auto";
  let routedModel: string;
  let tier: string;
  let reasoning: string;
  let category: string | undefined;
  let costEstimate: number | undefined;
  let baselineCost: number | undefined;

  if (requestedModel === "auto" || requestedModel === "tierflow/auto") {
    // Run the ML classifier (handles mode overrides, tools, audio internally)
    const routingCfg = getRoutingConfig();
    const hasTools = chatReq.tools && chatReq.tools.length > 0;
    const hasAudio =
      chatReq.messages?.some((m) => {
        const content = typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? "");
        return (
          content.includes("audio/ogg") ||
          content.includes("audio/") ||
          content.includes("[media attached:")
        );
      }) ?? false;

    const decision = await route(
      prompt,
      systemPrompt,
      maxTokens,
      {
        config: routingCfg,
        modelPricing,
      },
      { hasTools, hasAudio },
    );

    routedModel = decision.model;
    tier = decision.tier;
    reasoning = decision.reasoning;
    category = decision.category;
    costEstimate = decision.costEstimate;
    baselineCost = decision.baselineCost;

    // For legacy tier-based routing (when categories not configured), apply agentic override
    if (!decision.category && hasTools && routingCfg.agenticTiers) {
      const agenticTier = routingCfg.agenticTiers[tier as keyof typeof routingCfg.agenticTiers];
      if (agenticTier && agenticTier.primary !== routedModel) {
        routedModel = agenticTier.primary;
        reasoning += ` | tools-present -> agentic(${routedModel})`;
      }
    }

    const catLabel = decision.category ? ` category=${decision.category}` : "";
    logger.info(
      `[${stats.requests + 1}] Classified: tier=${tier}${catLabel} model=${routedModel} confidence=${decision.confidence.toFixed(2)} | ${reasoning}`,
    );
  } else {
    // Explicit model requested — pass through
    routedModel = requestedModel;
    tier = "EXPLICIT";
    reasoning = `explicit model: ${requestedModel}`;
    logger.info(`[${stats.requests + 1}] Passthrough: model=${routedModel}`);
  }

  // Update stats
  stats.requests++;
  stats.byTier[tier] = (stats.byTier[tier] ?? 0) + 1;
  stats.byModel[routedModel] = (stats.byModel[routedModel] ?? 0) + 1;

  // Add routing info headers
  res.setHeader("X-TierFlow-Model", routedModel);
  res.setHeader("X-TierFlow-Tier", tier);
  if (category) res.setHeader("X-TierFlow-Category", category);
  if (costEstimate !== undefined) res.setHeader("X-TierFlow-Cost", String(costEstimate));
  if (baselineCost !== undefined) res.setHeader("X-TierFlow-Baseline-Cost", String(baselineCost));
  // Sanitize reasoning to remove any prompt content before setting header
  const safeReasoning = reasoning.replace(/prompt[:\s].*/gi, "").slice(0, 200);
  res.setHeader("X-TierFlow-Reasoning", safeReasoning);

  // ─── PII Scrub (if provider requires it) ───
  let piiSession: string | null = null;
  let piiScrubbed = false;
  let primaryPiiMode: "strict" | "standard" = "strict";
  const primaryProvider = parseModelId(routedModel).provider;
  const cfg = getConfig();
  const primaryProviderCfg = cfg.providers[primaryProvider];

  if (primaryProviderCfg && isPiiEnabled(primaryProviderCfg)) {
    try {
      const piiMode = getPiiMode(primaryProviderCfg);
      primaryPiiMode = piiMode;
      const scrubResult = scrubMessages(
        chatReq.messages,
        getPiiExclude(primaryProviderCfg),
        isPiiScrubSystem(primaryProviderCfg),
      );
      piiSession = scrubResult.sessionId;
      piiScrubbed = scrubResult.scrubbed;

      if (piiScrubbed) {
        chatReq = { ...chatReq, messages: scrubResult.messages };
        stats.pii.scrubbed++;

        // Debug logging (temporary — logs safe/scrubbed payload only)
        if (isPiiDebugLog(primaryProviderCfg)) {
          logger.info(
            `[PII] DEBUG scrubbed payload: ${JSON.stringify(scrubResult.messages.map((m) => ({ role: m.role, content: typeof m.content === "string" ? m.content.slice(0, 200) : "[array]" })))}`,
          );
        }

        // Add PII info headers
        res.setHeader("X-PII-Scrubbed", "true");
        res.setHeader("X-PII-Categories", scrubResult.categories.join(","));
        res.setHeader(
          "X-PII-Count",
          String(
            scrubResult.messages.reduce((n, m) => {
              const c = typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? "");
              return n + (c.match(/p0[0-9a-f]{12}/g) ?? []).length;
            }, 0),
          ),
        );
      }
    } catch (err) {
      stats.pii.errors++;
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`[PII] ERROR: Scrub failed — request blocked — error: ${msg}`);
      // Fail-closed: NEVER forward unscrubbed data to external provider
      return sendError(res, 500, "PII scrub failed");
    }
  }

  // ─── CtxPack Compress (if provider enables it) ───
  if (primaryProviderCfg && isCompressEnabled(primaryProviderCfg)) {
    try {
      const passes = getCompressPasses(primaryProviderCfg) as PassName[] | undefined;
      const compressSys = isCompressSystem(primaryProviderCfg);
      const compressResult = compressMessages(chatReq.messages, passes, compressSys);

      if (compressResult.compressed) {
        chatReq = { ...chatReq, messages: compressResult.messages };
        stats.compress.compressed++;
        stats.compress.tokensSaved += compressResult.tokensBefore - compressResult.tokensAfter;

        res.setHeader("X-CtxPack-Savings", `${compressResult.savings}%`);
        res.setHeader("X-CtxPack-Before", String(compressResult.tokensBefore));
        res.setHeader("X-CtxPack-After", String(compressResult.tokensAfter));
      }
    } catch (err) {
      stats.compress.errors++;
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`[CtxPack] ERROR: Compression failed — passing uncompressed — error: ${msg}`);
      // Fail-open: forward uncompressed (compression is a cost optimization, not a safety feature)
    }
  }

  // Set category for usage tracking
  setCurrentCategory(category);

  // Build model list: primary + fallbacks
  const modelsToTry: string[] = [routedModel];
  if (tier !== "EXPLICIT") {
    const routingCfg = getRoutingConfig();
    // v2: use category config for fallbacks if available
    const categoryKey = category;
    if (categoryKey && routingCfg.categories && categoryKey in routingCfg.categories) {
      const catConfig = (routingCfg.categories as Record<string, any>)[categoryKey];
      for (const fb of catConfig.fallback) {
        if (fb !== routedModel) modelsToTry.push(fb);
      }
    } else {
      // Legacy: use tier config
      const hasTools = chatReq.tools && chatReq.tools.length > 0;
      const tierSource =
        hasTools && routingCfg.agenticTiers ? routingCfg.agenticTiers : routingCfg.tiers;
      const tierConfig = tierSource[tier as keyof typeof tierSource];
      if (tierConfig?.fallback) {
        for (const fb of tierConfig.fallback) {
          if (fb !== routedModel) modelsToTry.push(fb);
        }
      }
    }
  }

  // ─── Capture response body for caching (non-streaming only) ───
  let capturedBody: string | null = null;
  if (cacheKey && !stream) {
    const originalEnd = res.end.bind(res);
    (res as any).end = function (chunk?: any, ...args: any[]) {
      if (chunk && typeof chunk === "string") capturedBody = chunk;
      else if (chunk && Buffer.isBuffer(chunk)) capturedBody = chunk.toString();
      return originalEnd(chunk, ...args);
    };
    res.setHeader("X-Cache", "MISS");
  }

  let lastError: string = "";
  try {
    for (const modelToTry of modelsToTry) {
      try {
        if (modelToTry !== routedModel) {
          logger.info(`[${stats.requests}] Falling back to ${modelToTry}`);
          res.setHeader("X-TierFlow-Model", modelToTry);
        }

        // Always rehydrate if we scrubbed — even if fallback provider doesn't have PII enabled,
        // the messages were already scrubbed and the response will contain placeholders
        const actualProvider = parseModelId(modelToTry).provider;
        const actualProviderCfg = cfg.providers[actualProvider];
        const needsRehydrate = piiScrubbed;
        // Use primary provider's piiMode consistently (not the fallback's)
        const piiMode = primaryPiiMode;

        // Warn if falling back to a non-PII provider with scrubbed data
        if (
          piiScrubbed &&
          modelToTry !== routedModel &&
          (!actualProviderCfg || !isPiiEnabled(actualProviderCfg))
        ) {
          logger.warn(
            `[PII] Fallback to ${modelToTry} (no PII flag) — rehydrating scrubbed response`,
          );
          res.setHeader("X-PII-Warning", "fallback-to-non-pii-provider");
        }

        await forwardRequest(
          chatReq,
          modelToTry,
          tier,
          res,
          stream,
          needsRehydrate ? piiSession : null,
          needsRehydrate ? piiMode : undefined,
        );
        if (needsRehydrate) stats.pii.rehydrated++;

        // Store in cache on success (non-streaming, non-PII responses only)
        if (cacheKey && capturedBody && !piiScrubbed && responseCache) {
          responseCache.set(cacheKey, capturedBody, modelToTry);
        }

        return; // success
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        const isTimeout = err instanceof TimeoutError;
        if (isTimeout) {
          stats.timeouts++;
          logger.error(`\u23f1 TIMEOUT (${modelToTry}): ${lastError} — trying fallback...`);
        } else {
          logger.error(`Forward error (${modelToTry}): ${lastError}`);
        }
        if (res.headersSent) break; // can't retry if already streaming
      }
    }

    stats.errors++;
    if (!res.headersSent) {
      sendError(res, 502, `Backend error: ${lastError}`, "upstream_error");
    } else if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify({ error: { message: lastError } })}\n\n`);
      res.write("data: [DONE]\n\n");
      res.end();
    }
  } finally {
    // Always clean up PII session (idempotent — safe even if already destroyed)
    if (piiSession) {
      destroySession(piiSession);
    }
  }
}

/**
 * Handle GET /v1/models
 */
function handleListModels(_req: IncomingMessage, res: ServerResponse) {
  const cfg = getConfig();
  const created = Math.floor(Date.now() / 1000);
  const seen = new Set<string>();
  const models: Array<{
    id: string;
    object: string;
    created: number;
    owned_by: string;
    permission?: unknown[];
  }> = [];

  // Always include "auto" (the smart router)
  models.push({ id: "auto", object: "model", created, owned_by: "tierflow", permission: [] });
  seen.add("auto");

  // Collect models from tiers, agenticTiers, and categories
  const tierSources = [cfg.tiers, cfg.agenticTiers, cfg.categories].filter(Boolean);
  for (const source of tierSources) {
    for (const mapping of Object.values(source!)) {
      const ids = [mapping.primary, ...(mapping.fallback || [])];
      for (const modelId of ids) {
        if (seen.has(modelId)) continue;
        seen.add(modelId);
        const provider = modelId.split("/")[0] || "unknown";
        models.push({ id: modelId, object: "model", created, owned_by: provider });
      }
    }
  }

  // Add explicitly listed models from providers
  for (const [providerName, providerCfg] of Object.entries(cfg.providers)) {
    if (providerCfg.disabled) continue;
    for (const modelId of providerCfg.models ?? []) {
      const fullId = modelId.includes("/") ? modelId : `${providerName}/${modelId}`;
      if (seen.has(fullId)) continue;
      seen.add(fullId);
      models.push({ id: fullId, object: "model", created, owned_by: providerName });
    }
  }

  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ object: "list", data: models }));
}

/**
 * Handle GET /health
 */
function handleHealth(_req: IncomingMessage, res: ServerResponse) {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(
    JSON.stringify({
      status: "ok",
      version: "2.0.0",
      uptime: process.uptime(),
      mlClassifier: getClassifierStatus(),
      securityScanner: getScannerStatus(),
      modelSync: getLastSyncResult(),
      stats: {
        ...stats,
        cache: responseCache?.getStats() ?? {
          hits: 0,
          misses: 0,
          stores: 0,
          evictions: 0,
          size: 0,
          hitRate: "0.0%",
        },
        tokenUsage: getUsageStats(),
      },
    }),
  );
}

/**
 * Handle GET /stats
 */
function handleStats(_req: IncomingMessage, res: ServerResponse) {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(
    JSON.stringify(
      {
        ...stats,
        cache: responseCache?.getStats() ?? {
          hits: 0,
          misses: 0,
          stores: 0,
          evictions: 0,
          size: 0,
          hitRate: "0.0%",
        },
        tokenUsage: getUsageStats(),
      },
      null,
      2,
    ),
  );
}

/**
 * Handle GET /config — show sanitized config (no secrets)
 */
function handleConfig(_req: IncomingMessage, res: ServerResponse) {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(
    JSON.stringify(
      {
        configPath: getConfigPath(),
        config: getSanitizedConfig(),
      },
      null,
      2,
    ),
  );
}

/**
 * Handle POST /reload-config — reload config + auth without restart
 */
function handleReloadConfig(_req: IncomingMessage, res: ServerResponse) {
  reloadConfig();
  reloadAuth();
  responseCache = initCache();
  const cfg = getConfig();
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(
    JSON.stringify({
      status: "reloaded",
      configPath: getConfigPath(),
      providers: Object.keys(cfg.providers),
      tiers: Object.keys(cfg.tiers),
    }),
  );
}

/**
 * Handle POST /reload
 */
function handleReload(_req: IncomingMessage, res: ServerResponse) {
  reloadConfig();
  reloadAuth();
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ status: "reloaded" }));
}

/**
 * Request router.
 */
async function handleRequest(req: IncomingMessage, res: ServerResponse) {
  const method = req.method ?? "GET";
  const url = req.url ?? "/";

  // CORS headers — safe on localhost; restrict if exposing externally
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  try {
    if (method === "POST" && (url === "/v1/chat/completions" || url === "/chat/completions")) {
      await handleChatCompletions(req, res);
    } else if (method === "GET" && (url === "/v1/models" || url === "/models")) {
      handleListModels(req, res);
    } else if (method === "GET" && url === "/health") {
      handleHealth(req, res);
    } else if (method === "GET" && url === "/stats") {
      handleStats(req, res);
    } else if (method === "POST" && url === "/reload") {
      handleReload(req, res);
    } else if (method === "GET" && url === "/config") {
      handleConfig(req, res);
    } else if (method === "POST" && url === "/reload-config") {
      handleReloadConfig(req, res);
    } else if (method === "GET" && url === "/quality-tiers") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(getQualityTiersResponse()));
    } else if (method === "POST" && url === "/quality-preset") {
      const body = JSON.parse(await readBody(req));
      const preset = body.preset as PresetName;
      if (!["free", "smart_saver", "quality_first", "maximum"].includes(preset)) {
        sendError(res, 400, "Invalid preset. Use: free, smart_saver, quality_first, maximum");
      } else {
        applyPreset(preset);
        reloadConfig();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, preset }));
      }
    } else if (method === "POST" && url === "/quality-level") {
      const body = JSON.parse(await readBody(req));
      const { category, level, global: isGlobal } = body;
      if (isGlobal && level >= 1 && level <= 5) {
        setGlobalLevel(level as QualityLevel);
        reloadConfig();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, global: true, level }));
      } else if (category && level >= 1 && level <= 5) {
        setQualityLevel(category, level as QualityLevel);
        reloadConfig();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, category, level }));
      } else {
        sendError(res, 400, "Provide { category, level: 1-5 } or { global: true, level: 1-5 }");
      }
    } else if (method === "POST" && url === "/test-provider") {
      const body = JSON.parse(await readBody(req));
      const result = await testProvider(body.provider);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
    } else if (method === "POST" && url === "/provider-key") {
      const body = JSON.parse(await readBody(req));
      const { provider, apiKey } = body;
      if (!provider || typeof provider !== "string") {
        sendError(res, 400, "Provide { provider, apiKey }");
      } else if (!apiKey || typeof apiKey !== "string") {
        sendError(res, 400, "Provide { provider, apiKey }");
      } else {
        setProviderKey(provider, apiKey);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, provider }));
      }
    } else if (method === "GET" && url === "/provider-keys") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(getProviderKeyStatus()));
    } else if (method === "GET" && url === "/models-info") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ models: MODELS }));
    } else if (method === "GET" && (url === "/dashboard" || url === "/")) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(getDashboardHTML());
    } else {
      sendError(res, 404, `Not found: ${method} ${url}`, "not_found");
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`Unhandled error: ${msg}`);
    if (!res.headersSent) {
      sendError(res, 500, msg);
    }
  }
}

// ─── Start server ───

if (process.argv.includes("--debug")) {
  setLogLevel("debug");
}

responseCache = initCache();

const server = createServer(handleRequest);

server.listen(PORT, HOST, async () => {
  logger.info(
    `🚀 TierFlow listening on http://${HOST}:${PORT} (config: ${getConfigPath() ?? "built-in defaults"})`,
  );
  // Try to initialize local ML classifier (non-blocking)
  initClassifier().then((ok) => {
    if (ok) {
      const status = getClassifierStatus();
      logger.info(`   ML: local ONNX classifier ready (${status.training_examples} training examples)`);
    } else {
      logger.info(`   ML: local classifier not available (install @huggingface/transformers for local ML)`);
    }
  });
  // Start periodic model pricing sync from OpenRouter (every 24h)
  startPeriodicSync(modelPricing);
  logger.info(`   Models: ${modelPricing.size} in pricing map (auto-sync from OpenRouter every 24h)`);
  if (responseCache)
    logger.info(
      `   Cache: enabled (TTL=${getConfig().cache?.ttl_seconds ?? 300}s, max=${getConfig().cache?.max_entries ?? 5000})`,
    );
  logger.info(`   POST /v1/chat/completions  — route & forward`);
  logger.info(`   GET  /v1/models            — list models`);
  logger.info(`   GET  /health               — health check`);
  logger.info(`   GET  /stats                — request statistics`);
  logger.info(`   POST /reload               — reload auth keys`);
  logger.info(`   GET  /config               — show config (sanitized)`);
  logger.info(`   POST /reload-config         — reload config + auth`);
  logger.info(`   GET  /dashboard             — monitoring dashboard`);
});

// Graceful shutdown
process.on("SIGINT", () => {
  logger.info("Shutting down...");
  piiVaultStore.shutdown();
  server.close(() => process.exit(0));
});

process.on("SIGTERM", () => {
  logger.info("Shutting down...");
  piiVaultStore.shutdown();
  server.close(() => process.exit(0));
});
