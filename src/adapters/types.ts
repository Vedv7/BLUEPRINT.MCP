import type { BlueprintConfig } from "../config/loadConfig.js";
import type { FileNode, ImportEdge, LanguageId, SymbolNode } from "../ir/types.js";

export interface LanguageAdapter {
  readonly id: LanguageId;
  discoverFiles(repoRoot: string, config: BlueprintConfig): Promise<FileNode[]>;
  extractSymbols(
    repoRoot: string,
    files: FileNode[],
    opts?: { exportedOnly?: boolean }
  ): Promise<SymbolNode[]>;
  extractImports(repoRoot: string, files: FileNode[], config: BlueprintConfig): Promise<ImportEdge[]>;
  resolveImport(fromPath: string, specifier: string, config: BlueprintConfig): string | null;
}
