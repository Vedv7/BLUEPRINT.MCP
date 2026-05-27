import type { LanguageAdapter } from "../types.js";
import { discoverJavaFiles } from "./discoverJavaFiles.js";
import { extractJavaImports } from "./extractJavaImports.js";
import { extractJavaSymbols } from "./extractJavaSymbols.js";

export const javaAdapter: LanguageAdapter = {
  id: "java",
  discoverFiles: async (repoRoot, config) => discoverJavaFiles(repoRoot, config),
  extractSymbols: extractJavaSymbols,
  extractImports: extractJavaImports,
  resolveImport() {
    return null;
  }
};
