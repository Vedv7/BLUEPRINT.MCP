import { diceCoefficient } from "../engine/stringSim.js";
import type { ArchitectureIR } from "../ir/types.js";

export type CrossLanguageEquivalent = {
  label: string;
  symbols: Array<{ name: string; filePath: string; language: string }>;
  note: string;
};

function normalizeName(name: string) {
  return name
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .toLowerCase()
    .trim();
}

function tokens(name: string) {
  return normalizeName(name).split(/\s+/).filter(Boolean);
}

function namesSimilar(a: string, b: string) {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (diceCoefficient(na, nb) >= 0.72) return true;
  const ta = new Set(tokens(a));
  const tb = new Set(tokens(b));
  let overlap = 0;
  for (const t of ta) if (tb.has(t)) overlap += 1;
  return overlap >= 2 && overlap >= Math.min(ta.size, tb.size);
}

export function findCrossLanguageEquivalents(ir: ArchitectureIR): CrossLanguageEquivalent[] {
  const fns = ir.symbols.filter((s) => s.kind === "function" || s.kind === "class_method");
  const clusters: CrossLanguageEquivalent[] = [];
  const used = new Set<string>();

  for (let i = 0; i < fns.length; i++) {
    const a = fns[i]!;
    const keyA = `${a.language}:${a.name}`;
    if (used.has(keyA)) continue;
    const group = [a];
    for (let j = i + 1; j < fns.length; j++) {
      const b = fns[j]!;
      if (a.language === b.language) continue;
      const shortA = a.name.split(".").pop() ?? a.name;
      const shortB = b.name.split(".").pop() ?? b.name;
      if (namesSimilar(shortA, shortB)) group.push(b);
    }
    if (group.length < 2) continue;
    const langs = new Set(group.map((g) => g.language));
    if (langs.size < 2) continue;
    for (const g of group) used.add(`${g.language}:${g.name}`);
    clusters.push({
      label: group.map((g) => g.name).sort().join(" ≈ "),
      symbols: group.map((g) => ({ name: g.name, filePath: g.filePath, language: g.language })),
      note: "Cross-language equivalent abstraction (review for intentional duplication)"
    });
  }

  return clusters.slice(0, 12);
}
