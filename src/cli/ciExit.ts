export type CiGateOptions = {
  ci?: boolean;
  strict?: boolean;
};

export function shouldFailCi(
  counts: { violations: number; warnings: number },
  opts: CiGateOptions
): boolean {
  if (!opts.ci) return false;
  if (counts.violations > 0) return true;
  if (opts.strict && counts.warnings > 0) return true;
  return false;
}

export function applyStrictConfig<T extends { strictness?: string }>(config: T, strict?: boolean): T {
  if (!strict) return config;
  return { ...config, strictness: "strict" as const };
}
