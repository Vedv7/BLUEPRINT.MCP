import type { BlueprintDb } from "../db/db.js";
import type { SymbolRecord } from "../parser/types.js";
import { saveSymbols } from "../indexer/saveSymbols.js";
import type { ArchitectureIR, ImportEdge } from "./types.js";

export async function persistFileImports(db: BlueprintDb, edges: ImportEdge[], nowMs = Date.now()) {
  await db.exec("BEGIN;");
  try {
    const clearStmt = await db.prepare("DELETE FROM file_imports WHERE from_path = ?");
    for (const fp of new Set(edges.map((e) => e.fromPath))) {
      await clearStmt.run(fp);
    }
    await clearStmt.finalize();

    const ins = await db.prepare(
      `INSERT INTO file_imports(from_path, module_specifier, to_path, is_external, language, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(from_path, module_specifier, to_path)
       DO UPDATE SET is_external = excluded.is_external, language = excluded.language, updated_at = excluded.updated_at`
    );
    for (const e of edges) {
      await ins.run(e.fromPath, e.moduleSpecifier, e.toPath, e.isExternal ? 1 : 0, e.language, nowMs);
    }
    await ins.finalize();
    await db.exec("COMMIT;");
  } catch (err) {
    await db.exec("ROLLBACK;");
    throw err;
  }
}

export async function persistArchitectureIr(db: BlueprintDb, ir: ArchitectureIR, nowMs = Date.now()) {
  const symbolRecords: SymbolRecord[] = ir.symbols.map((s) => ({
    name: s.name,
    kind: s.kind === "variable" || s.kind === "unknown" ? "function" : s.kind,
    filePath: s.filePath,
    signature: s.signature,
    summary: s.summary ?? undefined,
    exported: s.exported
  }));

  await saveSymbols(db, symbolRecords, nowMs);
  await persistFileImports(db, ir.imports, nowMs);

  const fileStmt = await db.prepare(
    `INSERT INTO files(path, area, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(path) DO UPDATE SET area = excluded.area, updated_at = excluded.updated_at`
  );
  for (const file of ir.files) {
    await fileStmt.run(file.path, file.dialect, nowMs);
  }
  await fileStmt.finalize();
}
