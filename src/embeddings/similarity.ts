import type { BlueprintConfig } from "../config/loadConfig.js";
import type { BlueprintDb } from "../db/db.js";
import { buildProposedRepresentation } from "./representSymbol.js";
import { createEmbedder, type Embedder } from "./model.js";
import { loadAllEmbeddings } from "./store.js";
import { cosineSimilarity } from "./vector.js";

export type SemanticMatch = {
  symbolId: number;
  symbol: string;
  file: string;
  signature: string;
  summary?: string | null;
  semanticScore: number;
};

export async function findSemanticMatches(opts: {
  repoRoot: string;
  config: BlueprintConfig;
  db: BlueprintDb;
  proposedSymbolName: string;
  proposedFilePath?: string;
  intent?: string;
  limit?: number;
  embedder?: Embedder;
  forceMock?: boolean;
}): Promise<SemanticMatch[]> {
  if (!opts.config.embeddings.enabled) return [];

  const embeddings = await loadAllEmbeddings(opts.db, opts.config.embeddings.dimensions);
  if (!embeddings.size) return [];

  const embedder = opts.embedder ?? (await createEmbedder(opts.repoRoot, opts.config.embeddings, { forceMock: opts.forceMock }));
  const queryText = buildProposedRepresentation(opts.proposedSymbolName, opts.proposedFilePath, opts.intent);
  const queryVec = await embedder.embed(queryText);

  const ids = [...embeddings.keys()];
  const placeholders = ids.map(() => "?").join(",");
  const rows = await opts.db.all<
    Array<{ id: number; name: string; file_path: string; signature: string; summary: string | null }>
  >(`SELECT id, name, file_path, signature, summary FROM symbols WHERE id IN (${placeholders})`, ...ids);

  const matches: SemanticMatch[] = [];
  for (const row of rows) {
    const stored = embeddings.get(row.id);
    if (!stored) continue;
    const semanticScore = cosineSimilarity(queryVec, stored.vector);
    if (semanticScore < opts.config.embeddings.minSemanticScore * 0.85) continue;
    matches.push({
      symbolId: row.id,
      symbol: row.name,
      file: row.file_path,
      signature: row.signature,
      summary: row.summary,
      semanticScore
    });
  }

  return matches.sort((a, b) => b.semanticScore - a.semanticScore).slice(0, opts.limit ?? 5);
}
