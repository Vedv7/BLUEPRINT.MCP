import type { BlueprintConfig } from "../../config/loadConfig.js";
import type { LanguageAdapter } from "../types.js";
import { discoverPythonFiles } from "./discoverPythonFiles.js";
import { extractPythonImports } from "./extractPythonImports.js";
import { extractPythonSymbols } from "./extractPythonSymbols.js";

export const pythonAdapter: LanguageAdapter = {
  id: "python",
  discoverFiles: async (repoRoot, config) => discoverPythonFiles(repoRoot, config),
  extractSymbols: extractPythonSymbols,
  extractImports: extractPythonImports,
  resolveImport() {
    return null;
  }
};
