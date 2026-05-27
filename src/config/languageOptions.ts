import type { BlueprintConfig } from "./loadConfig.js";
import type { LanguageId } from "../ir/types.js";

export function typescriptExportedOnly(config: BlueprintConfig): boolean {
  return config.languages?.typescript?.indexNonExported !== true;
}

export function pythonExportedOnly(config: BlueprintConfig): boolean {
  return config.languages?.python?.indexNonExported !== true;
}

export function exportedOnlyForAdapter(adapterId: LanguageId, config: BlueprintConfig, override?: boolean): boolean {
  if (override !== undefined) return override;
  if (adapterId === "python") return pythonExportedOnly(config);
  return typescriptExportedOnly(config);
}
