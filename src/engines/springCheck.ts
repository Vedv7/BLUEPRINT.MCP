import type { BlueprintConfig } from "../config/loadConfig.js";
import type { ArchitectureIR } from "../ir/types.js";
import { classifyJavaSpringLayer, detectSpringProject, packageFromJavaPath } from "../ir/javaLayers.js";
import type { CheckFinding, CheckWarning } from "./architectureCheck.js";

export function checkSpringLayerRules(
  ir: ArchitectureIR,
  config: BlueprintConfig
): {
  violations: CheckFinding[];
  warnings: CheckWarning[];
} {
  const violations: CheckFinding[] = [];
  const warnings: CheckWarning[] = [];

  const filePaths = ir.files.map((f) => f.path);
  if (!detectSpringProject([...filePaths, ...ir.imports.map((e) => e.moduleSpecifier)])) {
    return { violations, warnings };
  }

  for (const edge of ir.imports) {
    if (!edge.toPath || edge.language !== "java") continue;
    const fromPkg = packageFromJavaPath(edge.fromPath);
    const toPkg = packageFromJavaPath(edge.toPath);
    const fromLayer = classifyJavaSpringLayer(edge.fromPath, fromPkg);
    const toLayer = classifyJavaSpringLayer(edge.toPath, toPkg);
    if (fromLayer === "unknown" || toLayer === "unknown") continue;

    if (fromLayer === "repository" && toLayer === "controller") {
      violations.push({
        file: edge.fromPath,
        message: `${edge.fromPath} imports ${edge.toPath}`,
        rule: "repository must not depend on controller (Spring layering)"
      });
    }
    if (
      config.strictness !== "lenient" &&
      fromLayer === "controller" &&
      toLayer === "repository"
    ) {
      warnings.push({
        file: edge.fromPath,
        message: `${edge.fromPath} imports ${edge.toPath} (controller should use service, not repository directly)`
      });
    }
  }

  return { violations, warnings };
}

export const DEFAULT_SPRING_FORBIDDEN = [
  {
    from: "**/repository/**",
    to: "**/controller/**",
    message: "Repository layer must not import controller layer."
  },
  {
    from: "**/service/**",
    to: "**/controller/**",
    message: "Service layer must not import controller layer."
  }
];
