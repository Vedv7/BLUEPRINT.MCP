import path from "node:path";
import { Node, Project, SyntaxKind } from "ts-morph";
import type { BlueprintConfig } from "../../config/loadConfig.js";
import type { FileNode, ImportEdge } from "../../ir/types.js";
import { normalizePath, resolveTypeScriptImport } from "./resolveImport.js";

function pushEdge(
  edges: ImportEdge[],
  fromRel: string,
  specifier: string,
  config: BlueprintConfig
) {
  const target = resolveTypeScriptImport(fromRel, specifier, config.pathAliases);
  edges.push({
    fromPath: fromRel,
    moduleSpecifier: specifier,
    toPath: target,
    isExternal: target === null,
    language: "typescript"
  });
}

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
      pushEdge(edges, fromRel, imp.getModuleSpecifierValue(), config);
    }

    for (const impEq of sf.getDescendantsOfKind(SyntaxKind.ImportEqualsDeclaration)) {
      const ref = impEq.getModuleReference().asKind(SyntaxKind.ExternalModuleReference);
      const expr = ref?.getExpression();
      if (expr && Node.isStringLiteral(expr)) {
        pushEdge(edges, fromRel, expr.getLiteralValue(), config);
      }
    }

    for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const callee = call.getExpression();
      if (!Node.isIdentifier(callee) || callee.getText() !== "require") continue;
      const arg0 = call.getArguments()[0];
      if (!arg0 || !Node.isStringLiteral(arg0)) continue;
      pushEdge(edges, fromRel, arg0.getLiteralValue(), config);
    }
  }
  return edges;
}
