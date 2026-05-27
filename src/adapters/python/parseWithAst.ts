import { spawnSync } from "node:child_process";
import fs from "node:fs";
import type { FileNode } from "../../ir/types.js";
import { pythonAstScriptPath } from "./packageRoot.js";

export type PythonAstImport = {
  moduleSpecifier: string;
  level: number;
  importedName: string;
};

export type PythonAstSymbol = {
  name: string;
  kind: string;
  filePath: string;
  signature: string;
  summary?: string | null;
  exported: boolean;
  language: "python";
};

export type PythonAstFileResult = {
  filePath: string;
  symbols: PythonAstSymbol[];
  imports: PythonAstImport[];
  error?: string;
};

export type PythonAstBatchResult = {
  repoRoot: string;
  files: PythonAstFileResult[];
};

function findPythonExecutable(): string | null {
  const candidates = process.platform === "win32" ? ["python", "py", "python3"] : ["python3", "python"];
  for (const cmd of candidates) {
    const probe = spawnSync(cmd, ["--version"], { encoding: "utf8" });
    if (probe.status === 0) return cmd;
  }
  return null;
}

export function parsePythonFilesWithAst(opts: {
  repoRoot: string;
  files: FileNode[];
  exportedOnly: boolean;
}): PythonAstBatchResult {
  const scriptPath = pythonAstScriptPath();
  if (!fs.existsSync(scriptPath)) {
    return { repoRoot: opts.repoRoot, files: [] };
  }

  const python = findPythonExecutable();
  if (!python) {
    return { repoRoot: opts.repoRoot, files: [] };
  }

  const payload = {
    repoRoot: opts.repoRoot,
    exportedOnly: opts.exportedOnly,
    files: opts.files.map((f) => ({ path: f.path, absolutePath: f.absolutePath }))
  };

  const run = spawnSync(python, [scriptPath], {
    input: JSON.stringify(payload),
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024
  });

  if (run.status !== 0 || !run.stdout) {
    return { repoRoot: opts.repoRoot, files: [] };
  }

  try {
    return JSON.parse(run.stdout) as PythonAstBatchResult;
  } catch {
    return { repoRoot: opts.repoRoot, files: [] };
  }
}
