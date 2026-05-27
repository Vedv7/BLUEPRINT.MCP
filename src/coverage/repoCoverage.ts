import path from "node:path";
import fs from "node:fs";
import { minimatch } from "minimatch";
import type { BlueprintConfig } from "../config/loadConfig.js";
import { JS_TS_EXTENSIONS, resolveTypeScriptIncludes, SKIP_WALK_DIRS } from "../adapters/typescript/globs.js";
import { PYTHON_EXTENSION, resolvePythonIncludes } from "../adapters/python/globs.js";
import { buildArchitectureIr } from "../ir/buildArchitectureIr.js";
import type { ArchitectureIR, ScriptDialect } from "../ir/types.js";
import { normalizePath } from "../adapters/typescript/resolveImport.js";

export type DetectedLanguage =
  | "typescript"
  | "javascript"
  | "python"
  | "java"
  | "go"
  | "rust"
  | "csharp";

export type LanguageCoverageLine = {
  id: DetectedLanguage;
  label: string;
  status: "supported" | "detected_unsupported";
  filesInRepo: number;
  filesParsed: number;
};

export type RepoCoverageReport = {
  languages: LanguageCoverageLine[];
  eligibleJsTsFiles: number;
  parsedJsTsFiles: number;
  eligiblePythonFiles: number;
  parsedPythonFiles: number;
  coverageRatio: number;
  ir: ArchitectureIR;
};

const EXT_TO_LANG: Array<{ ext: string; id: DetectedLanguage }> = [
  { ext: ".ts", id: "typescript" },
  { ext: ".tsx", id: "typescript" },
  { ext: ".js", id: "javascript" },
  { ext: ".jsx", id: "javascript" },
  { ext: ".mjs", id: "javascript" },
  { ext: ".cjs", id: "javascript" },
  { ext: ".py", id: "python" },
  { ext: ".java", id: "java" },
  { ext: ".go", id: "go" },
  { ext: ".rs", id: "rust" },
  { ext: ".cs", id: "csharp" }
];

function walkRepoFiles(repoRoot: string, rootRel: string): string[] {
  const rootAbs = path.resolve(repoRoot, rootRel);
  const acc: string[] = [];
  const stack = [rootAbs];
  while (stack.length) {
    const dir = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (SKIP_WALK_DIRS.has(entry.name)) continue;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(abs);
      else acc.push(normalizePath(path.relative(repoRoot, abs)));
    }
  }
  return acc;
}

function languageFromPath(filePath: string): DetectedLanguage | null {
  const ext = path.posix.extname(filePath).toLowerCase();
  return EXT_TO_LANG.find((x) => x.ext === ext)?.id ?? null;
}

function countByLanguage(paths: string[]) {
  const counts = new Map<DetectedLanguage, number>();
  for (const p of paths) {
    const lang = languageFromPath(p);
    if (!lang) continue;
    counts.set(lang, (counts.get(lang) ?? 0) + 1);
  }
  return counts;
}

function countParsedByDialect(files: ArchitectureIR["files"]) {
  const counts: Record<ScriptDialect, number> = { typescript: 0, javascript: 0 };
  for (const f of files) {
    if (f.dialect === "javascript") counts.javascript += 1;
    else if (f.dialect === "typescript") counts.typescript += 1;
  }
  return counts;
}

export function formatDoctorReport(coverage: RepoCoverageReport, opts: { configPresent: boolean; dbPresent: boolean; framework: string }) {
  const lines: string[] = ["Blueprint Doctor", ""];

  lines.push(`Framework: ${opts.framework}`);
  lines.push(`Config: ${opts.configPresent ? "present" : "missing"}`);
  lines.push(`Index DB: ${opts.dbPresent ? "present" : "missing"}`);
  lines.push("");
  lines.push("Languages detected:");

  for (const row of coverage.languages) {
    if (row.status === "supported") {
      lines.push(`- ${row.label}: supported, ${row.filesParsed} files parsed`);
    } else {
      lines.push(`- ${row.label}: detected, unsupported (${row.filesInRepo} files)`);
    }
  }

  const eligibleTotal = coverage.eligibleJsTsFiles + coverage.eligiblePythonFiles;
  const parsedTotal = coverage.parsedJsTsFiles + coverage.parsedPythonFiles;
  const pct = Math.round(coverage.coverageRatio * 100);
  lines.push("");
  lines.push(`Coverage: ${parsedTotal}/${eligibleTotal} source files parsed (${pct}%)`);
  lines.push(`  JS/TS: ${coverage.parsedJsTsFiles}/${coverage.eligibleJsTsFiles}`);
  lines.push(`  Python: ${coverage.parsedPythonFiles}/${coverage.eligiblePythonFiles}`);
  lines.push(`Symbols indexed: ${coverage.ir.symbols.length}`);
  lines.push(`Import edges: ${coverage.ir.imports.length}`);

  const mono = coverage.ir.modules.filter(
    (m) => m.id.startsWith("apps/") || m.id.startsWith("packages/") || m.id.startsWith("services/")
  );
  if (mono.length) {
    lines.push("");
    lines.push("Monorepo packages:");
    for (const pkg of mono) {
      lines.push(`- ${pkg.id}: ${pkg.fileCount} files`);
    }
  }

  return lines.join("\n");
}

