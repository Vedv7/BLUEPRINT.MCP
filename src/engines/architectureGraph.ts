import type { BlueprintConfig } from "../config/loadConfig.js";
import type { ArchitectureIR } from "../ir/types.js";
import { classifyModulePath } from "../ir/modules.js";
import { classifyJavaSpringLayer, detectSpringProject, packageFromJavaPath } from "../ir/javaLayers.js";

export type BoundaryRisk = {
  message: string;
  fromPath: string;
  toPath: string;
  rule: string;
  severity: "high" | "medium" | "low";
};

function classifyTopLevelArea(filePath: string): string | null {
  const p = filePath.replaceAll("\\", "/");
  if (p.startsWith("frontend/") || p.includes("/frontend/") || p.startsWith("src/app/") || p.startsWith("src/components/")) {
    return "frontend";
  }
  if (p.startsWith("ml-service/") || p.includes("/ml-service/")) return "ml-service";
  if (p.endsWith(".java") || p.includes("src/main/java") || p.startsWith("backend/")) return "backend";
  return null;
}

function isLenient(config: BlueprintConfig) {
  return config.strictness === "lenient";
}

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
        rule: "components should not import server",
        severity: "high"
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
        rule: "app pages should not import internal modules",
        severity: "high"
      });
    }

    if (edge.language === "java") {
      const fromLayer = classifyJavaSpringLayer(edge.fromPath, packageFromJavaPath(edge.fromPath));
      const toLayer = classifyJavaSpringLayer(edge.toPath, packageFromJavaPath(edge.toPath));
      if (fromLayer === "controller" && toLayer === "service") {
        flows.add("java/controller -> java/service");
      }
      if (fromLayer === "service" && toLayer === "repository") {
        flows.add("java/service -> java/repository");
      }
      if (fromLayer === "repository" && toLayer === "controller") {
        boundaryRisks.push({
          message: `${edge.fromPath} imports ${edge.toPath}`,
          fromPath: edge.fromPath,
          toPath: edge.toPath,
          rule: "repository must not import controller",
          severity: "high"
        });
      }
      if (
        !isLenient(config) &&
        fromLayer === "controller" &&
        toLayer === "repository"
      ) {
        boundaryRisks.push({
          message: `${edge.fromPath} imports ${edge.toPath}`,
          fromPath: edge.fromPath,
          toPath: edge.toPath,
          rule: "controller should use service, not repository directly",
          severity: config.strictness === "strict" ? "high" : "medium"
        });
      }
    }

    const fromTop = classifyTopLevelArea(edge.fromPath);
    const toTop = classifyTopLevelArea(edge.toPath);
    if (fromTop && toTop && fromTop !== toTop) {
      flows.add(`${fromTop} -> ${toTop}`);
    }
  }

  const suggestedPolicies = new Set<string>();
  if (boundaryRisks.some((r) => r.rule === "components should not import server")) {
    suggestedPolicies.add("components should not import server");
  }
  if (boundaryRisks.some((r) => r.rule === "app pages should not import internal modules")) {
    suggestedPolicies.add("app pages should not import internal modules");
  }
  if (detectSpringProject(ir.files.map((f) => f.path))) {
    suggestedPolicies.add("controller → service → repository layering");
    if (boundaryRisks.some((r) => r.rule.includes("repository must not"))) {
      suggestedPolicies.add("repository must not import controller");
    }
    if (boundaryRisks.some((r) => r.rule.includes("controller should use service"))) {
      suggestedPolicies.add("controller should not import repository directly");
    }
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
  else graph.modules.slice(0, 24).forEach((m) => lines.push(`- ${m}`));
  if (graph.modules.length > 24) lines.push(`- … and ${graph.modules.length - 24} more`);

  lines.push("", "Dependency flows:");
  if (!graph.dependencyFlows.length) lines.push("- none");
  else graph.dependencyFlows.slice(0, 20).forEach((f) => lines.push(`- ${f.from} -> ${f.to}`));
  if (graph.dependencyFlows.length > 20) lines.push(`- … and ${graph.dependencyFlows.length - 20} more`);

  lines.push("", "Boundary risks:");
  const risks = graph.boundaryRisks.filter((r) => r.severity !== "low");
  if (!risks.length) lines.push("- none");
  else risks.slice(0, 15).forEach((r) => lines.push(`- [${r.severity}] ${r.message}`));
  if (risks.length > 15) lines.push(`- … and ${risks.length - 15} more`);

  lines.push("", "Suggested policies:");
  if (!graph.suggestedPolicies.length) lines.push("- none");
  else graph.suggestedPolicies.forEach((p) => lines.push(`- ${p}`));

  return lines.join("\n");
}
