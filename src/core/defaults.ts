// core/defaults.ts — factory helpers producing valid default Tier 1 entities
// and a complete, saveable default project (ARCHITECTURE.md §3.2).

import { newId } from "./id";
import type {
  BodyGeometry,
  CameraState,
  ForceEntity,
  JointEntity,
  MechProject,
  MeterEntity,
  ProjectMode,
  RigidBodyEntity,
  RopeEntity,
  StaticEntity,
  Tier1BodyGeometryMap,
  Tier1BodyKind,
  Tier1ForceKind,
  Tier1JointKind,
  Tier1MeterKind,
  Tier1RopeModel,
  Vec3,
  WorldSettings,
} from "./types";

export function createDefaultWorldSettings(): WorldSettings {
  return {
    // Right-handed Z-up world: X/Y span the horizontal ground plane, +Z is up.
    gravity: [0, 0, -9.81],
    timeScale: 1,
    fixedDt: 1 / 120,
    solverIterations: 4,
    additionalFrictionIterations: 4,
    internalPgsIterations: 1,
    maxMassRatio: 1e4,
    contactTolerance: 0.005,
  };
}

export function createDefaultCamera(): CameraState {
  return {
    mode: "perspective",
    position: [8, -8, 6],
    target: [0, 0, 0.5],
    up: [0, 0, 1],
    fov: 50,
    zoom: 1,
  };
}

// Geometry axis convention (right-handed, +Z up): box H is vertical and D is
// depth; cylinder/disk axis is +Z; ellipsoid c is vertical.
const BODY_GEOMETRY: Tier1BodyGeometryMap = {
  box: { W: 1, H: 1, D: 1 },
  sphere: { R: 0.5, shell: false },
  ellipsoid: { a: 0.5, b: 0.5, c: 0.5 },
  cylinder: { R: 0.5, H: 1, hollow: false },
  rod: { L: 1, thickness: 0.05 },
  wedge: { thetaDeg: 30, W: 1, H: 0.5, D: 1, dynamic: false },
};

/** Default geometry of a palette-spawned pulley (a thin cylinder disk). */
export const PULLEY_GEOMETRY = { R: 0.5, H: 0.08, hollow: false };

const BODY_COLORS: Record<Tier1BodyKind, string> = {
  box: "#38bdf8",
  sphere: "#f472b6",
  ellipsoid: "#a78bfa",
  cylinder: "#34d399",
  rod: "#fbbf24",
  wedge: "#fb923c",
};

export function createDefaultBody<K extends Tier1BodyKind>(
  kind: K,
  partial: Partial<RigidBodyEntity> = {},
): RigidBodyEntity {
  const geometry: BodyGeometry = {};
  (geometry as Record<string, unknown>)[kind] = { ...BODY_GEOMETRY[kind] };

  return {
    id: newId(),
    name: kind,
    kind,
    tier: 1,
    geometry,
    mass: { value: 1, mode: "total" },
    centerOfMass: [0, 0, 0],
    friction: 0.6,
    restitution: 0.1,
    ccd: false,
    collisionGroups: { memberships: [1], filters: [1] },
    linearDamping: 0.05,
    angularDamping: 0.05,
    initial: {
      position: [0, 0, 0],
      rotation: [0, 0, 0, 1],
      velocity: [0, 0, 0],
      angularVelocity: [0, 0, 0],
    },
    locks: { translate: [false, false, false], rotate: [false, false, false] },
    appearance: { color: BODY_COLORS[kind], opacity: 1 },
    ...partial,
  };
}

export function createDefaultStatic(kind: "wall" | "ground", partial: Partial<StaticEntity> = {}): StaticEntity {
  return {
    id: newId(),
    name: kind === "ground" ? "Horizontal plane" : "Wall",
    kind,
    plane:
      kind === "ground"
        ? { normal: [0, 0, 1], extent: [20, 20] }
        : { normal: [0, 1, 0], extent: [10, 10] },
    friction: 0.8,
    restitution: 0.2,
    ccd: true,
    appearance: { color: "#3f3f46", opacity: 1 },
    ...partial,
  };
}

export function createDefaultJoint<K extends Tier1JointKind>(
  kind: K,
  partial: Partial<JointEntity> = {},
): JointEntity {
  const base: JointEntity = {
    id: newId(),
    name: kind,
    kind,
    tier: 1,
    bodyA: null,
    bodyB: null,
    anchors: { a: [0, 0, 0], b: [0, 0, 0] },
    axis: "z",
    axisVec: [0, 0, 1],
  };
  if (kind === "revolute") base.revolute = { friction: 0, damping: 0 };
  if (kind === "prismatic") base.prismatic = { friction: 0 };
  return { ...base, ...partial };
}

