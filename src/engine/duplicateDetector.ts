import type { BlueprintDb } from "../db/db.js";

import { diceCoefficient, tokenOverlap } from "./stringSim.js";

import type { BlueprintConfig } from "../config/loadConfig.js";

import { buildHybridScore, formatConfidenceExplanation, scoreParameterStructure, type HeuristicScore } from "../embeddings/hybridScore.js";

import { buildProposedRepresentation } from "../embeddings/representSymbol.js";

import { createEmbedder } from "../embeddings/model.js";

import { loadAllEmbeddings } from "../embeddings/store.js";

import { cosineSimilarity } from "../embeddings/vector.js";



export type ConfidenceLevel = "none" | "low" | "medium" | "high";



export type DuplicateMatch = {

  duplicateRisk: ConfidenceLevel;

  score: number;

  match: {

    symbol: string;

    kind: string;

    file: string;

    signature: string;

    summary?: string | null;

  } | null;

  suggestedImport?: string;

  reasons: string[];

  explanation?: string;

  breakdown?: {

    heuristic: number;

    semantic: number;

    hybrid: number;

  };

};



type SymbolRow = {

  id?: number;

  name: string;

  kind: string;

  file_path: string;

  signature: string;

  summary: string | null;

  exported: number;

};



export type DuplicateCandidate = {

  symbol: string;

  kind: string;

  file: string;

  signature: string;

  summary?: string | null;

  score: number;

  duplicateRisk: ConfidenceLevel;

  suggestedImport: string;

  reasons: string[];

  breakdown?: DuplicateMatch["breakdown"];

};



function pathTokens(filePath: string) {

  return filePath

    .replaceAll("\\", "/")

    .replace(/\.(ts|tsx|js|jsx)$/, "")

    .split("/")

    .flatMap((part) => part.split(/[-_.]/g))

    .map((s) => s.trim().toLowerCase())

    .filter(Boolean);

}



const SYNONYM_GROUPS = [

  ["money", "currency", "price", "amount", "payment", "payments"],

  ["format", "formatter", "normalize", "convert", "display"]

];



function canonicalToken(token: string) {

  for (const group of SYNONYM_GROUPS) {

    if (group.includes(token)) return group[0];

  }

  return token;

}



function canonicalizePhrase(raw: string) {

  return raw

    .replace(/[^a-zA-Z0-9]+/g, " ")

    .replace(/([a-z])([A-Z])/g, "$1 $2")

    .toLowerCase()

    .split(/\s+/)

    .filter(Boolean)

    .map(canonicalToken)

    .join(" ");

}



function guessNamedExport(name: string) {

  return `{ ${name} }`;

}



function pathToAliasImport(filePath: string, pathAliases: BlueprintConfig["pathAliases"] = []) {

  const normalized = filePath.replaceAll("\\", "/");

  for (const alias of pathAliases) {

    if (normalized.startsWith(alias.targetPrefix)) {

      return (alias.aliasPrefix + normalized.slice(alias.targetPrefix.length)).replace(/\.(ts|tsx|js|jsx)$/, "");

    }

  }

  if (normalized.startsWith("src/")) return "@/" + normalized.slice("src/".length).replace(/\.(ts|tsx|js|jsx)$/, "");

  if (normalized.startsWith("app/")) return "./" + normalized.replace(/\.(ts|tsx|js|jsx)$/, "");

  return "./" + normalized.replace(/\.(ts|tsx|js|jsx)$/, "");

}



export function buildSuggestedImport(

  symbolName: string,

  filePath: string,

  opts?: { pathAliases?: BlueprintConfig["pathAliases"] }

) {

  const importPath = pathToAliasImport(filePath, opts?.pathAliases);

  const exportedName = symbolName.includes(".") ? symbolName.split(".").at(-1)! : symbolName;

  return `import ${guessNamedExport(exportedName)} from "${importPath}";`;

}



