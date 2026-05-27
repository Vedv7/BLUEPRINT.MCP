import path from "node:path";
import { minimatch } from "minimatch";
import { diceCoefficient } from "../engine/stringSim.js";
import type { BlueprintConfig } from "../config/loadConfig.js";
import type { ArchitectureIR } from "../ir/types.js";
import { checkSpringLayerRules } from "./springCheck.js";

export type CheckFinding = {
  file: string;
  message: string;
  rule: string;
};

export type CheckWarning = {
  file: string;
  message: string;
};

export type CheckResult = {
  violations: CheckFinding[];
  warnings: CheckWarning[];
};

function normalize(p: string) {
  return p.replaceAll("\\", "/");
}

function stripExt(p: string) {
  return p.replace(/\.(ts|tsx|js|jsx|mjs|cjs|py|java)$/, "");
}

function checkForbiddenImports(ir: ArchitectureIR, config: BlueprintConfig): CheckFinding[] {
  const findings: CheckFinding[] = [];
  for (const edge of ir.imports) {
    if (!edge.toPath) continue;
    for (const rule of config.policies.forbiddenImports) {
      if (minimatch(edge.fromPath, rule.from, { nocase: true }) && minimatch(edge.toPath, rule.to, { nocase: true })) {
        findings.push({
          file: edge.fromPath,
          message: `${edge.fromPath} imports ${edge.toPath}`,
          rule: rule.message
        });
      }
    }
  }
  return findings;
}

function checkRequiredPlacement(ir: ArchitectureIR, config: BlueprintConfig): CheckFinding[] {
  const findings: CheckFinding[] = [];
  for (const file of ir.files) {
    const normalized = normalize(file.path);
    const basename = path.posix.basename(stripExt(normalized));
    for (const rule of config.policies.requiredPlacement) {
      const hit =
        minimatch(basename, rule.match, { nocase: true }) ||
        minimatch(normalized, rule.match, { nocase: true }) ||
        basename.toLowerCase().includes(rule.match.replace(/\*/g, "").toLowerCase());
      if (!hit) continue;
      const expectedPrefix = normalize(rule.path).replace(/\/$/, "") + "/";
      if (!normalized.startsWith(expectedPrefix)) {
        findings.push({
          file: normalized,
          message: `${normalized} should be under ${rule.path}`,
          rule: `requiredPlacement: ${rule.match} -> ${rule.path}`
        });
      }
    }
  }
  return findings;
}

function checkDuplicateLikeWarnings(ir: ArchitectureIR, config: BlueprintConfig): CheckWarning[] {
  if (config.strictness === "lenient") return [];
  const warnings: CheckWarning[] = [];
  const exportedFns = ir.symbols.filter((s) => s.exported && (s.kind === "function" || s.kind === "class_method"));
  const utils = exportedFns.filter((f) => f.filePath.startsWith("src/utils/"));
  const libs = exportedFns.filter((f) => f.filePath.startsWith("src/lib/"));

  for (const u of utils) {
    let best: (typeof exportedFns)[number] | null = null;
    let bestScore = 0;
    for (const l of libs) {
      const score = diceCoefficient(u.name, l.name);
      if (score > bestScore) {
        bestScore = score;
        best = l;
      }
    }
    const threshold = config.strictness === "strict" ? 0.4 : 0.55;
    if (best && bestScore >= threshold) {
      warnings.push({
        file: u.filePath,
        message: `${u.filePath} looks similar to ${best.filePath}`
      });
    }
  }
  return warnings;
}

export function runBlueprintCheckFromIr(ir: ArchitectureIR, config: BlueprintConfig): CheckResult {
  const spring = checkSpringLayerRules(ir, config);
  return {
    violations: [...checkForbiddenImports(ir, config), ...checkRequiredPlacement(ir, config), ...spring.violations],
    warnings: [...checkDuplicateLikeWarnings(ir, config), ...spring.warnings]
  };
}

export function formatCheckOutput(result: CheckResult, opts?: { format?: "text" | "markdown" }) {
  if (opts?.format === "markdown") {
    return formatCheckMarkdown(result);
  }

  const lines: string[] = ["BLUEPRINT CHECK", ""];
  lines.push("Violations:");
  if (!result.violations.length) lines.push("- none");
  else {
    result.violations.forEach((v, idx) => {
      lines.push(`${idx + 1}. ${v.message}`);
      lines.push(`   Rule: ${v.rule}`);
    });
  }
  lines.push("", "Warnings:");
  if (!result.warnings.length) lines.push("- none");
  else {
    result.warnings.forEach((w, idx) => lines.push(`${idx + 1}. ${w.message}`));
  }
  return lines.join("\n");
}

export function formatCheckMarkdown(result: CheckResult) {
  const lines: string[] = ["## Blueprint Check", ""];
  lines.push("### Violations");
  if (!result.violations.length) lines.push("- none");
  else {
    result.violations.forEach((v, idx) => {
      lines.push(`${idx + 1}. \`${v.message}\``);
      lines.push(`   - Rule: ${v.rule}`);
    });
  }
  lines.push("", "### Warnings");
  if (!result.warnings.length) lines.push("- none");
  else {
    result.warnings.forEach((w, idx) => lines.push(`${idx + 1}. ${w.message}`));
  }
  return lines.join("\n");
}
