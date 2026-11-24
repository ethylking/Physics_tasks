// core/validator.ts — semantic validator for `.mech.json` projects (§3.4).
//
// Rules enforced:
//  1. Root must be an object with `schemaVersion: 2`.
//  2. Every `id` reference (joints.bodyA/bodyB, forces.body, spring.anchorB,
//     rope path anchors & pulleys, meter targets) must resolve to a defined
//     body/static id — otherwise a line-numbered diagnostic is emitted.
//  3. Duplicate ids across all categories are hard errors.
//  4. Unknown Tier 1 built-in kinds are hard errors; unknown Tier 2 / plugin
//     kinds are PRESERVED with a warning (forward compatibility) and never
//     block the load.
//  5. Unknown root-level keys are preserved into `_raw` with a warning.
//  6. math expressions are scanned for banned tokens (§4.1) — warning only,
//     they will fall back to "0" at load time.

import type { Diagnostic, MechProject } from "./types";

export const TIER1_BODY_KINDS = ["box", "sphere", "ellipsoid", "cylinder", "rod", "wedge"] as const;
export const TIER1_STATIC_KINDS = ["wall", "ground"] as const;
export const TIER1_JOINT_KINDS = ["revolute", "spherical", "prismatic", "fixed"] as const;
export const TIER1_FORCE_KINDS = ["external", "torque", "thruster", "spring"] as const;
export const TIER1_ROPE_MODELS = ["massless", "chain"] as const;
export const TIER1_METER_KINDS = ["telemetry", "vectors", "trajectory", "energy", "momentum"] as const;

export const KNOWN_ROOT_KEYS = [
  "schemaVersion",
  "meta",
  "world",
  "enabledPlugins",
  "bodies",
  "statics",
  "joints",
  "forces",
  "ropes",
  "meters",
  "cameras",
  "_raw",
] as const;

export interface ValidationResult {
  /** true when no `error`-severity diagnostics were produced. */
  ok: boolean;
  diagnostics: Diagnostic[];
  /** Normalized project (with `_raw` populated) when the root parsed as schema v2. */
  project: MechProject | null;
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function lineAt(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) {
    if (text.charCodeAt(i) === 10) line += 1;
  }
  return line;
}

/** Lines of every `"id": "<id>"` definition in the raw JSON text. */
function idDefinitionLines(raw: string, id: string): number[] {
  const re = new RegExp(`"id"\\s*:\\s*"${escapeRegExp(id)}"`, "g");
  const lines: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    lines.push(lineAt(raw, m.index));
  }
  return lines;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

class Sink {
  readonly items: Diagnostic[] = [];

  constructor(private readonly raw?: string) {}

  error(code: string, message: string, extra: Omit<Diagnostic, "severity" | "code" | "message"> = {}): void {
    this.items.push({ severity: "error", code, message, ...extra });
  }

  warn(code: string, message: string, extra: Omit<Diagnostic, "severity" | "code" | "message"> = {}): void {
    this.items.push({ severity: "warning", code, message, ...extra });
  }

  get errorCount(): number {
    return this.items.reduce((n, d) => n + (d.severity === "error" ? 1 : 0), 0);
  }

  /** Line of the `"id": "..."` definition of an entity in the raw JSON. */
  idLine(id: string): number | undefined {
    if (!this.raw) return undefined;
    return idDefinitionLines(this.raw, id)[0];
  }
}

interface EntityEntry {
  entity: Record<string, unknown>;
  index: number;
}

// -----------------------------------------------------------------------------
// Section validators
// -----------------------------------------------------------------------------

function validateMeta(meta: unknown, sink: Sink): void {
  const rec = asRecord(meta);
  if (!rec) {
    sink.error("E_INVALID_META", "meta must be an object with `id`, `name` and `mode`.", { path: "meta" });
    return;
  }
  if (typeof rec.id !== "string" || rec.id.length === 0) {
    sink.error("E_INVALID_META", "meta.id must be a non-empty string UUID.", { path: "meta.id" });
  }
  if (typeof rec.name !== "string" || rec.name.length === 0) {
    sink.error("E_INVALID_META", "meta.name must be a non-empty string.", { path: "meta.name" });
  }
  if (rec.mode !== "2D" && rec.mode !== "3D") {
    sink.error("E_INVALID_META", `meta.mode must be "2D" or "3D", got ${JSON.stringify(rec.mode)}.`, {
      path: "meta.mode",
    });
  }
}

