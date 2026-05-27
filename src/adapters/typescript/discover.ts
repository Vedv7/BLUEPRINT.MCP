import path from "node:path";
import fs from "node:fs";
import { minimatch } from "minimatch";
import type { BlueprintConfig } from "../../config/loadConfig.js";
import type { FileNode } from "../../ir/types.js";
import {
  JS_TS_EXTENSIONS,
  resolveTypeScriptIncludes,
  scriptDialectFromPath,
  SKIP_WALK_DIRS
} from "./globs.js";
import { normalizePath } from "./resolveImport.js";

function walk(dirAbs: string, acc: string[]) {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dirAbs, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (SKIP_WALK_DIRS.has(entry.name)) continue;
    const abs = path.join(dirAbs, entry.name);
    if (entry.isDirectory()) walk(abs, acc);
    else acc.push(abs);
  }
}

export function discoverTypeScriptFiles(repoRoot: string, config: BlueprintConfig): FileNode[] {
  const rootAbs = path.resolve(repoRoot, config.root);
  const filesAbs: string[] = [];
  walk(rootAbs, filesAbs);

  const include = resolveTypeScriptIncludes(config);

  const rel = filesAbs
    .map((abs) => normalizePath(path.relative(repoRoot, abs)))
    .filter((p) => !p.startsWith(".blueprint/"));

  return rel
    .filter((p) => {
      const ext = path.posix.extname(p).toLowerCase();
      return JS_TS_EXTENSIONS.has(ext);
    })
    .filter((p) => include.some((glob) => minimatch(p, glob, { dot: true, nocase: true })))
    .map((p) => ({
      path: p,
      absolutePath: path.join(repoRoot, p),
      language: "typescript" as const,
      dialect: scriptDialectFromPath(p)
    }));
}
