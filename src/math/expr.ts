// math/expr.ts — safe mathjs expression compiler & evaluator (§4.1).
//
// Security model:
//   1. STATIC token rejection — eval / import / assignments / host-access
//      names are refused before parsing.
//   2. AST WHITELIST — the parsed tree is traversed; every FunctionNode must
//      be one of the 20 whitelisted math functions and every SymbolNode must
//      be one of {pi, e, t, x, y, z, vx, vy, vz, wx, wy, wz}. Anything else
//      (unknown functions, other constants, assignment nodes) fails at
//      compile time.
//   3. RUNTIME wrapper — exceptions, NaN and ±Infinity evaluate to 0 with a
//      rate-limited warning; magnitudes are clamped to 1e6.
//
// Evaluation happens against a plain object scope of NUMBERS only, so no host
// object is ever reachable from an expression.

import { create, all, parse } from "mathjs";
import type { MathNode } from "mathjs";

export const EXPR_VARIABLES = ["t", "x", "y", "z", "vx", "vy", "vz", "wx", "wy", "wz"] as const;

const WHITELIST_FUNCTIONS = new Set([
  "sin", "cos", "tan",
  "asin", "acos", "atan", "atan2",
  "sinh", "cosh", "tanh",
  "exp", "log", "log10", "sqrt",
  "abs", "pow", "sign",
  "min", "max", "floor", "ceil",
]);

const WHITELIST_SYMBOLS = new Set<string>(["pi", "e", ...EXPR_VARIABLES]);

/** Compile-time banned substrings (assignments, code execution, host access). */
const FORBIDDEN_TOKENS = [
  "eval",
  "Function",
  "import",
  "require",
  "window",
  "document",
  "process",
  "globalThis",
  "this",
  "constructor",
  "__proto__",
  ";",
  "=",
];

export const MAX_EXPR_MAGNITUDE = 1e6;

// Full mathjs instance (number output) — safe because every expression that
// reaches compile() has already passed the AST whitelist above.
const math = create(all ?? {});

export type ExprScope = Partial<Record<(typeof EXPR_VARIABLES)[number], number>>;

export type CompiledExprResult =
  | { ok: true; fn: (scope: ExprScope) => number; source: string }
  | { ok: false; error: string; source: string };

const cache = new Map<string, CompiledExprResult>();

/** Walk the AST and enforce the function/symbol whitelist. */
function validateAst(node: MathNode): string | null {
  let problem: string | null = null;
  node.traverse((raw: unknown, _path: unknown, rawParent: unknown) => {
    if (problem) return;
    const n = raw as { type?: string; name?: string; fn?: { name?: string } };
    const parent = rawParent as { type?: string; fn?: unknown } | null;
    if (n.type === "FunctionNode") {
      const name = typeof n.fn?.name === "string" ? n.fn.name : "?";
      if (!WHITELIST_FUNCTIONS.has(name)) {
        problem = `function "${name}" is not whitelisted`;
      }
    } else if (n.type === "SymbolNode") {
      // In mathjs ≥ 14 the FunctionNode's name is itself a SymbolNode child —
      // it was already validated by the FunctionNode branch above.
      if (parent && parent.type === "FunctionNode" && parent.fn === raw) return;
      const name = n.name ?? "?";
      if (!WHITELIST_SYMBOLS.has(name)) {
        problem = `symbol "${name}" is not whitelisted`;
      }
    } else if (n.type === "AssignmentNode") {
      problem = "assignments are not allowed";
    } else if (n.type === "AccessorNode" || n.type === "ObjectNode" || n.type === "ArrayNode") {
      problem = `${n.type} is not allowed in expressions`;
    }
  });
  return problem;
}

