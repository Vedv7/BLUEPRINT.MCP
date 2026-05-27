import type { FileNode, SymbolNode } from "../../ir/types.js";
import { extractSymbols } from "../../parser/extractSymbols.js";

export async function extractTypeScriptSymbols(
  repoRoot: string,
  files: FileNode[],
  opts?: { exportedOnly?: boolean }
): Promise<SymbolNode[]> {
  const records = await extractSymbols({
    repoRoot,
    filePaths: files.map((f) => f.absolutePath),
    exportedOnly: opts?.exportedOnly
  });
  return records.map((s) => ({
    name: s.name,
    kind: s.kind,
    filePath: s.filePath,
    signature: s.signature,
    summary: s.summary ?? null,
    exported: s.exported,
    language: "typescript"
  }));
}
