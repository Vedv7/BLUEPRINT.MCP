import type { BlueprintConfig } from "../config/loadConfig.js";
import { buildArchitectureIr } from "../ir/buildArchitectureIr.js";
import {
  formatInferredPoliciesOutput,
  inferPoliciesFromIr,
  type InferredPolicies
} from "../engines/inferPolicies.js";

export type { InferredPolicies };
export { formatInferredPoliciesOutput };

export async function inferPoliciesFromRepo(opts: {
  repoRoot: string;
  config: BlueprintConfig;
  filesRel?: string[];
  absFiles?: string[];
}) {
  const ir = await buildArchitectureIr(opts.repoRoot, opts.config);
  return inferPoliciesFromIr(ir, opts.config);
}
