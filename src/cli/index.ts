import fs from "node:fs";
import path from "node:path";
import { Command } from "commander";
import { loadConfig } from "../config/loadConfig.js";
import { formatDoctorReport } from "../coverage/repoCoverage.js";
import {
  buildDecisionMemory,
  createArchitecturalDecision,
  formatDecisionDetail,
  formatDecisionList,
  loadArchitecturalDecisions
} from "../decisions/store.js";
import { ensureDecisionsDir } from "../decisions/paths.js";
import { formatAdrSuggestionsOutput, suggestAdrs } from "../engines/adrSuggest.js";
import { createRuntime } from "../runtime/createRuntime.js";
import { startMcpServer } from "../mcp/server.js";
import { runValidate } from "./runValidate.js";

function repoRootFromCwd() {
  return process.cwd();
}

function runtime() {
  return createRuntime({ repoRoot: repoRootFromCwd() });
}

function runInit() {
  const repoRoot = repoRootFromCwd();
  const configPath = path.join(repoRoot, "blueprint.config.json");
  if (fs.existsSync(configPath)) {
    process.stdout.write("blueprint.config.json already exists\n");
    return;
  }
  const templatePath = path.join(path.dirname(new URL(import.meta.url).pathname), "../../blueprint.config.json");
  const template = fs.existsSync(templatePath)
    ? fs.readFileSync(templatePath, "utf8")
    : JSON.stringify(loadConfig(repoRoot), null, 2);
  fs.writeFileSync(configPath, template);
  ensureDecisionsDir(repoRoot);
  process.stdout.write("Wrote blueprint.config.json\n");
  process.stdout.write("Created .blueprint/decisions/ for architectural decision memory\n");
}

async function runScan() {
  const scan = await runtime().scan();
  process.stdout.write(
    JSON.stringify(
      {
        filesScanned: scan.filesScanned,
        symbolsIndexed: scan.symbolsIndexed,
        embeddings: scan.embeddings
      },
      null,
      2
    ) + "\n"
  );
}

async function runDoctor(opts?: { json?: boolean }) {
  const rt = runtime();
  const doctor = await rt.doctor();
  process.stdout.write(
    formatDoctorReport(doctor.coverage, {
      configPresent: doctor.configPresent,
      dbPresent: doctor.dbPresent,
      framework: doctor.framework
    }) + "\n"
  );
  if (opts?.json) {
    process.stdout.write(
      JSON.stringify(
        {
          repoRoot: rt.repoRoot,
          configPresent: doctor.configPresent,
          dbPresent: doctor.dbPresent,
          framework: doctor.framework,
          filesIndexed: doctor.coverage.ir.files.length,
          coverage: {
            parsedJsTsFiles: doctor.coverage.parsedJsTsFiles,
            eligibleJsTsFiles: doctor.coverage.eligibleJsTsFiles,
            parsedPythonFiles: doctor.coverage.parsedPythonFiles,
            eligiblePythonFiles: doctor.coverage.eligiblePythonFiles,
            parsedJavaFiles: doctor.coverage.parsedJavaFiles,
            eligibleJavaFiles: doctor.coverage.eligibleJavaFiles,
            coverageRatio: doctor.coverage.coverageRatio,
            languages: doctor.coverage.languages
          }
        },
        null,
        2
      ) + "\n"
    );
  }
}

async function runMcp() {
  await startMcpServer({ repoRoot: repoRootFromCwd() });
}

async function runReport() {
  const report = await runtime().report();
  process.stdout.write(report.text + "\n");
}

async function runSnapshot() {
  const snap = await runtime().snapshot();
  process.stdout.write(JSON.stringify({ path: snap.path, adapters: snap.adapters }, null, 2) + "\n");
}

async function runCheck(opts: { ci?: boolean; strict?: boolean; format?: string }) {
  const check = await runtime().check({
    strict: opts.strict,
    format: opts.format === "markdown" ? "markdown" : "text"
  });
  process.stdout.write(check.text + "\n");

  if (!opts.ci) {
    process.stdout.write(
      JSON.stringify(
        {
          filesScanned: check.filesScanned,
          symbolsIndexed: check.symbolsIndexed,
          violations: check.result.violations.length,
          warnings: check.result.warnings.length,
          strict: Boolean(opts.strict)
        },
        null,
        2
      ) + "\n"
    );
  } else {
    process.stdout.write(
      `CI: violations=${check.ci.violations} warnings=${check.ci.warnings} strict=${check.ci.strict}\n`
    );
  }

  if (opts.ci && check.ci.shouldFail) {
    process.exitCode = 1;
  }
}

