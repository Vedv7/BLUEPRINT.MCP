/** Semantic business domain (payments, auth, …) — not structural module paths. */

export type DomainLayer =
  | "controller"
  | "api"
  | "service"
  | "repository"
  | "schema"
  | "model"
  | "util"
  | "unknown";

export type DomainNode = {
  id: string;
  fileCount: number;
  modules: string[];
  layers: DomainLayer[];
};

export type OwnershipNode = {
  domain: string;
  layer: DomainLayer;
  filePath: string;
  symbols: string[];
};

export type OwnershipEdge = {
  domain: string;
  from: string;
  to: string;
  fromLayer: DomainLayer;
  toLayer: DomainLayer;
  kind: "import" | "stack";
};

export type DomainViolation = {
  message: string;
  fromPath: string;
  toPath: string;
  fromDomain: string;
  toDomain: string;
  rule: string;
  severity: "high" | "medium" | "low";
};

export type DomainDriftFinding = {
  kind: "cross_domain_spread" | "duplicate_pattern" | "layer_bleed";
  message: string;
  domain: string;
  paths: string[];
  severity: "high" | "medium" | "low";
};

export type DomainHealthScore = {
  score: number;
  risks: string[];
  violationCount: number;
  driftCount: number;
};

export type DomainArchitecture = {
  domains: DomainNode[];
  ownership: OwnershipNode[];
  ownershipEdges: OwnershipEdge[];
  violations: DomainViolation[];
  drift: DomainDriftFinding[];
  health: DomainHealthScore;
};
