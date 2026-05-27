import type { ConfidenceLevel } from "../engine/duplicateDetector.js";
import type { PlacementResult } from "../engine/placementEngine.js";
import { domainAdvisoryText } from "../engines/domainIntelligence.js";

function toLabel(risk: ConfidenceLevel | "none") {
  return risk === "none" ? "NONE" : risk.toUpperCase();
}

export function advisoryTextForAbstraction(result: {
  file?: string;
  symbol?: string;
  suggestedImport?: string;
  confidence: ConfidenceLevel | "none";
  action: string;
  reasons?: string[];
  explanation?: string;
}) {
  const existing =
    result.file && result.symbol ? `${result.file} -> ${result.symbol}()` : "No strong existing abstraction match.";
  const importLine = result.suggestedImport ?? "No import suggestion.";
  const lines = [
    "BLUEPRINT ADVISORY",
    "",
    "Existing abstraction found:",
    existing,
    "",
    "Suggested import:",
    importLine,
    "",
    `Confidence: ${toLabel(result.confidence)}`,
    `Action: ${result.action}`
  ];
  if (result.reasons?.length) {
    lines.push("", "Reasons:");
    result.reasons.forEach((r) => lines.push(`- ${r}`));
  }
  if (result.explanation) {
    lines.push("", result.explanation);
  }
  return lines.join("\n");
}

export function placementTextForAdvisory(placement: PlacementResult) {
  return [
    "BLUEPRINT ADVISORY",
    "",
    "Placement guidance:",
    placement.ok ? "Current path matches repository conventions." : `Suggested path: ${placement.suggestedPath}`,
    "",
    `Reason: ${placement.reason ?? "No issue detected."}`,
    `Action: ${placement.ok ? "Keep current path." : "Use suggested path."}`
  ].join("\n");
}

export function composeAgentAdvisoryText(blocks: Array<string | null | undefined>) {
  return blocks.filter(Boolean).join("\n\n");
}

export { domainAdvisoryText };

export function advisoryDecision(opts: {
  enforcementMode: "advisory" | "enforce";
  duplicateRisk: ConfidenceLevel;
  placementOk: boolean;
}) {
  const severity: "low" | "medium" | "high" =
    opts.duplicateRisk === "high" || !opts.placementOk
      ? "high"
      : opts.duplicateRisk === "medium"
        ? "medium"
        : "low";
  if (opts.enforcementMode === "enforce" && severity === "high") {
    return { decision: "BLOCKED" as const, mode: "enforce" as const, severity };
  }
  if (severity === "low") {
    return { decision: "ALLOW" as const, mode: opts.enforcementMode, severity };
  }
  return { decision: "ADVISORY" as const, mode: opts.enforcementMode, severity };
}
