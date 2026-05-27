import type { ArchitecturalDecision } from "./types.js";

export type NewAdrInput = {
  id: string;
  slug: string;
  title: string;
  decision: string;
  rationale?: string;
  constraints?: string[];
  chosenPatterns?: string[];
  rejectedPatterns?: string[];
  avoid?: string[];
  domains?: string[];
  domainOwnership?: Array<{ domain: string; paths: string[] }>;
  boundaryIntent?: string[];
  status?: ArchitecturalDecision["status"];
};

export function renderAdrMarkdown(input: NewAdrInput): string {
  const lines: string[] = [
    "---",
    `id: ${input.id}`,
    `title: ${input.title}`,
    `status: ${input.status ?? "accepted"}`,
    `date: ${new Date().toISOString().slice(0, 10)}`,
    ...(input.domains?.length ? [`domains: ${input.domains.join(", ")}`] : []),
    "---",
    "",
    `# ${input.id}: ${input.title}`,
    "",
    "## Decision",
    input.decision,
    ""
  ];

  if (input.rationale) {
    lines.push("## Rationale", input.rationale, "");
  }
  if (input.constraints?.length) {
    lines.push("## Constraints", ...input.constraints.map((c) => `- ${c}`), "");
  }
  if (input.chosenPatterns?.length) {
    lines.push("## Chosen patterns", ...input.chosenPatterns.map((c) => `- ${c}`), "");
  }
  if (input.rejectedPatterns?.length) {
    lines.push("## Rejected patterns", ...input.rejectedPatterns.map((c) => `- ${c}`), "");
  }
  if (input.avoid?.length) {
    lines.push("## Avoid", ...input.avoid.map((c) => `- ${c}`), "");
  }
  if (input.domainOwnership?.length) {
    lines.push("## Domain ownership", ...input.domainOwnership.map((d) => `- ${d.domain}: ${d.paths.join(", ")}`), "");
  }
  if (input.boundaryIntent?.length) {
    lines.push("## Boundary intent", ...input.boundaryIntent.map((c) => `- ${c}`), "");
  }

  return lines.join("\n").trimEnd() + "\n";
}
