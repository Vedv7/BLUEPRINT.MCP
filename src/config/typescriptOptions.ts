import type { BlueprintConfig } from "./loadConfig.js";

/** When `languages.typescript.indexNonExported` is true, index internal top-level symbols too. */
export function typescriptExportedOnly(config: BlueprintConfig): boolean {
  return config.languages?.typescript?.indexNonExported !== true;
}