export async function analyzeRepoCoverage(repoRoot: string, config: BlueprintConfig): Promise<RepoCoverageReport> {
  const allFiles = walkRepoFiles(repoRoot, config.root);
  const repoLangCounts = countByLanguage(allFiles);

  const tsInclude = resolveTypeScriptIncludes(config);
  const pyInclude = resolvePythonIncludes(config);

  const eligibleJsTs = allFiles.filter((p) => {
    const ext = path.posix.extname(p).toLowerCase();
    if (!JS_TS_EXTENSIONS.has(ext)) return false;
    return tsInclude.some((glob) => minimatch(p, glob, { dot: true, nocase: true }));
  });

  const eligiblePython = allFiles.filter((p) => {
    if (path.posix.extname(p).toLowerCase() !== PYTHON_EXTENSION) return false;
    return pyInclude.some((glob) => minimatch(p, glob, { dot: true, nocase: true }));
  });

  const shouldBuild = eligibleJsTs.length + eligiblePython.length > 0;
  const ir = shouldBuild
    ? await buildArchitectureIr(repoRoot, config)
    : {
        repoRoot,
        files: [],
        symbols: [],
        imports: [],
        modules: [],
        boundaries: [],
        adapters: [] as ArchitectureIR["adapters"]
      };

  const parsedByDialect = countParsedByDialect(ir.files);
  const parsedPythonFiles = ir.files.filter((f) => f.language === "python").length;
  const parsedJsTsFiles = ir.files.filter((f) => f.language === "typescript").length;

  const pythonEnabled = config.languages?.python?.enabled !== false;
  const languages: LanguageCoverageLine[] = [
    {
      id: "typescript",
      label: "TypeScript",
      status: "supported",
      filesInRepo: repoLangCounts.get("typescript") ?? 0,
      filesParsed: parsedByDialect.typescript
    },
    {
      id: "javascript",
      label: "JavaScript",
      status: "supported",
      filesInRepo: repoLangCounts.get("javascript") ?? 0,
      filesParsed: parsedByDialect.javascript
    },
    {
      id: "python",
      label: "Python",
      status: pythonEnabled ? "supported" : "detected_unsupported",
      filesInRepo: repoLangCounts.get("python") ?? 0,
      filesParsed: pythonEnabled ? parsedPythonFiles : 0
    },
    {
      id: "java",
      label: "Java",
      status: "detected_unsupported",
      filesInRepo: repoLangCounts.get("java") ?? 0,
      filesParsed: 0
    }
  ];

  for (const extra of ["go", "rust", "csharp"] as const) {
    const count = repoLangCounts.get(extra) ?? 0;
    if (count > 0) {
      languages.push({
        id: extra,
        label: extra === "go" ? "Go" : extra === "rust" ? "Rust" : "C#",
        status: "detected_unsupported",
        filesInRepo: count,
        filesParsed: 0
      });
    }
  }

  const eligibleJsTsFiles = eligibleJsTs.length;
  const eligiblePythonFiles = eligiblePython.length;
  const eligibleTotal = eligibleJsTsFiles + eligiblePythonFiles;
  const parsedTotal = parsedJsTsFiles + parsedPythonFiles;

  return {
    languages,
    eligibleJsTsFiles,
    parsedJsTsFiles,
    eligiblePythonFiles,
    parsedPythonFiles,
    coverageRatio: eligibleTotal ? parsedTotal / eligibleTotal : 1,
    ir
  };
}
