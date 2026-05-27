import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function blueprintPackageRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    const pkg = path.join(dir, "package.json");
    if (fs.existsSync(pkg)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(pkg, "utf8")) as { name?: string };
        if (
          parsed.name === "blueprint-mcp" ||
          parsed.name === "blueprint-arch-mcp"
        ) {
          return dir;
        }
      } catch {
        // continue
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
}

export function pythonAstScriptPath(): string {
  return path.join(blueprintPackageRoot(), "python", "parse_ast.py");
}