function validateWorld(world: unknown, sink: Sink): void {
  const rec = asRecord(world);
  if (!rec) {
    sink.error("E_INVALID_WORLD", "world must be an object with numeric simulation settings.", { path: "world" });
    return;
  }
  const vec3 = (value: unknown, path: string): void => {
    if (!Array.isArray(value) || value.length !== 3 || !value.every(isFiniteNumber)) {
      sink.error("E_INVALID_WORLD", `\`${path}\` must be a [number, number, number] array of finite numbers.`, { path });
    }
  };
  const num = (value: unknown, path: string, opts: { positive?: boolean; integer?: boolean } = {}): void => {
    const bad =
      !isFiniteNumber(value) ||
      (opts.positive === true && value <= 0) ||
      (opts.integer === true && !Number.isInteger(value));
    if (bad) {
      const kind = opts.integer === true ? "positive integer" : opts.positive === true ? "positive number" : "finite number";
      sink.error("E_INVALID_WORLD", `\`${path}\` must be a ${kind}.`, { path });
    }
  };
  vec3(rec.gravity, "world.gravity");
  num(rec.timeScale, "world.timeScale", { positive: true });
  num(rec.fixedDt, "world.fixedDt", { positive: true });
  num(rec.solverIterations, "world.solverIterations", { positive: true, integer: true });
  num(rec.additionalFrictionIterations, "world.additionalFrictionIterations", { positive: true, integer: true });
  num(rec.internalPgsIterations, "world.internalPgsIterations", { positive: true, integer: true });
  num(rec.maxMassRatio, "world.maxMassRatio", { positive: true });
  num(rec.contactTolerance, "world.contactTolerance", { positive: true });
}

function validatePlugins(value: unknown, sink: Sink): void {
  if (value === undefined) return;
  if (!Array.isArray(value) || !value.every((p) => typeof p === "string")) {
    sink.warn("W_INVALID_PLUGINS", "enabledPlugins must be an array of plugin kind strings.", {
      path: "enabledPlugins",
    });
  }
}

/** §4.1 — banned tokens in math expressions (full mathjs parse lands in M3). */
const BANNED_EXPR_TOKENS = [
  "eval",
  "Function",
  "import",
  "require",
  "window",
  "document",
  "process",
  "globalThis",
  "this",
  ";",
  "=",
];

function checkExpression(value: unknown, path: string, sink: Sink): void {
  if (typeof value !== "string" || value.trim() === "") return;
  const hit = BANNED_EXPR_TOKENS.find((token) => value.includes(token));
  if (hit) {
    sink.warn(
      "W_UNSAFE_EXPRESSION",
      `Expression at ${path} contains "${hit}", which is not allowed; it will fall back to "0" at load time.`,
      { path },
    );
  }
}

// -----------------------------------------------------------------------------
// Main entry points
// -----------------------------------------------------------------------------

/**
 * Validate a parsed project. `rawText` (the original JSON text) enables
 * line-numbered diagnostics.
 */
