import path from "node:path";
import { loadConfig } from "../config/loadConfig.js";
import { BlueprintRuntime } from "./blueprintRuntime.js";
import type { BlueprintRuntimeContext } from "./runtimeTypes.js";

export type CreateRuntimeOptions = {
  repoRoot: string;
  config?: BlueprintRuntimeContext["config"];
};

/**
 * Create a Blueprint runtime bound to a repository root.
 * Use from CLI, MCP, GitHub Actions, Docker, VS Code, or any agent host.
 */
export function createRuntime(opts: CreateRuntimeOptions): BlueprintRuntime {
  const repoRoot = path.resolve(opts.repoRoot);
  const config = opts.config ?? loadConfig(repoRoot);
  return new BlueprintRuntime({ repoRoot, config });
}

export { BlueprintRuntime } from "./blueprintRuntime.js";
export type * from "./runtimeTypes.js";
