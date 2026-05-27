import path from "node:path";

export type PlacementResult = {
  ok: boolean;
  suggestedPath?: string;
  reason?: string;
};

function normalize(p: string) {
  return p.replaceAll("\\", "/");
}

function inferCategoryFromIntent(intent: string) {
  const i = intent.toLowerCase();
  if (i.includes("hook") || i.includes("use")) return "hook";
  if (i.includes("component") || i.includes("react")) return "react_component";
  if (i.includes("api") || i.includes("route")) return "api_route";
  if (i.includes("server action") || i.includes("action")) return "server_action";
  if (i.includes("type") || i.includes("interface")) return "type";
  return "utility";
}

export function verifyPlacement(opts: {
  proposedFilePath: string;
  intent: string;
  placementRules: Record<string, string>;
}): PlacementResult {
  const proposed = normalize(opts.proposedFilePath);
  const category = inferCategoryFromIntent(opts.intent);
  const requiredBase = normalize(opts.placementRules[category] ?? "src/lib");

  if (proposed.startsWith(requiredBase + "/") || proposed === requiredBase) return { ok: true };

  const fileName = path.posix.basename(proposed);
  const suggestedPath = normalize(path.posix.join(requiredBase, fileName));
  return {
    ok: false,
    suggestedPath,
    reason: `intent looks like ${category}; expected under ${requiredBase}/`
  };
}

