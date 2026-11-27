// =============================================================================
// core/types.ts — Serialized truth of a `.mech.json` project (ARCHITECTURE.md §3)
//
// Coordinate convention: right-handed, +X right, +Y depth, +Z up. The default
// horizontal (ground) plane is X–Y; the 2D workspace is the vertical X–Z plane.
// Tier 1 entity schemas are fully specified here. Tier 2 payloads ride along as
// opaque plugin records (`kind: string`, `geometry: Record<string, unknown>`)
// and are preserved verbatim by the validator, never blocking a load.
// =============================================================================

export type Vec3 = [number, number, number];
/** Quaternion in x,y,z,w order. */
export type Quat = [number, number, number, number];
/** mathjs expression string; "" = constant. */
export type Expr = string;
export type UUID = string;
export type ProjectMode = "2D" | "3D";

export interface Scalar3 {
  x: Expr;
  y: Expr;
  z: Expr;
}

// -----------------------------------------------------------------------------
// Project root (§3.1)
// -----------------------------------------------------------------------------

export interface ProjectMeta {
  id: UUID;
  name: string;
  mode: ProjectMode;
  createdAt: string;
  modifiedAt: string;
  description?: string;
}

export interface MechProject {
  schemaVersion: 2;
  meta: ProjectMeta;
  world: WorldSettings;
  /** Tier 2 kinds the user enabled. */
  enabledPlugins: string[];
  bodies: RigidBodyEntity[];
  statics: StaticEntity[];
  joints: JointEntity[];
  forces: ForceEntity[];
  ropes: RopeEntity[];
  meters: MeterEntity[];
  cameras: CameraState;
  /** Preserved unknown/forward-compat entities. */
  _raw: Record<string, unknown>;
}

export interface WorldSettings {
  /** Default [0, 0, -9.81] (Z-up). */
  gravity: Vec3;
  /** 1 */
  timeScale: number;
  /** 1/120 | 1/240 */
  fixedDt: number;
  /** 4 */
  solverIterations: number;
  /** 4 */
  additionalFrictionIterations: number;
  /** 1 */
  internalPgsIterations: number;
  /** 1e4 */
  maxMassRatio: number;
  /** 0.005 */
  contactTolerance: number;
}

// -----------------------------------------------------------------------------
// Tier 1 entities (§3.2)
// -----------------------------------------------------------------------------

// --- Bodies ---

export type Tier1BodyKind = "box" | "sphere" | "ellipsoid" | "cylinder" | "rod" | "wedge";

export interface BoxGeometry {
  /** Width along +X. */
  W: number;
  /** Height along +Z (up). */
  H: number;
  /** Depth along +Y. */
  D: number;
}
export interface SphereGeometry {
  R: number;
  shell: boolean;
}
export interface EllipsoidGeometry {
  /** Semi-axis along +X. */
  a: number;
  /** Semi-axis along +Y (depth). */
  b: number;
  /** Semi-axis along +Z (up). */
  c: number;
}
export interface CylinderGeometry {
  /** Radius in the X–Y cross-section. */
  R: number;
  /** Height along +Z (the cylinder axis). */
  H: number;
  hollow: boolean;
}
export interface RodGeometry {
  L: number;
  thickness: number;
  densityExpr?: Expr;
}
export interface WedgeGeometry {
  thetaDeg: number;
  /** Incline run along +X. */
  W: number;
  /** Height along +Z (up). */
  H: number;
  /** Extrusion depth along +Y. */
  D: number;
  dynamic: boolean;
}

/** `{ box: {...}; sphere: {...}; ... }[Tier1BodyKind]` from the spec. */
export interface Tier1BodyGeometryMap {
  box: BoxGeometry;
  sphere: SphereGeometry;
  ellipsoid: EllipsoidGeometry;
  cylinder: CylinderGeometry;
  rod: RodGeometry;
  wedge: WedgeGeometry;
}

export type Tier1GeometryOf<K extends Tier1BodyKind> = Tier1BodyGeometryMap[K];

/**
 * Practical equivalent of the spec's indexed union: the key matching `kind` is
 * guaranteed by the factories; unknown keys carry a Tier 2 plugin payload.
 */
export type BodyGeometry = { [K in Tier1BodyKind]?: Tier1BodyGeometryMap[K] } & Record<string, unknown>;

export interface RigidBodyEntity {
  id: UUID;
  name: string;
  /** `string` = Tier 2 plugin kind. */
  kind: Tier1BodyKind | string;
  tier: 1 | 2;
  geometry: BodyGeometry;
  mass: { value: number; mode: "total" | "density" };
  centerOfMass: Vec3;
  inertia?: { I: [number, number, number]; principalFrame: Quat };
  friction: number;
  restitution: number;
  /** 6 values, box. */
  faceFriction?: number[];
  ccd: boolean;
  collisionGroups: { memberships: number[]; filters: number[] };
  linearDamping: number;
  angularDamping: number;
  initial: { position: Vec3; rotation: Quat; velocity: Vec3; angularVelocity: Vec3 };
  locks: { translate: [boolean, boolean, boolean]; rotate: [boolean, boolean, boolean] };
  appearance?: { color: string; opacity: number };
}

