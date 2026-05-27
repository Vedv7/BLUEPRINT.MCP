import fs from "node:fs";
import path from "node:path";
import { Command } from "commander";
import { loadConfig } from "../config/loadConfig.js";
import { extractSymbols } from "../parser/extractSymbols.js";
import { openDb } from "../db/db.js";
import { saveSymbols } from "../indexer/saveSymbols.js";
import { findDuplicateCandidates, findDuplicateForProposedSymbol } from "../engine/duplicateDetector.js";
import { verifyPlacement } from "../engine/placementEngine.js";
import { suggestImportForSymbol } from "../engine/importSuggester.js";
import { startMcpServer } from "../mcp/server.js";
import { generateBlueprintReport } from "../report/generateReport.js";
import { formatCheckOutput, runBlueprintCheck } from "../check/runCheck.js";
import { formatInferredPoliciesOutput, inferPoliciesFromRepo } from "../rules/inferRules.js";
import { buildArchitectureGraph, formatArchitectureGraphOutput } from "../graph/buildArchitectureGraph.js";
import { scanAndIndexRepo } from "../indexer/scanAndIndex.js";
import { analyzeRepoCoverage, formatDoctorReport } from "../coverage/repoCoverage.js";
import { writeBlueprintMemorySnapshot } from "../snapshot/generateSnapshot.js";
import { buildDomainModel } from "../domain/buildDomainModel.js";
import {
  formatDomainArchitectureOutput,
  formatDomainHealthMarkdown
} from "../engines/domainIntelligence.js";
import {
  buildDecisionMemory,
  createArchitecturalDecision,
  formatDecisionDetail,
  formatDecisionList,
  loadArchitecturalDecisions
} from "../decisions/store.js";
import { ensureDecisionsDir } from "../decisions/paths.js";
import {
  checkDecisionsAgainstRepo,
  formatDecisionCheckMarkdown,
  formatDecisionCheckOutput
} from "../engines/decisionGovernance.js";
import { formatAdrSuggestionsOutput, suggestAdrs } from "../engines/adrSuggest.js";
import { buildArchitectureIr } from "../ir/buildArchitectureIr.js";
import { applyStrictConfig, shouldFailCi } from "./ciExit.js";

function repoRootFromCwd() {
  return process.cwd();
}

async function runScan() {
  const repoRoot = repoRootFromCwd();
  const result = await scanAndIndexRepo(repoRoot);
  process.stdout.write(
    JSON.stringify(
      {
        filesScanned: result.filesScanned,
        symbolsIndexed: result.symbolsIndexed,
        embeddings: result.embeddings
      },
      null,
      2
    ) + "\n"
  );
}

async function scanAndIndex(repoRoot: string) {
  const result = await scanAndIndexRepo(repoRoot);
  return {
    config: result.config,
    ir: result.ir,
    filesScanned: result.filesScanned,
    symbolsIndexed: result.symbolsIndexed,
    embeddings: result.embeddings
  };
}

function runInit() {
  const repoRoot = repoRootFromCwd();
  const configPath = path.join(repoRoot, "blueprint.config.json");
  if (fs.existsSync(configPath)) {
    process.stdout.write("blueprint.config.json already exists\n");
    return;
  }
  const templatePath = path.join(path.dirname(new URL(import.meta.url).pathname), "../../blueprint.config.json");
  // Fallback: write minimal template if bundler path resolution differs.
  const template = fs.existsSync(templatePath)
    ? fs.readFileSync(templatePath, "utf8")
    : JSON.stringify(loadConfig(repoRoot), null, 2);
  fs.writeFileSync(configPath, template);
  ensureDecisionsDir(repoRoot);
  process.stdout.write("Wrote blueprint.config.json\n");
  process.stdout.write("Created .blueprint/decisions/ for architectural decision memory\n");
}

