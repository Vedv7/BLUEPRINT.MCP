import type { BlueprintConfig } from "../config/loadConfig.js";
import { discoverTypeScriptFiles } from "../adapters/typescript/discover.js";

/** @deprecated Use buildArchitectureIr() — kept for backward compatibility. */
export function scanRepo(repoRoot: string, config: BlueprintConfig): string[] {
  return discoverTypeScriptFiles(repoRoot, config).map((f) => f.path);
}
