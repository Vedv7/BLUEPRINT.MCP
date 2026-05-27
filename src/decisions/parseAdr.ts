import type { AdrStatus, ArchitecturalDecision } from "./types.js";

const SECTION_ALIASES: Record<string, keyof Pick<
  ArchitecturalDecision,
  "decision" | "rationale" | "constraints" | "chosenPatterns" | "rejectedPatterns" | "boundaryIntent" | "avoid"
> | "domainOwnership"> = {
  decision: "decision",
  decisions: "decision",
  rationale: "rationale",
  reason: "rationale",
  why: "rationale",
  constraints: "constraints",
  constraint: "constraints",
  "chosen patterns": "chosenPatterns",
  chosen: "chosenPatterns",
  "rejected patterns": "rejectedPatterns",
  rejected: "rejectedPatterns",
  avoid: "avoid",
  "do not": "avoid",
  "domain ownership": "domainOwnership",
  domains: "domainOwnership",
  "boundary intent": "boundaryIntent",
  boundaries: "boundaryIntent"
};

function parseFrontmatter(raw: string): { meta: Record<string, string>; body: string } {
  if (!raw.startsWith("---\n")) return { meta: {}, body: raw };
  const end = raw.indexOf("\n---\n", 4);
  if (end < 0) return { meta: {}, body: raw };
  const block = raw.slice(4, end);
  const meta: Record<string, string> = {};
  for (const line of block.split("\n")) {
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    meta[line.slice(0, idx).trim().toLowerCase()] = line.slice(idx + 1).trim();
  }
  return { meta, body: raw.slice(end + 5) };
}

function normalizeSectionName(line: string): string | null {
  const trimmed = line.trim().replace(/^#+\s*/, "");
  const key = trimmed.replace(/:$/, "").toLowerCase();
  return SECTION_ALIASES[key] ?? null;
}

function bulletLines(block: string): string[] {
  return block
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("-") || l.startsWith("*"))
    .map((l) => l.replace(/^[-*]\s*/, "").trim())
    .filter(Boolean);
}

function plainLines(block: string): string[] {
  return block
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"));
}

function parseDomainOwnership(lines: string[]): Array<{ domain: string; paths: string[] }> {
  const rows: Array<{ domain: string; paths: string[] }> = [];
  for (const line of lines) {
    const m = /^([a-z0-9_-]+)\s*:\s*(.+)$/i.exec(line);
    if (m) {
      rows.push({ domain: m[1]!, paths: [m[2]!.trim()] });
      continue;
    }
    const bullet = /^[-*]\s*([a-z0-9_-]+)\s*:\s*(.+)$/i.exec(line);
    if (bullet) rows.push({ domain: bullet[1]!, paths: [bullet[2]!.trim()] });
  }
  return rows;
}

function idFromFileName(fileName: string): { id: string; slug: string } {
  const base = fileName.replace(/\.md$/i, "");
  const m = /^(ADR-\d+)-(.+)$/i.exec(base);
  if (m) return { id: m[1]!.toUpperCase(), slug: m[2]! };
  return { id: base.toUpperCase(), slug: base.toLowerCase() };
}

export function parseAdrMarkdown(filePath: string, content: string): ArchitecturalDecision {
  const { meta, body } = parseFrontmatter(content);
  const { id: fileId, slug } = idFromFileName(filePath.split(/[/\\]/).pop() ?? filePath);

  const sections: Record<string, string[]> = {};
  let current: string | null = null;
  let buffer: string[] = [];

  const flush = () => {
    if (!current) return;
    sections[current] = [...(sections[current] ?? []), ...buffer];
    buffer = [];
  };

  for (const line of body.split("\n")) {
    const heading = line.match(/^#{1,3}\s+(.+)/);
    const label = /^([A-Za-z][^:]{0,40}):\s*$/.exec(line.trim());
    const sectionName = heading
      ? normalizeSectionName(heading[0])
      : label
        ? normalizeSectionName(label[1]!)
        : null;

    if (sectionName) {
      flush();
      current = sectionName;
      continue;
    }
    buffer.push(line);
  }
  flush();

  const decision = (sections.decision ?? []).join("\n").trim() || plainLines(body).join("\n").trim();
  const rationale = (sections.rationale ?? []).join("\n").trim();

  const constraints = bulletLines((sections.constraints ?? []).join("\n"));
  const chosenPatterns = bulletLines((sections.chosenPatterns ?? []).join("\n"));
  const rejectedPatterns = bulletLines((sections.rejectedPatterns ?? []).join("\n"));
  const avoid = bulletLines((sections.avoid ?? []).join("\n"));
  const boundaryIntent = bulletLines((sections.boundaryIntent ?? []).join("\n"));
  const domainOwnership = parseDomainOwnership(
    (sections.domainOwnership ?? []).flatMap((l) => l.split("\n")).filter((l) => l.trim())
  );

  const titleMatch = body.match(/^#\s+(.+)/m);
  const title =
    meta.title ??
    (titleMatch ? titleMatch[1]!.replace(/^ADR-\d+:\s*/i, "").trim() : slug.replace(/-/g, " "));

  const domains =
    meta.domains?.split(/[,;]/).map((d) => d.trim()).filter(Boolean) ??
    domainOwnership.map((d) => d.domain);

  return {
    id: meta.id?.toUpperCase() ?? fileId,
    slug,
    title,
    status: (meta.status as AdrStatus) ?? "accepted",
    date: meta.date ?? new Date().toISOString().slice(0, 10),
    filePath,
    decision: decision || "(no decision recorded)",
    rationale,
    constraints,
    chosenPatterns,
    rejectedPatterns,
    domainOwnership,
    boundaryIntent,
    avoid,
    domains,
    supersededBy: meta.supersededby ?? meta["superseded-by"]
  };
}
