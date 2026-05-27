import type { BlueprintDb } from "../db/db.js";
import type { SymbolRecord } from "../parser/types.js";

export async function saveSymbols(db: BlueprintDb, symbols: SymbolRecord[], nowMs = Date.now()) {
  await db.exec("BEGIN;");
  try {
    const stmt = await db.prepare(
      `INSERT INTO symbols(name, kind, file_path, signature, summary, exported, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(name, kind, file_path, signature) DO UPDATE SET
         summary = excluded.summary,
         exported = excluded.exported,
         updated_at = excluded.updated_at`
    );

    for (const s of symbols) {
      await stmt.run(s.name, s.kind, s.filePath, s.signature, s.summary ?? null, s.exported ? 1 : 0, nowMs);
    }
    await stmt.finalize();
    await db.exec("COMMIT;");
  } catch (e) {
    await db.exec("ROLLBACK;");
    throw e;
  }
}

