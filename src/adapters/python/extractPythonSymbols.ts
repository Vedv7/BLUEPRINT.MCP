import type { FileNode, SymbolKind, SymbolNode } from "../../ir/types.js";
import { parsePythonFilesWithAst } from "./parseWithAst.js";

function toSymbolKind(kind: string): SymbolKind {
  if (kind === "class") return "class";
  if (kind === "class_method") return "class_method";
  if (kind === "function") return "function";
  return "unknown";
}

export async function extractPythonSymbols(
  repoRoot: string,
  files: FileNode[],
  opts?: { exportedOnly?: boolean }
): Promise<SymbolNode[]> {
  if (!files.length) return [];
  const batch = parsePythonFilesWithAst({
    repoRoot,
    files,
    exportedOnly: opts?.exportedOnly !== false
  });

  const symbols: SymbolNode[] = [];
  for (const file of batch.files) {
    for (const sym of file.symbols) {
      symbols.push({
        name: sym.name,
        kind: toSymbolKind(sym.kind),
        filePath: sym.filePath,
        signature: sym.signature,
        summary: sym.summary ?? null,
        exported: sym.exported,
        language: "python"
      });
    }
  }
  return symbols;
}
