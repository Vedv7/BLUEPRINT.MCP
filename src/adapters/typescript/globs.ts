import path from "node:path";
import type { ScriptDialect } from "../../ir/types.js";

export const JS_TS_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);

/** Default discovery globs when config.include is empty. */
export const DEFAULT_TYPESCRIPT_INCLUDE_GLOBS = [
  "src/**",
  "app/**",
  "pages/**",
  "components/**",
  "lib/**",
  "server/**",
  "api/**",
  "packages/**",
  "apps/**",
  "backend/**",
  "frontend/**",
  "services/**"
];

export const SKIP_WALK_DIRS = new Set([
  "node_modules",
  ".next",
  "dist",
  "build",
  "out",
  ".git",
  ".blueprint",
  "coverage",
  "__pycache__",
  ".venv",
  "venv",
  "target"
]);

export function scriptDialectFromPath(filePath: string): ScriptDialect {
  const ext = path.posix.extname(filePath.replaceAll("\\", "/")).toLowerCase();
  return ext === ".ts" || ext === ".tsx" ? "typescript" : "javascript";
}

export function resolveTypeScriptIncludes(config: { include: string[]; languages?: { typescript?: { include?: string[] } } }) {
  if (config.languages?.typescript?.include?.length) {
    return config.languages.typescript.include;
  }
  if (config.include.length) {
    return config.include;
  }
  return DEFAULT_TYPESCRIPT_INCLUDE_GLOBS;
}
