export type LanguageId = "typescript" | "python" | "java" | "go" | "rust" | "csharp";

export type FileNode = {
  path: string;
  absolutePath: string;
  language: LanguageId;
};

export type SymbolKind =
  | "function"
  | "class_method"
  | "class"
  | "type"
  | "interface"
  | "variable"
  | "unknown";

export type SymbolNode = {
  name: string;
  kind: SymbolKind;
  filePath: string;
  signature: string;
  summary?: string | null;
  exported: boolean;
  language: LanguageId;
};

export type ImportEdge = {
  fromPath: string;
  moduleSpecifier: string;
  toPath: string | null;
  isExternal: boolean;
  language: LanguageId;
};

export type ModuleNode = {
  id: string;
  fileCount: number;
};

export type BoundaryRuleKind = "forbidden_import" | "required_placement" | "heuristic";

export type BoundaryRule = {
  id: string;
  kind: BoundaryRuleKind;
  from: string;
  to: string;
  message: string;
};

export type ArchitectureIR = {
  repoRoot: string;
  files: FileNode[];
  symbols: SymbolNode[];
  imports: ImportEdge[];
  modules: ModuleNode[];
  boundaries: BoundaryRule[];
  adapters: LanguageId[];
};
