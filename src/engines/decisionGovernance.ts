import { minimatch } from "minimatch";
import type { BlueprintConfig } from "../config/loadConfig.js";
import type { ArchitecturalDecision, DecisionCheckResult, DecisionMemory, DecisionViolation } from "../decisions/types.js";
import { inferDomainFromPath } from "../ir/domainInference.js";
import type { ArchitectureIR } from "../ir/types.js";

function globPatternsFromConstraint(text: string): string[] {
  const patterns: string[] = [];
  const quoted = text.match(/`([^`]+)`/g);
  if (quoted) patterns.push(...quoted.map((q) => q.replace(/`/g, "")));
  const globLike = text.match(/[a-z0-9_./-]+\*\*/gi);
  if (globLike) patterns.push(...globLike);
  if (text.includes("src/")) {
    const m = text.match(/src\/[a-z0-9_./-]+(?:\*\*)?/gi);
    if (m) patterns.push(...m);
  }
  if (!patterns.length && text.includes("/")) patterns.push(text.trim());
  return [...new Set(patterns)];
}

function pathMustLiveUnder(filePath: string, patterns: string[]): boolean {
  const norm = filePath.replaceAll("\\", "/");
  return patterns.some((p) => {
    const prefix = p.replace(/\*\*$/, "").replace(/\*$/, "");
    return minimatch(norm, p, { dot: true }) || norm.startsWith(prefix);
  });
}

function checkPlacementConstraints(
  ir: ArchitectureIR,
  adr: ArchitecturalDecision,
  violations: DecisionViolation[],
  warnings: DecisionViolation[]
) {
  for (const constraint of adr.constraints) {
    const lower = constraint.toLowerCase();
    if (!lower.includes("must") && !lower.includes("remain") && !lower.includes("under") && !lower.includes("only")) {
      continue;
    }
    const patterns = globPatternsFromConstraint(constraint);
    if (!patterns.length) continue;

    for (const file of ir.files) {
      const domain = inferDomainFromPath(file.path);
      const adrDomains = adr.domains;
      if (adrDomains.length && !adrDomains.includes(domain) && !adrDomains.includes("shared")) continue;

      const mentionsDomain = adrDomains.some((d) => constraint.toLowerCase().includes(d));
      if (!mentionsDomain && adrDomains.length) continue;

      if (!pathMustLiveUnder(file.path, patterns)) {
        const inDomainFolder = adrDomains.includes(domain);
        if (inDomainFolder || patterns.some((p) => file.path.includes(p.replace(/\*\*/g, "")))) continue;
        warnings.push({
          adrId: adr.id,
          rule: "constraint-placement",
          message: `${file.path} may violate ${adr.id}: ${constraint}`,
          path: file.path,
          severity: "medium"
        });
      }
    }
  }
}

function checkAvoidPatterns(
  ir: ArchitectureIR,
  adr: ArchitecturalDecision,
  violations: DecisionViolation[]
) {
  const avoidRules = [...adr.avoid, ...adr.rejectedPatterns];
  for (const rule of avoidRules) {
    const patterns = globPatternsFromConstraint(rule);
    const keywords = rule
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 4 && !["direct", "access", "from", "must", "should"].includes(w));

    for (const file of ir.files) {
      const hay = `${file.path} ${ir.symbols.filter((s) => s.filePath === file.path).map((s) => s.name).join(" ")}`.toLowerCase();
      const pathHit = patterns.length ? patterns.some((p) => minimatch(file.path, p, { dot: true })) : false;
      const keywordHit = keywords.some((k) => hay.includes(k));
      if (pathHit || keywordHit) {
        violations.push({
          adrId: adr.id,
          rule: "avoid-pattern",
          message: `${file.path} conflicts with ${adr.id} avoid/rejected: ${rule}`,
          path: file.path,
          severity: "high"
        });
      }
    }

    for (const edge of ir.imports) {
      const toPath = edge.toPath;
      if (!toPath) continue;
      const fromHay = edge.fromPath.toLowerCase();
      const toHay = toPath.toLowerCase();
      if (
        keywords.some((k) => fromHay.includes(k) || toHay.includes(k)) ||
        patterns.some((p) => minimatch(edge.fromPath, p, { dot: true }) || minimatch(toPath, p, { dot: true }))
      ) {
        violations.push({
          adrId: adr.id,
          rule: "avoid-import",
          message: `${edge.fromPath} imports ${edge.toPath} — violates ${adr.id}: ${rule}`,
          path: edge.fromPath,
          severity: "high"
        });
      }
    }
  }
}

