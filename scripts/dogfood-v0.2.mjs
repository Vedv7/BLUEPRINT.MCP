#!/usr/bin/env node
/**
 * Dogfood Blueprint v0.2 on local repos.
 * Usage: node scripts/dogfood-v0.2.mjs
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(root, "dist/cli/index.js");
const node = process.execPath;

const targets = [
  { name: "blueprint-mcp (self)", cwd: root },
  { name: "demo-repo", cwd: path.join(root, "examples/demo-repo") },
  {
    name: "next-blueprint-demo",
    cwd: path.resolve(root, "../next-blueprint-demo"),
    optional: true
  }
];

const commands = [
  ["scan", []],
  ["report", []],
  ["graph", []],
  ["domains", []],
  ["check", ["--ci"]],
  ["adr", ["check", "--format=markdown"]],
  ["snapshot", []]
];

function run(cwd, args) {
  const r = spawnSync(node, [cli, ...args], { cwd, encoding: "utf8", env: { ...process.env, BLUEPRINT_EMBED_MOCK: "1" } });
  return { code: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

console.log("Blueprint v0.2 dogfood\n");

let failed = 0;
for (const target of targets) {
  if (target.optional && !fs.existsSync(target.cwd)) {
    console.log(`SKIP ${target.name} (not found)\n`);
    continue;
  }
  if (!fs.existsSync(path.join(target.cwd, "blueprint.config.json")) && target.name !== "blueprint-mcp (self)") {
    console.log(`SKIP ${target.name} (no blueprint.config.json)\n`);
    continue;
  }

  console.log(`=== ${target.name} (${target.cwd}) ===`);
  for (const [cmd, extra] of commands) {
    const args = [cmd, ...extra];
    const { code, stdout, stderr } = run(target.cwd, args);
    const label = args.join(" ");
    const ok = code === 0 ? "OK" : `EXIT ${code}`;
    console.log(`  ${ok}  blueprint ${label}`);
    if (code !== 0) {
      failed++;
      if (stderr) console.log(stderr.slice(0, 400));
    }
    if (cmd === "snapshot" && code === 0) {
      const mem = path.join(target.cwd, "blueprint.memory.json");
      if (fs.existsSync(mem)) {
        const snap = JSON.parse(fs.readFileSync(mem, "utf8"));
        const domains = snap.domainHealth?.domains?.length ?? 0;
        const adrs = snap.architecturalDecisions?.length ?? 0;
        console.log(`       snapshot: domainHealth=${snap.domainHealth?.score ?? "?"} domains=${domains} adrs=${adrs}`);
      }
    }
    if (cmd === "adr" && stdout.includes("ADR Check")) {
      const m = stdout.match(/Violations: (\d+)/);
      const w = stdout.match(/Warnings: (\d+)/);
      console.log(`       adr: violations=${m?.[1] ?? "?"} warnings=${w?.[1] ?? "?"}`);
    }
  }
  console.log("");
}

console.log(failed ? `Dogfood finished with ${failed} command failures.` : "Dogfood finished: all commands succeeded.");
