import path from "node:path";
import fs from "node:fs";
import { minimatch } from "minimatch";
import type { BlueprintConfig } from "../../config/loadConfig.js";
import type { FileNode } from "../../ir/types.js";
import { SKIP_WALK_DIRS } from "../typescript/globs.js";
import { normalizePath } from "../typescript/resolveImport.js";
import { JAVA_EXTENSION, resolveJavaIncludes } from "./globs.js";

const EXTRA_SKIP = new Set(["target", "build", "out", "gradle"]);

function walk(dirAbs: string, acc: string[]) {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dirAbs, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (SKIP_WALK_DIRS.has(entry.name) || EXTRA_SKIP.has(entry.name)) continue;
    const abs = path.join(dirAbs, entry.name);
    if (entry.isDirectory()) walk(abs, acc);
    else acc.push(abs);
  }
}

export function discoverJavaFiles(repoRoot: string, config: BlueprintConfig): FileNode[] {
  const rootAbs = path.resolve(repoRoot, config.root);
  const filesAbs: string[] = [];
  walk(rootAbs, filesAbs);
  const include = resolveJavaIncludes(config);

  return filesAbs
    .map((abs) => normalizePath(path.relative(repoRoot, abs)))
    .filter((p) => !p.startsWith(".blueprint/"))
    .filter((p) => path.posix.extname(p).toLowerCase() === JAVA_EXTENSION)
    .filter((p) => include.some((glob) => minimatch(p, glob, { dot: true, nocase: true })))
    .map((p) => ({
      path: p,
      absolutePath: path.join(repoRoot, p),
      language: "java" as const
    }));
}
