import fs from "node:fs";
import path from "node:path";

export type EmbeddingsConfig = {
  enabled: boolean;
  model: string;
  dimensions: number;
  minSemanticScore: number;
  clusterThreshold: number;
  hybridWeights: {
    heuristic: number;
    semantic: number;
  };
};

export type LanguageAdapterConfig = {
  enabled?: boolean;
  include?: string[];
  /** Index top-level helpers that are not exported (default: false). */
  indexNonExported?: boolean;
};

export type BlueprintConfig = {
  root: string;
  include: string[];
  dbPath: string;
  enforcementMode: "advisory" | "enforce";
  /** lenient = fewer warnings; balanced = default; strict = more boundary warnings */
  strictness?: "lenient" | "balanced" | "strict";
  framework: "nextjs" | "react" | "vite" | "node-express" | "unknown";
  embeddings: EmbeddingsConfig;
  languages?: {
    typescript?: LanguageAdapterConfig;
    python?: LanguageAdapterConfig;
    java?: LanguageAdapterConfig;
    go?: LanguageAdapterConfig;
    rust?: LanguageAdapterConfig;
    csharp?: LanguageAdapterConfig;
  };
  modules?: {
    patterns?: Array<{ id: string; match: string }>;
    flows?: Array<{ from: string; to: string; allowed?: boolean }>;
  };
  pathAliases: Array<{ aliasPrefix: string; targetPrefix: string }>;
  placementRules: Record<string, string>;
  policies: {
    forbiddenImports: Array<{
      from: string;
      to: string;
      message: string;
    }>;
    requiredPlacement: Array<{
      match: string;
      path: string;
    }>;
  };
  rules?: {
    utility?: string;
    component?: string;
    hook?: string;
    apiRoute?: string;
  };
};

const DEFAULT_EMBEDDINGS: EmbeddingsConfig = {
  enabled: false,
  model: "Xenova/all-MiniLM-L6-v2",
  dimensions: 384,
  minSemanticScore: 0.72,
  clusterThreshold: 0.78,
  hybridWeights: {
    heuristic: 0.55,
    semantic: 0.45
  }
};

const DEFAULT_CONFIG: BlueprintConfig = {
  root: ".",
  include: [],
  dbPath: ".blueprint/blueprint.sqlite",
  enforcementMode: "advisory",
  strictness: "balanced",
  framework: "unknown",
  embeddings: DEFAULT_EMBEDDINGS,
  languages: {
    typescript: { enabled: true },
    python: { enabled: true },
    java: { enabled: true }
  },
  pathAliases: [{ aliasPrefix: "@/", targetPrefix: "src/" }],
  policies: {
    forbiddenImports: [],
    requiredPlacement: []
  },
  placementRules: {
    react_component: "src/components",
    hook: "src/hooks",
    utility: "src/lib",
    api_route: "src/app/api",
    server_action: "src/actions",
    type: "src/types"
  }
};

function normalizePrefix(v: string) {
  const n = v.replaceAll("\\", "/").replace(/\*+$/, "");
  return n.endsWith("/") ? n : `${n}/`;
}

function loadPathAliases(repoRoot: string): Array<{ aliasPrefix: string; targetPrefix: string }> {
  const tsconfigPath = path.join(repoRoot, "tsconfig.json");
  if (!fs.existsSync(tsconfigPath)) return DEFAULT_CONFIG.pathAliases;
  try {
    const parsed = JSON.parse(fs.readFileSync(tsconfigPath, "utf8")) as {
      compilerOptions?: { paths?: Record<string, string[]> };
    };
    const paths = parsed.compilerOptions?.paths ?? {};
    const aliases = Object.entries(paths)
      .flatMap(([alias, targets]) =>
        targets.map((target) => ({
          aliasPrefix: normalizePrefix(alias),
          targetPrefix: normalizePrefix(target)
        }))
      )
      .filter((x) => x.aliasPrefix && x.targetPrefix);
    return aliases.length ? aliases : DEFAULT_CONFIG.pathAliases;
  } catch {
    return DEFAULT_CONFIG.pathAliases;
  }
}

