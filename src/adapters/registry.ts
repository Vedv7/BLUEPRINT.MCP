import type { BlueprintConfig } from "../config/loadConfig.js";
import type { LanguageAdapter } from "./types.js";
import { typescriptAdapter } from "./typescript/adapter.js";

const ALL_ADAPTERS: LanguageAdapter[] = [typescriptAdapter];

export function getRegisteredAdapters(): LanguageAdapter[] {
  return ALL_ADAPTERS;
}

export function getEnabledAdapters(config: BlueprintConfig): LanguageAdapter[] {
  return ALL_ADAPTERS.filter((adapter) => {
    if (adapter.id === "typescript") {
      return config.languages?.typescript?.enabled !== false;
    }
    return false;
  });
}

export function getAdapter(id: string): LanguageAdapter | undefined {
  return ALL_ADAPTERS.find((a) => a.id === id);
}
