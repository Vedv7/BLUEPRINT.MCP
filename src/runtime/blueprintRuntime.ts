import fs from "node:fs";
import path from "node:path";
import { formatCheckOutput, runBlueprintCheck } from "../check/runCheck.js";
import { applyStrictConfig, shouldFailCi } from "../cli/ciExit.js";
import { analyzeRepoCoverage } from "../coverage/repoCoverage.js";
import { buildDomainModel } from "../domain/buildDomainModel.js";
import { buildDecisionMemory } from "../decisions/store.js";
import { openDb } from "../db/db.js";
import { indexSymbolEmbeddings } from "../embeddings/indexSymbols.js";
import {
  buildDomainAdvisory,
  buildDomainArchitecture,
  domainAdvisoryText,
  filterCandidatesByDomain,
  formatDomainArchitectureOutput,
  formatDomainHealthMarkdown
} from "../engines/domainIntelligence.js";
import {
  checkDecisionsAgainstRepo,
  decisionContinuityAdvisory,
  explainArchitecturalDecisions,
  formatDecisionCheckMarkdown,
  formatDecisionCheckOutput
} from "../engines/decisionGovernance.js";
import { buildArchitectureGraphFromIr, formatArchitectureGraphOutput } from "../engines/architectureGraph.js";
import { findDuplicateCandidates, findDuplicateForProposedSymbol } from "../engine/duplicateDetector.js";
import { suggestImportForSymbol } from "../engine/importSuggester.js";
import { verifyPlacement } from "../engine/placementEngine.js";
import { buildArchitectureIr } from "../ir/buildArchitectureIr.js";
import type { ArchitectureIR } from "../ir/types.js";
import { persistArchitectureIr } from "../ir/persistIr.js";
import { scanAndIndexRepo } from "../indexer/scanAndIndex.js";
import { formatInferredPoliciesOutput, inferPoliciesFromRepo } from "../rules/inferRules.js";
import { generateBlueprintReport } from "../report/generateReport.js";
import { writeBlueprintMemorySnapshot } from "../snapshot/generateSnapshot.js";
import {
  advisoryDecision,
  advisoryTextForAbstraction,
  composeAgentAdvisoryText,
  placementTextForAdvisory
} from "./formatAdvisory.js";
import type {
  AdrCheckOptions,
  AdrCheckResult,
  AgentAdvisoryInput,
  AgentAdvisoryResult,
  BlueprintRuntimeContext,
  CheckOptions,
  DoctorOptions,
  DoctorResult,
  DomainsResult,
  ExplainDecisionsInput,
  ExplainDecisionsResult,
  FindAbstractionsInput,
  FindAbstractionsResult,
  GraphResult,
  InferRulesResult,
  ReportResult,
  RuntimeCheckResult,
  RuntimeSession,
  ScanOptions,
  ScanResult,
  SnapshotResult,
  SuggestImportResult,
  ValidateOptions,
  ValidateResult,
  ValidateStepResult
} from "./runtimeTypes.js";

export class BlueprintRuntime {
  private session: RuntimeSession | null = null;

  readonly repoRoot: string;
  readonly config: BlueprintRuntimeContext["config"];

  constructor(ctx: BlueprintRuntimeContext) {
    this.repoRoot = path.resolve(ctx.repoRoot);
    this.config = ctx.config;
  }

  get sessionIndex(): RuntimeSession | null {
    return this.session;
  }

  private dbPath(): string {
    return path.join(this.repoRoot, this.config.dbPath);
  }

  private async persistAndEmbed(ir: RuntimeSession["ir"], enableEmbeddings?: boolean) {
    const config = this.config;
    if (enableEmbeddings) {
      config.embeddings.enabled = true;
    }
    const db = await openDb(this.dbPath());
    await persistArchitectureIr(db, ir);
    const embeddings = await indexSymbolEmbeddings({
      repoRoot: this.repoRoot,
      config,
      db,
      scannedFilesRel: ir.files.map((f) => f.path),
      forceMock: process.env.BLUEPRINT_EMBED_MOCK === "1"
    });
    await db.close();
    return embeddings;
  }

  private setSession(ir: RuntimeSession["ir"], embeddings: RuntimeSession["embeddings"]) {
    this.session = {
      ir,
      filesScanned: ir.files.length,
      symbolsIndexed: ir.symbols.length,
      embeddings
    };
  }

  private async resolveIr(opts?: { refresh?: boolean; useSession?: boolean }): Promise<ArchitectureIR> {
    if (opts?.useSession !== false && this.session && !opts?.refresh) {
      return this.session.ir;
    }
    const scan = await this.scan({ refresh: opts?.refresh ?? !this.session });
    return scan.ir;
  }