export function scoreAgainst(proposedSymbolName: string, row: SymbolRow, proposedFilePath?: string, intent?: string): HeuristicScore {

  const normalizedProposed = canonicalizePhrase(proposedSymbolName);

  const normalizedExisting = canonicalizePhrase(row.name);

  const nameScore = diceCoefficient(normalizedProposed, normalizedExisting);

  const tokenScore = tokenOverlap(normalizedProposed, normalizedExisting);

  let fileDomainScore = 0;

  if (proposedFilePath) {

    const a = new Set(pathTokens(proposedFilePath));

    const b = new Set(pathTokens(row.file_path));

    if (a.size && b.size) {

      let inter = 0;

      for (const t of a) if (b.has(t)) inter++;

      fileDomainScore = inter / Math.max(a.size, b.size);

    }

  }

  let intentScore = 0;

  if (intent) {

    const normalizedIntent = canonicalizePhrase(intent);

    intentScore = tokenOverlap(normalizedIntent, canonicalizePhrase(row.file_path + " " + row.name));

  }

  const score = 0.55 * nameScore + 0.2 * tokenScore + 0.15 * fileDomainScore + 0.1 * intentScore;

  const reasons: string[] = [];

  if (nameScore >= 0.8) reasons.push("high name similarity");

  if (tokenScore >= 0.6) reasons.push("high token overlap");

  if (fileDomainScore >= 0.4) reasons.push("similar module area");

  if (intentScore >= 0.3) reasons.push("intent aligns with existing symbol domain");

  return { score, reasons, nameScore, tokenScore, fileDomainScore, intentScore };

}



async function getIndexedExportedSymbols(db: BlueprintDb): Promise<SymbolRow[]> {

  return (await db.all<SymbolRow[]>(

    "SELECT id, name, kind, file_path, signature, summary, exported FROM symbols WHERE kind IN ('function','class_method') AND exported = 1"

  )) as unknown as SymbolRow[];

}



type ScoringContext = {

  repoRoot?: string;

  config?: BlueprintConfig;

  queryVector?: Float32Array;

  embeddingsBySymbolId?: Map<number, { vector: Float32Array }>;

};



async function prepareScoringContext(

  db: BlueprintDb,

  repoRoot: string | undefined,

  config: BlueprintConfig | undefined,

  proposedSymbolName: string,

  proposedFilePath?: string,

  intent?: string

): Promise<ScoringContext> {

  if (!config?.embeddings.enabled || !repoRoot) return {};



  const embeddingsBySymbolId = await loadAllEmbeddings(db, config.embeddings.dimensions);

  if (!embeddingsBySymbolId.size) return { repoRoot, config, embeddingsBySymbolId };



  const embedder = await createEmbedder(repoRoot, config.embeddings, { forceMock: process.env.BLUEPRINT_EMBED_MOCK === "1" });

  const queryText = buildProposedRepresentation(proposedSymbolName, proposedFilePath, intent);

  const queryVector = await embedder.embed(queryText);



  return { repoRoot, config, queryVector, embeddingsBySymbolId };

}



function semanticScoreForRow(row: SymbolRow, ctx: ScoringContext) {

  if (!ctx.queryVector || !row.id || !ctx.embeddingsBySymbolId) return 0;

  const stored = ctx.embeddingsBySymbolId.get(row.id);

  if (!stored) return 0;

  return cosineSimilarity(ctx.queryVector, stored.vector);

}



