import fs from "node:fs";
import path from "node:path";
import sqlite3 from "sqlite3";
import { open, type Database } from "sqlite";

export type BlueprintDb = Database<sqlite3.Database, sqlite3.Statement>;

export async function openDb(absoluteDbPath: string): Promise<BlueprintDb> {
  fs.mkdirSync(path.dirname(absoluteDbPath), { recursive: true });
  const db = await open({
    filename: absoluteDbPath,
    driver: sqlite3.Database
  });
  await db.exec("PRAGMA journal_mode=WAL;");
  await db.exec("PRAGMA foreign_keys=ON;");
  await ensureSchema(db);
  return db;
}

async function ensureSchema(db: BlueprintDb) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      path TEXT NOT NULL UNIQUE,
      area TEXT,
      updated_at INTEGER NOT NULL
    );
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS symbols (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      file_path TEXT NOT NULL,
      signature TEXT NOT NULL,
      summary TEXT,
      exported INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(name, kind, file_path, signature)
    );
  `);

  await db.exec("CREATE INDEX IF NOT EXISTS idx_symbols_name ON symbols(name);");
  await db.exec("CREATE INDEX IF NOT EXISTS idx_symbols_file_path ON symbols(file_path);");

  await db.exec(`
    CREATE TABLE IF NOT EXISTS symbol_embeddings (
      symbol_id INTEGER PRIMARY KEY,
      content_hash TEXT NOT NULL,
      representation TEXT NOT NULL,
      vector BLOB NOT NULL,
      dimensions INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY(symbol_id) REFERENCES symbols(id) ON DELETE CASCADE
    );
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS file_embedding_cache (
      file_path TEXT PRIMARY KEY,
      file_hash TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS file_imports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      from_path TEXT NOT NULL,
      module_specifier TEXT NOT NULL,
      to_path TEXT,
      is_external INTEGER NOT NULL,
      language TEXT,
      updated_at INTEGER NOT NULL,
      UNIQUE(from_path, module_specifier, to_path)
    );
  `);
  await db.exec("CREATE INDEX IF NOT EXISTS idx_file_imports_from_path ON file_imports(from_path);");
  await db.exec("CREATE INDEX IF NOT EXISTS idx_file_imports_to_path ON file_imports(to_path);");

  try {
    await db.exec("ALTER TABLE file_imports ADD COLUMN language TEXT;");
  } catch {
    // Column already exists.
  }
}

export type SymbolRowWithId = {
  id: number;
  name: string;
  kind: string;
  file_path: string;
  signature: string;
  summary: string | null;
  exported: number;
};

