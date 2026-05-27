import type { BlueprintConfig } from "../../config/loadConfig.js";

export const JAVA_EXTENSION = ".java";

export const DEFAULT_JAVA_INCLUDE_GLOBS = [
  "src/main/java/**",
  "src/**",
  "app/**",
  "backend/**",
  "apps/**",
  "packages/**",
  "services/**",
  "api/**"
];

export function resolveJavaIncludes(config: BlueprintConfig): string[] {
  if (config.languages?.java?.include?.length) {
    return config.languages.java.include;
  }
  return DEFAULT_JAVA_INCLUDE_GLOBS;
}
