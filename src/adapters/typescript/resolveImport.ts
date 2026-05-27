import path from "node:path";
import type { BlueprintConfig } from "../../config/loadConfig.js";

export function normalizePath(p: string) {
  return p.replaceAll("\\", "/");
}

export function stripSourceExt(p: string) {
  return p.replace(/\.(ts|tsx|js|jsx|mjs|cjs)$/, "");
}

export function resolveTypeScriptImport(
  fromFileRel: string,
  specifier: string,
  pathAliases: BlueprintConfig["pathAliases"]
) {
  const fromDir = path.posix.dirname(fromFileRel);
  if (specifier.startsWith("./") || specifier.startsWith("../")) {
    return normalizePath(stripSourceExt(path.posix.normalize(path.posix.join(fromDir, specifier))));
  }
  for (const alias of pathAliases) {
    if (specifier.startsWith(alias.aliasPrefix)) {
      return normalizePath(stripSourceExt(alias.targetPrefix + specifier.slice(alias.aliasPrefix.length)));
    }
  }
  if (specifier.startsWith("src/") || specifier.startsWith("app/")) {
    return normalizePath(stripSourceExt(specifier));
  }
  return null;
}
