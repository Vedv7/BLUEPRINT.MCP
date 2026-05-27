import type { BlueprintConfig } from "../config/loadConfig.js";
import type { BlueprintDb } from "../db/db.js";
import { loadAllEmbeddings } from "./store.js";
import { cosineSimilarity } from "./vector.js";

export type SemanticCluster = {
  label: string;
  symbols: string[];
  avgSimilarity: number;
};

const STOP = new Set(["src", "lib", "utils", "app", "use", "get", "set", "the", "a", "to", "for", "and"]);

function clusterLabel(symbols: Array<{ name: string; file_path: string }>) {
  const tokenCounts = new Map<string, number>();
  for (const s of symbols) {
    const raw = `${s.name} ${s.file_path}`.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
    for (const token of raw.split(/[^a-z0-9]+/)) {
      if (!token || token.length < 3 || STOP.has(token)) continue;
      tokenCounts.set(token, (tokenCounts.get(token) ?? 0) + 1);
    }
  }
  const ranked = [...tokenCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([t]) => t);
  if (!ranked.length) return "semantic duplicates";
  return ranked.join(" ") + " helpers";
}

function unionFind(ids: number[]) {
  const parent = new Map<number, number>();
  for (const id of ids) parent.set(id, id);
  function find(x: number): number {
    const p = parent.get(x)!;
    if (p !== x) parent.set(x, find(p));
    return parent.get(x)!;
  }
  function union(a: number, b: number) {
    parent.set(find(a), find(b));
  }
  return { find, union };
}

export async function buildSemanticDuplicateClusters(db: BlueprintDb, config: BlueprintConfig): Promise<SemanticCluster[]> {
  if (!config.embeddings.enabled) return [];

  const embeddings = await loadAllEmbeddings(db, config.embeddings.dimensions);
  if (embeddings.size < 2) return [];

  const ids = [...embeddings.keys()];
  const placeholders = ids.map(() => "?").join(",");
  const rows = await db.all<Array<{ id: number; name: string; file_path: string }>>(
    `SELECT id, name, file_path FROM symbols WHERE id IN (${placeholders})`,
    ...ids
  );

  const threshold = config.embeddings.clusterThreshold;
  const { find, union } = unionFind(ids);

  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const a = embeddings.get(rows[i].id)?.vector;
      const b = embeddings.get(rows[j].id)?.vector;
      if (!a || !b) continue;
      if (cosineSimilarity(a, b) >= threshold) {
        union(rows[i].id, rows[j].id);
      }
    }
  }

  const groups = new Map<number, Array<{ id: number; name: string; file_path: string }>>();
  for (const row of rows) {
    const root = find(row.id);
    const group = groups.get(root) ?? [];
    group.push(row);
    groups.set(root, group);
  }

  const clusters: SemanticCluster[] = [];
  for (const members of groups.values()) {
    if (members.length < 2) continue;

    let simSum = 0;
    let pairs = 0;
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        const a = embeddings.get(members[i].id)?.vector;
        const b = embeddings.get(members[j].id)?.vector;
        if (!a || !b) continue;
        simSum += cosineSimilarity(a, b);
        pairs++;
      }
    }

    clusters.push({
      label: clusterLabel(members),
      symbols: members.map((m) => m.name).sort(),
      avgSimilarity: pairs ? Number((simSum / pairs).toFixed(2)) : 1
    });
  }

  return clusters.sort((a, b) => b.symbols.length - a.symbols.length);
}
