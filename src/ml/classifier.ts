/**
 * TierFlow ML Classifier — KNN with sentence embeddings.
 *
 * Uses @huggingface/transformers (optional dependency) for ONNX-based
 * sentence embedding via all-MiniLM-L6-v2.
 *
 * If the dependency is not installed, classify() returns null and the
 * router falls back to the rule-based keyword scorer.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { logger } from "../logger.js";

// ─── Types ───

export type ClassifyResult = {
  category: string;
  confidence: number;
  alternatives: Array<{ category: string; confidence: number }>;
  latency_ms: number;
  method: "local-ml";
};

type TrainingExample = {
  text: string;
  category: string;
};

type TrainingData = {
  version: string;
  model: string;
  embedding_dim: number;
  categories: string[];
  examples: TrainingExample[];
};

type EmbeddingCache = {
  version: string;
  model: string;
  embeddings: number[][]; // parallel to training data examples
};

// ─── Module State ───

let pipeline: any = null; // @huggingface/transformers pipeline
let trainingData: TrainingData | null = null;
let trainingEmbeddings: Float32Array[] | null = null;
let isAvailable: boolean | null = null; // null = not checked yet
let isLoading = false;

const MODEL_ID = "Xenova/all-MiniLM-L6-v2";
const K_NEIGHBORS = 5;
const MIN_CONFIDENCE = 0.05; // alternatives must be above this
const MAX_ALTERNATIVES = 3;
const MAX_QUERY_LENGTH = 2000; // truncate queries beyond this

// ─── Public API ───

/**
 * Check if the ML classifier is available (dependency installed + model loadable).
 * Uses import.meta.resolve (ESM-native, sync in Node 20+) with a filesystem
 * fallback for environments where import.meta.resolve is unavailable (e.g. tsx).
 */
export function isMLAvailable(): boolean {
  if (isAvailable !== null) return isAvailable;

  try {
    // Prefer ESM-native resolution (Node 20+)
    if (typeof import.meta.resolve === "function") {
      import.meta.resolve("@huggingface/transformers");
      isAvailable = true;
      return true;
    }
  } catch {
    isAvailable = false;
    return false;
  }

  // Fallback: check if the package directory exists in node_modules
  try {
    const root = findPackageRoot();
    isAvailable = existsSync(join(root, "node_modules", "@huggingface", "transformers"));
  } catch {
    isAvailable = false;
  }
  return isAvailable;
}

/**
 * Initialize the ML classifier. Downloads model on first run (~80MB).
 * Call this at startup if you want eager loading.
 * Returns true if ready, false if dependency missing.
 */
export async function initClassifier(): Promise<boolean> {
  if (pipeline) return true;
  if (isLoading) return false;
  isLoading = true;

  try {
    // Dynamic import — only loads if @huggingface/transformers is installed
    const hf = await import("@huggingface/transformers");

    logger.info("[ML] Loading sentence-transformer model...");
    const start = Date.now();

    pipeline = await hf.pipeline("feature-extraction", MODEL_ID, {
      dtype: "fp32",
    });

    logger.info(`[ML] Model loaded in ${Date.now() - start}ms`);

    // Load training data
    trainingData = loadTrainingData();

    // Load or compute training embeddings
    trainingEmbeddings = await loadOrComputeEmbeddings();

    isAvailable = true;
    isLoading = false;
    return true;
  } catch (err) {
    logger.warn(
      `[ML] Classifier not available: ${err instanceof Error ? err.message : String(err)}`,
    );
    isAvailable = false;
    isLoading = false;
    return false;
  }
}

/**
 * Classify a query into one of 8 categories.
 * Returns null if the classifier is not available.
 */
export async function classify(query: string): Promise<ClassifyResult | null> {
  if (!pipeline || !trainingEmbeddings || !trainingData) {
    // Try lazy init
    const ready = await initClassifier();
    if (!ready) return null;
  }

  const start = performance.now();
  const truncated = query.slice(0, MAX_QUERY_LENGTH);

  // Compute query embedding
  const output = await pipeline!(truncated, { pooling: "mean", normalize: true });
  const queryEmbedding = new Float32Array(output.data);

  // KNN: find K nearest neighbors by cosine distance
  const distances: Array<{ index: number; distance: number }> = [];
  for (let i = 0; i < trainingEmbeddings!.length; i++) {
    const dist = cosineDistance(queryEmbedding, trainingEmbeddings![i]);
    distances.push({ index: i, distance: dist });
  }
  distances.sort((a, b) => a.distance - b.distance);

  const neighbors = distances.slice(0, K_NEIGHBORS);

  // Weighted vote: closer neighbors have more weight (inverse distance)
  const categoryWeights: Record<string, number> = {};
  let totalWeight = 0;

  for (const n of neighbors) {
    const category = trainingData!.examples[n.index].category;
    const weight = 1 / (n.distance + 1e-10); // avoid div by zero
    categoryWeights[category] = (categoryWeights[category] || 0) + weight;
    totalWeight += weight;
  }

  // Normalize to probabilities
  const probabilities: Array<{ category: string; confidence: number }> = [];
  for (const [cat, weight] of Object.entries(categoryWeights)) {
    probabilities.push({ category: cat, confidence: weight / totalWeight });
  }
  probabilities.sort((a, b) => b.confidence - a.confidence);

  const top = probabilities[0];
  const alternatives = probabilities
    .slice(1)
    .filter((p) => p.confidence > MIN_CONFIDENCE)
    .slice(0, MAX_ALTERNATIVES);

  const latency = performance.now() - start;

  return {
    category: top.category,
    confidence: Math.round(top.confidence * 1000) / 1000,
    alternatives: alternatives.map((a) => ({
      category: a.category,
      confidence: Math.round(a.confidence * 1000) / 1000,
    })),
    latency_ms: Math.round(latency * 10) / 10,
    method: "local-ml",
  };
}