export function validateProject(input: unknown, rawText?: string): ValidationResult {
  const sink = new Sink(rawText);

  const root = asRecord(input);
  if (!root) {
    sink.error("E_INVALID_ROOT", "Project root must be a JSON object.");
    return { ok: false, diagnostics: sink.items, project: null };
  }
  if (root.schemaVersion !== 2) {
    sink.error(
      "E_SCHEMA_VERSION",
      `Unsupported schemaVersion ${JSON.stringify(root.schemaVersion)} — expected 2. This file was written by an incompatible version.`,
      { path: "schemaVersion", line: 1 },
    );
    return { ok: false, diagnostics: sink.items, project: null };
  }

  validateMeta(root.meta, sink);
  validateWorld(root.world, sink);
  validatePlugins(root.enabledPlugins, sink);

  // --- Read entity arrays -----------------------------------------------------
  const rootObject = root; // non-null alias so closures see the narrowed type
  function readEntities(key: string, label: string): EntityEntry[] {
    const value = rootObject[key];
    if (value === undefined) return [];
    if (!Array.isArray(value)) {
      sink.error("E_INVALID_STRUCTURE", `\`${key}\` must be an array of ${label}.`, { path: key });
      return [];
    }
    const entries: EntityEntry[] = [];
    for (let i = 0; i < value.length; i++) {
      const item = asRecord(value[i]);
      if (!item) {
        sink.error("E_INVALID_STRUCTURE", `${label}[${i}] must be a JSON object.`, { path: `${key}[${i}]` });
        continue;
      }
      entries.push({ entity: item, index: i });
    }
    return entries;
  }

  const bodies = readEntities("bodies", "body");
  const statics = readEntities("statics", "static");
  const joints = readEntities("joints", "joint");
  const forces = readEntities("forces", "force");
  const ropes = readEntities("ropes", "rope");
  const meters = readEntities("meters", "meter");

  // --- Collect id definitions & duplicates ------------------------------------
  const occurrences = new Map<string, Array<{ category: string; index: number }>>();
  const registerId = (id: unknown, category: string, index: number): void => {
    if (typeof id !== "string" || id.length === 0) return;
    const list = occurrences.get(id) ?? [];
    list.push({ category, index });
    occurrences.set(id, list);
  };

  const metaRecord = asRecord(root.meta);
  if (metaRecord && typeof metaRecord.id === "string") {
    registerId(metaRecord.id, "meta", -1);
  }

  for (const [category, entries] of [
    ["bodies", bodies],
    ["statics", statics],
    ["joints", joints],
    ["forces", forces],
    ["ropes", ropes],
    ["meters", meters],
  ] as const) {
    for (const { entity, index } of entries) {
      if (typeof entity.id !== "string" || entity.id.length === 0) {
        sink.error("E_INVALID_STRUCTURE", `${category}[${index}] is missing a string \`id\`.`, {
          path: `${category}[${index}].id`,
        });
      } else {
        registerId(entity.id, category, index);
      }
    }
  }

  for (const [id, occs] of occurrences) {
    if (occs.length < 2) continue;
    const lines = rawText ? idDefinitionLines(rawText, id) : [];
    for (let i = 0; i < occs.length; i++) {
      const occ = occs[i];
      if (occ === undefined) continue;
      sink.error(
        "E_DUPLICATE_ID",
        `Duplicate id "${id}" (${occ.category}${occ.index >= 0 ? `[${occ.index}]` : ""}). Entity ids must be unique across all categories.`,
        {
          path: occ.index >= 0 ? `${occ.category}[${occ.index}].id` : "meta.id",
          line: lines[Math.min(i, lines.length - 1)],
        },
      );
    }
  }

  // --- Reference integrity -----------------------------------------------------
  const targetIds = new Set<string>();
  for (const { entity } of [...bodies, ...statics]) {
    if (typeof entity.id === "string" && entity.id.length > 0) targetIds.add(entity.id);
  }

  const checkReference = (category: string, entry: EntityEntry, field: string, value: unknown, label: string): void => {
    if (value === null || value === undefined) return;
    if (typeof value !== "string" || value.length === 0) return;
    if (targetIds.has(value)) return;
    const entityId = typeof entry.entity.id === "string" ? entry.entity.id : undefined;
    sink.error(
      "E_UNRESOLVED_REFERENCE",
      `${category}[${entry.index}] ${label} references missing entity "${value}". Define the entity first or fix the reference.`,
      {
        path: `${category}[${entry.index}].${field}`,
        line: entityId ? sink.idLine(entityId) : undefined,
        data: { refId: value, entityId, field, category, index: entry.index },
      },
    );
  };

  for (const entry of joints) {
    checkReference("joints", entry, "bodyA", entry.entity.bodyA, "bodyA");
    checkReference("joints", entry, "bodyB", entry.entity.bodyB, "bodyB");
  }
  for (const entry of forces) {
    checkReference("forces", entry, "body", entry.entity.body, "body");
    const spring = asRecord(entry.entity.spring);
    if (spring) checkReference("forces", entry, "spring.anchorB", spring.anchorB, "spring anchorB");
  }
  for (const entry of ropes) {
    if (Array.isArray(entry.entity.path)) {
      entry.entity.path.forEach((point, i) => {
        const rec = asRecord(point);
        if (rec) checkReference("ropes", entry, `path[${i}].anchorId`, rec.anchorId, "rope path anchor");
      });
    }
    if (Array.isArray(entry.entity.pulleys)) {
      entry.entity.pulleys.forEach((pulley, i) => {
        checkReference("ropes", entry, `pulleys[${i}]`, pulley, "rope pulley");
      });
    }
  }
  for (const entry of meters) {
    checkReference("meters", entry, "target", entry.entity.target, "meter target");
  }

  // --- Kind classification (Tier 1 hard error vs Tier 2 preserved) -------------
  const checkKind = (
    category: string,
    entry: EntityEntry,
    tier1Kinds: readonly string[],
    kindField: string,
  ): void => {
    const kind = entry.entity[kindField];
    const singular = category.slice(0, -1);
    if (typeof kind !== "string" || kind.length === 0) {
      sink.error("E_INVALID_STRUCTURE", `${category}[${entry.index}] is missing a string \`${kindField}\`.`, {
        path: `${category}[${entry.index}].${kindField}`,
      });
      return;
    }
    if (tier1Kinds.includes(kind)) return;
    if (entry.entity.tier === 1) {
      sink.error(
        "E_UNKNOWN_TIER1_KIND",
        `Unknown Tier 1 ${singular} kind "${kind}" — built-in kinds are: ${tier1Kinds.join(", ")}. Use \`tier: 2\` for plugin entities.`,
        { path: `${category}[${entry.index}].${kindField}` },
      );
      return;
    }
    sink.warn(
      "W_UNKNOWN_KIND_PRESERVED",
      `Unknown ${singular} kind "${kind}" is not a Tier 1 built-in; it is preserved for forward compatibility${
        entry.entity.tier === 2 ? " as a Tier 2 plugin entity" : ""
      } and requires its EntityPlugin to be registered before it can run.`,
      { path: `${category}[${entry.index}].${kindField}` },
    );
  };

  for (const entry of bodies) checkKind("bodies", entry, TIER1_BODY_KINDS, "kind");
  for (const entry of statics) checkKind("statics", entry, TIER1_STATIC_KINDS, "kind");
  for (const entry of joints) checkKind("joints", entry, TIER1_JOINT_KINDS, "kind");
  for (const entry of forces) checkKind("forces", entry, TIER1_FORCE_KINDS, "kind");
  for (const entry of ropes) checkKind("ropes", entry, TIER1_ROPE_MODELS, "model");
  for (const entry of meters) checkKind("meters", entry, TIER1_METER_KINDS, "kind");

  // --- Expression scan ----------------------------------------------------------
  for (const entry of forces) {
    const components = asRecord(entry.entity.components);
    if (components) {
      for (const axis of ["x", "y", "z"] as const) {
        checkExpression(components[axis], `forces[${entry.index}].components.${axis}`, sink);
      }
    }
  }
  for (const entry of bodies) {
    const geometry = asRecord(entry.entity.geometry);
    const rod = geometry ? asRecord(geometry.rod) : null;
    if (rod) checkExpression(rod.densityExpr, `bodies[${entry.index}].geometry.rod.densityExpr`, sink);
  }

  // --- Forward-compatible root keys → `_raw` ------------------------------------
  const preserved: Record<string, unknown> = {};
  for (const key of Object.keys(root)) {
    if ((KNOWN_ROOT_KEYS as readonly string[]).includes(key) || key === "$schema") continue;
    preserved[key] = root[key];
    sink.warn(
      "W_UNKNOWN_ROOT_KEY",
      `Root key "${key}" is not part of schema v2; it has been preserved in \`_raw\` and will be restored verbatim on save.`,
      { path: key },
    );
  }

  const project = { ...root, _raw: preserved } as unknown as MechProject;
  return { ok: sink.errorCount === 0, diagnostics: sink.items, project };
}

