import type { EmbeddingIndexResult } from "../embeddings/indexSymbols.js";
import type { BlueprintConfig } from "../config/loadConfig.js";
import type { CheckResult } from "../check/runCheck.js";
import type { DecisionCheckResult } from "../decisions/types.js";
import type { DuplicateCandidate, DuplicateMatch } from "../engine/duplicateDetector.js";
import type { suggestImportForSymbol } from "../engine/importSuggester.js";
import type { PlacementResult } from "../engine/placementEngine.js";
import type { ArchitectureGraph } from "../engines/architectureGraph.js";
import type { DomainAdvisory } from "../engines/domainIntelligence.js";
import type { DomainArchitecture } from "../ir/domainTypes.js";
import type { ArchitectureIR } from "../ir/types.js";
import type { RepoCoverageReport } from "../coverage/repoCoverage.js";
import type { InferredPolicies } from "../rules/inferRules.js";

export type BlueprintRuntimeContext = {
  repoRoot: string;
  config: BlueprintConfig;
};

export type RuntimeSession = {
  ir: ArchitectureIR;
  filesScanned: number;
  symbolsIndexed: number;
  embeddings: EmbeddingIndexResult;
};

export type ScanOptions = {
  /** Re-scan even if a session index exists */
  refresh?: boolean;
  /** MCP-style scan: index only exported symbols */
  exportedOnly?: boolean;
  enableEmbeddings?: boolean;
};

export type ScanResult = {
  filesScanned: number;
  symbolsIndexed: number;
  embeddings: EmbeddingIndexResult;
  adapters: ArchitectureIR["adapters"];
  ir: ArchitectureIR;
};

export type DoctorOptions = {
  /** Use indexed IR from last scan when available */
  useSession?: boolean;
};

export type DoctorResult = {
  coverage: RepoCoverageReport;
  configPresent: boolean;
  dbPresent: boolean;
  framework: string;
};

export type ReportResult = {
  text: string;
  filesScanned: number;
  symbolsIndexed: number;
};

export type GraphResult = {
  graph: ArchitectureGraph;
  text: string;
};

export type CheckOptions = {
  strict?: boolean;
  format?: "text" | "markdown";
  useSession?: boolean;
  refresh?: boolean;
};

export type RuntimeCheckResult = {
  result: CheckResult;
  text: string;
  filesScanned: number;
  symbolsIndexed: number;
  ci: {
    violations: number;
    warnings: number;
    strict: boolean;
    shouldFail: boolean;
  };
};

export type AdrCheckOptions = {
  strict?: boolean;
  format?: "text" | "markdown";
  useSession?: boolean;
  refresh?: boolean;
};

export type AdrCheckResult = {
  result: DecisionCheckResult;
  text: string;
  ci: {
    violations: number;
    warnings: number;
    strict: boolean;
    shouldFail: boolean;
  };
};

export type SnapshotResult = {
  path: string;
  adapters: string[];
};

export type AgentAdvisoryInput = {
  proposedSymbolName: string;
  proposedFilePath: string;
  intent: string;
  limit?: number;
};

export type AgentAdvisoryDecision = "ALLOW" | "ADVISORY" | "BLOCKED";

export type AgentAdvisoryResult = {
  decision: AgentAdvisoryDecision;
  mode: BlueprintConfig["enforcementMode"];
  severity: "low" | "medium" | "high";
  proposedSymbolName: string;
  proposedFilePath: string;
  intent: string;
  confidence: "high" | "medium" | "low" | "none";
  candidates: DuplicateCandidate[];
  duplicate: DuplicateMatch;
  placement: PlacementResult;
  domain: DomainAdvisory | null;
  decisionContinuity: string | null;
  suggestedAction:
    | {
        message: string;
        suggestedImport?: string;
        suggestedPath?: string;
      }
    | null;
  text: string;
};

export type FindAbstractionsInput = {
  proposedSymbolName: string;
  proposedFilePath?: string;
  intent?: string;
  limit?: number;
};

export type FindAbstractionsResult = {
  proposedSymbolName: string;
  proposedFilePath?: string;
  intent?: string;
  confidence: "high" | "medium" | "low" | "none";
  candidates: DuplicateCandidate[];
  domain: DomainAdvisory | null;
  decisionContinuity: string | null;
  text: string;
};

export type SuggestImportResult = {
  symbolName: string;
  suggestion: Awaited<ReturnType<typeof suggestImportForSymbol>>;
  text: string;
};

export type DomainsResult = {
  model: DomainArchitecture;
  text: string;
};

export type ValidateOptions = {
  full?: boolean;
  strict?: boolean;
};

export type ValidateStepResult = {
  id: string;
  ok: boolean;
  detail?: string;
};

export type ValidateResult = {
  ok: boolean;
  steps: ValidateStepResult[];
};

export type InferRulesResult = {
  policies: InferredPolicies;
  text: string;
};

export type ExplainDecisionsInput = {
  filePath?: string;
  intent?: string;
  domain?: string;
};

export type ExplainDecisionsResult = {
  text: string;
  accepted: number;
  proposed: number;
};