async function runInferRules() {
  const inferred = await runtime().inferRules();
  process.stdout.write(inferred.text + "\n");
  process.stdout.write(
    JSON.stringify(
      {
        policies: {
          forbiddenImports: inferred.policies.forbiddenImports,
          requiredPlacement: inferred.policies.requiredPlacement
        }
      },
      null,
      2
    ) + "\n"
  );
}

async function runGraph() {
  const graph = await runtime().graph();
  process.stdout.write(graph.text + "\n");
}

async function runDomains() {
  const domains = await runtime().domains();
  process.stdout.write(domains.text + "\n");
}

async function runDomainHealth(opts: { format?: string }) {
  const rt = runtime();
  if (opts.format === "markdown") {
    const health = await rt.domainHealth();
    process.stdout.write(health.text + "\n");
    process.stdout.write(JSON.stringify(health.health, null, 2) + "\n");
  } else {
    const domains = await rt.domains();
    process.stdout.write(domains.text + "\n");
    const health = await rt.domainHealth({ useSession: true });
    process.stdout.write(JSON.stringify(health.health, null, 2) + "\n");
  }
}

async function runDomainCheck() {
  const domains = await runtime().domains();
  process.stdout.write(domains.text + "\n");
  if (domains.model.violations.length > 0) process.exitCode = 1;
}

async function runAdrList() {
  const decisions = loadArchitecturalDecisions(repoRootFromCwd());
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
  const { path: adrPath, decision } = createArchitecturalDecision(repoRoot, {
    title: opts.title,
    decision: opts.decision,
    rationale: opts.rationale,
    constraints: opts.constraint,
    avoid: opts.avoid,
    chosenPatterns: opts.chosen,
    rejectedPatterns: opts.rejected,
    domains: opts.domain
  });
  process.stdout.write(`Wrote ${adrPath}\n`);
  process.stdout.write(formatDecisionDetail(decision) + "\n");
}

async function runAdrCheck(opts?: { ci?: boolean; strict?: boolean; format?: string }) {
  const adr = await runtime().adrCheck({
    strict: opts?.strict,
    format: opts?.format === "markdown" ? "markdown" : "text"
  });
  process.stdout.write(adr.text + "\n");

  if (opts?.ci) {
    process.stdout.write(
      `CI: violations=${adr.ci.violations} warnings=${adr.ci.warnings} strict=${adr.ci.strict}\n`
    );
  }

  if (opts?.ci && adr.ci.shouldFail) {
    process.exitCode = 1;
  }
}

async function runAdrSuggest() {
  const rt = runtime();
  const scan = await rt.scan();
  const memory = buildDecisionMemory(rt.repoRoot);
  const suggestions = suggestAdrs(scan.ir, memory);
  process.stdout.write(formatAdrSuggestionsOutput(suggestions) + "\n");
}

async function runFindDuplicates(symbolName: string, limit = 5, proposedFilePath?: string, intent?: string) {
  const found = await runtime().findExistingAbstractions({
    proposedSymbolName: symbolName,
    proposedFilePath,
    intent,
    limit
  });
  process.stdout.write(
    JSON.stringify(
      {
        symbolName,
        proposedFilePath,
        intent,
        candidates: found.candidates
      },
      null,
      2
    ) + "\n"
  );
}

async function runSuggestImport(symbolName: string) {
  const result = await runtime().suggestImportReuse(symbolName);
  process.stdout.write(JSON.stringify({ symbolName, suggestion: result.suggestion }, null, 2) + "\n");
}

async function runVerify(symbolName: string, proposedFilePath: string, intent: string) {
  const advisory = await runtime().getAgentAdvisory({
    proposedSymbolName: symbolName,
    proposedFilePath,
    intent
  });
  process.stdout.write(
    JSON.stringify(
      {
        decision: advisory.decision,
        mode: advisory.mode,
        severity: advisory.severity,
        duplicate: advisory.duplicate,
        placement: advisory.placement
      },
      null,
      2
    ) + "\n"
  );
}

const program = new Command();
program.name("blueprint").description("Blueprint MCP: architectural guardrails for AI coding agents").version("0.2.2");

program.command("init").description("Create blueprint.config.json").action(runInit);
program
  .command("validate")
  .description("Run the common workflow: scan, doctor, check --ci, adr check --ci, snapshot")
  .option("--full", "Also run report, graph, domains, and domain-health")
  .option("--strict", "CI strict gate: fail on policy/ADR warnings too")
  .action(async (opts: { full?: boolean; strict?: boolean }) => {
    await runValidate(opts);
  });
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

adr.command("suggest").description("Suggest new ADRs from repeated architectural patterns").action(() => runAdrSuggest());

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

program.command("snapshot").description("Write blueprint.memory.json architecture snapshot for agents").action(() => runSnapshot());
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
