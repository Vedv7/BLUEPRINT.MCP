import type { BlueprintConfig } from "../config/loadConfig.js";
import {
  BUILTIN_DOMAIN_CATALOG,
  classifyDomainLayer,
  domainMatchesGlob,
  inferDomainFromIntent,
  inferDomainFromPath,
  layerRank,
  symbolSuggestsDomain
} from "../ir/domainInference.js";
import { classifyModulePath } from "../ir/modules.js";
import type { ArchitectureIR, SymbolNode } from "../ir/types.js";
import type {
  DomainArchitecture,
  DomainDriftFinding,
  DomainHealthScore,
  DomainLayer,
  DomainNode,
  DomainViolation,
  OwnershipEdge,
  OwnershipNode
} from "../ir/domainTypes.js";

const DEFAULT_FORBIDDEN_CROSS_DOMAIN: Array<{
  from: string;
  to: string;
  message: string;
  severity: "high" | "medium" | "low";
}> = [
  {
    from: "analytics",
    to: "auth",
    message: "Analytics should not import auth internals directly.",
    severity: "high"
  },
  {
    from: "notifications",
    to: "payments",
    message: "Notifications should not reach into payment persistence layers.",
    severity: "medium"
  },
  {
    from: "*",
    to: "payments",
    message: "Avoid importing payment internal/repository modules from other domains.",
    severity: "high"
  }
];

const SENSITIVE_PATH_MARKERS = ["/internal", "/repository", "/dao", "/schema", "validator"];

function symbolsForFile(symbols: SymbolNode[], filePath: string): string[] {
  return symbols.filter((s) => s.filePath === filePath).map((s) => s.name);
}

function buildDomainNodes(
  ir: ArchitectureIR,
  config: BlueprintConfig,
  fileDomains: Map<string, string>
): DomainNode[] {
  const byDomain = new Map<string, { files: Set<string>; modules: Set<string>; layers: Set<DomainLayer> }>();

  for (const file of ir.files) {
    const domain = fileDomains.get(file.path) ?? "shared";
    const row = byDomain.get(domain) ?? { files: new Set(), modules: new Set(), layers: new Set() };
    row.files.add(file.path);
    row.modules.add(classifyModulePath(file.path, config));
    row.layers.add(classifyDomainLayer(file.path));
    byDomain.set(domain, row);
  }

  return [...byDomain.entries()]
    .map(([id, row]) => ({
      id,
      fileCount: row.files.size,
      modules: [...row.modules].sort(),
      layers: [...row.layers].sort()
    }))
    .sort((a, b) => b.fileCount - a.fileCount || a.id.localeCompare(b.id));
}

function buildOwnershipNodes(
  ir: ArchitectureIR,
  fileDomains: Map<string, string>
): OwnershipNode[] {
  return ir.files
    .map((file) => ({
      domain: fileDomains.get(file.path) ?? "shared",
      layer: classifyDomainLayer(file.path),
      filePath: file.path,
      symbols: symbolsForFile(ir.symbols, file.path)
    }))
    .filter((n) => n.domain !== "shared" || n.layer !== "unknown")
    .sort((a, b) => a.domain.localeCompare(b.domain) || layerRank(a.layer) - layerRank(b.layer));
}