/**
 * Get classifier status for /health endpoint.
 */
export function getClassifierStatus(): {
  available: boolean;
  model: string;
  training_examples: number;
  method: string;
} {
  return {
    available: !!pipeline && !!trainingEmbeddings,
    model: MODEL_ID,
    training_examples: trainingData?.examples.length ?? 0,
    method: "local-onnx-knn",
  };
}

// ─── Internal Helpers ───

function cosineDistance(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const similarity = dot / (Math.sqrt(normA) * Math.sqrt(normB) + 1e-10);
  return 1 - similarity; // distance = 1 - similarity
}

/**
 * Find the package root by walking up from import.meta.url until we find package.json.
 * Works in both dev (src/ml/classifier.ts) and bundled (dist/server.js) contexts.
 */
function findPackageRoot(): string {
  let dir: string;
  try {
    dir = dirname(fileURLToPath(import.meta.url));
  } catch {
    dir = __dirname;
  }

  // Walk up at most 5 levels to find package.json
  for (let i = 0; i < 5; i++) {
    if (existsSync(join(dir, "package.json"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break; // filesystem root
    dir = parent;
  }
  return dir;
}

/**
 * Locate training-data.json — checks multiple paths to handle dev, bundled, and npm installs.
 */
function findTrainingDataPath(): string {
  const root = findPackageRoot();
  const candidates = [
    join(root, "src", "ml", "training-data.json"), // dev + npm package (listed in "files")
    join(root, "dist", "ml", "training-data.json"), // if copied to dist
    join(dirname(fileURLToPath(import.meta.url)), "training-data.json"), // co-located (dev)
  ];

  for (const p of candidates) {
    if (existsSync(p)) return p;
  }

  throw new Error(
    `training-data.json not found. Searched:\n${candidates.map((c) => `  - ${c}`).join("\n")}`,
  );
}

function loadTrainingData(): TrainingData {
  const dataPath = findTrainingDataPath();
  logger.info(`[ML] Loading training data from ${dataPath}`);
  const raw = readFileSync(dataPath, "utf-8");
  return JSON.parse(raw) as TrainingData;
}

/**
 * Embedding cache goes in ~/.cache/tierflow/ — always writable, survives npm updates.
 */
function getEmbeddingCachePath(): string {
  const cacheDir = join(homedir(), ".cache", "tierflow");
  if (!existsSync(cacheDir)) {
    mkdirSync(cacheDir, { recursive: true });
  }
  return join(cacheDir, "embeddings-cache.json");
}

async function loadOrComputeEmbeddings(): Promise<Float32Array[]> {
  const cachePath = getEmbeddingCachePath();

  // Try loading from cache
  if (existsSync(cachePath)) {
    try {
      const raw = readFileSync(cachePath, "utf-8");
      const cache = JSON.parse(raw) as EmbeddingCache;

      // Validate version matches
      if (
        cache.version === trainingData!.version &&
        cache.model === MODEL_ID &&
        cache.embeddings.length === trainingData!.examples.length
      ) {
        logger.info(`[ML] Loaded ${cache.embeddings.length} cached embeddings`);
        return cache.embeddings.map((e) => new Float32Array(e));
      }
      logger.info("[ML] Embedding cache version mismatch — recomputing");
    } catch {
      logger.warn("[ML] Failed to load embedding cache — recomputing");
    }
  }

  // Compute embeddings for all training examples
  logger.info(`[ML] Computing embeddings for ${trainingData!.examples.length} training examples...`);
  const start = Date.now();

  const embeddings: Float32Array[] = [];
  for (const example of trainingData!.examples) {
    const output = await pipeline!(example.text, { pooling: "mean", normalize: true });
    embeddings.push(new Float32Array(output.data));
  }

  logger.info(`[ML] Computed ${embeddings.length} embeddings in ${Date.now() - start}ms`);

  // Save cache
  try {
    const cache: EmbeddingCache = {
      version: trainingData!.version,
      model: MODEL_ID,
      embeddings: embeddings.map((e) => Array.from(e)),
    };
    writeFileSync(cachePath, JSON.stringify(cache));
    logger.info(`[ML] Saved embedding cache to ${cachePath}`);
  } catch (err) {
    logger.warn(`[ML] Failed to save embedding cache: ${err}`);
  }

  return embeddings;
}
