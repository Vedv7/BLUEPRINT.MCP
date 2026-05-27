export type SymbolRepresentationInput = {
  name: string;
  kind: string;
  filePath: string;
  signature: string;
  summary?: string | null;
};

function camelToWords(name: string) {
  return name
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .toLowerCase()
    .trim();
}

function inferIntent(name: string, filePath: string, summary?: string | null) {
  if (summary?.trim()) return summary.trim();
  const fromName = camelToWords(name);
  const pathHint = filePath
    .replace(/\.(ts|tsx|js|jsx)$/, "")
    .split("/")
    .slice(-2)
    .join(" ");
  return `Implements ${fromName} in ${pathHint}`;
}

export function buildSymbolRepresentation(symbol: SymbolRepresentationInput) {
  const lines = [
    `Symbol: ${symbol.name}`,
    `Kind: ${symbol.kind}`,
    `Path: ${symbol.filePath}`,
    `Signature: ${symbol.signature}`,
    `Intent: ${inferIntent(symbol.name, symbol.filePath, symbol.summary)}`
  ];
  if (symbol.summary?.trim()) {
    lines.push(`Documentation: ${symbol.summary.trim()}`);
  }
  return lines.join("\n");
}

export function buildProposedRepresentation(proposedSymbolName: string, proposedFilePath?: string, intent?: string) {
  const lines = [`Symbol: ${proposedSymbolName}`, `Intent: ${intent?.trim() || inferIntent(proposedSymbolName, proposedFilePath ?? "", null)}`];
  if (proposedFilePath) lines.push(`Path: ${proposedFilePath}`);
  if (intent?.trim()) lines.push(`Task: ${intent.trim()}`);
  return lines.join("\n");
}

export function contentHashForSymbol(symbol: SymbolRepresentationInput) {
  return `${symbol.name}|${symbol.kind}|${symbol.filePath}|${symbol.signature}|${symbol.summary ?? ""}`;
}