async function runDoctor(opts?: { json?: boolean }) {
  const repoRoot = repoRootFromCwd();
  const config = loadConfig(repoRoot);
  const dbAbs = path.join(repoRoot, config.dbPath);
  const configPath = path.join(repoRoot, "blueprint.config.json");
  const coverage = await analyzeRepoCoverage(repoRoot, config);
  const text = formatDoctorReport(coverage, {
    configPresent: fs.existsSync(configPath),
    dbPresent: fs.existsSync(dbAbs),
    framework: config.framework
  });
  process.stdout.write(text + "\n");
  if (opts?.json) {
    process.stdout.write(
      JSON.stringify(
        {
          repoRoot,
          configPresent: fs.existsSync(configPath),
          dbPresent: fs.existsSync(dbAbs),
          framework: config.framework,
          filesIndexed: coverage.ir.files.length,
          coverage: {
            parsedJsTsFiles: coverage.parsedJsTsFiles,
            eligibleJsTsFiles: coverage.eligibleJsTsFiles,
            parsedPythonFiles: coverage.parsedPythonFiles,
            eligiblePythonFiles: coverage.eligiblePythonFiles,
            parsedJavaFiles: coverage.parsedJavaFiles,
            eligibleJavaFiles: coverage.eligibleJavaFiles,
            coverageRatio: coverage.coverageRatio,
            languages: coverage.languages
          }
        },
        null,
        2
      ) + "\n"
    );
  }
}

async function runMcp() {
  const repoRoot = repoRootFromCwd();
  await startMcpServer({ repoRoot });
}

async function runReport() {
  const repoRoot = repoRootFromCwd();
  const { config, filesScanned, symbolsIndexed, ir } = await scanAndIndex(repoRoot);
  const report = await generateBlueprintReport({
    repoRoot,
    config,
    filesScanned,
    symbolsIndexed,
    modules: ir.modules,
    ir
  });
  process.stdout.write(report.text + "\n");
}

async function runSnapshot() {
  const repoRoot = repoRootFromCwd();
  const { config, ir } = await scanAndIndex(repoRoot);
  const result = await writeBlueprintMemorySnapshot(repoRoot, ir, config);
  process.stdout.write(JSON.stringify({ path: result.path, adapters: result.snapshot.adapters }, null, 2) + "\n");
}

async function runCheck(opts: { ci?: boolean; strict?: boolean; format?: string }) {
  const repoRoot = repoRootFromCwd();
  const { config: baseConfig, ir, filesScanned, symbolsIndexed } = await scanAndIndex(repoRoot);
  const config = applyStrictConfig(baseConfig, opts.strict);
  const result = await runBlueprintCheck({ repoRoot, config, ir });
  const outputFormat = opts.format === "markdown" ? "markdown" : "text";
  process.stdout.write(formatCheckOutput(result, { format: outputFormat }) + "\n");

  if (!opts.ci) {
    process.stdout.write(
      JSON.stringify(
        {
          filesScanned,
          symbolsIndexed,
          violations: result.violations.length,
          warnings: result.warnings.length,
          strict: Boolean(opts.strict)
        },
        null,
        2
      ) + "\n"
    );
  } else {
    process.stdout.write(
      `CI: violations=${result.violations.length} warnings=${result.warnings.length} strict=${Boolean(opts.strict)}\n`
    );
  }

  if (shouldFailCi({ violations: result.violations.length, warnings: result.warnings.length }, opts)) {
    process.exitCode = 1;
  }
}

async function runInferRules() {
  const repoRoot = repoRootFromCwd();
  const config = loadConfig(repoRoot);
  const inferred = await inferPoliciesFromRepo({ repoRoot, config });
  process.stdout.write(formatInferredPoliciesOutput(inferred) + "\n");
  process.stdout.write(
    JSON.stringify(
      {
        policies: {
          forbiddenImports: inferred.forbiddenImports,
          requiredPlacement: inferred.requiredPlacement
        }
      },
      null,
      2
    ) + "\n"
  );
}

