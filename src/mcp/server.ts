import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { loadConfig } from "../config/loadConfig.js";
import { openDb } from "../db/db.js";
import { indexSymbolEmbeddings } from "../embeddings/indexSymbols.js";
import { buildArchitectureIr } from "../ir/buildArchitectureIr.js";
import { persistArchitectureIr } from "../ir/persistIr.js";
import { formatArchitectureGraphOutput } from "../graph/buildArchitectureGraph.js";
import { buildArchitectureGraphFromIr } from "../engines/architectureGraph.js";
import { findDuplicateCandidates, findDuplicateForProposedSymbol } from "../engine/duplicateDetector.js";
import { suggestImportForSymbol } from "../engine/importSuggester.js";
import { verifyPlacement } from "../engine/placementEngine.js";
import type { ConfidenceLevel } from "../engine/duplicateDetector.js";

function advisoryDecision(opts: {
  enforcementMode: "advisory" | "enforce";
  duplicateRisk: ConfidenceLevel;
  placementOk: boolean;
}) {
  const severity = opts.duplicateRisk === "high" || !opts.placementOk ? "high" : opts.duplicateRisk === "medium" ? "medium" : "low";
  if (opts.enforcementMode === "enforce" && severity === "high") {
    return { decision: "BLOCKED", mode: "enforce" as const, severity };
  }
  if (severity === "low") return { decision: "ALLOW", mode: opts.enforcementMode, severity };
  return { decision: "ADVISORY", mode: opts.enforcementMode, severity };
}

function toLabel(risk: ConfidenceLevel) {
  return risk.toUpperCase();
}

function advisoryTextForAbstraction(result: {
  file?: string;
  symbol?: string;
  suggestedImport?: string;
  confidence: ConfidenceLevel;
  action: string;
  reasons?: string[];
  explanation?: string;
}) {
  const existing = result.file && result.symbol ? `${result.file} -> ${result.symbol}()` : "No strong existing abstraction match.";
  const importLine = result.suggestedImport ?? "No import suggestion.";
  const lines = [
    "BLUEPRINT ADVISORY",
    "",
    "Existing abstraction found:",
    existing,
    "",
    "Suggested import:",
    importLine,
    "",
    `Confidence: ${toLabel(result.confidence)}`,
    `Action: ${result.action}`
  ];
  if (result.reasons?.length) {
    lines.push("", "Reasons:");
    result.reasons.forEach((r) => lines.push(`- ${r}`));
  }
  if (result.explanation) {
    lines.push("", result.explanation);
  }
  return lines.join("\n");
}

function placementTextForAdvisory(placement: { ok: boolean; suggestedPath?: string; reason?: string }) {
  return [
    "BLUEPRINT ADVISORY",
    "",
    "Placement guidance:",
    placement.ok ? "Current path matches repository conventions." : `Suggested path: ${placement.suggestedPath}`,
    "",
    `Reason: ${placement.reason ?? "No issue detected."}`,
    `Action: ${placement.ok ? "Keep current path." : "Use suggested path."}`
  ].join("\n");
}