/**
 * Parse + validate raw JSON text. Malformed JSON produces a single
 * `E_MALFORMED_JSON` diagnostic with a line number.
 */
export function validateProjectText(text: string): ValidationResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return { ok: false, diagnostics: [parseErrorDiagnostic(e, text)], project: null };
  }
  return validateProject(parsed, text);
}

/** Convert a JSON.parse error into a line-numbered diagnostic. */
export function parseErrorDiagnostic(e: unknown, text: string): Diagnostic {
  const message = e instanceof Error ? e.message : String(e);
  let line: number | undefined;
  const lineCol = message.match(/line (\d+) column (\d+)/i);
  if (lineCol) {
    line = Number(lineCol[1]);
  } else {
    const pos = message.match(/position (\d+)/i);
    if (pos) {
      const index = Number(pos[1]);
      line = 1 + (text.slice(0, index).match(/\n/g)?.length ?? 0);
    } else {
      // Modern V8 ("Unexpected token '}', ... is not valid JSON") no longer
      // reports a position — locate the first structural violation ourselves.
      line = locateJsonErrorLine(text);
    }
  }
  return {
    severity: "error",
    code: "E_MALFORMED_JSON",
    message: `Malformed JSON: ${message}`,
    line,
    path: "$",
  };
}

/**
 * Minimal structural JSON scanner used as a fallback to find the 1-based line
 * of the first syntactic violation. Returns `undefined` when the structure
 * scans clean (e.g. exotic string-escape errors we don't model).
 */