async function runGraph() {
  const repoRoot = repoRootFromCwd();
  const { config, ir } = await scanAndIndex(repoRoot);
  const graph = await buildArchitectureGraph({ repoRoot, config, ir });
  process.stdout.write(formatArchitectureGraphOutput(graph) + "\n");
}

async function runDomains() {
  const repoRoot = repoRootFromCwd();
  const config = loadConfig(repoRoot);
  const model = await buildDomainModel({ repoRoot, config });
  process.stdout.write(formatDomainArchitectureOutput(model) + "\n");
}

async function runDomainHealth(opts: { format?: string }) {
  const repoRoot = repoRootFromCwd();
  const config = loadConfig(repoRoot);
  const model = await buildDomainModel({ repoRoot, config });
  const output =
    opts.format === "markdown" ? formatDomainHealthMarkdown(model) : formatDomainArchitectureOutput(model);
  process.stdout.write(output + "\n");
  process.stdout.write(JSON.stringify(model.health, null, 2) + "\n");
}

async function runDomainCheck() {
  const repoRoot = repoRootFromCwd();
  const config = loadConfig(repoRoot);
  const model = await buildDomainModel({ repoRoot, config });
  process.stdout.write(formatDomainArchitectureOutput(model) + "\n");
  if (model.violations.length > 0) process.exitCode = 1;
}

async function runAdrList() {
  const repoRoot = repoRootFromCwd();
  const decisions = loadArchitecturalDecisions(repoRoot);
  process.stdout.write(formatDecisionList(decisions) + "\n");
}

