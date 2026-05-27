import path from "node:path";
import {
  Node,
  Project,
  SyntaxKind,
  type Expression,
  type FunctionDeclaration,
  type MethodDeclaration,
  type SourceFile
} from "ts-morph";
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

function formatExprSignature(name: string, expr: Expression) {
  if (Node.isFunctionExpression(expr) || Node.isArrowFunction(expr)) {
    const params = expr
      .getParameters()
      .map((p) => p.getName())
      .join(", ");
    return `${name}(${params})`;
  }
  if (Node.isClassExpression(expr)) {
    return `${name} [class]`;
  }
  return name;
}

function shouldIndex(exported: boolean, exportedOnly: boolean) {
  return exportedOnly ? exported : true;
}

function pushSymbol(
  out: SymbolRecord[],
  row: SymbolRecord,
  exportedOnly: boolean
) {
  if (!shouldIndex(row.exported, exportedOnly)) return;
  out.push(row);
}

function collectCommonJsExports(sf: SourceFile, rel: string, out: SymbolRecord[], exportedOnly: boolean) {
  for (const stmt of sf.getStatements()) {
    if (!Node.isExpressionStatement(stmt)) continue;
    const expr = stmt.getExpression();
    if (!Node.isBinaryExpression(expr) || expr.getOperatorToken().getKind() !== SyntaxKind.EqualsToken) continue;

    const left = expr.getLeft();
    const right = expr.getRight();
    if (!Node.isPropertyAccessExpression(left)) continue;

    const base = left.getExpression().getText();
    const prop = left.getName();

    if (base === "exports" && prop) {
      pushSymbol(
        out,
        {
          name: prop,
          kind: Node.isClassExpression(right) ? "class" : "function",
          filePath: rel,
          signature: formatExprSignature(prop, right),
          summary: undefined,
          exported: true
        },
        exportedOnly
      );
      continue;
    }

    if (base === "module" && prop === "exports" && Node.isObjectLiteralExpression(right)) {
      for (const p of right.getProperties()) {
        if (Node.isPropertyAssignment(p)) {
          const name = p.getName();
          const init = p.getInitializer();
          if (!name || !init) continue;
          pushSymbol(
            out,
            {
              name,
              kind: Node.isClassExpression(init) ? "class" : "function",
              filePath: rel,
              signature: formatExprSignature(name, init),
              summary: undefined,
              exported: true
            },
            exportedOnly
          );
        } else if (Node.isShorthandPropertyAssignment(p)) {
          const name = p.getName();
          pushSymbol(
            out,
            {
              name,
              kind: "function",
              filePath: rel,
              signature: name,
              summary: undefined,
              exported: true
            },
            exportedOnly
          );
        } else if (Node.isMethodDeclaration(p)) {
          const name = p.getName();
          if (!name) continue;
          pushSymbol(
            out,
            {
              name,
              kind: "function",
              filePath: rel,
              signature: `${name}()`,
              summary: getJsDocSummary(p),
              exported: true
            },
            exportedOnly
          );
        }
      }
    }
  }
}

function collectModuleScopeSymbols(sf: SourceFile, rel: string, out: SymbolRecord[], exportedOnly: boolean) {
  for (const fn of sf.getFunctions()) {
    const name = fn.getName();
    if (!name) continue;
    const exported = fn.isExported();
    pushSymbol(
      out,
      {
        name,
        kind: "function",
        filePath: rel,
        signature: formatFuncSignature(fn),
        summary: getJsDocSummary(fn),
        exported
      },
      exportedOnly
    );
  }

  for (const cls of sf.getClasses()) {
    const className = cls.getName();
    if (!className) continue;
    const classExported = cls.isExported();
    pushSymbol(
      out,
      {
        name: className,
        kind: "class",
        filePath: rel,
        signature: className,
        summary: getJsDocSummary(cls),
        exported: classExported
      },
      exportedOnly
    );

    if (!shouldIndex(classExported, exportedOnly)) continue;

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

  for (const stmt of sf.getVariableStatements()) {
    if (!stmt.getParentIfKind(SyntaxKind.SourceFile)) continue;
    const isExported = stmt.isExported();
    for (const decl of stmt.getDeclarationList().getDeclarations()) {
      const name = decl.getName();
      if (typeof name !== "string" || !name) continue;
      const init = decl.getInitializer();
      if (!init) continue;
      if (
        !Node.isArrowFunction(init) &&
        !Node.isFunctionExpression(init) &&
        !Node.isCallExpression(init)
      ) {
        continue;
      }
      pushSymbol(
        out,
        {
          name,
          kind: "function",
          filePath: rel,
          signature: formatExprSignature(name, init),
          summary: undefined,
          exported: isExported
        },
        exportedOnly
      );
    }
  }
}

export type ExtractOptions = {
  repoRoot: string;
  filePaths: string[];
  exportedOnly?: boolean;
};

export async function extractSymbols(opts: ExtractOptions): Promise<SymbolRecord[]> {
  const project = new Project({
    tsConfigFilePath: undefined,
    skipAddingFilesFromTsConfig: true,
    compilerOptions: {
      allowJs: true,
      checkJs: false
    }
  });
  project.addSourceFilesAtPaths(opts.filePaths);

  const exportedOnly = opts.exportedOnly !== false;
  const out: SymbolRecord[] = [];

  for (const sf of project.getSourceFiles()) {
    const abs = sf.getFilePath();
    const rel = path.relative(opts.repoRoot, abs).replaceAll("\\", "/");

    collectModuleScopeSymbols(sf, rel, out, exportedOnly);
    collectCommonJsExports(sf, rel, out, exportedOnly);
  }

  return out;
}
