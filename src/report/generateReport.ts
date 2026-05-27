import path from "node:path";
import type { BlueprintConfig } from "../config/loadConfig.js";
import type { ModuleNode } from "../ir/types.js";
import { buildSemanticDuplicateClusters } from "../embeddings/cluster.js";
import { openDb } from "../db/db.js";
import { diceCoefficient } from "../engine/stringSim.js";

type SymbolRow = {
  name: string;
  kind: string;
  file_path: string;
  signature: string;
  exported: number;
};

const STOP_TOKENS = new Set([
  "use",
  "get",
  "set",
  "to",
  "from",
  "for",
  "with",
  "and",
  "the",
  "a",
  "an",
  "src",
  "app",
  "lib",
  "utils",
  "dist",
  "js",
  "jsx",
  "ts",
  "tsx",
  "index",
  "engine",
  "shared",
  "ui"
]);

const DOMAIN_CLUSTERS = [
  {
    label: "currency formatting",
    tokens: new Set(["currency", "money", "payment", "price", "amount", "format"])
  },
  {
    label: "email validation",
    tokens: new Set(["email", "mail", "validate", "validation", "check", "address"])
  },
  {
    label: "request retry",
    tokens: new Set(["retry", "fetch", "http", "request"])
  }
] as const;

function titleFramework(framework: BlueprintConfig["framework"]) {
  if (framework === "nextjs") return "Next.js";
  if (framework === "node-express") return "Node/Express";
  if (framework === "vite") return "Vite";
  if (framework === "react") return "React";
  return "Unknown";
}

function normalizeAlias(aliasPrefix: string) {
  return aliasPrefix.endsWith("/") ? `${aliasPrefix}*` : aliasPrefix;
}

function tokens(raw: string) {
  return raw
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t && !STOP_TOKENS.has(t));
}

function countActivePlacementRules(config: BlueprintConfig) {
  if (config.rules) {
    const fromRules = [config.rules.utility, config.rules.component, config.rules.hook, config.rules.apiRoute];
    const count = fromRules.filter((v) => typeof v === "string" && v.length > 0).length;
    if (count > 0) return count;
  }
  return Object.values(config.placementRules).filter((v) => typeof v === "string" && v.length > 0).length;
}

function rankReusableAbstractions(rows: SymbolRow[]) {
  const fnRows = rows.filter(
    (r) => r.kind === "function" && (!/auth|token/i.test(r.name) || r.file_path.includes("/auth/"))
  );
  const allNames = fnRows.map((r) => r.name);

  return fnRows
    .map((row) => {
      let score = 0;
      if (row.file_path.startsWith("src/lib/")) score += 20;
      else if (row.file_path.startsWith("src/utils/")) score += 10;
      if (row.exported) score += 5;
      if (row.name.length <= 24) score += 2;
      if (!row.name.startsWith("use")) score += 2;

      const fileStem = row.file_path.split("/").pop()?.replace(/\.[^.]+$/, "") ?? "";
      if (diceCoefficient(fileStem, row.name) >= 0.35) score += 8;

      for (const other of allNames) {
        if (other === row.name) continue;
        const sim = diceCoefficient(row.name, other);
        if (sim >= 0.55 && row.name.length > other.length) score -= 5;
      }

      return { row, score };
    })
    .sort((a, b) => b.score - a.score || a.row.name.localeCompare(b.row.name))
    .slice(0, 5)
    .map((x) => x.row);
}

function symbolMatchesDomain(row: SymbolRow, domainTokens: Set<string>) {
  const symbolTokens = new Set([...tokens(row.name), ...tokens(row.file_path)]);
  for (const t of symbolTokens) {
    if (domainTokens.has(t)) return true;
  }
  return false;
}

function buildDuplicateRiskClusters(rows: SymbolRow[]) {
  const clusters: Array<{ label: string; symbols: string[] }> = [];

  for (const domain of DOMAIN_CLUSTERS) {
    const matched = rows.filter((r) => r.kind === "function" && symbolMatchesDomain(r, domain.tokens));
    const names = [...new Set(matched.map((r) => r.name))].sort();
    if (names.length >= 2) {
      clusters.push({ label: domain.label, symbols: names.slice(0, 6) });
    }
  }

  return clusters;
}