  async scan(opts: ScanOptions = {}): Promise<ScanResult> {
    if (this.session && !opts.refresh && !opts.exportedOnly) {
      const { ir, embeddings, filesScanned, symbolsIndexed } = this.session;
      return {
        ir,
        embeddings,
        filesScanned,
        symbolsIndexed,
        adapters: ir.adapters
      };
    }

    if (opts.exportedOnly) {
      const ir = await buildArchitectureIr(this.repoRoot, this.config, { exportedOnly: true });
      const embeddings = await this.persistAndEmbed(ir, opts.enableEmbeddings);
      this.setSession(ir, embeddings);
      return {
        ir,
        embeddings,
        filesScanned: ir.files.length,
        symbolsIndexed: ir.symbols.length,
        adapters: ir.adapters
      };
    }

    const indexed = await scanAndIndexRepo(this.repoRoot, {
      enableEmbeddings: opts.enableEmbeddings,
      forceMockEmbeddings: process.env.BLUEPRINT_EMBED_MOCK === "1"
    });
    this.setSession(indexed.ir, indexed.embeddings);
    return {
      ir: indexed.ir,
      embeddings: indexed.embeddings,
      filesScanned: indexed.filesScanned,
      symbolsIndexed: indexed.symbolsIndexed,
      adapters: indexed.ir.adapters
    };
  }

  async doctor(opts: DoctorOptions = {}): Promise<DoctorResult> {
    const ir = opts.useSession !== false ? await this.resolveIr() : await buildArchitectureIr(this.repoRoot, this.config);
    const coverage = await analyzeRepoCoverage(this.repoRoot, this.config, { ir });
    const configPath = path.join(this.repoRoot, "blueprint.config.json");
    return {
      coverage,
      configPresent: fs.existsSync(configPath),
      dbPresent: fs.existsSync(this.dbPath()),
      framework: this.config.framework
    };
  }

  async report(opts?: { refresh?: boolean }): Promise<ReportResult> {
    const scan = await this.scan({ refresh: opts?.refresh });
    const report = await generateBlueprintReport({
      repoRoot: this.repoRoot,
      config: this.config,
      filesScanned: scan.filesScanned,
      symbolsIndexed: scan.symbolsIndexed,
      modules: scan.ir.modules,
      ir: scan.ir
    });
    return {
      text: report.text,
      filesScanned: scan.filesScanned,
      symbolsIndexed: scan.symbolsIndexed
    };
  }

  async graph(opts?: { refresh?: boolean; useSession?: boolean }): Promise<GraphResult> {
    const ir = await this.resolveIr({ refresh: opts?.refresh, useSession: opts?.useSession });
    const graph = buildArchitectureGraphFromIr(ir, this.config);
    return {
      graph,
      text: formatArchitectureGraphOutput(graph)
    };
  }

  async check(opts: CheckOptions = {}): Promise<RuntimeCheckResult> {
    const ir = await this.resolveIr({ refresh: opts.refresh, useSession: opts.useSession });
    const config = applyStrictConfig(this.config, opts.strict);
    const result = await runBlueprintCheck({ repoRoot: this.repoRoot, config, ir });
    const format = opts.format === "markdown" ? "markdown" : "text";
    const text = formatCheckOutput(result, { format });
    const ciOpts = { ci: true as const, strict: opts.strict };
    return {
      result,
      text,
      filesScanned: ir.files.length,
      symbolsIndexed: ir.symbols.length,
      ci: {
        violations: result.violations.length,
        warnings: result.warnings.length,
        strict: Boolean(opts.strict),
        shouldFail: shouldFailCi(
          { violations: result.violations.length, warnings: result.warnings.length },
          ciOpts
        )
      }
    };
  }

  async adrCheck(opts: AdrCheckOptions = {}): Promise<AdrCheckResult> {
    const ir = await this.resolveIr({ refresh: opts.refresh, useSession: opts.useSession });
    const config = applyStrictConfig(this.config, opts.strict);
    const memory = buildDecisionMemory(this.repoRoot);
    const result = checkDecisionsAgainstRepo(ir, config, memory);
    const text =
      opts.format === "markdown" ? formatDecisionCheckMarkdown(result) : formatDecisionCheckOutput(result);
    const ciOpts = { ci: true as const, strict: opts.strict };
    return {
      result,
      text,
      ci: {
        violations: result.violations.length,
        warnings: result.warnings.length,
        strict: Boolean(opts.strict),
        shouldFail: shouldFailCi(
          { violations: result.violations.length, warnings: result.warnings.length },
          ciOpts
        )
      }
    };
  }