function locateJsonErrorLine(text: string): number | undefined {
  const n = text.length;
  if (n === 0) return 1;
  let i = 0;
  const lineAt = (idx: number): number => 1 + (text.slice(0, idx).match(/\n/g)?.length ?? 0);
  const errorLine = (): number => lineAt(Math.max(0, Math.min(i, n - 1)));
  const skipWs = (): void => {
    while (i < n) {
      const c = text.charCodeAt(i);
      if (c === 32 || c === 9 || c === 10 || c === 13) i++;
      else break;
    }
  };

  const parseString = (): boolean => {
    if (text[i] !== '"') return false;
    i++;
    while (i < n) {
      const c = text[i] as string;
      if (c === "\\") {
        i += 2;
        continue;
      }
      if (c === '"') {
        i++;
        return true;
      }
      if (c === "\n") return false;
      i++;
    }
    return false;
  };

  const parseNumber = (): boolean => {
    const start = i;
    if (text[i] === "-") i++;
    if (i >= n || !/[0-9]/.test(text[i] as string)) return false;
    if (text[i] === "0") {
      i++;
    } else {
      while (i < n && /[0-9]/.test(text[i] as string)) i++;
    }
    if (i < n && text[i] === ".") {
      i++;
      if (i >= n || !/[0-9]/.test(text[i] as string)) {
        i = start;
        return false;
      }
      while (i < n && /[0-9]/.test(text[i] as string)) i++;
    }
    if (i < n && (text[i] === "e" || text[i] === "E")) {
      i++;
      if (i < n && (text[i] === "+" || text[i] === "-")) i++;
      if (i >= n || !/[0-9]/.test(text[i] as string)) {
        i = start;
        return false;
      }
      while (i < n && /[0-9]/.test(text[i] as string)) i++;
    }
    return true;
  };

  const parseValue = (): boolean => {
    skipWs();
    if (i >= n) return false;
    const c = text[i] as string;
    if (c === "{") return parseObject();
    if (c === "[") return parseArray();
    if (c === '"') return parseString();
    if (c === "-" || (c >= "0" && c <= "9")) return parseNumber();
    if (text.startsWith("true", i)) {
      i += 4;
      return true;
    }
    if (text.startsWith("false", i)) {
      i += 5;
      return true;
    }
    if (text.startsWith("null", i)) {
      i += 4;
      return true;
    }
    return false;
  };

  const parseArray = (): boolean => {
    i++; // '['
    skipWs();
    if (i < n && text[i] === "]") {
      i++;
      return true;
    }
    for (;;) {
      if (!parseValue()) return false;
      skipWs();
      if (i < n && text[i] === ",") {
        i++;
        skipWs();
        continue;
      }
      if (i < n && text[i] === "]") {
        i++;
        return true;
      }
      return false;
    }
  };

  const parseObject = (): boolean => {
    i++; // '{'
    skipWs();
    if (i < n && text[i] === "}") {
      i++;
      return true;
    }
    for (;;) {
      skipWs();
      if (!parseString()) return false;
      skipWs();
      if (i >= n || text[i] !== ":") return false;
      i++;
      if (!parseValue()) return false;
      skipWs();
      if (i < n && text[i] === ",") {
        i++;
        continue;
      }
      if (i < n && text[i] === "}") {
        i++;
        return true;
      }
      return false;
    }
  };

  if (!parseValue()) return errorLine();
  skipWs();
  if (i < n) return lineAt(i); // trailing garbage
  return undefined; // scans clean — give up on a line number
}

/** Human-readable one-line rendering for logs and dialogs. */
export function formatDiagnostic(d: Diagnostic): string {
  const where = d.line !== undefined ? `line ${d.line}` : d.path ?? "?";
  return `[${d.severity}] ${d.code} @ ${where}: ${d.message}`;
}
