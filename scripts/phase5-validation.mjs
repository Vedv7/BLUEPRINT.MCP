import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cli = path.join(__dirname, "../dist/cli/index.js");
const workspace = path.join(__dirname, "../..");

const targets = [
  { id: "next-blueprint-demo", dir: path.join(workspace, "next-blueprint-demo") },
  { id: "Review-Gate", dir: path.join(workspace, "validation-repos", "Review-Gate") },
  {
    id: "RankStream",
    dir: path.join(workspace, "validation-repos", "real-time-ranking-and-recommendation-platform")
  }
];

const COMMANDS = ["doctor", "scan", "report", "graph", "check", "snapshot"];

function run(cwd, args) {
  const r = spawnSync(process.execPath, [cli, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, BLUEPRINT_EMBED_MOCK: "1" },
    maxBuffer: 32 * 1024 * 1024
  });
  return { code: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

function parseDoctor(stdout) {
  const languages = {};
  for (const line of stdout.split("\n")) {
    const m = line.match(/^- (\w+[\w\s#]*): (supported|detected, unsupported), (\d+) files parsed/);
    if (m) languages[m[1].trim()] = { status: m[2], parsed: Number(m[3]) };
    const u = line.match(/^- (\w+[\w\s#]*): detected, unsupported \((\d+) files\)/);
    if (u) languages[u[1].trim()] = { status: "unsupported", inRepo: Number(u[2]), parsed: 0 };
  }
  const coverage = stdout.match(/Coverage: (\d+)\/(\d+)/);
  const symbols = stdout.match(/Symbols indexed: (\d+)/);
  const imports = stdout.match(/Import edges: (\d+)/);
  return {
    languages,
    coverageParsed: coverage ? Number(coverage[1]) : 0,
    coverageEligible: coverage ? Number(coverage[2]) : 0,
    symbolsIndexed: symbols ? Number(symbols[1]) : 0,
    importEdges: imports ? Number(imports[1]) : 0
  };
}

function parseScan(stdout) {
  try {
    return JSON.parse(stdout);
  } catch {
    return {};
  }
}

function parseGraph(stdout) {
  const flows = [];
  const risks = [];
  let inFlows = false;
  let inRisks = false;
  for (const line of stdout.split("\n")) {
    if (line.startsWith("Dependency flows:")) {
      inFlows = true;
      inRisks = false;
      continue;
    }
    if (line.startsWith("Boundary risks:")) {
      inFlows = false;
      inRisks = true;
      continue;
    }
    if (line.startsWith("Suggested policies:")) break;
    if (inFlows && line.startsWith("- ")) flows.push(line.slice(2).trim());
    if (inRisks && line.startsWith("- ")) risks.push(line.slice(2).trim());
  }
  return { flows: flows.length, flowSamples: flows.slice(0, 8), risks: risks.length, riskSamples: risks.slice(0, 8) };
}

function parseCheck(stdout) {
  const violations = (stdout.match(/Violations:\n([\s\S]*?)\n\nWarnings:/i)?.[1] ?? "")
    .split("\n")
    .filter((l) => /^\d+\./.test(l));
  const warnings = (stdout.match(/Warnings:\n([\s\S]*?)$/i)?.[1] ?? "")
    .split("\n")
    .filter((l) => /^\d+\./.test(l));
  return { violations: violations.length, warnings: warnings.length, violationSamples: violations.slice(0, 5), warningSamples: warnings.slice(0, 5) };
}

function validateRepo(target) {
  if (!fs.existsSync(target.dir)) {
    return { id: target.id, status: "missing", path: target.dir };
  }

  const row = { id: target.id, path: target.dir, commands: {}, metrics: {} };
  for (const cmd of COMMANDS) {
    const result = run(target.dir, [cmd]);
    row.commands[cmd] = { exitCode: result.code, ok: result.code === 0 };
    if (cmd === "doctor") row.metrics.doctor = parseDoctor(result.stdout);
    if (cmd === "scan") {
      const scan = parseScan(result.stdout);
      row.metrics.scan = {
        filesScanned: scan.filesScanned ?? 0,
        symbolsIndexed: scan.symbolsIndexed ?? 0
      };
    }
    if (cmd === "graph") row.metrics.graph = parseGraph(result.stdout);
    if (cmd === "check") row.metrics.check = parseCheck(result.stdout);
    if (cmd === "snapshot") {
      try {
        const snap = JSON.parse(result.stdout);
        row.metrics.snapshotPath = snap.path;
      } catch {
        row.metrics.snapshotPath = null;
      }
    }
  }
  row.status = Object.values(row.commands).every((c) => c.ok) ? "ok" : "partial";
  return row;
}

const scorecard = {
  generatedAt: new Date().toISOString(),
  blueprintCommit: spawnSync("git", ["rev-parse", "--short", "HEAD"], {
    cwd: path.join(__dirname, ".."),
    encoding: "utf8"
  }).stdout?.trim(),
  repos: targets.map(validateRepo)
};

const outDir = path.join(__dirname, "../validation-scorecard");
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, "scorecard.json");
fs.writeFileSync(outPath, JSON.stringify(scorecard, null, 2));
console.log(JSON.stringify(scorecard, null, 2));
console.error(`\nWrote ${outPath}`);
