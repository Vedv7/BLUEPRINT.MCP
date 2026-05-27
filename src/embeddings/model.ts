import path from "node:path";
import type { EmbeddingsConfig } from "../config/loadConfig.js";
import { normalizeVector } from "./vector.js";

export type Embedder = {
  readonly dimensions: number;
  readonly modelId: string;
  embed(text: string): Promise<Float32Array>;
  embedBatch(texts: string[]): Promise<Float32Array[]>;
};

let cachedMiniLm: Embedder | null = null;

export function createMockEmbedder(dimensions = 384, modelId = "mock-minilm"): Embedder {
  const domainKeywords = [
    ["currency", "money", "format", "amount", "payment", "price", "display", "convert"],
    ["email", "mail", "validate", "validation", "address"],
    ["retry", "fetch", "http", "request"]
  ];

  return {
    dimensions,
    modelId,
    async embed(text: string) {
      const vec = new Float32Array(dimensions);
      let seed = 0;
      for (let i = 0; i < text.length; i++) seed = (seed * 31 + text.charCodeAt(i)) >>> 0;
      for (let i = 0; i < dimensions; i++) {
        seed = (seed * 1664525 + 1013904223 + i) >>> 0;
        vec[i] = (seed / 0xffffffff) * 0.15;
      }

      const lower = text.toLowerCase();
      for (let d = 0; d < domainKeywords.length; d++) {
        for (const kw of domainKeywords[d]) {
          if (lower.includes(kw)) {
            vec[d * 8] += 0.55;
            vec[d * 8 + 1] += 0.35;
            vec[d * 8 + 2] += 0.25;
          }
        }
      }

      return normalizeVector(vec);
    },
    async embedBatch(texts: string[]) {
      return Promise.all(texts.map((t) => this.embed(t)));
    }
  };
}

export async function createMiniLmEmbedder(repoRoot: string, config: EmbeddingsConfig): Promise<Embedder> {
  if (cachedMiniLm && cachedMiniLm.modelId === config.model) return cachedMiniLm;

  const cacheDir = path.join(repoRoot, ".blueprint", "models");
  const { pipeline, env } = await import("@xenova/transformers");
  env.cacheDir = cacheDir;
  env.allowLocalModels = true;

  const extractor = await pipeline("feature-extraction", config.model, {
    quantized: true
  });

  const embedder: Embedder = {
    dimensions: config.dimensions,
    modelId: config.model,
    async embed(text: string) {
      const output = await extractor(text, { pooling: "mean", normalize: true });
      const data = output.data as Float32Array | number[];
      const vec = data instanceof Float32Array ? data : Float32Array.from(data);
      return normalizeVector(vec.slice(0, config.dimensions));
    },
    async embedBatch(texts: string[]) {
      return Promise.all(texts.map((t) => embedder.embed(t)));
    }
  };

  cachedMiniLm = embedder;
  return embedder;
}

export async function createEmbedder(repoRoot: string, config: EmbeddingsConfig, opts?: { forceMock?: boolean }) {
  if (opts?.forceMock || process.env.BLUEPRINT_EMBED_MOCK === "1") {
    return createMockEmbedder(config.dimensions, "mock-minilm");
  }
  return createMiniLmEmbedder(repoRoot, config);
}

export function resetEmbedderCacheForTests() {
  cachedMiniLm = null;
}
