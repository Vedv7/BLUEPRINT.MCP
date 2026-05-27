import type { BlueprintConfig } from "../config/loadConfig.js";
import type { BlueprintDb } from "../db/db.js";
import { buildArchitectureIr } from "../ir/buildArchitectureIr.js";
import { persistArchitectureIr } from "../ir/persistIr.js";
import type { ArchitectureIR } from "../ir/types.js";
import {
  buildArchitectureGraphFromIr,
  formatArchitectureGraphOutput,
  type ArchitectureGraph,
  type BoundaryRisk
} from "../engines/architectureGraph.js";

export type { ArchitectureGraph, BoundaryRisk };
export { formatArchitectureGraphOutput };

export async function buildArchitectureGraph(opts: {
  repoRoot: string;
  config: BlueprintConfig;
  ir?: ArchitectureIR;
  db?: BlueprintDb;
}) {
  const ir = opts.ir ?? (await buildArchitectureIr(opts.repoRoot, opts.config));
  if (opts.db) {
    await persistArchitectureIr(opts.db, ir);
  }
  return buildArchitectureGraphFromIr(ir, opts.config);
}
