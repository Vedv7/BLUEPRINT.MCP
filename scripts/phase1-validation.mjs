import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cli = path.join(__dirname, "../dist/cli/index.js");
const workspace = path.join(__dirname, "../..");

const targets = [
  { name: "next-blueprint-demo", dir: path.join(workspace, "next-blueprint-demo") },
  { name: "Review-Gate", dir: path.join(workspace, "validation-repos", "Review-Gate") },
  {
    name: "RankStream",
    dir: path.join(workspace, "validation-repos", "real-time-ranking-and-recommendation-platform")
  }
];

function run(cwd, args) {
  const r = spawnSync(process.execPath, [cli, ...args], { cwd, encoding: "utf8", env: { ...process.env, BLUEPRINT_EMBED_MOCK: "1" } });
  return { code: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

let failed = 0;
for (const target of targets) {
  if (!fs.existsSync(target.dir)) {
    console.log(`\n=== ${target.name} === SKIP (path missing: ${target.dir})`);
    continue;
  }
  console.log(`\n=== ${target.name} ===`);
  const doctor = run(target.dir, ["doctor"]);
  const scan = run(target.dir, ["scan"]);
  console.log(doctor.stdout.split("\n").slice(0, 12).join("\n"));
  const scanJson = (() => {
    try {
      return JSON.parse(scan.stdout);
    } catch {
      return { parseError: true, raw: scan.stdout.slice(0, 200) };
    }
  })();
  console.log("scan:", scanJson);
  if (doctor.code !== 0 || scan.code !== 0) {
    console.error("FAILED", target.name, { doctor: doctor.code, scan: scan.code, stderr: doctor.stderr || scan.stderr });
    failed += 1;
  }
}

if (failed) {
  process.exit(1);
}
console.log("\nPhase 1 validation: all targets completed.");