function scoreRowHybrid(

  proposedSymbolName: string,

  row: SymbolRow,

  proposedFilePath: string | undefined,

  intent: string | undefined,

  ctx: ScoringContext,

  proposedSignature?: string

) {

  const heuristic = scoreAgainst(proposedSymbolName, row, proposedFilePath, intent);

  const semanticScore = semanticScoreForRow(row, ctx);



  if (!ctx.config?.embeddings.enabled) {

    return {

      score: Number(heuristic.score.toFixed(3)),

      duplicateRisk: riskFromScore(heuristic.score),

      reasons: heuristic.reasons.length ? heuristic.reasons : ["moderate similarity"],

      breakdown: undefined as DuplicateMatch["breakdown"]

    };

  }



  const hybrid = buildHybridScore({

    heuristic,

    semanticScore,

    embeddings: ctx.config.embeddings,

    paramStructureScore: scoreParameterStructure(proposedSignature, row.signature)

  });



  return {

    score: hybrid.score,

    duplicateRisk: hybrid.duplicateRisk,

    reasons: hybrid.reasons,

    breakdown: hybrid.breakdown

  };

}



function riskFromScore(score: number): ConfidenceLevel {

  if (score >= 0.82) return "high";

  if (score >= 0.6) return "medium";

  if (score >= 0.3) return "low";

  return "none";

}



export async function findDuplicateCandidates(

  db: BlueprintDb,

  proposedSymbolName: string,

  limit = 5,

  proposedFilePath?: string,

  intent?: string,

  opts?: { pathAliases?: BlueprintConfig["pathAliases"]; config?: BlueprintConfig; repoRoot?: string }

): Promise<DuplicateCandidate[]> {

  const rows = await getIndexedExportedSymbols(db);

  const ctx = await prepareScoringContext(db, opts?.repoRoot, opts?.config, proposedSymbolName, proposedFilePath, intent);



  const scored = rows.map((row) => {

    const result = scoreRowHybrid(proposedSymbolName, row, proposedFilePath, intent, ctx);

    return {

      symbol: row.name,

      kind: row.kind,

      file: row.file_path,

      signature: row.signature,

      summary: row.summary,

      score: result.score,

      duplicateRisk: result.duplicateRisk,

      suggestedImport: buildSuggestedImport(row.name, row.file_path, opts),

      reasons: result.reasons,

      breakdown: result.breakdown

    } satisfies DuplicateCandidate;

  });



  return scored.sort((a, b) => b.score - a.score).slice(0, limit);

}



export async function findDuplicateForProposedSymbol(

  db: BlueprintDb,

  proposedSymbolName: string,

  proposedFilePath?: string,

  intent?: string,

  opts?: { pathAliases?: BlueprintConfig["pathAliases"]; config?: BlueprintConfig; repoRoot?: string }

) {

  const rows = await getIndexedExportedSymbols(db);

  const ctx = await prepareScoringContext(db, opts?.repoRoot, opts?.config, proposedSymbolName, proposedFilePath, intent);



  let best: { row: SymbolRow; score: number; reasons: string[]; breakdown?: DuplicateMatch["breakdown"]; duplicateRisk: ConfidenceLevel } | null =

    null;



  for (const r of rows) {

    const result = scoreRowHybrid(proposedSymbolName, r, proposedFilePath, intent, ctx);

    if (!best || result.score > best.score) {

      best = { row: r, score: result.score, reasons: result.reasons, breakdown: result.breakdown, duplicateRisk: result.duplicateRisk };

    }

  }



  if (!best) {

    return {

      duplicateRisk: "none",

      score: 0,

      match: null,

      reasons: ["no symbols indexed"]

    } satisfies DuplicateMatch;

  }



  const suggestedImport = buildSuggestedImport(best.row.name, best.row.file_path, opts);

  const explanation = formatConfidenceExplanation({

    duplicateRisk: best.duplicateRisk,

    reasons: best.reasons,

    breakdown: best.breakdown,

    matchSymbol: best.row.name,

    matchFile: best.row.file_path

  });



  return {

    duplicateRisk: best.duplicateRisk,

    score: best.score,

    match: {

      symbol: best.row.name,

      kind: best.row.kind,

      file: best.row.file_path,

      signature: best.row.signature,

      summary: best.row.summary

    },

    suggestedImport,

    reasons: best.reasons,

    explanation,

    breakdown: best.breakdown

  } satisfies DuplicateMatch;

}


