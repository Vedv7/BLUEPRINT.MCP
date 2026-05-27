import type { BlueprintDb, SymbolRowWithId } from "../db/db.js";
import { deserializeVector, serializeVector } from "./vector.js";

export type StoredEmbedding = {
  symbolId: number;
  contentHash: string;
  representation: string;
  vector: Float32Array;
  dimensions: number;
};

export async function loadAllEmbeddings(db: BlueprintDb, dimensions: number): Promise<Map<number, StoredEmbedding>> {
  const rows = await db.all<
    Array<{
      symbol_id: number;
      content_hash: string;
      representation: string;
      vector: Buffer;
      dimensions: number;
    }>
  >("SELECT symbol_id, content_hash, representation, vector, dimensions FROM symbol_embeddings");

  const map = new Map<number, StoredEmbedding>();
  for (const row of rows) {
    map.set(row.symbol_id, {
      symbolId: row.symbol_id,
      contentHash: row.content_hash,
      representation: row.representation,
      vector: deserializeVector(row.vector, row.dimensions || dimensions),
      dimensions: row.dimensions || dimensions
    });
  }
  return map;
}

export async function upsertSymbolEmbedding(
  db: BlueprintDb,
  symbolId: number,
  contentHash: string,
  representation: string,
  vector: Float32Array,
  nowMs = Date.now()
) {
  await db.run(
    `INSERT INTO symbol_embeddings(symbol_id, content_hash, representation, vector, dimensions, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(symbol_id) DO UPDATE SET
       content_hash = excluded.content_hash,
       representation = excluded.representation,
       vector = excluded.vector,
       dimensions = excluded.dimensions,
       updated_at = excluded.updated_at`,
    symbolId,
    contentHash,
    representation,
    serializeVector(vector),
    vector.length,
    nowMs
  );
}

export async function deleteEmbeddingsForFile(db: BlueprintDb, filePath: string) {
  await db.run(
    `DELETE FROM symbol_embeddings
     WHERE symbol_id IN (SELECT id FROM symbols WHERE file_path = ?)`,
    filePath
  );
}

export async function getExportedSymbolsWithIds(db: BlueprintDb): Promise<SymbolRowWithId[]> {
  return db.all<SymbolRowWithId[]>(
    `SELECT id, name, kind, file_path, signature, summary, exported
     FROM symbols
     WHERE kind IN ('function', 'class_method') AND exported = 1`
  );
}

export async function getFileEmbeddingHash(db: BlueprintDb, filePath: string) {
  const row = await db.get<{ file_hash: string }>("SELECT file_hash FROM file_embedding_cache WHERE file_path = ?", filePath);
  return row?.file_hash ?? null;
}

export async function setFileEmbeddingHash(db: BlueprintDb, filePath: string, fileHash: string, nowMs = Date.now()) {
  await db.run(
    `INSERT INTO file_embedding_cache(file_path, file_hash, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(file_path) DO UPDATE SET file_hash = excluded.file_hash, updated_at = excluded.updated_at`,
    filePath,
    fileHash,
    nowMs
  );
}
