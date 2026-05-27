import type { BlueprintConfig } from "../config/loadConfig.js";
import { getEnabledAdapters } from "../adapters/registry.js";
import { boundaryRulesFromConfig } from "./boundaries.js";
import { buildModuleNodes } from "./modules.js";
import type { ArchitectureIR, FileNode, ImportEdge, SymbolNode } from "./types.js";

export type BuildIrOptions = {
  exportedOnly?: boolean;
};

export async function buildArchitectureIr(
  repoRoot: string,
  config: BlueprintConfig,
  opts?: BuildIrOptions
): Promise<ArchitectureIR> {
  const adapters = getEnabledAdapters(config);
  const files: FileNode[] = [];
  const symbols: SymbolNode[] = [];
  const imports: ImportEdge[] = [];

  for (const adapter of adapters) {
    const discovered = await adapter.discoverFiles(repoRoot, config);
    files.push(...discovered);
    symbols.push(...(await adapter.extractSymbols(repoRoot, discovered, { exportedOnly: opts?.exportedOnly ?? true })));
    imports.push(...(await adapter.extractImports(repoRoot, discovered, config)));
  }

  const uniqueFiles = dedupeFiles(files);
  const modules = buildModuleNodes(uniqueFiles, config);

  return {
    repoRoot,
    files: uniqueFiles,
    symbols,
    imports,
    modules,
    boundaries: boundaryRulesFromConfig(config),
    adapters: adapters.map((a) => a.id)
  };
}

function dedupeFiles(files: FileNode[]): FileNode[] {
  const map = new Map<string, FileNode>();
  for (const file of files) {
    map.set(file.path, file);
  }
  return [...map.values()].sort((a, b) => a.path.localeCompare(b.path));
}
