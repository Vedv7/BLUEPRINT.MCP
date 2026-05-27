import fs from "node:fs";
import path from "node:path";

function normalize(p: string) {
  return p.replaceAll("\\", "/");
}

function isExternalJavaModule(spec: string) {
  return (
    spec.startsWith("java.") ||
    spec.startsWith("javax.") ||
    spec.startsWith("jakarta.") ||
    spec.startsWith("kotlin.") ||
    spec.startsWith("org.springframework.") ||
    spec.startsWith("com.fasterxml.") ||
    spec.startsWith("lombok.") ||
    spec.startsWith("org.junit.") ||
    !spec.includes(".")
  );
}

function packageToPath(pkg: string) {
  return pkg.replaceAll(".", "/");
}

function fileExists(repoRoot: string, rel: string) {
  return fs.existsSync(path.join(repoRoot, rel));
}

function resolveTypePath(repoRoot: string, fqcn: string): string | null {
  const base = packageToPath(fqcn);
  const candidates = [`src/main/java/${base}.java`, `${base}.java`, `src/${base}.java`];
  for (const rel of candidates) {
    if (fileExists(repoRoot, rel)) return normalize(rel.replace(/\.java$/, ""));
  }
  return null;
}

export function resolveJavaImport(repoRoot: string, moduleSpecifier: string): string | null {
  if (!moduleSpecifier || isExternalJavaModule(moduleSpecifier)) return null;
  return resolveTypePath(repoRoot, moduleSpecifier);
}

export function resolveJavaImportEdge(
  repoRoot: string,
  moduleSpecifier: string
): { toPath: string | null; isExternal: boolean } {
  if (moduleSpecifier.endsWith(".*") || moduleSpecifier.endsWith("*")) {
    const pkg = moduleSpecifier.replace(/\.\*$/, "").replace(/\*$/, "");
    const pkgPath = resolveTypePath(repoRoot, `${pkg}.Placeholder`);
    if (pkgPath) {
      const dir = pkgPath.replace(/\/[^/]+$/, "");
      return { toPath: dir, isExternal: false };
    }
    return { toPath: packageToPath(pkg), isExternal: isExternalJavaModule(pkg) };
  }
  const toPath = resolveJavaImport(repoRoot, moduleSpecifier);
  return { toPath, isExternal: toPath === null };
}
