import type { BlueprintConfig } from "../../config/loadConfig.js";
import type { LanguageAdapter } from "../types.js";
import { discoverTypeScriptFiles } from "./discover.js";
import { extractTypeScriptImports } from "./extractImports.js";
import { extractTypeScriptSymbols } from "./extractSymbols.js";
import { resolveTypeScriptImport } from "./resolveImport.js";

export const typescriptAdapter: LanguageAdapter = {
  id: "typescript",
  discoverFiles: async (repoRoot, config) => discoverTypeScriptFiles(repoRoot, config),
  extractSymbols: extractTypeScriptSymbols,
  extractImports: extractTypeScriptImports,
  resolveImport: (fromPath, specifier, config) => resolveTypeScriptImport(fromPath, specifier, config.pathAliases)
};
