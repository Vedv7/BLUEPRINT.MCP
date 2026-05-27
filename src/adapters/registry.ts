import type { BlueprintConfig } from "../config/loadConfig.js";
import type { LanguageAdapter } from "./types.js";
import { pythonAdapter } from "./python/pythonAdapter.js";
import { typescriptAdapter } from "./typescript/adapter.js";

const ALL_ADAPTERS: LanguageAdapter[] = [typescriptAdapter, pythonAdapter];

export function getRegisteredAdapters(): LanguageAdapter[] {
  return ALL_ADAPTERS;
}

function isAdapterEnabled(config: BlueprintConfig, adapter: LanguageAdapter): boolean {
  if (adapter.id === "typescript") {
    return config.languages?.typescript?.enabled !== false;
  }
  if (adapter.id === "python") {
    return config.languages?.python?.enabled !== false;
  }
  return false;
}

export function getEnabledAdapters(config: BlueprintConfig): LanguageAdapter[] {
  return ALL_ADAPTERS.filter((adapter) => isAdapterEnabled(config, adapter));
}

export function getAdapter(id: string): LanguageAdapter | undefined {
  return ALL_ADAPTERS.find((a) => a.id === id);
}
