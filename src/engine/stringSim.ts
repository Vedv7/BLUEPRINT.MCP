export function normalizeIdentifier(s: string) {
  return s
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .trim();
}

export function diceCoefficient(aRaw: string, bRaw: string): number {
  const a = normalizeIdentifier(aRaw);
  const b = normalizeIdentifier(bRaw);
  if (!a || !b) return 0;
  if (a === b) return 1;

  const bigrams = (s: string) => {
    const out: string[] = [];
    for (let i = 0; i < s.length - 1; i++) out.push(s.slice(i, i + 2));
    return out;
  };
  const aBi = bigrams(a);
  const bBi = bigrams(b);
  const aMap = new Map<string, number>();
  for (const g of aBi) aMap.set(g, (aMap.get(g) ?? 0) + 1);
  let matches = 0;
  for (const g of bBi) {
    const n = aMap.get(g) ?? 0;
    if (n > 0) {
      matches++;
      aMap.set(g, n - 1);
    }
  }
  return (2 * matches) / (aBi.length + bBi.length);
}

export function tokenOverlap(aRaw: string, bRaw: string): number {
  const a = new Set(normalizeIdentifier(aRaw).split(/\s+/).filter(Boolean));
  const b = new Set(normalizeIdentifier(bRaw).split(/\s+/).filter(Boolean));
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / Math.max(a.size, b.size);
}

