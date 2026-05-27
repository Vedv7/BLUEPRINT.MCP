export type SymbolKind = "function" | "class_method" | "class" | "type" | "interface";

export type SymbolRecord = {
  name: string;
  kind: SymbolKind;
  filePath: string;
  signature: string;
  summary?: string;
  exported: boolean;
};