async function runAdrShow(id: string) {
  const repoRoot = repoRootFromCwd();
  const memory = buildDecisionMemory(repoRoot);
  const key = id.toUpperCase().startsWith("ADR-") ? id.toUpperCase() : `ADR-${id.padStart(3, "0")}`;
  const d = memory.byId.get(key);
  if (!d) {
    process.stderr.write(`Decision not found: ${key}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(formatDecisionDetail(d) + "\n");
}

async function runAdrNew(opts: {
  title: string;
  decision: string;
  rationale?: string;
  constraint?: string[];
  avoid?: string[];
  chosen?: string[];
  rejected?: string[];
  domain?: string[];
}) {
  const repoRoot = repoRootFromCwd();
  const { path, decision } = createArchitecturalDecision(repoRoot, {
    title: opts.title,
    decision: opts.decision,
    rationale: opts.rationale,
    constraints: opts.constraint,
    avoid: opts.avoid,
    chosenPatterns: opts.chosen,
    rejectedPatterns: opts.rejected,
    domains: opts.domain
  });
  process.stdout.write(`Wrote ${path}\n`);
  process.stdout.write(formatDecisionDetail(decision) + "\n");
}

async function runAdrCheck(opts?: { ci?: boolean; strict?: boolean; format?: string }) {
  const repoRoot = repoRootFromCwd();
  const config = loadConfig(repoRoot);
  const ir = await buildArchitectureIr(repoRoot, config);
  const memory = buildDecisionMemory(repoRoot);
  const result = checkDecisionsAgainstRepo(ir, config, memory);
  const output =
    opts?.format === "markdown" ? formatDecisionCheckMarkdown(result) : formatDecisionCheckOutput(result);
  process.stdout.write(output + "\n");

  if (opts?.ci) {
    process.stdout.write(
      `CI: violations=${result.violations.length} warnings=${result.warnings.length} strict=${Boolean(opts?.strict)}\n`
    );
  }

  if (shouldFailCi({ violations: result.violations.length, warnings: result.warnings.length }, opts ?? {})) {
    process.exitCode = 1;
  }
}

async function runAdrSuggest() {
  const repoRoot = repoRootFromCwd();
  const config = loadConfig(repoRoot);
  const ir = await buildArchitectureIr(repoRoot, config);
  const memory = buildDecisionMemory(repoRoot);
  const suggestions = suggestAdrs(ir, memory);
  process.stdout.write(formatAdrSuggestionsOutput(suggestions) + "\n");
}

async function runFindDuplicates(symbolName: string, limit = 5, proposedFilePath?: string, intent?: string) {
  const repoRoot = repoRootFromCwd();
  const config = loadConfig(repoRoot);
  const dbAbs = path.join(repoRoot, config.dbPath);
  const db = await openDb(dbAbs);
  const candidates = await findDuplicateCandidates(db, symbolName, limit, proposedFilePath, intent, {
    pathAliases: config.pathAliases
  });
  await db.close();
  process.stdout.write(JSON.stringify({ symbolName, proposedFilePath, intent, candidates }, null, 2) + "\n");
}

async function runSuggestImport(symbolName: string) {
  const repoRoot = repoRootFromCwd();
  const config = loadConfig(repoRoot);
  const dbAbs = path.join(repoRoot, config.dbPath);
  const db = await openDb(dbAbs);
  const suggestion = await suggestImportForSymbol(db, symbolName, { pathAliases: config.pathAliases });
  await db.close();
  process.stdout.write(JSON.stringify({ symbolName, suggestion }, null, 2) + "\n");
}

async function runVerify(symbolName: string, proposedFilePath: string, intent: string) {
  const repoRoot = repoRootFromCwd();
  const config = loadConfig(repoRoot);
  const dbAbs = path.join(repoRoot, config.dbPath);
  const db = await openDb(dbAbs);
  const dup = await findDuplicateForProposedSymbol(db, symbolName, proposedFilePath, intent, {
    pathAliases: config.pathAliases
  });
  await db.close();

  const placement = verifyPlacement({
    proposedFilePath,
    intent,
    placementRules: config.placementRules
  });
  const severity = dup.duplicateRisk === "high" || !placement.ok ? "high" : dup.duplicateRisk === "medium" ? "medium" : "low";
  const decision = config.enforcementMode === "enforce" && severity === "high" ? "BLOCKED" : severity === "low" ? "ALLOW" : "ADVISORY";

  process.stdout.write(
    JSON.stringify(
      {
        decision,
        mode: config.enforcementMode,
        severity,
        duplicate: dup,
        placement
      },
      null,
      2
    ) + "\n"
  );
}

const program = new Command();
program.name("blueprint").description("Blueprint MCP: architectural guardrails for AI coding agents").version("0.2.0");

program.command("init").description("Create blueprint.config.json").action(runInit);
program.command("scan").description("Scan repo and index exported symbols").action(() => runScan());
program
  .command("doctor")
  .description("Language coverage, monorepo breakdown, config/db status")
  .option("--json", "Also print machine-readable JSON summary")
  .action((opts: { json?: boolean }) => runDoctor(opts));
program.command("mcp").description("Start Blueprint MCP server (stdio)").action(() => runMcp());
program.command("report").description("Generate repository architecture memory report").action(() => runReport());
program
  .command("check")
  .description("Check architecture policy violations and warnings")
  .option("--ci", "CI mode: exit non-zero on violations (warnings only with --strict)")
  .option("--strict", "CI strict gate: fail on warnings too; use strictness for checks")
  .option("--format <format>", "Output format: text or markdown", "text")
  .action((opts: { ci?: boolean; strict?: boolean; format?: string }) => runCheck(opts));
program
  .command("infer-rules")
  .description("Infer suggested architecture policies from repo structure")
  .action(() => runInferRules());
program.command("graph").description("Build architecture graph and boundary risks").action(() => runGraph());
program
  .command("domains")
  .description("Infer business domains, ownership stacks, and domain health")
  .action(() => runDomains());
program
  .command("domain-health")
  .description("Architecture health score from domain governance signals")
  .option("--format <format>", "text or markdown", "text")
  .action((opts: { format?: string }) => runDomainHealth(opts));
program
  .command("domain-check")
  .description("Domain boundary violations and architectural drift (CI-friendly exit code)")
  .action(() => runDomainCheck());

const adr = program.command("adr").description("Architectural decision memory (.blueprint/decisions/)");

adr.command("list").description("List recorded ADRs").action(() => runAdrList());

adr
  .command("show")
  .description("Show one ADR by id (e.g. ADR-001)")
  .argument("<id>", "ADR id")
  .action((id: string) => runAdrShow(id));

adr
  .command("new")
  .description("Record a new architectural decision")
  .requiredOption("-t, --title <title>", "Short title")
  .requiredOption("-d, --decision <text>", "Decision statement")
  .option("-r, --rationale <text>", "Why this decision")
  .option("-c, --constraint <text>", "Constraint (repeatable)", (v: string, acc: string[]) => [...acc, v], [] as string[])
  .option("--avoid <text>", "Pattern to avoid (repeatable)", (v: string, acc: string[]) => [...acc, v], [] as string[])
  .option("--chosen <text>", "Chosen pattern (repeatable)", (v: string, acc: string[]) => [...acc, v], [] as string[])
  .option("--rejected <text>", "Rejected pattern (repeatable)", (v: string, acc: string[]) => [...acc, v], [] as string[])
  .option("--domain <name>", "Domain tag (repeatable)", (v: string, acc: string[]) => [...acc, v], [] as string[])
  .action((opts: {
    title: string;
    decision: string;
    rationale?: string;
    constraint: string[];
    avoid: string[];
    chosen: string[];
    rejected: string[];
    domain: string[];
  }) => runAdrNew(opts));

adr
  .command("check")
  .description("Check repo against recorded decision constraints")
  .option("--ci", "CI mode: exit non-zero on ADR violations (warnings only with --strict)")
  .option("--strict", "CI strict gate: fail on ADR warnings; only accepted ADRs enforce")
  .option("--format <format>", "text or markdown", "text")
  .action((opts: { ci?: boolean; strict?: boolean; format?: string }) => runAdrCheck(opts));

adr
  .command("suggest")
  .description("Suggest new ADRs from repeated architectural patterns")
  .action(() => runAdrSuggest());

program
  .command("decide")
  .description("Alias: record a decision (blueprint adr new)")
  .requiredOption("-t, --title <title>", "Short title")
  .requiredOption("-d, --decision <text>", "Decision statement")
  .option("-r, --rationale <text>", "Why this decision")
  .option("-c, --constraint <text>", "Constraint (repeatable)", (v: string, acc: string[]) => [...acc, v], [] as string[])
  .option("--avoid <text>", "Pattern to avoid (repeatable)", (v: string, acc: string[]) => [...acc, v], [] as string[])
  .option("--domain <name>", "Domain tag (repeatable)", (v: string, acc: string[]) => [...acc, v], [] as string[])
  .action((opts: {
    title: string;
    decision: string;
    rationale?: string;
    constraint: string[];
    avoid: string[];
    domain: string[];
  }) => runAdrNew(opts));

program
  .command("snapshot")
  .description("Write blueprint.memory.json architecture snapshot for agents")
  .action(() => runSnapshot());
program
  .command("find-duplicates")
  .description("Find likely duplicate symbols")
  .argument("<symbolName>", "Proposed symbol name")
  .option("-l, --limit <n>", "Max candidates", "5")
  .option("-p, --path <proposedFilePath>", "Optional proposed file path")
  .option("-i, --intent <intent>", "Optional intent text")
  .action((symbolName: string, opts: { limit: string; path?: string; intent?: string }) =>
    runFindDuplicates(symbolName, Number(opts.limit), opts.path, opts.intent)
  );
program
  .command("suggest-import")
  .description("Suggest canonical import for symbol")
  .argument("<symbolName>", "Desired symbol name")
  .action((symbolName: string) => runSuggestImport(symbolName));
program
  .command("verify")
  .description("Verify duplicate risk and file placement")
  .argument("<symbolName>", "Proposed symbol name")
  .argument("<proposedFilePath>", "Repo-relative file path")
  .argument("<intent>", "Intent text")
  .action((symbolName: string, proposedFilePath: string, intent: string) => runVerify(symbolName, proposedFilePath, intent));

program.parse(process.argv);

