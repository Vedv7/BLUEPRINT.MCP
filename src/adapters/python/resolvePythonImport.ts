import fs from "node:fs";
import path from "node:path";

function normalize(p: string) {
  return p.replaceAll("\\", "/");
}

function moduleToPath(moduleName: string) {
  return moduleName.replaceAll(".", "/");
}

function fileExists(repoRoot: string, rel: string) {
  return fs.existsSync(path.join(repoRoot, rel));
}

function resolveModuleAt(repoRoot: string, modulePath: string): string | null {
  const base = normalize(modulePath);
  const candidates = [`${base}.py`, `${base}/__init__.py`];
  for (const rel of candidates) {
    if (fileExists(repoRoot, rel)) return rel.replace(/\.py$/, "").replace(/\/__init__$/, "");
  }
  return null;
}

/** Resolve relative import base directory from `fromPath` and `level` (PEP 328). */
function relativeBaseDir(fromPath: string, level: number): string {
  const parts = path.posix.dirname(normalize(fromPath)).split("/").filter(Boolean);
  if (level <= 1) return parts.join("/");
  const up = Math.max(0, parts.length - (level - 1));
  return parts.slice(0, up).join("/");
}

export function resolvePythonImport(
  repoRoot: string,
  fromPath: string,
  moduleSpecifier: string,
  level: number
): string | null {
  if (level > 0) {
    const base = relativeBaseDir(fromPath, level);
    const mod = moduleSpecifier ? moduleToPath(moduleSpecifier) : "";
    const combined = mod ? (base ? `${base}/${mod}` : mod) : base;
    return resolveModuleAt(repoRoot, combined);
  }

  if (!moduleSpecifier) return null;
  return resolveModuleAt(repoRoot, moduleToPath(moduleSpecifier));
}

export function resolvePythonImportEdge(
  repoRoot: string,
  fromPath: string,
  moduleSpecifier: string,
  level: number
): { toPath: string | null; isExternal: boolean } {
  const toPath = resolvePythonImport(repoRoot, fromPath, moduleSpecifier, level);
  return { toPath, isExternal: toPath === null };
}
