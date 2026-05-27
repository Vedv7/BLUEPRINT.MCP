import type { EmbeddingsConfig } from "../config/loadConfig.js";

export type HeuristicScore = {
  score: number;
  reasons: string[];
  nameScore: number;
  tokenScore: number;
  fileDomainScore: number;
  intentScore: number;
};

export type HybridScoreInput = {
  heuristic: HeuristicScore;
  semanticScore: number;
  embeddings: EmbeddingsConfig;
  paramStructureScore?: number;
};

export type HybridScoreResult = {
  score: number;
  duplicateRisk: "none" | "low" | "medium" | "high";
  reasons: string[];
  breakdown: {
    heuristic: number;
    semantic: number;
    hybrid: number;
  };
};

export function riskFromHybridScore(score: number): HybridScoreResult["duplicateRisk"] {
  if (score >= 0.82) return "high";
  if (score >= 0.6) return "medium";
  if (score >= 0.3) return "low";
  return "none";
}

export function scoreParameterStructure(proposedSignature: string | undefined, existingSignature: string) {
  if (!proposedSignature) return 0;
  const proposedParams = (proposedSignature.match(/\(([^)]*)\)/)?.[1] ?? "")
    .split(",")
    .map((p) => p.trim().split(":")[0])
    .filter(Boolean);
  const existingParams = (existingSignature.match(/\(([^)]*)\)/)?.[1] ?? "")
    .split(",")
    .map((p) => p.trim().split(":")[0])
    .filter(Boolean);
  if (!proposedParams.length || !existingParams.length) return 0;
  const a = new Set(proposedParams);
  const b = new Set(existingParams);
  let inter = 0;
  for (const p of a) if (b.has(p)) inter++;
  return inter / Math.max(a.size, b.size);
}

export function buildHybridScore(input: HybridScoreInput): HybridScoreResult {
  const { heuristic, semanticScore, embeddings } = input;
  const paramScore = input.paramStructureScore ?? 0;

  const hasSemantic = semanticScore > 0;
  const heuristicWeight = hasSemantic ? embeddings.hybridWeights.heuristic : 1;
  const semanticWeight = hasSemantic ? embeddings.hybridWeights.semantic : 0;

  const hybrid = heuristicWeight * heuristic.score + semanticWeight * semanticScore;

  const reasons = [...heuristic.reasons];
  if (semanticScore >= embeddings.minSemanticScore) {
    reasons.push(`semantic similarity: ${semanticScore.toFixed(2)}`);
  }
  if (semanticScore >= 0.85) {
    reasons.push("similar function intent");
  }
  if (paramScore >= 0.66) {
    reasons.push("matching parameter structure");
  }
  if (heuristic.fileDomainScore >= 0.4) {
    reasons.push("same domain keywords");
  }

  const score = Number(Math.min(1, hybrid + paramScore * 0.05).toFixed(3));

  return {
    score,
    duplicateRisk: riskFromHybridScore(score),
    reasons: reasons.length ? reasons : ["moderate similarity"],
    breakdown: {
      heuristic: Number(heuristic.score.toFixed(3)),
      semantic: Number(semanticScore.toFixed(3)),
      hybrid: score
    }
  };
}

export function formatConfidenceExplanation(opts: {
  duplicateRisk: HybridScoreResult["duplicateRisk"];
  reasons: string[];
  breakdown?: HybridScoreResult["breakdown"];
  matchSymbol?: string;
  matchFile?: string;
}) {
  const lines = [
    `Confidence: ${opts.duplicateRisk.toUpperCase()}`,
    "",
    "Reasons:"
  ];
  for (const reason of opts.reasons) {
    lines.push(`- ${reason}`);
  }
  if (opts.breakdown) {
    lines.push("", `Score breakdown: heuristic=${opts.breakdown.heuristic}, semantic=${opts.breakdown.semantic}, hybrid=${opts.breakdown.hybrid}`);
  }
  if (opts.matchSymbol && opts.matchFile) {
    lines.push("", `Semantic duplicate candidate: ${opts.matchSymbol} ≈ proposed abstraction (${opts.matchFile})`);
  }
  return lines.join("\n");
}
