import fs from "node:fs";
import path from "node:path";
import type { BlueprintConfig } from "../config/loadConfig.js";
import { buildArchitectureGraphFromIr } from "../engines/architectureGraph.js";
import { buildDomainArchitecture } from "../engines/domainIntelligence.js";
import { findCrossLanguageEquivalents } from "../engines/crossLanguage.js";
import type { ArchitectureIR } from "../ir/types.js";
import { classifyModulePath } from "../ir/modules.js";

export type BlueprintMemorySnapshot = {
  version: 1;
  generatedAt: string;
  repoRoot: string;
  adapters: string[];
  languages: Array<{ id: string; files: number; symbols: number }>;
  modules: Array<{ id: string; fileCount: number }>;
  topSymbols: Array<{ name: string; kind: string; filePath: string; language: string }>;
  importEdgeCount: number;
  dependencyFlows: Array<{ from: string; to: string }>;
  crossLanguageEquivalents: ReturnType<typeof findCrossLanguageEquivalents>;
  domainHealth: { score: number; risks: string[]; domains: string[] };
};

export function buildBlueprintMemorySnapshot(
  ir: ArchitectureIR,
  config: BlueprintConfig
): BlueprintMemorySnapshot {
  const graph = buildArchitectureGraphFromIr(ir, config);
  const domain = buildDomainArchitecture(ir, config);
  const langStats = new Map<string, { files: number; symbols: number }>();

  for (const file of ir.files) {
    const row = langStats.get(file.language) ?? { files: 0, symbols: 0 };
    row.files += 1;
    langStats.set(file.language, row);
  }
  for (const sym of ir.symbols) {
    const row = langStats.get(sym.language) ?? { files: 0, symbols: 0 };
    row.symbols += 1;
    langStats.set(sym.language, row);
  }

  const topSymbols = ir.symbols
    .filter((s) => s.exported)
    .slice(0, 50)
    .map((s) => ({ name: s.name, kind: s.kind, filePath: s.filePath, language: s.language }));

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    repoRoot: ir.repoRoot,
    adapters: ir.adapters,
    languages: [...langStats.entries()].map(([id, stats]) => ({ id, ...stats })),
    modules: ir.modules.length
      ? ir.modules
      : [...new Set(ir.files.map((f) => classifyModulePath(f.path, config)))].map((id) => ({
          id,
          fileCount: ir.files.filter((f) => classifyModulePath(f.path, config) === id).length
        })),
    topSymbols,
    importEdgeCount: ir.imports.length,
    dependencyFlows: graph.dependencyFlows,
    crossLanguageEquivalents: findCrossLanguageEquivalents(ir),
    domainHealth: {
      score: domain.health.score,
      risks: domain.health.risks,
      domains: domain.domains.map((d) => d.id)
    }
  };
}

export async function writeBlueprintMemorySnapshot(
  repoRoot: string,
  ir: ArchitectureIR,
  config: BlueprintConfig,
  outPath = "blueprint.memory.json"
) {
  const snapshot = buildBlueprintMemorySnapshot(ir, config);
  const abs = path.join(repoRoot, outPath);
  fs.writeFileSync(abs, JSON.stringify(snapshot, null, 2));
  return { path: abs, snapshot };
}
