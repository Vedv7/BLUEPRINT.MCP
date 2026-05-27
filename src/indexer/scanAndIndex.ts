import path from "node:path";
import type { BlueprintConfig } from "../config/loadConfig.js";
import { loadConfig } from "../config/loadConfig.js";
import { openDb } from "../db/db.js";
import { indexSymbolEmbeddings, type EmbeddingIndexResult } from "../embeddings/indexSymbols.js";
import { buildArchitectureIr } from "../ir/buildArchitectureIr.js";
import { persistArchitectureIr } from "../ir/persistIr.js";

export type ScanIndexResult = {
  config: BlueprintConfig;
  ir: Awaited<ReturnType<typeof buildArchitectureIr>>;
  filesScanned: number;
  symbolsIndexed: number;
  embeddings: EmbeddingIndexResult;
};

export async function scanAndIndexRepo(
  repoRoot: string,
  opts?: { forceMockEmbeddings?: boolean; enableEmbeddings?: boolean }
): Promise<ScanIndexResult> {
  const config = loadConfig(repoRoot);
  if (opts?.enableEmbeddings) {
    config.embeddings.enabled = true;
  }

  const ir = await buildArchitectureIr(repoRoot, config);
  const db = await openDb(path.join(repoRoot, config.dbPath));
  await persistArchitectureIr(db, ir);

  const embeddings = await indexSymbolEmbeddings({
    repoRoot,
    config,
    db,
    scannedFilesRel: ir.files.map((f) => f.path),
    forceMock: opts?.forceMockEmbeddings ?? process.env.BLUEPRINT_EMBED_MOCK === "1"
  });
  await db.close();

  return {
    config,
    ir,
    filesScanned: ir.files.length,
    symbolsIndexed: ir.symbols.length,
    embeddings
  };
}
