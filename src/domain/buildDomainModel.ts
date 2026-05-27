import type { BlueprintConfig } from "../config/loadConfig.js";
import { buildDomainArchitecture } from "../engines/domainIntelligence.js";
import { buildArchitectureIr } from "../ir/buildArchitectureIr.js";
import type { ArchitectureIR } from "../ir/types.js";
import type { DomainArchitecture } from "../ir/domainTypes.js";

export async function buildDomainModel(opts: {
  repoRoot: string;
  config: BlueprintConfig;
  ir?: ArchitectureIR;
}): Promise<DomainArchitecture> {
  const ir = opts.ir ?? (await buildArchitectureIr(opts.repoRoot, opts.config));
  return buildDomainArchitecture(ir, opts.config);
}