// --- Statics ---

export interface StaticEntity {
  id: UUID;
  name: string;
  kind: "wall" | "ground";
  plane: { normal: Vec3; extent: [number, number] };
  /**
   * `true` = SOLID half-space: the `−normal` side is filled, so nothing can be
   * under it (this is the project floor / "solid bottom"). `false` = a thin,
   * two-sided SURFACE of `plane.extent`: it blocks bodies crossing it but leaves
   * both sides free, so other objects may live under it. When ABSENT (files
   * written before the field existed) the legacy rule applies — `kind ===
   * "ground"` is solid, `"wall"` is a surface — and the value is baked into the
   * project on load (`applyStaticSolidityDefaults`).
   */
  solid?: boolean;
  /** World point the plane passes through (defaults to the origin). */
  position?: Vec3;
  /** Relative rotation applied AFTER the base orientation from `plane.normal` (identity = initial direction). */
  rotation?: Quat;
  friction: number;
  restitution: number;
  ccd: boolean;
  appearance?: { color: string; opacity: number };
}

// --- Joints ---

export type Tier1JointKind = "revolute" | "spherical" | "prismatic" | "fixed";

export interface JointEntity {
  id: UUID;
  name: string;
  kind: Tier1JointKind | string;
  tier: 1 | 2;
  /** null = world. */
  bodyA: UUID | null;
  bodyB: UUID | null;
  anchors: { a: Vec3; b: Vec3 };
  axis?: "x" | "y" | "z" | "custom";
  axisVec?: Vec3;
  revolute?: { friction: number; damping: number; limits?: [number, number] };
  prismatic?: { friction: number; limits?: [number, number] };
  // Tier 2 payloads (gear, rolling, motor, …) live in `_raw` / plugin schema.
}

// --- Forces ---

export type Tier1ForceKind = "external" | "torque" | "thruster" | "spring";

export interface ForceEntity {
  id: UUID;
  name: string;
  kind: Tier1ForceKind | string;
  tier: 1 | 2;
  body: UUID | null;
  anchor?: Vec3;
  localFrame?: boolean;
  /** external/torque, Expr per axis. */
  components?: Scalar3;
  spring?: { k: number; restLength: number; damping: number; anchorB: UUID; anchorBPoint: Vec3 };
  enabled: boolean;
  appearance?: { color: string; scale: number };
}

// --- Ropes ---

export type Tier1RopeModel = "massless" | "chain";

export interface RopeEntity {
  id: UUID;
  name: string;
  model: Tier1RopeModel | string;
  tier: 1 | 2;
  path: { anchorId: UUID; point: Vec3 }[];
  /** Pulley body ids - pulley i sits between path[i] and path[i+1]. */
  pulleys?: UUID[];
  massless?: { inextensible: boolean };
  chain?: {
    /** Total chain mass (kg); overridden by `linearDensity` when set. */
    mass: number;
    /** Linear density (kg/m) - M = density * L_path when positive. */
    linearDensity?: number;
    segments: number;
    /** Reserved for future XPBD link softening (currently unused). */
    stiffness: number;
    /** Per-link angular damping rate (1/s), scaled by the link inertia. */
    damping: number;
  };
  appearance?: { color: string; thickness: number };
}

// --- Meters ---

export type Tier1MeterKind = "telemetry" | "vectors" | "trajectory" | "energy" | "momentum";

export interface MeterEntity {
  id: UUID;
  name: string;
  kind: Tier1MeterKind | string;
  tier: 1 | 2;
  target?: UUID;
  /** World position of the meter marker (overrides the target-derived position). */
  position?: Vec3;
  output?: "hud" | "plot" | "export";
}

// --- Camera ---

export interface CameraState {
  mode: "perspective" | "orthographic";
  position: Vec3;
  target: Vec3;
  up: Vec3;
  fov: number;
  zoom: number;
}

// -----------------------------------------------------------------------------
// Tier 2 plugins (§3.3)
// -----------------------------------------------------------------------------

/** Loose JSON Schema typing — plugins may embed a full JSON Schema document. */
export interface JSONSchema {
  [key: string]: unknown;
}

export interface EntityPlugin<K extends string = string> {
  kind: K;
  tier: 2;
  /** Validates the payload in `_raw[kind]` / `geometry`. */
  schema: JSONSchema;
  defaults: Record<string, unknown>;
  /** How the entity is built at load. */
  factory: "rapier" | "custom";
  /** React inspector panel id. */
  inspector: string;
  /** Ghost-preview component id. */
  ghost: string;
}

// -----------------------------------------------------------------------------
// Validation diagnostics (§3.4)
// -----------------------------------------------------------------------------

export type DiagnosticSeverity = "error" | "warning";

export interface Diagnostic {
  severity: DiagnosticSeverity;
  code: string;
  message: string;
  /** 1-based line in the source JSON, when the raw text was available. */
  line?: number;
  /** Dotted path such as `joints[0].bodyA`. */
  path?: string;
  /** Structured extras, e.g. { refId, entityId, field }. */
  data?: Record<string, unknown>;
}
