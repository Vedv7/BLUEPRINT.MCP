import { minimatch } from "minimatch";
import type { BlueprintConfig } from "../config/loadConfig.js";
import type { DomainLayer } from "./domainTypes.js";
import { classifyJavaSpringLayer } from "./javaLayers.js";

export const BUILTIN_DOMAIN_CATALOG: Array<{ id: string; tokens: string[] }> = [
  { id: "payments", tokens: ["payment", "payments", "checkout", "invoice", "stripe", "wallet"] },
  { id: "auth", tokens: ["auth", "authentication", "session", "login", "identity", "oauth", "jwt", "token"] },
  { id: "users", tokens: ["user", "users", "account", "accounts", "profile", "membership"] },
  { id: "analytics", tokens: ["analytics", "metrics", "tracking", "telemetry", "events", "segment"] },
  { id: "notifications", tokens: ["notification", "notifications", "notify", "email", "sms", "push", "webhook"] },
  { id: "billing", tokens: ["billing", "subscription", "subscriptions", "plan", "pricing", "tier"] }
];

const LAYER_PATTERNS: Array<{ layer: DomainLayer; patterns: string[] }> = [
  { layer: "controller", patterns: ["/controller/", "/controllers/", ".controller.", "Controller."] },
  { layer: "api", patterns: ["/api/", "/routes/", "/route.", "/handlers/", "/pages/api/"] },
  { layer: "service", patterns: ["/service/", "/services/", ".service.", "Service."] },
  { layer: "repository", patterns: ["/repository/", "/repositories/", "/repo/", ".repository.", "/dao/", "/data/"] },
  { layer: "schema", patterns: ["/schema/", "/schemas/", "/dto/", "/dtos/", "/validators/", "validator", "validation"] },
  { layer: "model", patterns: ["/model/", "/models/", "/entity/", "/entities/", "/domain/"] },
  { layer: "util", patterns: ["/util/", "/utils/", "/helpers/", "/common/", "/shared/"] }
];

const STACK_ORDER: DomainLayer[] = ["controller", "api", "service", "repository", "schema", "model", "util", "unknown"];

function normalize(p: string) {
  return p.replaceAll("\\", "/").toLowerCase();
}

function pathSegments(filePath: string): string[] {
  return normalize(filePath)
    .replace(/\.[a-z0-9]+$/i, "")
    .split("/")
    .filter(Boolean);
}

function tokenizeSegment(seg: string): string[] {
  return seg
    .split(/[-_.]/g)
    .map((t) => t.trim())
    .filter((t) => t.length > 1);
}

export function classifyDomainLayer(filePath: string, symbolName?: string): DomainLayer {
  const hay = `${normalize(filePath)} ${symbolName ?? ""}`;
  if (hay.endsWith(".java") || hay.includes("src/main/java/")) {
    const javaLayer = classifyJavaSpringLayer(filePath);
    if (javaLayer === "controller") return "controller";
    if (javaLayer === "service") return "service";
    if (javaLayer === "repository") return "repository";
    if (javaLayer === "model") return "model";
    if (javaLayer === "config") return "util";
  }
  for (const { layer, patterns } of LAYER_PATTERNS) {
    if (patterns.some((p) => hay.includes(p.toLowerCase()))) return layer;
  }
  if (hay.includes("controller")) return "controller";
  if (hay.includes("repository") || hay.includes("repo")) return "repository";
  if (hay.includes("service")) return "service";
  return "unknown";
}

export function layerRank(layer: DomainLayer): number {
  const idx = STACK_ORDER.indexOf(layer);
  return idx >= 0 ? idx : STACK_ORDER.length;
}

function scoreDomainToken(seg: string, token: string): number {
  const lower = seg.toLowerCase();
  const t = token.toLowerCase();
  if (lower === t) return 10;
  if (lower.startsWith(t) || lower.endsWith(t)) return 7;
  if (lower.includes(t)) return 4;
  return 0;
}

export function inferDomainFromPath(filePath: string, config?: BlueprintConfig): string {
  const p = normalize(filePath);

  const custom = config?.domains?.patterns?.find((pattern) => {
    const prefix = pattern.match.replace(/\*\*$/, "").replace(/\*$/, "");
    return p.startsWith(prefix.toLowerCase()) || p.includes(`/${pattern.id.toLowerCase()}/`);
  });
  if (custom) return custom.id;

  const catalog = [...BUILTIN_DOMAIN_CATALOG];
  for (const extra of config?.domains?.catalog ?? []) {
    if (!catalog.some((c) => c.id === extra.id)) catalog.push(extra);
  }

  let bestId = "shared";
  let bestScore = 0;

  for (const seg of pathSegments(filePath)) {
    for (const token of tokenizeSegment(seg)) {
      for (const domain of catalog) {
        for (const dt of domain.tokens) {
          const s = scoreDomainToken(token, dt);
          if (s > bestScore) {
            bestScore = s;
            bestId = domain.id;
          }
        }
      }
    }
  }

  const folderBoost = catalog.flatMap((d) =>
    [
      `/${d.id}/`,
      `/lib/${d.id}/`,
      `/api/${d.id}/`,
      `/services/${d.id}/`,
      `/modules/${d.id}/`,
      `/features/${d.id}/`,
      `/domains/${d.id}/`
    ].map((prefix) => ({ id: d.id, prefix }))
  );

  for (const { id, prefix } of folderBoost) {
    if (p.includes(prefix)) {
      const boost = 12;
      if (boost > bestScore) {
        bestScore = boost;
        bestId = id;
      }
    }
  }

  return bestId;
}

export function inferDomainFromIntent(intent?: string): string | null {
  if (!intent) return null;
  const lower = intent.toLowerCase();
  for (const domain of BUILTIN_DOMAIN_CATALOG) {
    if (domain.tokens.some((t) => lower.includes(t))) return domain.id;
  }
  return null;
}

export function domainMatchesGlob(domainId: string, pattern: string): boolean {
  return minimatch(domainId, pattern, { nocase: true, dot: true });
}

export function symbolSuggestsDomain(symbolName: string): string | null {
  const lower = symbolName.toLowerCase();
  for (const domain of BUILTIN_DOMAIN_CATALOG) {
    if (domain.tokens.some((t) => lower.includes(t))) return domain.id;
  }
  return null;
}
