import path from "node:path";
import fs from "node:fs";
import { minimatch } from "minimatch";
import type { BlueprintConfig } from "../../config/loadConfig.js";
import type { FileNode } from "../../ir/types.js";
import { normalizePath } from "./resolveImport.js";

const TS_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);

function walk(dirAbs: string, acc: string[]) {
  const entries = fs.readdirSync(dirAbs, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === ".next" || entry.name === "dist" || entry.name === ".git") {
      continue;
    }
    const abs = path.join(dirAbs, entry.name);
    if (entry.isDirectory()) walk(abs, acc);
    else acc.push(abs);
  }
}

function defaultTypeScriptGlobs() {
  return [
    "src/**/*.ts",
    "src/**/*.tsx",
    "src/**/*.js",
    "src/**/*.jsx",
    "app/**/*.ts",
    "app/**/*.tsx",
    "app/**/*.js",
    "app/**/*.jsx",
    "frontend/**/*.ts",
    "frontend/**/*.tsx",
    "frontend/**/*.js",
    "frontend/**/*.jsx",
    "packages/**/*.ts",
    "packages/**/*.tsx",
    "V2/**/*.js",
    "scripts/**/*.js",
    "tests/**/*.js"
  ];
}

export function discoverTypeScriptFiles(repoRoot: string, config: BlueprintConfig): FileNode[] {
  const rootAbs = path.resolve(repoRoot, config.root);
  const filesAbs: string[] = [];
  walk(rootAbs, filesAbs);

  const include = config.languages?.typescript?.include?.length
    ? config.languages.typescript.include
    : config.include.length
      ? config.include
      : defaultTypeScriptGlobs();

  const rel = filesAbs
    .map((abs) => normalizePath(path.relative(repoRoot, abs)))
    .filter((p) => !p.startsWith(".blueprint/"));

  return rel
    .filter((p) => {
      const ext = path.posix.extname(p).toLowerCase();
      return TS_EXTENSIONS.has(ext);
    })
    .filter((p) => include.some((glob) => minimatch(p, glob, { dot: true, nocase: true })))
    .map((p) => ({
      path: p,
      absolutePath: path.join(repoRoot, p),
      language: "typescript" as const
    }));
}