  async snapshot(opts?: { refresh?: boolean }): Promise<SnapshotResult> {
    const ir = await this.resolveIr({ refresh: opts?.refresh });
    const snap = await writeBlueprintMemorySnapshot(this.repoRoot, ir, this.config);
    return {
      path: snap.path,
      adapters: snap.snapshot.adapters
    };
  }

  async domains(opts?: { refresh?: boolean; useSession?: boolean }): Promise<DomainsResult> {
    const ir = await this.resolveIr({ refresh: opts?.refresh, useSession: opts?.useSession });
    const model = await buildDomainModel({ repoRoot: this.repoRoot, config: this.config, ir });
    return {
      model,
      text: formatDomainArchitectureOutput(model)
    };
  }

  async domainHealth(opts?: { refresh?: boolean; useSession?: boolean }) {
    const { model } = await this.domains(opts);
    return {
      model,
      text: `${formatDomainHealthMarkdown(model)}\n\n${formatDomainArchitectureOutput(model)}`,
      health: model.health
    };
  }

  async inferRules(): Promise<InferRulesResult> {
    const policies = await inferPoliciesFromRepo({ repoRoot: this.repoRoot, config: this.config });
    return {
      policies,
      text: formatInferredPoliciesOutput(policies)
    };
  }

  async explainDecisions(input: ExplainDecisionsInput = {}): Promise<ExplainDecisionsResult> {
    const memory = buildDecisionMemory(this.repoRoot);
    const text = explainArchitecturalDecisions(memory, input);
    return {
      text,
      accepted: memory.decisions.filter((d) => d.status === "accepted").length,
      proposed: memory.decisions.filter((d) => d.status === "proposed").length
    };
  }

  async findExistingAbstractions(input: FindAbstractionsInput): Promise<FindAbstractionsResult> {
    const limit = input.limit ?? 5;
    const db = await openDb(this.dbPath());
    let candidates = await findDuplicateCandidates(
      db,
      input.proposedSymbolName,
      limit,
      input.proposedFilePath,
      input.intent,
      { pathAliases: this.config.pathAliases, config: this.config, repoRoot: this.repoRoot }
    );
    await db.close();

    if (input.proposedFilePath) {
      candidates = filterCandidatesByDomain(candidates, input.proposedFilePath, this.config);
    }

    const ir = await this.resolveIr();
    const domainModel = input.proposedFilePath ? buildDomainArchitecture(ir, this.config) : null;
    const domainAdvisory =
      input.proposedFilePath && domainModel
        ? buildDomainAdvisory({
            proposedFilePath: input.proposedFilePath,
            proposedSymbolName: input.proposedSymbolName,
            intent: input.intent,
            model: domainModel,
            config: this.config
          })
        : null;

    const memory = buildDecisionMemory(this.repoRoot);
    const decisionContinuity = decisionContinuityAdvisory(memory, {
      filePath: input.proposedFilePath,
      intent: input.intent,
      domain: domainAdvisory?.domain
    });

    const best = candidates[0];
    const confidence = best?.duplicateRisk ?? "none";
    const text = composeAgentAdvisoryText([
      decisionContinuity,
      domainAdvisory ? domainAdvisoryText(domainAdvisory) : null,
      advisoryTextForAbstraction({
        file: best?.file,
        symbol: best?.symbol,
        suggestedImport: best?.suggestedImport,
        confidence,
        action: best ? "Prefer reuse/import over creating duplicate code." : "Proceed with implementation.",
        reasons: best?.reasons
      })
    ]);

    return {
      proposedSymbolName: input.proposedSymbolName,
      proposedFilePath: input.proposedFilePath,
      intent: input.intent,
      confidence,
      candidates,
      domain: domainAdvisory,
      decisionContinuity,
      text
    };
  }

  async suggestImportReuse(symbolName: string): Promise<SuggestImportResult> {
    const db = await openDb(this.dbPath());
    const suggestion = await suggestImportForSymbol(db, symbolName, { pathAliases: this.config.pathAliases });
    await db.close();
    const text = advisoryTextForAbstraction({
      file: suggestion.file ?? undefined,
      symbol: suggestion.symbol,
      suggestedImport: suggestion.suggestedImport ?? undefined,
      confidence: suggestion.strategy === "exact" ? "high" : suggestion.strategy === "nearest" ? "medium" : "none",
      action: suggestion.suggestedImport ? "Reuse the suggested import." : "No reuse suggestion found."
    });
    return { symbolName, suggestion, text };
  }

