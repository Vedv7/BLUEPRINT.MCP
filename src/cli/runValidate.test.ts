import { describe, expect, it } from "vitest";
import { shouldFailCi } from "./ciExit.js";

describe("validate CI gates", () => {
  it("fails check step when violations exist in CI mode", () => {
    expect(shouldFailCi({ violations: 1, warnings: 0 }, { ci: true })).toBe(true);
  });

  it("passes check step when clean in CI mode", () => {
    expect(shouldFailCi({ violations: 0, warnings: 0 }, { ci: true })).toBe(false);
  });

  it("fails adr step on warnings only when strict", () => {
    expect(shouldFailCi({ violations: 0, warnings: 2 }, { ci: true, strict: true })).toBe(true);
    expect(shouldFailCi({ violations: 0, warnings: 2 }, { ci: true, strict: false })).toBe(false);
  });
});
