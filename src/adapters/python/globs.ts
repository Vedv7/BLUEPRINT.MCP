import type { BlueprintConfig } from "../../config/loadConfig.js";

export const PYTHON_EXTENSION = ".py";

export const DEFAULT_PYTHON_INCLUDE_GLOBS = [
  "src/**",
  "app/**",
  "lib/**",
  "backend/**",
  "frontend/**",
  "ml-service/**",
  "packages/**",
  "apps/**",
  "services/**",
  "api/**",
  "server/**",
  "V2/**",
  "scripts/**"
];

export function resolvePythonIncludes(config: BlueprintConfig): string[] {
  if (config.languages?.python?.include?.length) {
    return config.languages.python.include;
  }
  return DEFAULT_PYTHON_INCLUDE_GLOBS;
}
