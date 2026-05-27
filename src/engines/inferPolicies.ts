import { minimatch } from "minimatch";
import type { BlueprintConfig } from "../config/loadConfig.js";
import type { ArchitectureIR } from "../ir/types.js";
import { classifyModulePath } from "../ir/modules.js";
import { classifyJavaSpringLayer, detectSpringProject, packageFromJavaPath } from "../ir/javaLayers.js";
import { DEFAULT_SPRING_FORBIDDEN } from "./springCheck.js";

export type InferredPolicies = {
  forbiddenImports: Array<{ from: string; to: string; message: string }>;
  requiredPlacement: Array<{ match: string; path: string }>;
  notes: string[];
};

function hasPathPrefix(files: string[], prefix: string) {
  return files.some((f) => f.startsWith(prefix));
}

export function inferPoliciesFromIr(ir: ArchitectureIR, config: BlueprintConfig): InferredPolicies {
  const suggestions: InferredPolicies["forbiddenImports"] = [];
  const notes: string[] = [];
  const filePaths = ir.files.map((f) => f.path);

  const componentToServer = ir.imports.filter(
    (e) => minimatch(e.fromPath, "src/components/**") && e.toPath && minimatch(e.toPath, "src/server/**")
  );
  if (componentToServer.length > 0) {
    suggestions.push({
      from: "src/components/**",
      to: "src/server/**",
      message: "Frontend components should not import server-only modules."
    });
  }

  const appToInternal = ir.imports.filter(
    (e) => minimatch(e.fromPath, "src/app/**") && e.toPath && minimatch(e.toPath, "src/lib/payments/internal**")
  );
  if (appToInternal.length > 0) {
    suggestions.push({
      from: "src/app/**",
      to: "src/lib/payments/internal**",
      message: "App layer should not import internal payment modules."
    });
  }

  if (hasPathPrefix(filePaths, "src/components/") && hasPathPrefix(filePaths, "src/server/")) {
    notes.push("Detected both src/components and src/server — component/server boundary rules are recommended.");
  }

  const placement: InferredPolicies["requiredPlacement"] = [];
  const hookFiles = ir.symbols.filter((s) => s.name.startsWith("use") && s.name.length > 3);
  const hooksOutside = hookFiles.filter((s) => !s.filePath.startsWith("src/hooks/"));
  if (hooksOutside.length > 0) {
    placement.push({ match: "use*", path: config.placementRules.hook ?? "src/hooks" });
    notes.push(`Found ${hooksOutside.length} hook-like symbol(s) outside ${config.placementRules.hook ?? "src/hooks"}.`);
  }

  const authFiles = ir.files.filter((f) => f.path.toLowerCase().includes("auth"));
  const authOutside = authFiles.filter((f) => !f.path.includes("/auth/"));
  if (authOutside.length > 0) {
    placement.push({ match: "*Auth*", path: "src/lib/auth" });
    notes.push(`Found ${authOutside.length} auth-related file(s) outside src/lib/auth.`);
  }

  const moduleIds = new Set(ir.files.map((f) => classifyModulePath(f.path, config)));
  if (moduleIds.size >= 3) {
    notes.push(`Detected modules: ${[...moduleIds].slice(0, 8).join(", ")}`);
  }

  if (detectSpringProject(filePaths)) {
    notes.push("Detected Spring-style Java layering (controller/service/repository).");
    for (const rule of DEFAULT_SPRING_FORBIDDEN) {
      suggestions.push(rule);
    }
    const repoToController = ir.imports.filter((e) => {
      if (!e.toPath) return false;
      return (
        classifyJavaSpringLayer(e.fromPath, packageFromJavaPath(e.fromPath)) === "repository" &&
        classifyJavaSpringLayer(e.toPath, packageFromJavaPath(e.toPath)) === "controller"
      );
    });
    if (repoToController.length) {
      notes.push(`${repoToController.length} repository → controller import(s) detected (forbidden).`);
    }
    const controllerToRepo = ir.imports.filter((e) => {
      if (!e.toPath) return false;
      return (
        classifyJavaSpringLayer(e.fromPath, packageFromJavaPath(e.fromPath)) === "controller" &&
        classifyJavaSpringLayer(e.toPath, packageFromJavaPath(e.toPath)) === "repository"
      );
    });
    if (controllerToRepo.length) {
      notes.push(`${controllerToRepo.length} controller → repository import(s) detected (use service layer).`);
    }
  }

  const hasFrontend = filePaths.some((p) => p.startsWith("frontend/") || p.startsWith("src/app/"));
  const hasBackend = filePaths.some((p) => p.endsWith(".java") || p.startsWith("backend/"));
  if (hasFrontend && hasBackend) {
    suggestions.push({
      from: "frontend/**",
      to: "backend/**",
      message: "Frontend must not import backend internals directly."
    });
    notes.push("Detected frontend + backend — cross-language boundary rule recommended.");
  }

  return {
    forbiddenImports: suggestions,
    requiredPlacement: placement,
    notes
  };
}

export function formatInferredPoliciesOutput(policies: InferredPolicies) {
  const lines: string[] = ["Blueprint Inferred Policies", ""];

  lines.push("Suggested forbiddenImports:");
  if (!policies.forbiddenImports.length) lines.push("- none");
  else {
    policies.forbiddenImports.forEach((rule, idx) => {
      lines.push(`${idx + 1}. from: ${rule.from}`);
      lines.push(`   to: ${rule.to}`);
      lines.push(`   message: ${rule.message}`);
    });
  }

  lines.push("", "Suggested requiredPlacement:");
  if (!policies.requiredPlacement.length) lines.push("- none");
  else {
    policies.requiredPlacement.forEach((rule, idx) => {
      lines.push(`${idx + 1}. match: ${rule.match}`);
      lines.push(`   path: ${rule.path}`);
    });
  }

  if (policies.notes.length) {
    lines.push("", "Notes:");
    policies.notes.forEach((n) => lines.push(`- ${n}`));
  }

  return lines.join("\n");
}
