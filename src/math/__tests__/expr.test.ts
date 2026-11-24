// math/__tests__/expr.test.ts — mathjs sandbox: whitelist, variable binding,
// graceful fallback + warnings, magnitude clamping, forbidden-expression
// rejection.

import { beforeEach, describe, expect, it } from "vitest";
import {
  compileExpression,
  evaluateExpression,
  makeExprScope,
  resetExprWarnings,
  setExprWarningSink,
} from "../expr";

const warnings: string[] = [];

beforeEach(() => {
  warnings.length = 0;
  resetExprWarnings();
  setExprWarningSink((m) => warnings.push(m));
});

describe("expr — evaluation", () => {
  it("evaluates trig/exp/log with the whitelist", () => {
    expect(evaluateExpression("2*sin(t)", makeExprScope(Math.PI / 2, 0, 0, 0))).toBeCloseTo(2, 9);
    expect(evaluateExpression("cos(pi/2)", makeExprScope(0, 0, 0, 0))).toBeCloseTo(0, 9);
    expect(evaluateExpression("exp(log(5))", makeExprScope(0, 0, 0, 0))).toBeCloseTo(5, 9);
    expect(evaluateExpression("sqrt(16) + abs(-3) + pow(2,3)", makeExprScope(0, 0, 0, 0))).toBeCloseTo(15, 9);
  });

  it("binds variables (t, x, y, z)", () => {
    expect(evaluateExpression("x + 2*y - z", makeExprScope(1, 1, 2, 3))).toBeCloseTo(2, 9);
    expect(evaluateExpression("vx + wy", makeExprScope(0, 0, 0, 0, 5, 0, 0, 0, 3, 0))).toBeCloseTo(8, 9);
  });

  it("supports min/max/floor/ceil and constants", () => {
    expect(evaluateExpression("max(1, 2)", makeExprScope(0, 0, 0, 0))).toBe(2);
    expect(evaluateExpression("floor(2.7) + ceil(2.1) + e*0", makeExprScope(0, 0, 0, 0))).toBe(5);
  });

  it("treats the empty expression as constant 0", () => {
    expect(evaluateExpression("", makeExprScope(0, 0, 0, 0))).toBe(0);
    expect(warnings).toHaveLength(0);
  });

  it("clamps magnitudes to ±1e6", () => {
    expect(evaluateExpression("1e9", makeExprScope(0, 0, 0, 0))).toBe(1e6);
    expect(evaluateExpression("-2e9", makeExprScope(0, 0, 0, 0))).toBe(-1e6);
  });
});

describe("expr — graceful fallback with warnings", () => {
  it("1/0 evaluates to 0 with a warning", () => {
    expect(evaluateExpression("1/0", makeExprScope(0, 0, 0, 0))).toBe(0);
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]).toContain("1/0");
  });

  it("log(-1) evaluates to 0 with a warning", () => {
    expect(evaluateExpression("log(-1)", makeExprScope(0, 0, 0, 0))).toBe(0);
    expect(warnings.some((w) => w.includes("log(-1)"))).toBe(true);
  });

  it("sqrt(-4) evaluates to 0 with a warning", () => {
    expect(evaluateExpression("sqrt(-4)", makeExprScope(0, 0, 0, 0))).toBe(0);
    expect(warnings.length).toBeGreaterThan(0);
  });

  it("0/0 (NaN) evaluates to 0 with a warning", () => {
    expect(evaluateExpression("0/0", makeExprScope(0, 0, 0, 0))).toBe(0);
    expect(warnings.length).toBeGreaterThan(0);
  });

  it("rate-limits repeated warnings for the same expression", () => {
    evaluateExpression("1/0", makeExprScope(0, 0, 0, 0));
    const afterFirst = warnings.length;
    evaluateExpression("1/0", makeExprScope(0, 0, 0, 0));
    evaluateExpression("1/0", makeExprScope(0, 0, 0, 0));
    expect(warnings.length).toBe(afterFirst);
    // after resetting the rate limiter, it warns again
    resetExprWarnings();
    evaluateExpression("1/0", makeExprScope(0, 0, 0, 0));
    expect(warnings.length).toBe(afterFirst + 1);
  });
});

describe("expr — compile-time rejection", () => {
  it("rejects assignments", () => {
    const result = compileExpression("a = 5");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("=");
  });

  it("rejects eval / import / process tokens", () => {
    for (const source of ["eval('1')", "import('x')", "process.exit()", "window.location"]) {
      const result = compileExpression(source);
      expect(result.ok, `expected "${source}" to be rejected`).toBe(false);
    }
  });

  it("rejects unknown symbols at compile time", () => {
    const result = compileExpression("foo(t) + sin(t)");
    expect(result.ok).toBe(false);
  });

  it("compiles expressions that only use whitelisted names", () => {
    expect(compileExpression("5*sin(t)+cos(x)").ok).toBe(true);
    expect(compileExpression("atan2(y, x)").ok).toBe(true);
  });

  it("evaluates rejected expressions to 0 with a warning", () => {
    expect(evaluateExpression("a = 5", makeExprScope(0, 0, 0, 0))).toBe(0);
    expect(warnings.length).toBeGreaterThan(0);
  });
});