export async function startMcpServer(opts: { repoRoot: string }) {
  const { repoRoot } = opts;
  const config = loadConfig(repoRoot);
  const dbAbs = path.join(repoRoot, config.dbPath);

  const server = new McpServer({ name: "blueprint", version: "0.1.0" });

  server.tool(
    "scan_repo",
    "Scan repository and index exported TypeScript/JS symbols into the local Blueprint SQLite index.",
    {
      exportedOnly: z.boolean().default(true).describe("If true, index only exported symbols.")
    },
    async ({ exportedOnly }) => {
      const ir = await buildArchitectureIr(repoRoot, config, { exportedOnly });
      const db = await openDb(dbAbs);
      await persistArchitectureIr(db, ir);
      const embeddingStats = await indexSymbolEmbeddings({
        repoRoot,
        config,
        db,
        scannedFilesRel: ir.files.map((f) => f.path),
        forceMock: process.env.BLUEPRINT_EMBED_MOCK === "1"
      });
      await db.close();

      const payload = {
        filesScanned: ir.files.length,
        symbolsIndexed: ir.symbols.length,
        adapters: ir.adapters,
        embeddings: embeddingStats
      };
      return {
        content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
        structuredContent: payload
      };
    }
  );

  server.tool(
    "find_existing_abstractions",
    "Advisory-first lookup for existing reusable abstractions similar to a proposed symbol.",
    {
      proposedSymbolName: z.string().describe("Main symbol being introduced, e.g. formatMoney"),
      proposedFilePath: z.string().optional().describe("Optional repo-relative file path for better domain-aware scoring."),
      intent: z.string().optional().describe("Optional natural language intent for better semantic alignment."),
      limit: z.number().int().min(1).max(20).default(5).describe("Maximum number of ranked candidates to return.")
    },
    async ({ proposedSymbolName, proposedFilePath, intent, limit }) => {
      const db = await openDb(dbAbs);
      const candidates = await findDuplicateCandidates(db, proposedSymbolName, limit, proposedFilePath, intent, {
        pathAliases: config.pathAliases,
        config,
        repoRoot
      });
      await db.close();

      const payload = {
        proposedSymbolName,
        proposedFilePath,
        intent,
        confidence: candidates[0]?.duplicateRisk ?? "low",
        candidates
      };
      const best = candidates[0];
      return {
        content: [
          {
            type: "text",
            text: advisoryTextForAbstraction({
              file: best?.file,
              symbol: best?.symbol,
              suggestedImport: best?.suggestedImport,
              confidence: payload.confidence,
              action: best ? "Prefer reuse/import over creating duplicate code." : "Proceed with implementation.",
              reasons: best?.reasons
            })
          }
        ],
        structuredContent: payload
      };
    }
  );

  server.tool(
    "suggest_import_reuse",
    "Suggest canonical import reuse for an existing abstraction (advisory guidance).",
    {
      symbolName: z.string().describe("Desired symbol name to import, e.g. formatCurrency")
    },
    async ({ symbolName }) => {
      const db = await openDb(dbAbs);
      const suggestion = await suggestImportForSymbol(db, symbolName, { pathAliases: config.pathAliases });
      await db.close();

      const payload = { symbolName, suggestion };
      return {
        content: [
          {
            type: "text",
            text: advisoryTextForAbstraction({
              file: suggestion.file ?? undefined,
              symbol: suggestion.symbol,
              suggestedImport: suggestion.suggestedImport ?? undefined,
              confidence: suggestion.strategy === "exact" ? "high" : suggestion.strategy === "nearest" ? "medium" : "none",
              action: suggestion.suggestedImport ? "Reuse the suggested import." : "No reuse suggestion found."
            })
          }
        ],
        structuredContent: payload
      };
    }
  );

  server.tool(
    "explain_architecture_boundaries",
    "Explain module boundaries, dependency flows, and risky imports in the repository.",
    {},
    async () => {
      const ir = await buildArchitectureIr(repoRoot, config);
      const graph = buildArchitectureGraphFromIr(ir, config);
      return {
        content: [{ type: "text", text: formatArchitectureGraphOutput(graph) }],
        structuredContent: graph
      };
    }
  );

  server.tool(
    "suggest_file_placement",
    "Suggest correct file placement by intent and folder conventions. Advisory-first guidance.",
    {
      proposedFilePath: z.string().describe("Repo-relative file path the agent intends to write"),
      intent: z.string().describe("Short natural-language intent, e.g. utility to format payment amounts")
    },
    async ({ proposedFilePath, intent }) => {
      const placement = verifyPlacement({
        proposedFilePath,
        intent,
        placementRules: config.placementRules
      });

      const payload = {
        mode: config.enforcementMode,
        framework: config.framework,
        placement,
        recommendation: placement.ok
          ? "placement looks good"
          : `Suggested location: ${placement.suggestedPath}`
      };

      return {
        content: [{ type: "text", text: placementTextForAdvisory(placement) }],
        structuredContent: payload
      };
    }
  );

  // Backward-compatible combined tool. Kept for migration.
  server.tool(
    "verify_and_place_code",
    "Combined duplicate + placement check. Advisory-first by default; blocks only in enforce mode.",
    {
      proposedFilePath: z.string().describe("Repo-relative file path the agent intends to write, e.g. src/utils/paymentFormatter.ts"),
      proposedSymbolName: z.string().describe("Main symbol being introduced, e.g. formatMoney"),
      intent: z.string().describe("Short natural-language intent, e.g. 'utility to format payment amounts'")
    },
    async ({ proposedFilePath, proposedSymbolName, intent }) => {
      const db = await openDb(dbAbs);
      const dup = await findDuplicateForProposedSymbol(db, proposedSymbolName, proposedFilePath, intent, {
        pathAliases: config.pathAliases,
        config,
        repoRoot
      });
      await db.close();

      const placement = verifyPlacement({
        proposedFilePath,
        intent,
        placementRules: config.placementRules
      });

      const { decision, mode, severity } = advisoryDecision({
        enforcementMode: config.enforcementMode,
        duplicateRisk: dup.duplicateRisk,
        placementOk: placement.ok
      });

      const response = {
        decision,
        mode,
        severity,
        duplicate: dup,
        placement,
        suggestedAction:
          dup.match && dup.duplicateRisk !== "low"
            ? {
                message: `Use existing ${dup.match.symbol} from ${dup.match.file}`,
                suggestedImport: dup.suggestedImport
              }
            : placement.ok
              ? null
              : {
                  message: `Suggested location: ${placement.suggestedPath}`,
                  suggestedPath: placement.suggestedPath
                }
      };

      return {
        content: [
          {
            type: "text",
            text: advisoryTextForAbstraction({
              file: response.duplicate.match?.file,
              symbol: response.duplicate.match?.symbol,
              suggestedImport: response.duplicate.suggestedImport,
              confidence: response.duplicate.duplicateRisk,
              action:
                decision === "BLOCKED"
                  ? "Do not create duplicate. Reuse existing function."
                  : decision === "ADVISORY"
                    ? "Prefer reuse and follow placement guidance."
                    : "Proceed.",
              reasons: response.duplicate.reasons,
              explanation: response.duplicate.explanation
            })
          }
        ],
        structuredContent: response
      };
    }
  );

  // Backward-compatible aliases.
  server.tool(
    "find_duplicates",
    "Alias for find_existing_abstractions.",
    {
      proposedSymbolName: z.string(),
      proposedFilePath: z.string().optional(),
      intent: z.string().optional(),
      limit: z.number().int().min(1).max(20).default(5)
    },
    async ({ proposedSymbolName, proposedFilePath, intent, limit }) => {
      const db = await openDb(dbAbs);
      const candidates = await findDuplicateCandidates(db, proposedSymbolName, limit, proposedFilePath, intent, {
        pathAliases: config.pathAliases,
        config,
        repoRoot
      });
      await db.close();
      const payload = { proposedSymbolName, proposedFilePath, intent, confidence: candidates[0]?.duplicateRisk ?? "low", candidates };
      const best = candidates[0];
      return {
        content: [
          {
            type: "text",
            text: advisoryTextForAbstraction({
              file: best?.file,
              symbol: best?.symbol,
              suggestedImport: best?.suggestedImport,
              confidence: payload.confidence,
              action: best ? "Prefer reuse/import over creating duplicate code." : "Proceed with implementation.",
              reasons: best?.reasons
            })
          }
        ],
        structuredContent: payload
      };
    }
  );

  server.tool(
    "suggest_import",
    "Alias for suggest_import_reuse.",
    {
      symbolName: z.string()
    },
    async ({ symbolName }) => {
      const db = await openDb(dbAbs);
      const suggestion = await suggestImportForSymbol(db, symbolName, { pathAliases: config.pathAliases });
      await db.close();
      const payload = { symbolName, suggestion };
      return {
        content: [
          {
            type: "text",
            text: advisoryTextForAbstraction({
              file: suggestion.file ?? undefined,
              symbol: suggestion.symbol,
              suggestedImport: suggestion.suggestedImport ?? undefined,
              confidence: suggestion.strategy === "exact" ? "high" : suggestion.strategy === "nearest" ? "medium" : "none",
              action: suggestion.suggestedImport ? "Reuse the suggested import." : "No reuse suggestion found."
            })
          }
        ],
        structuredContent: payload
      };
    }
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