function detectFramework(repoRoot: string): BlueprintConfig["framework"] {
  const packagePath = path.join(repoRoot, "package.json");
  if (!fs.existsSync(packagePath)) return "unknown";
  try {
    const pkg = JSON.parse(fs.readFileSync(packagePath, "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
    if (deps.next) return "nextjs";
    if (deps.vite) return "vite";
    if (deps.express) return "node-express";
    if (deps.react || deps["react-dom"]) return "react";
    return "unknown";
  } catch {
    return "unknown";
  }
}

function mergePlacementRules(
  base: Record<string, string>,
  fileRules?: BlueprintConfig["rules"],
  parsedPlacementRules?: Record<string, string>
) {
  const fromRules = fileRules
    ? (Object.entries({
        utility: fileRules.utility,
        react_component: fileRules.component,
        hook: fileRules.hook,
        api_route: fileRules.apiRoute
      }).reduce<Record<string, string>>((acc, [key, value]) => {
        if (typeof value === "string" && value.length > 0) acc[key] = value;
        return acc;
      }, {}))
    : {};
  return {
    ...base,
    ...(parsedPlacementRules ?? {}),
    ...fromRules
  };
}

function frameworkPlacementDefaults(framework: BlueprintConfig["framework"]) {
  if (framework === "nextjs") {
    return {
      react_component: "src/components",
      hook: "src/hooks",
      utility: "src/lib",
      api_route: "src/app/api",
      server_action: "src/actions",
      type: "src/types"
    };
  }
  if (framework === "node-express") {
    return {
      react_component: "src/components",
      hook: "src/hooks",
      utility: "src/lib",
      api_route: "src/routes",
      server_action: "src/services",
      type: "src/types"
    };
  }
  if (framework === "vite" || framework === "react") {
    return {
      react_component: "src/components",
      hook: "src/hooks",
      utility: "src/lib",
      api_route: "src/api",
      server_action: "src/actions",
      type: "src/types"
    };
  }
  return DEFAULT_CONFIG.placementRules;
}

export function loadConfig(repoRoot: string): BlueprintConfig {
  const configPath = path.join(repoRoot, "blueprint.config.json");
  if (!fs.existsSync(configPath)) return DEFAULT_CONFIG;
  const parsed = JSON.parse(fs.readFileSync(configPath, "utf8")) as Partial<BlueprintConfig>;
  const framework = detectFramework(repoRoot);
  const embeddingsParsed = (parsed.embeddings ?? {}) as Partial<EmbeddingsConfig>;
  const hybrid = embeddingsParsed.hybridWeights;
  const embeddings: EmbeddingsConfig = {
    ...DEFAULT_EMBEDDINGS,
    ...embeddingsParsed,
    hybridWeights: {
      heuristic: hybrid?.heuristic ?? DEFAULT_EMBEDDINGS.hybridWeights.heuristic,
      semantic: hybrid?.semantic ?? DEFAULT_EMBEDDINGS.hybridWeights.semantic
    }
  };

  return {
    ...DEFAULT_CONFIG,
    ...parsed,
    enforcementMode: parsed.enforcementMode === "enforce" ? "enforce" : "advisory",
    strictness:
      parsed.strictness === "lenient" || parsed.strictness === "strict" ? parsed.strictness : "balanced",
    framework,
    embeddings,
    pathAliases: loadPathAliases(repoRoot),
    placementRules: mergePlacementRules(frameworkPlacementDefaults(framework), parsed.rules, parsed.placementRules),
    policies: {
      forbiddenImports: parsed.policies?.forbiddenImports ?? DEFAULT_CONFIG.policies.forbiddenImports,
      requiredPlacement: parsed.policies?.requiredPlacement ?? DEFAULT_CONFIG.policies.requiredPlacement
    },
    rules: parsed.rules
  };
}

