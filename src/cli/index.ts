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
  process.stdout.write("Wrote blueprint.config.json\n");
}

async function runDoctor() {
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
  process.stdout.write(
    JSON.stringify(
      {
        repoRoot,
        configPresent: fs.existsSync(configPath),
        dbPresent: fs.existsSync(dbAbs),
        framework: config.framework,
        coverage: {
          parsedJsTsFiles: coverage.parsedJsTsFiles,
          eligibleJsTsFiles: coverage.eligibleJsTsFiles,
          parsedPythonFiles: coverage.parsedPythonFiles,
          eligiblePythonFiles: coverage.eligiblePythonFiles,
          coverageRatio: coverage.coverageRatio,
          languages: coverage.languages
        }
      },
      null,
      2
    ) + "\n"
  );
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
    modules: ir.modules
  });
  process.stdout.write(report.text + "\n");
}

async function runCheck(opts: { ci?: boolean; format?: string }) {
  const repoRoot = repoRootFromCwd();
  const { config, filesScanned, symbolsIndexed } = await scanAndIndex(repoRoot);
  const result = await runBlueprintCheck({ repoRoot, config });
  const outputFormat = opts.format === "markdown" ? "markdown" : "text";
  process.stdout.write(formatCheckOutput(result, { format: outputFormat }) + "\n");

  if (!opts.ci) {
    process.stdout.write(
      JSON.stringify(
        {
          filesScanned,
          symbolsIndexed,
          violations: result.violations.length,
          warnings: result.warnings.length
        },
        null,
        2
      ) + "\n"
    );
  }

  if (result.violations.length > 0) process.exitCode = 1;
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
program.name("blueprint").description("Blueprint MCP: architectural guardrails for AI coding agents").version("0.1.0");

program.command("init").description("Create blueprint.config.json").action(runInit);
program.command("scan").description("Scan repo and index exported symbols").action(() => runScan());
program.command("doctor").description("Language coverage, monorepo breakdown, config/db status").action(() => runDoctor());
program.command("mcp").description("Start Blueprint MCP server (stdio)").action(() => runMcp());
program.command("report").description("Generate repository architecture memory report").action(() => runReport());
program
  .command("check")
  .description("Check architecture policy violations and warnings")
  .option("--ci", "CI mode: clean output, non-zero exit on violations")
  .option("--format <format>", "Output format: text or markdown", "text")
  .action((opts: { ci?: boolean; format?: string }) => runCheck(opts));
program
  .command("infer-rules")
  .description("Infer suggested architecture policies from repo structure")
  .action(() => runInferRules());
program.command("graph").description("Build architecture graph and boundary risks").action(() => runGraph());
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

