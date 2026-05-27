import fs from "node:fs";
import type { BlueprintConfig } from "../../config/loadConfig.js";
import type { FileNode, ImportEdge } from "../../ir/types.js";
import { parseJavaSource } from "./parseJavaSource.js";
import { resolveJavaImportEdge } from "./resolveJavaImport.js";

export async function extractJavaImports(
  repoRoot: string,
  files: FileNode[],
  _config: BlueprintConfig
): Promise<ImportEdge[]> {
  const edges: ImportEdge[] = [];

  for (const file of files) {
    let source = "";
    try {
      source = fs.readFileSync(file.absolutePath, "utf8");
    } catch {
      continue;
    }
    const parsed = parseJavaSource(source);
    for (const imp of parsed.imports) {
      const { toPath, isExternal } = resolveJavaImportEdge(repoRoot, imp.moduleSpecifier);
      edges.push({
        fromPath: file.path,
        moduleSpecifier: imp.moduleSpecifier,
        toPath,
        isExternal,
        language: "java"
      });
    }
  }

  return edges;
}
