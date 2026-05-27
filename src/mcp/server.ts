import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  buildDecisionMemory,
  createArchitecturalDecision,
  formatDecisionDetail,
  formatDecisionList
} from "../decisions/store.js";
import { placementTextForAdvisory } from "../runtime/formatAdvisory.js";
import { createRuntime } from "../runtime/createRuntime.js";

export async function startMcpServer(opts: { repoRoot: string }) {
  const runtime = createRuntime({ repoRoot: opts.repoRoot });
  const server = new McpServer({ name: "blueprint", version: "0.2.1" });

  server.tool(
    "scan_repo",
    "Scan repository and index exported TypeScript/JS symbols into the local Blueprint SQLite index.",
    {
      exportedOnly: z.boolean().default(true).describe("If true, index only exported symbols.")
    },
    async ({ exportedOnly }) => {
      const scan = await runtime.scan({ exportedOnly, refresh: true });
      const payload = {
        filesScanned: scan.filesScanned,
        symbolsIndexed: scan.symbolsIndexed,
        adapters: scan.adapters,
        embeddings: scan.embeddings
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
      const result = await runtime.findExistingAbstractions({
        proposedSymbolName,
        proposedFilePath,
        intent,
        limit
      });
      const payload = {
        proposedSymbolName: result.proposedSymbolName,
        proposedFilePath: result.proposedFilePath,
        intent: result.intent,
        confidence: result.confidence,
        candidates: result.candidates,
        domain: result.domain
      };
      return {
        content: [{ type: "text", text: result.text }],
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
      const result = await runtime.suggestImportReuse(symbolName);
      return {
        content: [{ type: "text", text: result.text }],
        structuredContent: { symbolName: result.symbolName, suggestion: result.suggestion }
      };
    }
  );

  server.tool(
    "explain_architecture_boundaries",
    "Explain module boundaries, dependency flows, and risky imports in the repository.",
    {},
    async () => {
      const graph = await runtime.graph();
      return {
        content: [{ type: "text", text: graph.text }],
        structuredContent: graph.graph
      };
    }
  );

  server.tool(
    "infer_domains",
    "Infer business domains (payments, auth, …), ownership stacks, and cross-domain risks.",
    {},
    async () => {
      const domains = await runtime.domains();
      return {
        content: [{ type: "text", text: domains.text }],
        structuredContent: domains.model
      };
    }
  );

  server.tool(
    "domain_health",
    "Architecture health score from domain governance (violations, drift, boundary risks).",
    {},
    async () => {
      const health = await runtime.domainHealth();
      return {
        content: [{ type: "text", text: health.text }],
        structuredContent: health.model
      };
    }
  );

  server.tool(
    "explain_domain_boundaries",
    "Domain boundary violations and drift (analytics→auth, payment internals, validator sprawl).",
    {},
    async () => {
      const domains = await runtime.domains();
      const focus = [
        "Domain violations:",
        ...domains.model.violations.map((v) => `- [${v.severity}] ${v.message}`),
        "",
        "Drift:",
        ...domains.model.drift.map((d) => `- [${d.severity}] ${d.message}`)
      ].join("\n");
      return {
        content: [{ type: "text", text: focus }],
        structuredContent: {
          violations: domains.model.violations,
          drift: domains.model.drift,
          health: domains.model.health
        }
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
      const advisory = await runtime.getAgentAdvisory({
        proposedSymbolName: "_placement_probe_",
        proposedFilePath,
        intent
      });
      const placement = advisory.placement;
      const payload = {
        mode: runtime.config.enforcementMode,
        framework: runtime.config.framework,
        placement,
        recommendation: placement.ok ? "placement looks good" : `Suggested location: ${placement.suggestedPath}`
      };
      return {
        content: [{ type: "text", text: placementTextForAdvisory(placement) }],
        structuredContent: payload
      };
    }
  );

  server.tool(
    "verify_and_place_code",
    "Combined duplicate + placement check. Advisory-first by default; blocks only in enforce mode.",
    {
      proposedFilePath: z.string().describe("Repo-relative file path the agent intends to write, e.g. src/utils/paymentFormatter.ts"),
      proposedSymbolName: z.string().describe("Main symbol being introduced, e.g. formatMoney"),
      intent: z.string().describe("Short natural-language intent, e.g. 'utility to format payment amounts'")
    },
    async ({ proposedFilePath, proposedSymbolName, intent }) => {
      const advisory = await runtime.getAgentAdvisory({
        proposedFilePath,
        proposedSymbolName,
        intent
      });
      const response = {
        decision: advisory.decision,
        mode: advisory.mode,
        severity: advisory.severity,
        domain: advisory.domain,
        duplicate: advisory.duplicate,
        placement: advisory.placement,
        suggestedAction: advisory.suggestedAction
      };
      return {
        content: [{ type: "text", text: advisory.text }],
        structuredContent: response
      };
    }
  );

  server.tool(
    "list_architectural_decisions",
    "List persistent architectural decisions (ADRs) and rationale for continuity across AI sessions.",
    {},
    async () => {
      const memory = buildDecisionMemory(runtime.repoRoot);
      return {
        content: [{ type: "text", text: formatDecisionList(memory.decisions) }],
        structuredContent: { decisions: memory.decisions }
      };
    }
  );

  server.tool(
    "check_decision_constraints",
    "Check whether the codebase violates recorded architectural decisions.",
    {},
    async () => {
      const adr = await runtime.adrCheck();
      return {
        content: [{ type: "text", text: adr.text }],
        structuredContent: adr.result
      };
    }
  );

  server.tool(
    "explain_architectural_decisions",
    "Explain which accepted ADRs apply before creating code (auth, payments, currency, etc.).",
    {
      filePath: z.string().optional().describe("Repo-relative path you plan to edit"),
      intent: z.string().optional().describe("What you are about to build"),
      domain: z.string().optional().describe("Business domain, e.g. payments or auth")
    },
    async ({ filePath, intent, domain }) => {
      const explained = await runtime.explainDecisions({ filePath, intent, domain });
      return {
        content: [{ type: "text", text: explained.text }],
        structuredContent: {
          filePath,
          intent,
          domain,
          accepted: explained.accepted,
          proposed: explained.proposed
        }
      };
    }
  );

  server.tool(
    "record_architectural_decision",
    "Record an ADR under .blueprint/decisions/ for long-term architectural continuity.",
    {
      title: z.string(),
      decision: z.string(),
      rationale: z.string().optional(),
      constraints: z.array(z.string()).optional(),
      avoid: z.array(z.string()).optional(),
      domains: z.array(z.string()).optional()
    },
    async ({ title, decision, rationale, constraints, avoid, domains }) => {
      const { path: adrPath, decision: recorded } = createArchitecturalDecision(runtime.repoRoot, {
        title,
        decision,
        rationale,
        constraints,
        avoid,
        domains
      });
      return {
        content: [{ type: "text", text: `Recorded ${adrPath}\n\n${formatDecisionDetail(recorded)}` }],
        structuredContent: recorded
      };
    }
  );

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
      const result = await runtime.findExistingAbstractions({
        proposedSymbolName,
        proposedFilePath,
        intent,
        limit
      });
      const payload = {
        proposedSymbolName: result.proposedSymbolName,
        proposedFilePath: result.proposedFilePath,
        intent: result.intent,
        confidence: result.confidence,
        candidates: result.candidates
      };
      return {
        content: [{ type: "text", text: result.text }],
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
      const result = await runtime.suggestImportReuse(symbolName);
      return {
        content: [{ type: "text", text: result.text }],
        structuredContent: { symbolName: result.symbolName, suggestion: result.suggestion }
      };
    }
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
