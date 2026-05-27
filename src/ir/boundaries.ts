import type { BlueprintConfig } from "../config/loadConfig.js";
import type { BoundaryRule } from "./types.js";

export function boundaryRulesFromConfig(config: BlueprintConfig): BoundaryRule[] {
  const rules: BoundaryRule[] = [];
  for (const rule of config.policies.forbiddenImports) {
    rules.push({
      id: `forbidden:${rule.from}->${rule.to}`,
      kind: "forbidden_import",
      from: rule.from,
      to: rule.to,
      message: rule.message
    });
  }
  for (const rule of config.policies.requiredPlacement) {
    rules.push({
      id: `placement:${rule.match}`,
      kind: "required_placement",
      from: rule.match,
      to: rule.path,
      message: `requiredPlacement: ${rule.match} -> ${rule.path}`
    });
  }
  return rules;
}
