/** Spring / enterprise Java layer classification from path and package. */

export type JavaSpringLayer =
  | "controller"
  | "service"
  | "repository"
  | "model"
  | "config"
  | "util"
  | "unknown";

const LAYER_PATTERNS: Array<{ layer: JavaSpringLayer; patterns: string[] }> = [
  { layer: "controller", patterns: [".controller.", "/controller/", "controller/"] },
  { layer: "service", patterns: [".service.", "/service/", "service/"] },
  { layer: "repository", patterns: [".repository.", "/repository/", "repository/", ".dao.", "/dao/"] },
  { layer: "model", patterns: [".model.", "/model/", "/models/", ".entity.", "/entity/", "/domain/"] },
  { layer: "config", patterns: [".config.", "/config/", "configuration/"] },
  { layer: "util", patterns: [".util.", "/util/", "/utils/", ".helper.", "/common/"] }
];

export function classifyJavaSpringLayer(filePath: string, packageName?: string | null): JavaSpringLayer {
  const hay = `${packageName ?? ""} ${filePath.replaceAll("\\", "/")}`.toLowerCase();
  for (const { layer, patterns } of LAYER_PATTERNS) {
    if (patterns.some((p) => hay.includes(p))) return layer;
  }
  if (hay.includes("controller")) return "controller";
  if (hay.includes("service")) return "service";
  if (hay.includes("repository") || hay.includes("repo")) return "repository";
  return "unknown";
}

export function javaLayerModuleId(layer: JavaSpringLayer): string {
  return layer === "unknown" ? "java/unknown" : `java/${layer}`;
}

export function packageFromJavaPath(filePath: string): string | null {
  const norm = filePath.replaceAll("\\", "/");
  for (const marker of ["src/main/java/", "src/"]) {
    const idx = norm.indexOf(marker);
    if (idx >= 0) {
      const rest = norm.slice(idx + marker.length).replace(/\.java$/i, "");
      if (rest) return rest.replaceAll("/", ".");
    }
  }
  return null;
}

export function detectSpringProject(files: string[]): boolean {
  const hay = files.join(" ").toLowerCase();
  return (
    hay.includes("org.springframework") ||
    hay.includes("/controller/") ||
    hay.includes(".controller.") ||
    (hay.includes("/service/") && hay.includes("/repository/"))
  );
}