export function createDefaultForce<K extends Tier1ForceKind>(
  kind: K,
  partial: Partial<ForceEntity> = {},
): ForceEntity {
  const base: ForceEntity = {
    id: newId(),
    name: kind,
    kind,
    tier: 1,
    body: null,
    enabled: true,
    appearance: { color: "#f87171", scale: 1 },
  };
  if (kind === "external" || kind === "torque" || kind === "thruster") {
    base.components = { x: "0", y: "0", z: "0" };
  }
  if (kind === "thruster") {
    base.anchor = [0, 0, 0];
    base.localFrame = true;
  }
  if (kind === "spring") {
    base.spring = { k: 10, restLength: 1, damping: 0.5, anchorB: "", anchorBPoint: [0, 0, 0] };
  }
  return { ...base, ...partial };
}

export function createDefaultRope(model: Tier1RopeModel = "massless", partial: Partial<RopeEntity> = {}): RopeEntity {
  const base: RopeEntity = {
    id: newId(),
    name: model,
    model,
    tier: 1,
    path: [],
    appearance: { color: "#e4e4e7", thickness: 0.02 },
  };
  base.pulleys = [];
  if (model === "massless") {
    base.massless = { inextensible: true };
  } else {
    base.chain = { mass: 1, segments: 30, stiffness: 1000, damping: 10 };
  }
  return { ...base, ...partial };
}

export function createDefaultMeter<K extends Tier1MeterKind>(
  kind: K,
  partial: Partial<MeterEntity> = {},
): MeterEntity {
  return {
    id: newId(),
    name: kind,
    kind,
    tier: 1,
    output: "hud",
    ...partial,
  };
}

/**
 * §4.5 — 2D-in-3D locking: the 2D workspace is the vertical X–Z plane, so Y
 * translation and X/Z rotations are locked at the solver level. Z stays up.
 */
export function applyModeLocks(bodies: RigidBodyEntity[], mode: ProjectMode): void {
  if (mode !== "2D") return;
  for (const body of bodies) {
    body.locks = { translate: [false, true, false], rotate: [true, false, true] };
  }
}

export interface CreateProjectOptions {
  /** Seed the scene with a ground plane and a demo box. Default: true. */
  seedScene?: boolean;
}

/** Build a complete, valid, saveable default project. */
export function createDefaultProject(
  name: string,
  mode: ProjectMode,
  options: CreateProjectOptions = {},
): MechProject {
  const now = new Date().toISOString();
  const seedScene = options.seedScene ?? true;

  const statics: StaticEntity[] = [];
  const bodies: RigidBodyEntity[] = [];
  if (seedScene) {
    statics.push(createDefaultStatic("ground"));
    const box = createDefaultBody("box");
    box.name = "Box 1";
    box.initial = { ...box.initial, position: [0, 0, 0.5] };
    bodies.push(box);
  }
  applyModeLocks(bodies, mode);

  return {
    schemaVersion: 2,
    meta: {
      id: newId(),
      name: name.trim() || "Untitled Project",
      mode,
      createdAt: now,
      modifiedAt: now,
      description: "",
    },
    world: createDefaultWorldSettings(),
    enabledPlugins: [],
    bodies,
    statics,
    joints: [],
    forces: [],
    ropes: [],
    meters: [],
    cameras: createDefaultCamera(),
    _raw: {},
  };
}

/** A fresh, uninitialized Vec3 (exported for editor convenience). */
export function zeroVec3(): Vec3 {
  return [0, 0, 0];
}

/**
 * Half the vertical extent of a body kind with DEFAULT geometry (used for ghost
 * previews and the placement lift). `pulley` is a thin cylinder disk.
 */
export function halfHeightOf(kind: string): number {
  switch (kind) {
    case "box":
      return BODY_GEOMETRY.box.H / 2;
    case "sphere":
      return BODY_GEOMETRY.sphere.R;
    case "ellipsoid":
      return BODY_GEOMETRY.ellipsoid.c;
    case "cylinder":
      return BODY_GEOMETRY.cylinder.H / 2;
    case "pulley":
      return PULLEY_GEOMETRY.H / 2;
    case "rod":
      return BODY_GEOMETRY.rod.thickness / 2;
    case "wedge":
      return BODY_GEOMETRY.wedge.H / 2;
    default:
      return 0;
  }
}

/**
 * Half the vertical extent of a CONCRETE body, read from its actual geometry
 * (a pulley is a cylinder with a custom thin H, so kind-based defaults lie).
 */
export function bodyHalfHeight(body: RigidBodyEntity): number {
  const g = body.geometry;
  switch (body.kind) {
    case "box":
      return (g.box?.H ?? BODY_GEOMETRY.box.H) / 2;
    case "sphere":
      return g.sphere?.R ?? BODY_GEOMETRY.sphere.R;
    case "ellipsoid":
      return g.ellipsoid?.c ?? BODY_GEOMETRY.ellipsoid.c;
    case "cylinder":
      return (g.cylinder?.H ?? BODY_GEOMETRY.cylinder.H) / 2;
    case "rod":
      return (g.rod?.thickness ?? BODY_GEOMETRY.rod.thickness) / 2;
    case "wedge":
      return (g.wedge?.H ?? BODY_GEOMETRY.wedge.H) / 2;
    default:
      return 0;
  }
}
