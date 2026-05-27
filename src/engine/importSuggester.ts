import type { BlueprintDb } from "../db/db.js";
import { buildSuggestedImport, findDuplicateCandidates } from "./duplicateDetector.js";
import type { BlueprintConfig } from "../config/loadConfig.js";

export async function suggestImportForSymbol(
  db: BlueprintDb,
  symbolName: string,
  opts?: { pathAliases?: BlueprintConfig["pathAliases"] }
) {
  const exact = (await db.get<{ name: string; file_path: string; exported: number }>(
    "SELECT name, file_path, exported FROM symbols WHERE name = ? AND exported = 1 LIMIT 1",
    symbolName
  )) ?? null;

  if (exact) {
    return {
      strategy: "exact",
      symbol: exact.name,
      suggestedImport: buildSuggestedImport(exact.name, exact.file_path, opts),
      file: exact.file_path
    };
  }

  const [best] = await findDuplicateCandidates(db, symbolName, 1, undefined, undefined, opts);
  if (!best) {
    return {
      strategy: "none",
      suggestedImport: null,
      file: null
    };
  }

  return {
    strategy: "nearest",
    symbol: best.symbol,
    suggestedImport: best.suggestedImport,
    file: best.file,
    score: best.score
  };
}

