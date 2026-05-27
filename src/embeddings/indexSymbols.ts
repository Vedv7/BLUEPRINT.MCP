import fs from "node:fs";
import path from "node:path";
import type { BlueprintConfig } from "../config/loadConfig.js";
import type { BlueprintDb } from "../db/db.js";
import { hashContent, hashFileContent } from "./hash.js";
import { createEmbedder, type Embedder } from "./model.js";
import { buildSymbolRepresentation, contentHashForSymbol } from "./representSymbol.js";
import {
  deleteEmbeddingsForFile,
  getExportedSymbolsWithIds,
  getFileEmbeddingHash,
  setFileEmbeddingHash,
  upsertSymbolEmbedding
} from "./store.js";

export type EmbeddingIndexResult = {
  filesProcessed: number;
  symbolsEmbedded: number;
  symbolsSkippedCache: number;
  filesSkippedCache: number;
};

async function indexFileSymbols(opts: {
  db: BlueprintDb;
  embedder: Embedder;
  repoRoot: string;
  filePath: string;
  nowMs: number;
}) {
  const abs = path.join(opts.repoRoot, opts.filePath);
  if (!fs.existsSync(abs)) return { embedded: 0, skipped: 0 };

  const fileContent = fs.readFileSync(abs, "utf8");
  const fileHash = hashFileContent(fileContent);
  const prevFileHash = await getFileEmbeddingHash(opts.db, opts.filePath);

  const symbols = (await getExportedSymbolsWithIds(opts.db)).filter((s) => s.file_path === opts.filePath);
  if (!symbols.length) {
    await setFileEmbeddingHash(opts.db, opts.filePath, fileHash, opts.nowMs);
    return { embedded: 0, skipped: 0 };
  }

  const toEmbed: Array<{ symbolId: number; representation: string; contentHash: string }> = [];

  for (const symbol of symbols) {
    const representation = buildSymbolRepresentation({
      name: symbol.name,
      kind: symbol.kind,
      filePath: symbol.file_path,
      signature: symbol.signature,
      summary: symbol.summary
    });
    const contentHash = hashContent(
      contentHashForSymbol({
        name: symbol.name,
        kind: symbol.kind,
        filePath: symbol.file_path,
        signature: symbol.signature,
        summary: symbol.summary
      })
    );

    const existing = await opts.db.get<{ content_hash: string }>(
      "SELECT content_hash FROM symbol_embeddings WHERE symbol_id = ?",
      symbol.id
    );
    if (existing?.content_hash === contentHash) continue;
    toEmbed.push({ symbolId: symbol.id, representation, contentHash });
  }

  if (!toEmbed.length && prevFileHash === fileHash) {
    return { embedded: 0, skipped: 1 };
  }

  if (!toEmbed.length) {
    await setFileEmbeddingHash(opts.db, opts.filePath, fileHash, opts.nowMs);
    return { embedded: 0, skipped: 0 };
  }

  const vectors = await opts.embedder.embedBatch(toEmbed.map((t) => t.representation));
  for (let i = 0; i < toEmbed.length; i++) {
    await upsertSymbolEmbedding(opts.db, toEmbed[i].symbolId, toEmbed[i].contentHash, toEmbed[i].representation, vectors[i], opts.nowMs);
  }

  await setFileEmbeddingHash(opts.db, opts.filePath, fileHash, opts.nowMs);
  return { embedded: toEmbed.length, skipped: 0 };
}

export async function indexSymbolEmbeddings(opts: {
  repoRoot: string;
  config: BlueprintConfig;
  db: BlueprintDb;
  scannedFilesRel: string[];
  embedder?: Embedder;
  forceMock?: boolean;
  nowMs?: number;
}): Promise<EmbeddingIndexResult> {
  if (!opts.config.embeddings.enabled) {
    return { filesProcessed: 0, symbolsEmbedded: 0, symbolsSkippedCache: 0, filesSkippedCache: 0 };
  }

  const nowMs = opts.nowMs ?? Date.now();
  const embedder = opts.embedder ?? (await createEmbedder(opts.repoRoot, opts.config.embeddings, { forceMock: opts.forceMock }));

  let symbolsEmbedded = 0;
  let filesSkippedCache = 0;

  const uniqueFiles = [...new Set(opts.scannedFilesRel.map((f) => f.replaceAll("\\", "/")))];

  for (const filePath of uniqueFiles) {
    const result = await indexFileSymbols({
      db: opts.db,
      embedder,
      repoRoot: opts.repoRoot,
      filePath,
      nowMs
    });
    symbolsEmbedded += result.embedded;
    filesSkippedCache += result.skipped;
  }

  const indexedFiles = new Set(uniqueFiles);
  const allSymbols = await getExportedSymbolsWithIds(opts.db);
  const staleFiles = [...new Set(allSymbols.map((s) => s.file_path))].filter((f) => !indexedFiles.has(f));
  for (const stale of staleFiles) {
    await deleteEmbeddingsForFile(opts.db, stale);
  }

  return {
    filesProcessed: uniqueFiles.length,
    symbolsEmbedded,
    symbolsSkippedCache: 0,
    filesSkippedCache
  };
}
