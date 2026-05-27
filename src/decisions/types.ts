export type AdrStatus = "proposed" | "accepted" | "deprecated" | "superseded";

export type ArchitecturalDecision = {
  id: string;
  slug: string;
  title: string;
  status: AdrStatus;
  date: string;
  filePath: string;
  decision: string;
  rationale: string;
  constraints: string[];
  chosenPatterns: string[];
  rejectedPatterns: string[];
  domainOwnership: Array<{ domain: string; paths: string[] }>;
  boundaryIntent: string[];
  avoid: string[];
  domains: string[];
  supersededBy?: string;
};

export type DecisionMemory = {
  decisionsDir: string;
  decisions: ArchitecturalDecision[];
  byDomain: Map<string, ArchitecturalDecision[]>;
  byId: Map<string, ArchitecturalDecision>;
};

export type DecisionViolation = {
  adrId: string;
  rule: string;
  message: string;
  path?: string;
  severity: "high" | "medium" | "low";
};

export type DecisionCheckResult = {
  /** Accepted ADRs used for enforcement */
  enforcedDecisions: ArchitecturalDecision[];
  /** Proposed ADRs (informational only) */
  proposedDecisions: ArchitecturalDecision[];
  violations: DecisionViolation[];
  warnings: DecisionViolation[];
};
