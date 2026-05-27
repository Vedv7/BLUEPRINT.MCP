import type { BlueprintConfig } from "../config/loadConfig.js";
import type { ArchitectureIR } from "../ir/types.js";
import { classifyModulePath } from "../ir/modules.js";

export type BoundaryRisk = {
  message: string;
  fromPath: string;
  toPath: string;
  rule: string;
};

export type ArchitectureGraph = {
  modules: string[];
  dependencyFlows: Array<{ from: string; to: string }>;
  boundaryRisks: BoundaryRisk[];
  suggestedPolicies: string[];
  adapters: string[];
};

export function buildArchitectureGraphFromIr(ir: ArchitectureIR, config: BlueprintConfig): ArchitectureGraph {
  const modules = new Set<string>();
  const flows = new Set<string>();
  const boundaryRisks: BoundaryRisk[] = [];

  for (const file of ir.files) {
    modules.add(classifyModulePath(file.path, config));
  }

  for (const edge of ir.imports) {
    if (!edge.toPath) continue;
    const fromModule = classifyModulePath(edge.fromPath, config);
    const toModule = classifyModulePath(edge.toPath, config);
    modules.add(fromModule);
    modules.add(toModule);
    if (fromModule !== toModule) flows.add(`${fromModule} -> ${toModule}`);

    if (fromModule === "src/components" && toModule === "src/server") {
      boundaryRisks.push({
        message: `${edge.fromPath} imports ${edge.toPath}`,
        fromPath: edge.fromPath,
        toPath: edge.toPath,
        rule: "components should not import server"
      });
    }
    if (
      edge.fromPath.startsWith("src/app/") &&
      !edge.fromPath.startsWith("src/app/api/") &&
      edge.toPath.includes("/internal")
    ) {
      boundaryRisks.push({
        message: `${edge.fromPath} imports ${edge.toPath}`,
        fromPath: edge.fromPath,
        toPath: edge.toPath,
        rule: "app pages should not import internal modules"
      });
    }
  }

  const suggestedPolicies = new Set<string>();
  if (boundaryRisks.some((r) => r.rule === "components should not import server")) {
    suggestedPolicies.add("components should not import server");
  }
  if (boundaryRisks.some((r) => r.rule === "app pages should not import internal modules")) {
    suggestedPolicies.add("app pages should not import internal modules");
  }

  return {
    modules: [...modules].sort(),
    dependencyFlows: [...flows].sort().map((f) => {
      const [from, to] = f.split(" -> ");
      return { from, to };
    }),
    boundaryRisks,
    suggestedPolicies: [...suggestedPolicies],
    adapters: ir.adapters
  };
}

export function formatArchitectureGraphOutput(graph: ArchitectureGraph) {
  const lines: string[] = ["BLUEPRINT ARCHITECTURE GRAPH", ""];

  lines.push("Adapters:");
  if (!graph.adapters.length) lines.push("- none");
  else graph.adapters.forEach((a) => lines.push(`- ${a}`));

  lines.push("", "Modules:");
  if (!graph.modules.length) lines.push("- none");
  else graph.modules.forEach((m) => lines.push(`- ${m}`));

  lines.push("", "Dependency flows:");
  if (!graph.dependencyFlows.length) lines.push("- none");
  else graph.dependencyFlows.forEach((f) => lines.push(`- ${f.from} -> ${f.to}`));

  lines.push("", "Boundary risks:");
  if (!graph.boundaryRisks.length) lines.push("- none");
  else graph.boundaryRisks.forEach((r) => lines.push(`- ${r.message}`));

  lines.push("", "Suggested policies:");
  if (!graph.suggestedPolicies.length) lines.push("- none");
  else graph.suggestedPolicies.forEach((p) => lines.push(`- ${p}`));

  return lines.join("\n");
}
