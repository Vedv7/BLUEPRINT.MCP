import fs from "node:fs";
import path from "node:path";

export const DECISIONS_DIR = ".blueprint/decisions";

export function decisionsDirAbs(repoRoot: string): string {
  return path.join(repoRoot, DECISIONS_DIR);
}

export function ensureDecisionsDir(repoRoot: string): string {
  const dir = decisionsDirAbs(repoRoot);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function nextAdrNumber(repoRoot: string): number {
  const dir = decisionsDirAbs(repoRoot);
  if (!fs.existsSync(dir)) return 1;
  const nums = fs
    .readdirSync(dir)
    .map((f) => /^ADR-(\d+)/i.exec(f)?.[1])
    .filter(Boolean)
    .map((n) => Number(n));
  return nums.length ? Math.max(...nums) + 1 : 1;
}

export function adrFileName(id: string, slug: string): string {
  return `${id}-${slug}.md`;
}
