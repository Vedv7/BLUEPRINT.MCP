import path from "node:path";
import { Project, SyntaxKind, type FunctionDeclaration, type MethodDeclaration } from "ts-morph";
import type { SymbolRecord } from "./types.js";

function oneLine(s: string) {
  return s.replace(/\s+/g, " ").trim();
}

function getJsDocSummary(node: { getJsDocs(): { getComment(): unknown }[] }) {
  const docs = node.getJsDocs();
  for (const d of docs) {
    const c = d.getComment();
    if (typeof c === "string" && c.trim()) return oneLine(c);
    if (Array.isArray(c)) {
      const text = c
        .map((p) => {
          if (!p) return "";
          // ts-morph may return structured JSDoc parts
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const maybeText = (p as any).getText?.();
          return typeof maybeText === "string" ? maybeText : String(p);
        })
        .join(" ");
      if (text.trim()) return oneLine(text);
    }
  }
  return undefined;
}

function formatFuncSignature(fn: FunctionDeclaration) {
  const name = fn.getName() ?? "anonymous";
  const params = fn
    .getParameters()
    .map((p) => `${p.getName()}:${oneLine(p.getType().getText(p))}`)
    .join(", ");
  const ret = oneLine(fn.getReturnType().getText(fn));
  return `${name}(${params}):${ret}`;
}

function formatMethodSignature(m: MethodDeclaration, className: string) {
  const name = m.getName();
  const params = m
    .getParameters()
    .map((p) => `${p.getName()}:${oneLine(p.getType().getText(p))}`)
    .join(", ");
  const ret = oneLine(m.getReturnType().getText(m));
  return `${className}.${name}(${params}):${ret}`;
}

export type ExtractOptions = {
  repoRoot: string;
  filePaths: string[];
  exportedOnly?: boolean;
};

export async function extractSymbols(opts: ExtractOptions): Promise<SymbolRecord[]> {
  const project = new Project({
    tsConfigFilePath: undefined,
    skipAddingFilesFromTsConfig: true
  });
  project.addSourceFilesAtPaths(opts.filePaths);

  const out: SymbolRecord[] = [];

  for (const sf of project.getSourceFiles()) {
    const abs = sf.getFilePath();
    const rel = path.relative(opts.repoRoot, abs).replaceAll("\\", "/");

    // Exported function declarations
    for (const fn of sf.getFunctions()) {
      const name = fn.getName();
      if (!name) continue;
      const exported = fn.isExported();
      if (opts.exportedOnly !== false && !exported) continue;

      out.push({
        name,
        kind: "function",
        filePath: rel,
        signature: formatFuncSignature(fn),
        summary: getJsDocSummary(fn),
        exported
      });
    }

    // Exported classes + methods (exported if class is exported)
    for (const cls of sf.getClasses()) {
      const className = cls.getName();
      if (!className) continue;
      const classExported = cls.isExported();
      if (opts.exportedOnly !== false && !classExported) continue;

      out.push({
        name: className,
        kind: "class",
        filePath: rel,
        signature: `${className}`,
        summary: getJsDocSummary(cls),
        exported: classExported
      });

      for (const m of cls.getMembers().filter((n) => n.getKind() === SyntaxKind.MethodDeclaration)) {
        const md = m as MethodDeclaration;
        const mName = md.getName();
        if (!mName || mName === "constructor") continue;
        out.push({
          name: `${className}.${mName}`,
          kind: "class_method",
          filePath: rel,
          signature: formatMethodSignature(md, className),
          summary: getJsDocSummary(md),
          exported: classExported
        });
      }
    }
  }

  return out;
}

