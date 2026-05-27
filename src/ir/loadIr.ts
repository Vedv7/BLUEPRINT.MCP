import type { BlueprintDb } from "../db/db.js";
import type { ArchitectureIR, FileNode, ImportEdge, SymbolNode } from "./types.js";

export async function loadArchitectureIrFromDb(db: BlueprintDb, repoRoot: string): Promise<ArchitectureIR> {
  const fileRows = await db.all<Array<{ path: string; area: string | null }>>(
    "SELECT path, area FROM files ORDER BY path ASC"
  );

  const fileNodes: FileNode[] = fileRows.map((f) => ({
    path: f.path,
    absolutePath: `${repoRoot}/${f.path}`.replaceAll("\\", "/"),
    language: (f.area === "python" || f.area === "java" ? f.area : "typescript") as FileNode["language"]
  }));

  const symbolRows = await db.all<
    Array<{
      name: string;
      kind: string;
      file_path: string;
      signature: string;
      summary: string | null;
      exported: number;
    }>
  >("SELECT name, kind, file_path, signature, summary, exported FROM symbols ORDER BY name ASC");

  const symbolNodes: SymbolNode[] = symbolRows.map((s) => ({
    name: s.name,
    kind: s.kind as SymbolNode["kind"],
    filePath: s.file_path,
    signature: s.signature,
    summary: s.summary,
    exported: Boolean(s.exported),
    language: "typescript"
  }));

  const importRows = await db.all<
    Array<{
      from_path: string;
      module_specifier: string;
      to_path: string | null;
      is_external: number;
      language: string | null;
    }>
  >("SELECT from_path, module_specifier, to_path, is_external, language FROM file_imports");

  const imports: ImportEdge[] = importRows.map((row) => ({
    fromPath: row.from_path,
    moduleSpecifier: row.module_specifier,
    toPath: row.to_path,
    isExternal: Boolean(row.is_external),
    language: (row.language ?? "typescript") as ImportEdge["language"]
  }));

  return {
    repoRoot,
    files: fileNodes,
    symbols: symbolNodes,
    imports,
    modules: [],
    boundaries: [],
    adapters: ["typescript"]
  };
}
