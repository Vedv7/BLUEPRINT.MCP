import path from "node:path";
import { Project } from "ts-morph";
import type { BlueprintConfig } from "../../config/loadConfig.js";
import type { FileNode, ImportEdge } from "../../ir/types.js";
import { normalizePath, resolveTypeScriptImport } from "./resolveImport.js";

export async function extractTypeScriptImports(
  repoRoot: string,
  files: FileNode[],
  config: BlueprintConfig
): Promise<ImportEdge[]> {
  const project = new Project({ tsConfigFilePath: undefined, skipAddingFilesFromTsConfig: true });
  project.addSourceFilesAtPaths(files.map((f) => f.absolutePath));

  const edges: ImportEdge[] = [];
  for (const sf of project.getSourceFiles()) {
    const fromRel = normalizePath(path.relative(repoRoot, sf.getFilePath()));
    for (const imp of sf.getImportDeclarations()) {
      const specifier = imp.getModuleSpecifierValue();
      const target = resolveTypeScriptImport(fromRel, specifier, config.pathAliases);
      edges.push({
        fromPath: fromRel,
        moduleSpecifier: specifier,
        toPath: target,
        isExternal: target === null,
        language: "typescript"
      });
    }
  }
  return edges;
}
