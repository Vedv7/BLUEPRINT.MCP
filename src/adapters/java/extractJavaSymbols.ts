import fs from "node:fs";
import type { FileNode, SymbolKind, SymbolNode } from "../../ir/types.js";
import { parseJavaSource } from "./parseJavaSource.js";

function toKind(kind: string): SymbolKind {
  if (kind === "class") return "class";
  if (kind === "interface") return "interface";
  if (kind === "enum") return "class";
  return "unknown";
}

export async function extractJavaSymbols(
  repoRoot: string,
  files: FileNode[],
  opts?: { exportedOnly?: boolean }
): Promise<SymbolNode[]> {
  const exportedOnly = opts?.exportedOnly !== false;
  const symbols: SymbolNode[] = [];

  for (const file of files) {
    let source = "";
    try {
      source = fs.readFileSync(file.absolutePath, "utf8");
    } catch {
      continue;
    }
    const parsed = parseJavaSource(source);

    if (parsed.packageName) {
      symbols.push({
        name: parsed.packageName,
        kind: "unknown",
        filePath: file.path,
        signature: `package ${parsed.packageName}`,
        summary: null,
        exported: true,
        language: "java"
      });
    }

    for (const type of parsed.types) {
      if (exportedOnly && !type.exported) continue;
      symbols.push({
        name: type.name,
        kind: toKind(type.kind),
        filePath: file.path,
        signature: `${type.kind} ${type.name}`,
        summary: type.annotations.length ? `@${type.annotations.join(" @")}` : null,
        exported: type.exported,
        language: "java"
      });
    }

    for (const method of parsed.methods) {
      if (exportedOnly && !method.exported) continue;
      const symName = method.isConstructor ? method.className : `${method.className}.${method.name}`;
      symbols.push({
        name: symName,
        kind: method.isConstructor ? "class" : "class_method",
        filePath: file.path,
        signature: method.signature,
        summary: null,
        exported: method.exported,
        language: "java"
      });
    }
  }

  return symbols;
}
