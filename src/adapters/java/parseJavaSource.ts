export type ParsedJavaImport = {
  moduleSpecifier: string;
  isStatic: boolean;
  isWildcard: boolean;
};

export type ParsedJavaType = {
  name: string;
  kind: "class" | "interface" | "enum";
  annotations: string[];
  exported: boolean;
};

export type ParsedJavaMethod = {
  className: string;
  name: string;
  signature: string;
  visibility: "public" | "private" | "protected" | "package";
  isConstructor: boolean;
  exported: boolean;
};

export type ParsedJavaFile = {
  packageName: string | null;
  imports: ParsedJavaImport[];
  types: ParsedJavaType[];
  methods: ParsedJavaMethod[];
};

function stripComments(source: string) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

function parseAnnotations(before: string): string[] {
  const annotations: string[] = [];
  const re = /@([A-Za-z_][\w.]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(before))) {
    annotations.push(m[1]!.split(".").pop() ?? m[1]!);
  }
  return annotations;
}

export function parseJavaSource(source: string): ParsedJavaFile {
  const cleaned = stripComments(source);
  const packageMatch = cleaned.match(/^\s*package\s+([\w.]+)\s*;/m);
  const packageName = packageMatch?.[1] ?? null;

  const imports: ParsedJavaImport[] = [];
  const importRe = /^\s*import\s+(static\s+)?([\w.*]+)\s*;/gm;
  let im: RegExpExecArray | null;
  while ((im = importRe.exec(cleaned))) {
    const spec = im[2]!;
    imports.push({
      moduleSpecifier: spec.replace(/\*$/, "").replace(/\.$/, ""),
      isStatic: Boolean(im[1]),
      isWildcard: spec.endsWith("*")
    });
  }

  const types: ParsedJavaType[] = [];
  const methods: ParsedJavaMethod[] = [];

  const typeRe =
    /(?:^|[;\}])\s*((?:public|private|protected)\s+)?(?:abstract\s+|static\s+|final\s+)*(@[\w.]+(?:\s*\([^)]*\))?\s*)*(class|interface|enum)\s+(\w+)/gm;
  let tm: RegExpExecArray | null;
  while ((tm = typeRe.exec(cleaned))) {
    const visibility = (tm[1]?.trim() as ParsedJavaMethod["visibility"]) || "package";
    const kind = tm[3] as ParsedJavaType["kind"];
    const name = tm[4]!;
    const before = cleaned.slice(Math.max(0, tm.index - 120), tm.index);
    const annotations = parseAnnotations(before + tm[0]);
    const exported = visibility === "public";
    types.push({ name, kind, annotations, exported });
  }

  const classNames = types.filter((t) => t.kind === "class" || t.kind === "enum").map((t) => t.name);

  const methodRe =
    /(?:^|\n)\s*((?:public|private|protected)\s+)?(?:static\s+|final\s+|synchronized\s+|abstract\s+)*(@[\w.]+(?:\s*\([^)]*\))?\s*)*([\w<>\[\],\s.?]+?)\s+(\w+)\s*\(/g;
  let mm: RegExpExecArray | null;
  while ((mm = methodRe.exec(cleaned))) {
    const visibility = (mm[1]?.trim() as ParsedJavaMethod["visibility"]) || "package";
    const returnType = mm[3]?.trim() ?? "";
    const name = mm[4]!;
    if (name === "if" || name === "for" || name === "while" || name === "switch" || name === "catch") continue;
    if (returnType === "class" || returnType === "interface" || returnType === "enum") continue;

    const preceding = cleaned.slice(Math.max(0, mm.index - 400), mm.index);
    const classMatch = preceding.match(/(?:class|interface|enum)\s+(\w+)[\s\S]*$/);
    const className = classMatch?.[1] ?? classNames[0] ?? "Unknown";
    const isConstructor = name === className || returnType === className;
    const exported = visibility === "public";

    methods.push({
      className,
      name,
      signature: isConstructor ? `${className}()` : `${name}(${returnType})`,
      visibility,
      isConstructor,
      exported
    });
  }

  return { packageName, imports, types, methods };
}