  async getAgentAdvisory(input: AgentAdvisoryInput): Promise<AgentAdvisoryResult> {
    const memory = buildDecisionMemory(this.repoRoot);
    const decisionContinuity = decisionContinuityAdvisory(memory, {
      filePath: input.proposedFilePath,
      intent: input.intent
    });

    const ir = await this.resolveIr();
    const domainModel = buildDomainArchitecture(ir, this.config);
    const domainAdvisory = buildDomainAdvisory({
      proposedFilePath: input.proposedFilePath,
      proposedSymbolName: input.proposedSymbolName,
      intent: input.intent,
      model: domainModel,
      config: this.config
    });

    const db = await openDb(this.dbPath());
    const duplicate = await findDuplicateForProposedSymbol(
      db,
      input.proposedSymbolName,
      input.proposedFilePath,
      input.intent,
      { pathAliases: this.config.pathAliases, config: this.config, repoRoot: this.repoRoot }
    );
    await db.close();

    const placement = verifyPlacement({
      proposedFilePath: input.proposedFilePath,
      intent: input.intent,
      placementRules: this.config.placementRules
    });

    const { decision, mode, severity } = advisoryDecision({
      enforcementMode: this.config.enforcementMode,
      duplicateRisk: duplicate.duplicateRisk,
      placementOk: placement.ok
    });

    const findResult = await this.findExistingAbstractions({
      proposedSymbolName: input.proposedSymbolName,
      proposedFilePath: input.proposedFilePath,
      intent: input.intent,
      limit: input.limit ?? 5
    });

    const suggestedAction =
      duplicate.match && duplicate.duplicateRisk !== "low"
        ? {
            message: `Use existing ${duplicate.match.symbol} from ${duplicate.match.file}`,
            suggestedImport: duplicate.suggestedImport
          }
        : placement.ok
          ? null
          : {
              message: `Suggested location: ${placement.suggestedPath}`,
              suggestedPath: placement.suggestedPath
            };

    const text = composeAgentAdvisoryText([
      decisionContinuity,
      domainAdvisoryText(domainAdvisory),
      advisoryTextForAbstraction({
        file: duplicate.match?.file,
        symbol: duplicate.match?.symbol,
        suggestedImport: duplicate.suggestedImport,
        confidence: duplicate.duplicateRisk,
        action:
          decision === "BLOCKED"
            ? "Do not create duplicate. Reuse existing function."
            : decision === "ADVISORY"
              ? "Prefer reuse and follow placement guidance."
              : "Proceed.",
        reasons: duplicate.reasons,
        explanation: duplicate.explanation
      })
    ]);

    return {
      decision,
      mode,
      severity,
      proposedSymbolName: input.proposedSymbolName,
      proposedFilePath: input.proposedFilePath,
      intent: input.intent,
      confidence: findResult.confidence,
      candidates: findResult.candidates,
      duplicate,
      placement,
      domain: domainAdvisory,
      decisionContinuity,
      suggestedAction,
      text
    };
  }

  async validate(opts: ValidateOptions = {}): Promise<ValidateResult> {
    const steps: ValidateStepResult[] = [];

    const scan = await this.scan({ refresh: true });
    steps.push({
      id: "scan",
      ok: true,
      detail: `${scan.filesScanned} files, ${scan.symbolsIndexed} symbols`
    });
    steps.push({ id: "doctor", ok: true });

    const check = await this.check({ strict: opts.strict, useSession: true });
    steps.push({
      id: "check",
      ok: !check.ci.shouldFail,
      detail: `${check.ci.violations} violations, ${check.ci.warnings} warnings`
    });

    const adr = await this.adrCheck({ strict: opts.strict, useSession: true });
    steps.push({
      id: "adr check",
      ok: !adr.ci.shouldFail,
      detail: `${adr.ci.violations} violations, ${adr.ci.warnings} warnings`
    });

    const snap = await this.snapshot();
    steps.push({ id: "snapshot", ok: true, detail: snap.path });

    if (opts.full) {
      await this.report();
      steps.push({ id: "report", ok: true });
      await this.graph({ useSession: true });
      steps.push({ id: "graph", ok: true });
      const domains = await this.domains({ useSession: true });
      steps.push({ id: "domains", ok: true, detail: `${domains.model.domains.length} domains` });
      const health = await this.domainHealth({ useSession: true });
      steps.push({
        id: "domain-health",
        ok: true,
        detail: `score ${health.health.score}`
      });
    }

    const ok = steps.every((s) => s.ok);
    return { ok, steps };
  }
}
