import type { BlueprintConfig } from "../../config/loadConfig.js";
import type { FileNode, ImportEdge } from "../../ir/types.js";
import { parsePythonFilesWithAst } from "./parseWithAst.js";
import { resolvePythonImportEdge } from "./resolvePythonImport.js";

export async function extractPythonImports(
  repoRoot: string,
  files: FileNode[],
  _config: BlueprintConfig
): Promise<ImportEdge[]> {
  if (!files.length) return [];
  const batch = parsePythonFilesWithAst({ repoRoot, files, exportedOnly: true });
  const edges: ImportEdge[] = [];

  for (const file of batch.files) {
    for (const imp of file.imports) {
      const specifier =
        imp.level > 0
          ? `${".".repeat(imp.level)}${imp.moduleSpecifier ? imp.moduleSpecifier : ""}`
          : imp.moduleSpecifier;
      const { toPath, isExternal } = resolvePythonImportEdge(
        repoRoot,
        file.filePath,
        imp.moduleSpecifier,
        imp.level
      );
      edges.push({
        fromPath: file.filePath,
        moduleSpecifier: specifier,
        toPath,
        isExternal,
        language: "python"
      });
    }
  }
  return edges;
}