function checkDomainOwnership(
  ir: ArchitectureIR,
  adr: ArchitecturalDecision,
  violations: DecisionViolation[]
) {
  for (const row of adr.domainOwnership) {
    for (const pattern of row.paths) {
      const patterns = globPatternsFromConstraint(pattern);
      for (const file of ir.files) {
        const domain = inferDomainFromPath(file.path);
        if (domain !== row.domain) continue;
        if (!pathMustLiveUnder(file.path, patterns.length ? patterns : [pattern])) {
          violations.push({
            adrId: adr.id,
            rule: "domain-ownership",
            message: `${file.path} is in ${row.domain} but outside owned paths (${pattern})`,
            path: file.path,
            severity: "high"
          });
        }
      }
    }
  }
}

function checkBoundaryIntent(
  ir: ArchitectureIR,
  adr: ArchitecturalDecision,
  violations: DecisionViolation[]
) {
  for (const intent of adr.boundaryIntent) {
    const lower = intent.toLowerCase();
    if (!lower.includes("import") && !lower.includes("access")) continue;
    const patterns = globPatternsFromConstraint(intent);
    for (const edge of ir.imports) {
      const toPath = edge.toPath;
      if (!toPath) continue;
      const hitsInternal = patterns.some((p) => minimatch(toPath, p, { dot: true })) || toPath.includes("/internal/");
      if (
        hitsInternal &&
        (lower.includes("must not") || lower.includes("cannot") || lower.includes("should not"))
      ) {
        violations.push({
          adrId: adr.id,
          rule: "boundary-intent",
          message: `${edge.fromPath} → ${edge.toPath} may violate ${adr.id} boundary: ${intent}`,
          path: edge.fromPath,
          severity: "high"
        });
      }
    }
  }
}

export function getEnforcedDecisions(memory: DecisionMemory): ArchitecturalDecision[] {
  return memory.decisions.filter((d) => d.status === "accepted");
}

export function getProposedDecisions(memory: DecisionMemory): ArchitecturalDecision[] {
  return memory.decisions.filter((d) => d.status === "proposed");
}

export function getActiveDecisionCount(memory: DecisionMemory): number {
  return getEnforcedDecisions(memory).length + getProposedDecisions(memory).length;
}

export function checkDecisionsAgainstRepo(
  ir: ArchitectureIR,
  _config: BlueprintConfig,
  memory: DecisionMemory
): DecisionCheckResult {
  const violations: DecisionViolation[] = [];
  const warnings: DecisionViolation[] = [];

  const enforcedDecisions = getEnforcedDecisions(memory);
  const proposedDecisions = getProposedDecisions(memory);

  for (const adr of enforcedDecisions) {
    checkPlacementConstraints(ir, adr, violations, warnings);
    checkAvoidPatterns(ir, adr, violations);
    checkDomainOwnership(ir, adr, violations);
    checkBoundaryIntent(ir, adr, violations);
  }

  return { enforcedDecisions, proposedDecisions, violations, warnings };
}

export function formatDecisionCheckOutput(result: DecisionCheckResult): string {
  const activeCount = result.enforcedDecisions.length + result.proposedDecisions.length;
  const lines = [
    "BLUEPRINT DECISION GOVERNANCE",
    "",
    `Active decisions: ${activeCount} (enforced: ${result.enforcedDecisions.length}, proposed: ${result.proposedDecisions.length})`,
    "",
    "Violations:",
    ...(result.violations.length
      ? result.violations.map((v) => `- [${v.severity}] ${v.adrId}: ${v.message}`)
      : ["- none"]),
    "",
    "Warnings:",
    ...(result.warnings.length
      ? result.warnings.map((v) => `- [${v.severity}] ${v.adrId}: ${v.message}`)
      : ["- none"])
  ];
  return lines.join("\n");
}

export function formatDecisionCheckMarkdown(result: DecisionCheckResult): string {
  const activeCount = result.enforcedDecisions.length + result.proposedDecisions.length;
  const lines = [
    "## ADR Check",
    "",
    `- Active decisions: ${activeCount}`,
    `- Enforced (accepted): ${result.enforcedDecisions.length}`,
    `- Proposed (informational): ${result.proposedDecisions.length}`,
    `- Violations: ${result.violations.length}`,
    `- Warnings: ${result.warnings.length}`,
    ""
  ];

  if (result.enforcedDecisions.length) {
    lines.push("### Accepted ADRs", "");
    for (const d of result.enforcedDecisions) {
      lines.push(`- **${d.id}** ${d.title}`);
    }
    lines.push("");
  }

  if (result.proposedDecisions.length) {
    lines.push("### Proposed ADRs (not enforced)", "");
    for (const d of result.proposedDecisions) {
      lines.push(`- ${d.id} ${d.title}`);
    }
    lines.push("");
  }

  lines.push("### Violations", "");
  if (!result.violations.length) lines.push("- none");
  else result.violations.forEach((v) => lines.push(`- [${v.severity}] ${v.adrId}: ${v.message}`));

  lines.push("", "### Warnings", "");
  if (!result.warnings.length) lines.push("- none");
  else result.warnings.forEach((v) => lines.push(`- [${v.severity}] ${v.adrId}: ${v.message}`));

  return lines.join("\n");
}

