import type { DecisionMemory } from "../decisions/types.js";
import { inferDomainFromPath } from "../ir/domainInference.js";
import type { ArchitectureIR, SymbolNode } from "../ir/types.js";

export type AdrSuggestion = {
  title: string;
  decision: string;
  rationale: string;
  constraints: string[];
  avoid: string[];
  chosenPatterns: string[];
  domains: string[];
  evidence: string[];
};

type PatternRule = {
  id: string;
  domain: string;
  tokens: string[];
  title: string;
  decisionTemplate: (canonicalPath: string, count: number) => string;
};

const PATTERN_RULES: PatternRule[] = [
  {
    id: "currency",
    domain: "payments",
    tokens: ["currency", "money", "payment", "amount", "format", "invoice"],
    title: "Standardize currency formatting",
    decisionTemplate: (path, count) =>
      `Standardize currency formatting through ${path} (${count} currency-like helpers detected).`
  },
  {
    id: "auth",
    domain: "auth",
    tokens: ["auth", "session", "token", "login", "jwt", "identity"],
    title: "Centralize authentication",
    decisionTemplate: (path, count) =>
      `Centralize authentication logic under ${path} (${count} auth-related symbols detected).`
  },
  {
    id: "validation",
    domain: "shared",
    tokens: ["validate", "validator", "validation"],
    title: "Consolidate validation logic",
    decisionTemplate: (path, count) =>
      `Consolidate validation through shared modules under ${path} (${count} validators detected).`
  }
];

function symbolMatchesRule(sym: SymbolNode, rule: PatternRule): boolean {
  const hay = `${sym.name} ${sym.filePath}`.toLowerCase();
  return rule.tokens.some((t) => hay.includes(t));
}

function canonicalPathForCluster(symbols: SymbolNode[]): string {
  const libPaths = symbols.map((s) => s.filePath).filter((p) => p.includes("/lib/"));
  if (libPaths.length) {
    const counts = new Map<string, number>();
    for (const p of libPaths) {
      const dir = p.replace(/\/[^/]+$/, "");
      counts.set(dir, (counts.get(dir) ?? 0) + 1);
    }
    const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    if (best) return `${best}/**`;
  }
  const first = symbols[0]?.filePath ?? "src/lib/";
  const dir = first.replace(/\/[^/]+$/, "");
  return `${dir}/**`;
}

function existingAdrCovers(memory: DecisionMemory, rule: PatternRule): boolean {
  return memory.decisions.some(
    (d) =>
      (d.status === "accepted" || d.status === "proposed") &&
      (d.domains.includes(rule.domain) ||
        d.title.toLowerCase().includes(rule.id) ||
        d.decision.toLowerCase().includes(rule.id))
  );
}

export function suggestAdrs(ir: ArchitectureIR, memory: DecisionMemory): AdrSuggestion[] {
  const suggestions: AdrSuggestion[] = [];
  const minCluster = 3;

  for (const rule of PATTERN_RULES) {
    if (existingAdrCovers(memory, rule)) continue;

    const cluster = ir.symbols.filter((s) => symbolMatchesRule(s, rule));
    if (cluster.length < minCluster) continue;

    const canonical = canonicalPathForCluster(cluster);
    const domains = [...new Set(cluster.map((s) => inferDomainFromPath(s.filePath)))].filter(
      (d) => d !== "shared"
    );

    suggestions.push({
      title: rule.title,
      decision: rule.decisionTemplate(canonical, cluster.length),
      rationale: `${cluster.length} ${rule.id}-like helpers detected across the repository.`,
      constraints: [`${rule.id} helpers must live under ${canonical}`],
      avoid: [`Duplicate ${rule.id} helpers outside ${canonical}`],
      chosenPatterns: [...new Set(cluster.slice(0, 3).map((s) => `${s.filePath} → ${s.name}()`))],
      domains: domains.length ? domains : [rule.domain],
      evidence: cluster.slice(0, 8).map((s) => `${s.name} (${s.filePath})`)
    });
  }

  return suggestions;
}

export function formatAdrSuggestionsOutput(suggestions: AdrSuggestion[]): string {
  if (!suggestions.length) {
    return "BLUEPRINT ADR SUGGESTIONS\n\nNo new ADR suggestions — patterns are covered or below threshold.";
  }
  const lines = ["BLUEPRINT ADR SUGGESTIONS", ""];
  for (const s of suggestions) {
    lines.push(`Suggested ADR: ${s.title}`);
    lines.push(`Decision: ${s.decision}`);
    lines.push(`Reason: ${s.rationale}`);
    if (s.evidence.length) {
      lines.push("Evidence:");
      s.evidence.forEach((e) => lines.push(`- ${e}`));
    }
    lines.push("");
  }
  lines.push("Record with: blueprint adr new -t \"…\" -d \"…\"");
  return lines.join("\n");
}
