import path from "node:path";
import { formatDoctorReport } from "../coverage/repoCoverage.js";
import { createRuntime } from "../runtime/createRuntime.js";
import type { ValidateOptions } from "../runtime/runtimeTypes.js";

function writeln(text: string) {
  process.stdout.write(text.endsWith("\n") ? text : text + "\n");
}

function section(title: string) {
  writeln("");
  writeln(`--- ${title} ---`);
  writeln("");
}

export async function runValidate(opts: ValidateOptions = {}) {
  const runtime = createRuntime({ repoRoot: process.cwd() });
  const configPath = path.join(runtime.repoRoot, "blueprint.config.json");

  writeln("=== Blueprint validate ===");

  section("scan");
  const scan = await runtime.scan({ refresh: true });
  writeln(
    JSON.stringify(
      {
        filesScanned: scan.filesScanned,
        symbolsIndexed: scan.symbolsIndexed,
        embeddings: scan.embeddings
      },
      null,
      2
    )
  );

  section("doctor");
  const doctor = await runtime.doctor({ useSession: true });
  writeln(
    formatDoctorReport(doctor.coverage, {
      configPresent: doctor.configPresent,
      dbPresent: doctor.dbPresent,
      framework: doctor.framework
    })
  );

  section("check");
  const check = await runtime.check({ strict: opts.strict, useSession: true });
  writeln(check.text);
  writeln(
    `CI: violations=${check.ci.violations} warnings=${check.ci.warnings} strict=${check.ci.strict}`
  );

  section("adr check");
  const adr = await runtime.adrCheck({ strict: opts.strict, useSession: true });
  writeln(adr.text);
  writeln(`CI: violations=${adr.ci.violations} warnings=${adr.ci.warnings} strict=${adr.ci.strict}`);

  section("snapshot");
  const snap = await runtime.snapshot();
  writeln(JSON.stringify({ path: snap.path, adapters: snap.adapters }, null, 2));

  if (opts.full) {
    section("report");
    const report = await runtime.report();
    writeln(report.text);

    section("graph");
    const graph = await runtime.graph({ useSession: true });
    writeln(graph.text);

    section("domains");
    const domains = await runtime.domains({ useSession: true });
    writeln(domains.text);

    section("domain-health");
    const health = await runtime.domainHealth({ useSession: true });
    writeln(health.text);
    writeln(JSON.stringify(health.health, null, 2));
  }

  const steps = [
    {
      id: "scan",
      ok: true,
      detail: `${scan.filesScanned} files, ${scan.symbolsIndexed} symbols`
    },
    { id: "doctor", ok: true },
    {
      id: "check",
      ok: !check.ci.shouldFail,
      detail: `${check.ci.violations} violations, ${check.ci.warnings} warnings`
    },
    {
      id: "adr check",
      ok: !adr.ci.shouldFail,
      detail: `${adr.ci.violations} violations, ${adr.ci.warnings} warnings`
    },
    { id: "snapshot", ok: true, detail: snap.path }
  ];

  if (opts.full) {
    steps.push(
      { id: "report", ok: true },
      { id: "graph", ok: true },
      { id: "domains", ok: true },
      { id: "domain-health", ok: true }
    );
  }

  const ok = steps.every((s) => s.ok);
  section("validate summary");
  for (const step of steps) {
    const status = step.ok ? "OK" : "FAIL";
    const extra = step.detail ? ` (${step.detail})` : "";
    writeln(`${step.id}: ${status}${extra}`);
  }
  writeln("");
  writeln(ok ? "validate: passed" : "validate: failed");

  if (!ok) {
    process.exitCode = 1;
  }

  return { ok, steps };
}
