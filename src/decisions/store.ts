import fs from "node:fs";
import path from "node:path";
import { parseAdrMarkdown } from "./parseAdr.js";
import { adrFileName, decisionsDirAbs, ensureDecisionsDir, nextAdrNumber } from "./paths.js";
import { renderAdrMarkdown, type NewAdrInput } from "./template.js";
import type { ArchitecturalDecision, DecisionMemory } from "./types.js";

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48) || "decision";
}

export function loadArchitecturalDecisions(repoRoot: string): ArchitecturalDecision[] {
  const dir = decisionsDirAbs(repoRoot);
  if (!fs.existsSync(dir)) return [];

  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .sort()
    .map((file) => {
      const abs = path.join(dir, file);
      const content = fs.readFileSync(abs, "utf8");
      return parseAdrMarkdown(file, content);
    });
}

export function buildDecisionMemory(repoRoot: string): DecisionMemory {
  const decisions = loadArchitecturalDecisions(repoRoot);
  const byDomain = new Map<string, ArchitecturalDecision[]>();
  const byId = new Map<string, ArchitecturalDecision>();

  for (const d of decisions) {
    byId.set(d.id, d);
    const domains = d.domains.length ? d.domains : ["_global"];
    for (const domain of domains) {
      const list = byDomain.get(domain) ?? [];
      list.push(d);
      byDomain.set(domain, list);
    }
  }

  return { decisionsDir: decisionsDirAbs(repoRoot), decisions, byDomain, byId };
}

export function createArchitecturalDecision(
  repoRoot: string,
  input: Omit<NewAdrInput, "id" | "slug"> & { slug?: string }
): { path: string; decision: ArchitecturalDecision } {
  const dir = ensureDecisionsDir(repoRoot);
  const num = nextAdrNumber(repoRoot);
  const id = `ADR-${String(num).padStart(3, "0")}`;
  const slug = input.slug ?? slugify(input.title);
  const fileName = adrFileName(id, slug);
  const abs = path.join(dir, fileName);

  const body = renderAdrMarkdown({ ...input, id, slug });
  fs.writeFileSync(abs, body, "utf8");
  const decision = parseAdrMarkdown(fileName, body);
  return { path: abs, decision };
}

export function formatDecisionList(decisions: ArchitecturalDecision[]): string {
  if (!decisions.length) {
    return "No architectural decisions recorded. Run: blueprint adr new --title \"…\"";
  }
  const lines = ["BLUEPRINT ARCHITECTURAL DECISIONS", ""];
  for (const d of decisions) {
    lines.push(`- ${d.id} [${d.status}] ${d.title}`);
    lines.push(`  ${d.decision.split("\n")[0]?.slice(0, 100) ?? ""}`);
    if (d.domains.length) lines.push(`  domains: ${d.domains.join(", ")}`);
  }
  return lines.join("\n");
}

export function formatDecisionDetail(d: ArchitecturalDecision): string {
  return [
    `BLUEPRINT ADR: ${d.id}`,
    `Status: ${d.status} · Date: ${d.date}`,
    "",
    "## Decision",
    d.decision,
    d.rationale ? `\n## Rationale\n${d.rationale}` : "",
    d.constraints.length ? `\n## Constraints\n${d.constraints.map((c) => `- ${c}`).join("\n")}` : "",
    d.chosenPatterns.length ? `\n## Chosen patterns\n${d.chosenPatterns.map((c) => `- ${c}`).join("\n")}` : "",
    d.rejectedPatterns.length ? `\n## Rejected patterns\n${d.rejectedPatterns.map((c) => `- ${c}`).join("\n")}` : "",
    d.avoid.length ? `\n## Avoid\n${d.avoid.map((c) => `- ${c}`).join("\n")}` : "",
    d.domainOwnership.length
      ? `\n## Domain ownership\n${d.domainOwnership.map((o) => `- ${o.domain}: ${o.paths.join(", ")}`).join("\n")}`
      : "",
    d.boundaryIntent.length ? `\n## Boundary intent\n${d.boundaryIntent.map((c) => `- ${c}`).join("\n")}` : ""
  ]
    .filter(Boolean)
    .join("\n");
}