/** Compile an expression string against the whitelist. Cached per source. */
export function compileExpression(source: string): CompiledExprResult {
  const expr = source.trim();
  if (expr === "") {
    return { ok: true, fn: () => 0, source }; // empty = constant 0
  }
  const cached = cache.get(expr);
  if (cached) return cached;

  for (const token of FORBIDDEN_TOKENS) {
    if (expr.includes(token)) {
      const result: CompiledExprResult = {
        ok: false,
        source,
        error: `expression contains forbidden token "${token}"`,
      };
      cache.set(expr, result);
      return result;
    }
  }

  try {
    const node = parse(expr);
    const astProblem = validateAst(node);
    if (astProblem) {
      const result: CompiledExprResult = { ok: false, source, error: `cannot compile expression: ${astProblem}` };
      cache.set(expr, result);
      return result;
    }
    const compiled = math.compile(expr) as unknown as CompiledNode;
    const result: CompiledExprResult = {
      ok: true,
      source,
      fn: (scope: ExprScope) => evaluateCompiled(compiled, scope, expr),
    };
    cache.set(expr, result);
    return result;
  } catch (e) {
    const result: CompiledExprResult = {
      ok: false,
      source,
      error: `cannot compile expression: ${e instanceof Error ? e.message : String(e)}`,
    };
    cache.set(expr, result);
    return result;
  }
}

/** Build the standard simulation scope for a force/meter expression. */
export function makeExprScope(
  t: number,
  x: number,
  y: number,
  z: number,
  vx = 0,
  vy = 0,
  vz = 0,
  wx = 0,
  wy = 0,
  wz = 0,
): ExprScope {
  return { t, x, y, z, vx, vy, vz, wx, wy, wz };
}

// -----------------------------------------------------------------------------
// Warning sink (rate-limited, deduplicated)
// -----------------------------------------------------------------------------

export type ExprWarningSink = (message: string) => void;

let warningSink: ExprWarningSink | null = null;
const warnTimes = new Map<string, number>();
export const EXPR_WARN_INTERVAL_MS = 5000;

/** Attach a warning sink (the physics worker forwards these to the UI). */
export function setExprWarningSink(sink: ExprWarningSink | null): void {
  warningSink = sink;
}

/** Reset warning rate-limit state (tests). */
export function resetExprWarnings(): void {
  warnTimes.clear();
}

function warnOnce(key: string, message: string): void {
  const now = Date.now();
  const last = warnTimes.get(key) ?? 0;
  if (now - last < EXPR_WARN_INTERVAL_MS) return;
  warnTimes.set(key, now);
  warningSink?.(message);
}

/**
 * Emit a rate-limited warning through the installed sink (deduplicated per
 * message). Used by force compilation (worker → UI warning badge, §4.1).
 */
export function emitExprWarning(message: string): void {
  warnOnce(`msg:${message}`, message);
}

// -----------------------------------------------------------------------------
// Evaluation
// -----------------------------------------------------------------------------

interface CompiledNode {
  evaluate: (scope: unknown) => unknown;
}

function evaluateCompiled(compiled: CompiledNode, scope: ExprScope, source: string): number {
  let raw: unknown;
  try {
    raw = compiled.evaluate(scope);
  } catch (e) {
    warnOnce(`err:${source}`, `expression "${source}" failed at runtime: ${e instanceof Error ? e.message : String(e)} → 0`);
    return 0;
  }
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    warnOnce(`nan:${source}`, `expression "${source}" produced ${String(raw)} → 0`);
    return 0;
  }
  if (raw > MAX_EXPR_MAGNITUDE) return MAX_EXPR_MAGNITUDE;
  if (raw < -MAX_EXPR_MAGNITUDE) return -MAX_EXPR_MAGNITUDE;
  return raw;
}

/**
 * Compile + evaluate in one step (convenience for single-shot uses).
 * Returns 0 and emits a warning on any failure.
 */
export function evaluateExpression(source: string, scope: ExprScope): number {
  const result = compileExpression(source);
  if (!result.ok) {
    warnOnce(`compile:${source}`, result.error);
    return 0;
  }
  return result.fn(scope);
}