function buildRecommendations(rows: SymbolRow[], clusters: Array<{ label: string; symbols: string[] }>) {
  const recommendations: string[] = [];

  const currencyCluster = clusters.find((c) => c.label === "currency formatting");
  if (currencyCluster) {
    const canonical = rows.find((r) => r.name === "formatCurrency") ?? rows.find((r) => currencyCluster.symbols.includes(r.name));
    if (canonical) {
      recommendations.push(`Reuse ${canonical.file_path} for money formatting`);
    }
  }

  const emailCluster = clusters.find((c) => c.label === "email validation");
  if (emailCluster) {
    const canonical = rows.find((r) => r.name === "validateEmail") ?? rows.find((r) => emailCluster.symbols.includes(r.name));
    if (canonical) {
      recommendations.push(`Reuse ${canonical.file_path} for email validation`);
    }
  }

  const authOutsideAuthDir = rows.filter((r) => /auth/i.test(r.name) && !r.file_path.includes("/auth/"));
  if (authOutsideAuthDir.length) {
    recommendations.push("Keep auth helpers under src/lib/auth");
  }

  if (!recommendations.length) {
    recommendations.push("Continue indexing and reuse existing abstractions");
  }

  return recommendations;
}

function formatMonorepoSection(modules: ModuleNode[]) {
  const mono = modules.filter(
    (m) => m.id.startsWith("apps/") || m.id.startsWith("packages/") || m.id.startsWith("services/")
  );
  if (!mono.length) return [];
  return [
    "",
    "Monorepo packages:",
    ...mono.map((m) => `- ${m.id}: ${m.fileCount} files`)
  ];
}

export async function generateBlueprintReport(opts: {
  repoRoot: string;
  config: BlueprintConfig;
  filesScanned: number;
  symbolsIndexed: number;
  modules?: ModuleNode[];
}) {
  const dbAbs = path.join(opts.repoRoot, opts.config.dbPath);
  const db = await openDb(dbAbs);
  const rows = (await db.all<SymbolRow[]>(
    "SELECT name, kind, file_path, signature, exported FROM symbols WHERE exported = 1 ORDER BY name ASC"
  )) as unknown as SymbolRow[];
  const semanticClusters = await buildSemanticDuplicateClusters(db, opts.config);
  await db.close();

  const topReusable = rankReusableAbstractions(rows);
  const clusters = buildDuplicateRiskClusters(rows);
  const recommendations = buildRecommendations(rows, clusters);
  const activeRules = countActivePlacementRules(opts.config);

  const reportLines = [
    "Blueprint Report",
    "",
    `Framework: ${titleFramework(opts.config.framework)}`,
    `Files scanned: ${opts.filesScanned}`,
    `Symbols indexed: ${opts.symbolsIndexed}`,
    `Path aliases: ${opts.config.pathAliases.map((a) => normalizeAlias(a.aliasPrefix)).join(", ") || "None"}`,
    `Placement rules: ${activeRules} active`,
    ...formatMonorepoSection(opts.modules ?? []),
    "",
    "Top reusable abstractions:",
    ...(topReusable.length
      ? topReusable.map((r) => `- ${r.name} → ${r.file_path}`)
      : ["- (none indexed yet)"]),
    "",
    "Duplicate-risk clusters:",
    ...(clusters.length
      ? clusters.map((c) => `- ${c.label}: ${c.symbols.join(", ")}`)
      : ["- (no high-signal clusters yet)"]),
    "",
    "Semantic duplicate clusters:",
    ...(semanticClusters.length
      ? semanticClusters.map((c) => `- ${c.label}: ${c.symbols.join(", ")} (avg sim ${c.avgSimilarity})`)
      : ["- (enable embeddings in blueprint.config.json)"]),
    "",
    "Recommended actions:",
    ...recommendations.map((r) => `- ${r}`)
  ];

  return {
    text: reportLines.join("\n"),
    stats: {
      framework: opts.config.framework,
      filesScanned: opts.filesScanned,
      symbolsIndexed: opts.symbolsIndexed,
      pathAliases: opts.config.pathAliases,
      activeRules,
      topReusable,
      clusters,
      semanticClusters,
      recommendations
    }
  };
}
