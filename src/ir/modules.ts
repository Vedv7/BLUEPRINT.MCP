import type { BlueprintConfig } from "../config/loadConfig.js";
import type { FileNode, ModuleNode } from "./types.js";

function normalize(p: string) {
  return p.replaceAll("\\", "/");
}

export function classifyModulePath(filePath: string, config?: BlueprintConfig): string {
  const p = normalize(filePath);

  const custom = config?.modules?.patterns?.find((pattern) => {
    const prefix = pattern.match.replace(/\*\*$/, "").replace(/\*$/, "");
    return p.startsWith(prefix) || p.includes(`/${pattern.id}/`);
  });
  if (custom) return custom.id;

  if (p.startsWith("app/")) {
    const parts = p.split("/");
    return parts.length >= 2 ? `app/${parts[1]}` : "app";
  }
  if (p.startsWith("src/components/")) return "src/components";
  if (p.startsWith("src/lib/")) return "src/lib";
  if (p.startsWith("src/server/")) return "src/server";
  if (p.startsWith("src/app/api/")) return "src/app/api";
  if (p.startsWith("src/app/")) return "src/app";
  if (p.startsWith("src/hooks/")) return "src/hooks";
  if (p.startsWith("apps/")) {
    const parts = p.split("/");
    return parts.length >= 2 ? `apps/${parts[1]}` : "apps";
  }
  if (p.startsWith("packages/")) {
    const parts = p.split("/");
    return parts.length >= 2 ? `packages/${parts[1]}` : "packages";
  }
  if (p.startsWith("services/")) {
    const parts = p.split("/");
    return parts.length >= 2 ? `services/${parts[1]}` : "services";
  }
  if (p.startsWith("backend/")) return "backend";
  if (p.startsWith("frontend/")) return "frontend";
  if (p.startsWith("ml-service/")) return "ml-service";
  if (p.startsWith("V2/")) return "V2";
  if (p.startsWith("scripts/")) return "scripts";
  if (p.startsWith("tests/")) return "tests";
  if (p.startsWith("src/")) {
    const [a, b] = p.split("/");
    return `${a}/${b}`;
  }
  const parts = p.split("/");
  return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : parts[0] ?? "root";
}

export function buildModuleNodes(files: FileNode[], config?: BlueprintConfig): ModuleNode[] {
  const counts = new Map<string, number>();
  for (const file of files) {
    const moduleId = classifyModulePath(file.path, config);
    counts.set(moduleId, (counts.get(moduleId) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([id, fileCount]) => ({ id, fileCount }))
    .sort((a, b) => a.id.localeCompare(b.id));
}
