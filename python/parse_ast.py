#!/usr/bin/env python3
"""Extract Blueprint symbols and imports from Python source via stdlib ast."""
from __future__ import annotations

import ast
import json
import sys
from typing import Any


def _sig(args: ast.arguments) -> str:
    parts: list[str] = []
    posonly = [a.arg for a in getattr(args, "posonlyargs", []) or []]
    parts.extend(posonly)
    if posonly:
        parts.append("/")
    parts.extend(a.arg for a in args.args)
    if args.vararg:
        parts.append(f"*{args.vararg.arg}")
    elif args.kwonlyargs:
        parts.append("*")
    parts.extend(a.arg for a in args.kwonlyargs)
    if args.kwarg:
        parts.append(f"**{args.kwarg.arg}")
    return ",".join(parts)


def _decorator_name(node: ast.expr) -> str | None:
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        return node.attr
    if isinstance(node, ast.Call):
        return _decorator_name(node.func)
    return None


def _is_exported(node: ast.AST) -> bool:
  for dec in getattr(node, "decorator_list", []) or []:
    name = _decorator_name(dec)
    if name in ("public", "export", "api"):
      return True
  # Module-level without leading underscore => treated as public API surface
  name = getattr(node, "name", "")
  return bool(name) and not str(name).startswith("_")


class FileVisitor(ast.NodeVisitor):
    def __init__(self, rel_path: str, exported_only: bool) -> None:
        self.rel_path = rel_path
        self.exported_only = exported_only
        self.symbols: list[dict[str, Any]] = []
        self.imports: list[dict[str, Any]] = []
        self._class_stack: list[str] = []

    def _add_symbol(
        self,
        name: str,
        kind: str,
        signature: str,
        exported: bool,
        lineno: int,
        summary: str | None = None,
    ) -> None:
        if self.exported_only and not exported:
            return
        self.symbols.append(
            {
                "name": name,
                "kind": kind,
                "filePath": self.rel_path,
                "signature": signature,
                "summary": summary,
                "exported": exported,
                "language": "python",
            }
        )

    def visit_Import(self, node: ast.Import) -> None:
        for alias in node.names:
            spec = alias.name
            self.imports.append(
                {
                    "moduleSpecifier": spec,
                    "level": 0,
                    "importedName": alias.asname or alias.name.split(".")[-1],
                }
            )

    def visit_ImportFrom(self, node: ast.ImportFrom) -> None:
        module = node.module or ""
        level = node.level or 0
        for alias in node.names:
            if alias.name == "*":
                self.imports.append(
                    {
                        "moduleSpecifier": module,
                        "level": level,
                        "importedName": "*",
                    }
                )
                continue
            self.imports.append(
                {
                    "moduleSpecifier": module,
                    "level": level,
                    "importedName": alias.asname or alias.name,
                }
            )

    def visit_FunctionDef(self, node: ast.FunctionDef) -> None:
        self._visit_function(node, is_async=False)

    def visit_AsyncFunctionDef(self, node: ast.AsyncFunctionDef) -> None:
        self._visit_function(node, is_async=True)

    def _visit_function(self, node: ast.FunctionDef | ast.AsyncFunctionDef, is_async: bool) -> None:
        if self._class_stack:
            cls = self._class_stack[-1]
            exported = not node.name.startswith("_")
            kind = "class_method"
            sig = f"{cls}.{node.name}({ _sig(node.args) })" + (" -> async" if is_async else "")
            self._add_symbol(f"{cls}.{node.name}", kind, sig, exported, node.lineno)
            self.generic_visit(node)
            return

        exported = _is_exported(node) or not node.name.startswith("_")
        prefix = "async def" if is_async else "def"
        sig = f"{prefix} {node.name}({ _sig(node.args) })"
        doc = ast.get_docstring(node)
        self._add_symbol(node.name, "function", sig, exported, node.lineno, doc)
        self.generic_visit(node)

    def visit_ClassDef(self, node: ast.ClassDef) -> None:
        exported = _is_exported(node) or not node.name.startswith("_")
        doc = ast.get_docstring(node)
        self._add_symbol(node.name, "class", f"class {node.name}", exported, node.lineno, doc)
        self._class_stack.append(node.name)
        self.generic_visit(node)
        self._class_stack.pop()


def parse_file(rel_path: str, source: str, exported_only: bool) -> dict[str, Any]:
    try:
        tree = ast.parse(source, filename=rel_path)
    except SyntaxError as err:
        return {"filePath": rel_path, "symbols": [], "imports": [], "error": str(err)}
    visitor = FileVisitor(rel_path, exported_only)
    visitor.visit(tree)
    return {"filePath": rel_path, "symbols": visitor.symbols, "imports": visitor.imports}


def main() -> None:
    payload = json.load(sys.stdin)
    exported_only = bool(payload.get("exportedOnly", True))
    repo_root = payload.get("repoRoot", "")
    files = payload.get("files", [])
    out: list[dict[str, Any]] = []
    for item in files:
        rel = item["path"]
        abs_path = item.get("absolutePath") or rel
        try:
            with open(abs_path, encoding="utf-8") as fh:
                source = fh.read()
        except OSError as err:
            out.append({"filePath": rel, "symbols": [], "imports": [], "error": str(err)})
            continue
        out.append(parse_file(rel, source, exported_only))
    json.dump({"repoRoot": repo_root, "files": out}, sys.stdout)


if __name__ == "__main__":
    main()