export function relevantDecisionsForContext(
  memory: DecisionMemory,
  opts: { filePath?: string; intent?: string; domain?: string }
): ArchitecturalDecision[] {
  const domain =
    opts.domain ??
    (opts.filePath ? inferDomainFromPath(opts.filePath) : null) ??
    null;

  const hits = new Set<ArchitecturalDecision>();
  if (domain && memory.byDomain.has(domain)) {
    for (const d of memory.byDomain.get(domain)!) hits.add(d);
  }
  if (memory.byDomain.has("_global")) {
    for (const d of memory.byDomain.get("_global")!) hits.add(d);
  }

  const intentLower = opts.intent?.toLowerCase() ?? "";
  for (const d of memory.decisions) {
    if (intentLower && d.title.toLowerCase().includes(intentLower.slice(0, 12))) hits.add(d);
    if (intentLower && d.domains.some((dom) => intentLower.includes(dom))) hits.add(d);
  }

  return [...hits].filter((d) => d.status === "accepted");
}

export function explainArchitecturalDecisions(
  memory: DecisionMemory,
  opts: { filePath?: string; intent?: string; domain?: string }
): string {
  const domain =
    opts.domain ?? (opts.filePath ? inferDomainFromPath(opts.filePath) : null) ?? null;
  const relevant = relevantDecisionsForContext(memory, opts);
  const proposed = getProposedDecisions(memory).filter((d) => {
    if (!domain) return true;
    return d.domains.includes(domain) || d.domains.length === 0;
  });

  const lines = ["BLUEPRINT ARCHITECTURAL DECISIONS", ""];

  if (opts.filePath || opts.intent || domain) {
    lines.push("Context:");
    if (opts.filePath) lines.push(`- path: ${opts.filePath}`);
    if (opts.intent) lines.push(`- intent: ${opts.intent}`);
    if (domain) lines.push(`- domain: ${domain}`);
    lines.push("");
  }

  if (!relevant.length && !proposed.length) {
    lines.push("No applicable ADRs found for this context.");
    lines.push("", "Record decisions with: blueprint adr new");
    return lines.filter(Boolean).join("\n");
  }

  if (relevant.length) {
    lines.push("Applicable ADRs (accepted — enforce governance):", "");
    for (const d of relevant) {
      lines.push(`### ${d.id}: ${d.title}`);
      lines.push(`**Decision:** ${d.decision.split("\n")[0]}`);
      if (d.constraints.length) lines.push(`**Constraints:** ${d.constraints.join("; ")}`);
      if (d.avoid.length) lines.push(`**Avoid:** ${d.avoid.join("; ")}`);
      if (d.chosenPatterns.length) lines.push(`**Chosen:** ${d.chosenPatterns.join("; ")}`);
      if (d.rejectedPatterns.length) lines.push(`**Rejected:** ${d.rejectedPatterns.join("; ")}`);
      lines.push("");
    }
  }

  if (proposed.length) {
    lines.push("Proposed ADRs (informational — not enforced until accepted):", "");
    for (const d of proposed.slice(0, 5)) {
      lines.push(`- ${d.id}: ${d.title} — ${d.decision.split("\n")[0]}`);
    }
  }

  return lines.filter(Boolean).join("\n");
}

export function decisionContinuityAdvisory(
  memory: DecisionMemory,
  opts: { filePath?: string; intent?: string; domain?: string }
): string | null {
  const relevant = relevantDecisionsForContext(memory, opts);
  if (!relevant.length) return null;

  const lines = [
    "BLUEPRINT DECISION MEMORY",
    "",
    "Prior architectural decisions apply:"
  ];
  for (const d of relevant.slice(0, 5)) {
    lines.push(`- ${d.id}: ${d.decision.split("\n")[0]}`);
    if (d.constraints[0]) lines.push(`  constraint: ${d.constraints[0]}`);
    if (d.avoid[0]) lines.push(`  avoid: ${d.avoid[0]}`);
  }
  lines.push("", "Preserve architectural continuity — do not contradict accepted ADRs.");
  return lines.join("\n");
}
