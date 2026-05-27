import type { BlueprintConfig } from "../config/loadConfig.js";
import { buildArchitectureIr } from "../ir/buildArchitectureIr.js";
import type { ArchitectureIR } from "../ir/types.js";
import {
  formatCheckOutput,
  formatCheckMarkdown,
  runBlueprintCheckFromIr,
  type CheckFinding,
  type CheckResult,
  type CheckWarning
} from "../engines/architectureCheck.js";

export type { CheckFinding, CheckResult, CheckWarning };
export { formatCheckOutput, formatCheckMarkdown };

export async function runBlueprintCheck(opts: {
  repoRoot: string;
  config: BlueprintConfig;
  filesRel?: string[];
  absFiles?: string[];
  ir?: ArchitectureIR;
}): Promise<CheckResult> {
  const ir = opts.ir ?? (await buildArchitectureIr(opts.repoRoot, opts.config));
  return runBlueprintCheckFromIr(ir, opts.config);
}