function buildOwnershipEdges(
  ir: ArchitectureIR,
  fileDomains: Map<string, string>,
  config: BlueprintConfig
): OwnershipEdge[] {
  const edges: OwnershipEdge[] = [];
  const seen = new Set<string>();

  for (const imp of ir.imports) {
    if (!imp.toPath) continue;
    const fromDomain = domainForPath(imp.fromPath, fileDomains, config);
    const toDomain = domainForPath(imp.toPath, fileDomains, config);
    if (fromDomain !== toDomain || fromDomain === "shared") continue;

    const fromLayer = classifyDomainLayer(imp.fromPath);
    const toLayer = classifyDomainLayer(imp.toPath);
    const key = `${fromDomain}|${imp.fromPath}|${imp.toPath}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push({
      domain: fromDomain,
      from: imp.fromPath,
      to: imp.toPath,
      fromLayer,
      toLayer,
      kind: "import"
    });
  }

  const byDomainLayer = new Map<string, OwnershipNode[]>();
  for (const file of ir.files) {
    const domain = fileDomains.get(file.path) ?? "shared";
    if (domain === "shared") continue;
    const layer = classifyDomainLayer(file.path);
    const list = byDomainLayer.get(domain) ?? [];
    list.push({
      domain,
      layer,
      filePath: file.path,
      symbols: symbolsForFile(ir.symbols, file.path)
    });
    byDomainLayer.set(domain, list);
  }

  for (const [domain, nodes] of byDomainLayer) {
    const sorted = [...nodes].sort((a, b) => layerRank(a.layer) - layerRank(b.layer));
    for (let i = 0; i < sorted.length - 1; i++) {
      const a = sorted[i]!;
      const b = sorted[i + 1]!;
      if (layerRank(a.layer) < layerRank(b.layer)) {
        const key = `stack|${domain}|${a.filePath}|${b.filePath}`;
        if (!seen.has(key)) {
          seen.add(key);
          edges.push({
            domain,
            from: a.filePath,
            to: b.filePath,
            fromLayer: a.layer,
            toLayer: b.layer,
            kind: "stack"
          });
        }
      }
    }
  }

  return edges;
}

function checkCrossDomainViolations(
  ir: ArchitectureIR,
  fileDomains: Map<string, string>,
  config: BlueprintConfig
): DomainViolation[] {
  const violations: DomainViolation[] = [];
  const rules = [
    ...DEFAULT_FORBIDDEN_CROSS_DOMAIN,
    ...(config.domains?.forbiddenCrossDomain ?? []).map((r) => ({
      ...r,
      severity: "high" as const
    }))
  ];

  for (const imp of ir.imports) {
    if (!imp.toPath) continue;
    const fromDomain = domainForPath(imp.fromPath, fileDomains, config);
    const toDomain = domainForPath(imp.toPath, fileDomains, config);
    if (fromDomain === toDomain || fromDomain === "shared" || toDomain === "shared") continue;

    const toNorm = imp.toPath.replaceAll("\\", "/").toLowerCase();
    const sensitive = SENSITIVE_PATH_MARKERS.some((m) => toNorm.includes(m));

    for (const rule of rules) {
      const fromMatch = rule.from === "*" || domainMatchesGlob(fromDomain, rule.from);
      const toMatch = domainMatchesGlob(toDomain, rule.to);
      if (!fromMatch || !toMatch) continue;
      if (rule.from === "*" && rule.to === "payments" && !sensitive) continue;

      violations.push({
        message: `${imp.fromPath} (${fromDomain}) imports ${imp.toPath} (${toDomain}): ${rule.message}`,
        fromPath: imp.fromPath,
        toPath: imp.toPath,
        fromDomain,
        toDomain,
        rule: `cross-domain:${rule.from}->${rule.to}`,
        severity: rule.severity
      });
      break;
    }

    for (const flow of config.modules?.flows ?? config.domains?.flows ?? []) {
      if (flow.allowed === false && domainMatchesGlob(fromDomain, flow.from) && domainMatchesGlob(toDomain, flow.to)) {
        violations.push({
          message: `${imp.fromPath} (${fromDomain}) imports ${imp.toPath} (${toDomain}): flow not allowed`,
          fromPath: imp.fromPath,
          toPath: imp.toPath,
          fromDomain,
          toDomain,
          rule: `flow:${flow.from}->${flow.to}`,
          severity: "high"
        });
      }
    }
  }

  return violations;
}

function checkLayerViolations(
  ir: ArchitectureIR,
  fileDomains: Map<string, string>,
  config: BlueprintConfig
): DomainViolation[] {
  if (config.domains?.enforceLayerStack === false) return [];
  const violations: DomainViolation[] = [];

  for (const imp of ir.imports) {
    if (!imp.toPath) continue;
    const domain = domainForPath(imp.fromPath, fileDomains, config);
    const toDomain = domainForPath(imp.toPath, fileDomains, config);
    if (domain !== toDomain || domain === "shared") continue;

    const fromLayer = classifyDomainLayer(imp.fromPath);
    const toLayer = classifyDomainLayer(imp.toPath);
    if (fromLayer === "unknown" || toLayer === "unknown") continue;
    if (layerRank(fromLayer) > layerRank(toLayer)) {
      violations.push({
        message: `${imp.fromPath} (${fromLayer}) imports lower layer ${imp.toPath} (${toLayer}) in ${domain}`,
        fromPath: imp.fromPath,
        toPath: imp.toPath,
        fromDomain: domain,
        toDomain: domain,
        rule: "domain-layer-stack",
        severity: "medium"
      });
    }
  }
  return violations;
}

function detectDrift(
  ir: ArchitectureIR,
  fileDomains: Map<string, string>
): DomainDriftFinding[] {
  const drift: DomainDriftFinding[] = [];

  const authTokens = BUILTIN_DOMAIN_CATALOG.find((d) => d.id === "auth")?.tokens ?? [];
  for (const file of ir.files) {
    const domain = fileDomains.get(file.path) ?? "shared";
    if (domain === "auth") continue;
    const hay = file.path.toLowerCase();
    if (authTokens.some((t) => hay.includes(t) && !hay.includes("/shared/"))) {
      drift.push({
        kind: "cross_domain_spread",
        message: `Auth-related path segment in ${domain} domain: ${file.path}`,
        domain,
        paths: [file.path],
        severity: domain === "notifications" || domain === "analytics" ? "high" : "medium"
      });
    }
  }

  const validatorSymbols = ir.symbols.filter((s) => /validate|validator|validation/i.test(s.name));
  const byDomain = new Map<string, string[]>();
  for (const sym of validatorSymbols) {
    const d = fileDomains.get(sym.filePath) ?? "shared";
    const list = byDomain.get(d) ?? [];
    list.push(sym.name);
    byDomain.set(d, list);
  }
  if (byDomain.size >= 3) {
    drift.push({
      kind: "duplicate_pattern",
      message: `Validation logic duplicated across ${byDomain.size} domains`,
      domain: "cross-cutting",
      paths: validatorSymbols.map((s) => s.filePath),
      severity: "medium"
    });
  }

  for (const sym of ir.symbols) {
    const pathDomain = fileDomains.get(sym.filePath) ?? "shared";
    const symbolDomain = symbolSuggestsDomain(sym.name);
    if (symbolDomain && symbolDomain !== pathDomain && pathDomain !== "shared") {
      drift.push({
        kind: "layer_bleed",
        message: `${sym.name} suggests ${symbolDomain} but file is under ${pathDomain}: ${sym.filePath}`,
        domain: pathDomain,
        paths: [sym.filePath],
        severity: "low"
      });
    }
  }

  return drift;
}

function computeHealth(violations: DomainViolation[], drift: DomainDriftFinding[]): DomainHealthScore {
  let score = 100;
  const risks: string[] = [];

  for (const v of violations) {
    if (v.severity === "high") score -= 8;
    else if (v.severity === "medium") score -= 4;
    else score -= 2;
    if (v.rule.startsWith("cross-domain:") && !risks.includes(`${v.fromDomain} → ${v.toDomain} boundary`)) {
      risks.push(`${v.fromDomain} → ${v.toDomain} boundary`);
    }
    if (v.rule === "domain-layer-stack" && !risks.includes(`${v.fromDomain} layer stack`)) {
      risks.push(`${v.fromDomain} layer stack`);
    }
  }

  for (const d of drift) {
    if (d.severity === "high") score -= 6;
    else if (d.severity === "medium") score -= 4;
    else score -= 2;
    if (d.kind === "cross_domain_spread" && !risks.includes("auth drift")) risks.push("auth drift");
    if (d.kind === "duplicate_pattern" && !risks.includes("duplicate validators")) {
      risks.push("duplicate validators");
    }
  }

  score = Math.max(0, Math.min(100, score));
  if (violations.length === 0 && drift.length === 0 && !risks.length) {
    risks.push("no major domain risks detected");
  }

  return {
    score,
    risks,
    violationCount: violations.length,
    driftCount: drift.length
  };
}

function domainForPath(
  pathKey: string,
  fileDomains: Map<string, string>,
  config: BlueprintConfig
): string {
  if (fileDomains.has(pathKey)) return fileDomains.get(pathKey)!;
  for (const ext of [".ts", ".tsx", ".js", ".jsx"]) {
    if (fileDomains.has(`${pathKey}${ext}`)) return fileDomains.get(`${pathKey}${ext}`)!;
  }
  const basename = pathKey.split("/").pop() ?? pathKey;
  for (const [filePath, domain] of fileDomains) {
    if (filePath.endsWith(`/${basename}`) || filePath.includes(pathKey)) return domain;
  }
  return inferDomainFromPath(pathKey, config);
}

export function buildDomainArchitecture(ir: ArchitectureIR, config: BlueprintConfig): DomainArchitecture {
  const fileDomains = new Map<string, string>();
  for (const file of ir.files) {
    const domain = inferDomainFromPath(file.path, config);
    fileDomains.set(file.path, domain);
    fileDomains.set(file.path.replace(/\.(tsx?|jsx?|mjs|cjs)$/i, ""), domain);
  }

  const violations = [
    ...checkCrossDomainViolations(ir, fileDomains, config),
    ...checkLayerViolations(ir, fileDomains, config)
  ];
  const drift = detectDrift(ir, fileDomains);
  const health = computeHealth(violations, drift);

  return {
    domains: buildDomainNodes(ir, config, fileDomains),
    ownership: buildOwnershipNodes(ir, fileDomains),
    ownershipEdges: buildOwnershipEdges(ir, fileDomains, config),
    violations,
    drift,
    health
  };
}

export function formatDomainArchitectureOutput(model: DomainArchitecture): string {
  const lines: string[] = ["BLUEPRINT DOMAIN INTELLIGENCE", ""];

  lines.push("Domains:");
  if (!model.domains.length) lines.push("- none");
  for (const d of model.domains) {
    lines.push(`- ${d.id} (${d.fileCount} files) layers: ${d.layers.join(", ") || "unknown"}`);
    lines.push(`  modules: ${d.modules.slice(0, 6).join(", ")}${d.modules.length > 6 ? "…" : ""}`);
  }

  lines.push("", "Ownership stacks (by domain):");
  const byDomain = new Map<string, OwnershipNode[]>();
  for (const node of model.ownership) {
    const list = byDomain.get(node.domain) ?? [];
    list.push(node);
    byDomain.set(node.domain, list);
  }
  for (const [domain, nodes] of [...byDomain.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    lines.push(`- ${domain}:`);
    for (const n of nodes.sort((a, b) => layerRank(a.layer) - layerRank(b.layer))) {
      const sym = n.symbols[0] ? ` (${n.symbols[0]}…)` : "";
      lines.push(`  - ${n.layer}: ${n.filePath}${sym}`);
    }
    const imports = model.ownershipEdges.filter((e) => e.domain === domain && e.kind === "import").slice(0, 5);
    for (const e of imports) {
      lines.push(`  - ${e.fromLayer} → ${e.toLayer}: ${pathBasename(e.from)} → ${pathBasename(e.to)}`);
    }
  }

  lines.push("", "Domain violations:");
  if (!model.violations.length) lines.push("- none");
  for (const v of model.violations.slice(0, 20)) {
    lines.push(`- [${v.severity}] ${v.message}`);
  }
  if (model.violations.length > 20) lines.push(`- … and ${model.violations.length - 20} more`);

  lines.push("", "Architectural drift:");
  if (!model.drift.length) lines.push("- none");
  for (const d of model.drift.slice(0, 15)) {
    lines.push(`- [${d.severity}] ${d.message}`);
  }

  lines.push(
    "",
    `Architecture health: ${model.health.score}/100`,
    "Risks:",
    ...model.health.risks.map((r) => `- ${r}`)
  );

  return lines.join("\n");
}

export function formatDomainHealthMarkdown(model: DomainArchitecture): string {
  return [
    "## Blueprint domain health",
    "",
    `**Architecture health:** ${model.health.score}/100`,
    "",
    "### Risks",
    ...model.health.risks.map((r) => `- ${r}`),
    "",
    `Violations: ${model.health.violationCount} · Drift signals: ${model.health.driftCount}`
  ].join("\n");
}

function pathBasename(p: string) {
  const parts = p.replaceAll("\\", "/").split("/");
  return parts[parts.length - 1] ?? p;
}

export type DomainAdvisory = {
  domain: string;
  layer: DomainLayer;
  message: string;
  reuseHint?: string;
  healthScore: number;
};

export function buildDomainAdvisory(opts: {
  proposedFilePath: string;
  proposedSymbolName: string;
  intent?: string;
  model: DomainArchitecture;
  config: BlueprintConfig;
}): DomainAdvisory {
  const pathDomain = inferDomainFromPath(opts.proposedFilePath, opts.config);
  const intentDomain = opts.intent ? inferDomainFromIntent(opts.intent) : null;
  const domain = intentDomain ?? pathDomain;
  const layer = classifyDomainLayer(opts.proposedFilePath, opts.proposedSymbolName);

  const domainNode = opts.model.domains.find((d) => d.id === domain);
  const peers = opts.model.ownership.filter((o) => o.domain === domain && o.layer === layer);
  const reuseHint =
    peers.length > 0
      ? `Reuse existing ${domain} abstractions under ${peers[0]!.filePath} instead of adding parallel logic.`
      : domainNode
        ? `Place this in the ${domain} domain (${domainNode.modules[0] ?? "conventional paths"}).`
        : undefined;

  const message = [
    `This logic belongs in the **${domain}** domain (${layer} layer).`,
    reuseHint ?? "Follow existing domain modules before introducing new helpers."
  ].join(" ");

  return {
    domain,
    layer,
    message,
    reuseHint,
    healthScore: opts.model.health.score
  };
}

export function domainAdvisoryText(advisory: DomainAdvisory): string {
  return [
    "BLUEPRINT DOMAIN ADVISORY",
    "",
    advisory.message,
    "",
    `Domain: ${advisory.domain}`,
    `Layer: ${advisory.layer}`,
    `Repository domain health: ${advisory.healthScore}/100`,
    advisory.reuseHint ? `Hint: ${advisory.reuseHint}` : ""
  ]
    .filter(Boolean)
    .join("\n");
}

export function filterCandidatesByDomain<T extends { file: string }>(
  candidates: T[],
  proposedFilePath: string,
  config: BlueprintConfig
): T[] {
  const targetDomain = inferDomainFromPath(proposedFilePath, config);
  const inDomain = candidates.filter((c) => inferDomainFromPath(c.file, config) === targetDomain);
  return inDomain.length ? inDomain : candidates;
}
