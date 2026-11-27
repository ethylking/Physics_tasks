// physics/engine.ts — Rapier3D world builder + fixed-step engine (§5.2).
//
// Deliberately worker-agnostic: the Web Worker is a thin shell around this
// class, and the automated tests drive it directly in Node.
//
// Verified API pins (rapier3d-compat 0.14):
//   RigidBodyDesc.setAdditionalMassProperties(mass, CoM, principalInertia, principalFrame)
//   ColliderDesc.setMass(0) / setDensity(0)  → no mass double-counting
//   RigidBodyDesc.setCcdEnabled, setEnabledTranslations/Rotations
//   world.integrationParameters.{dt, numSolverIterations, numAdditionalFrictionIterations, numInternalPgsIterations}

import RAPIER from "@dimforge/rapier3d-compat";
import type { MechProject, ProjectMode, Quat, RigidBodyEntity, Vec3 } from "../core/types";
import { isSolidStatic } from "../core/defaults";
import { computeBodyMassProperties } from "../math/inertia";
import { localToWorld, quatInvert, quatMultiply, rotateVec3ByQuat, staticBaseQuat } from "../math/rotation";
import { emitExprWarning } from "../math/expr";
import {
  compileForceEntity,
  compileSpring,
  evaluateForceApplication,
  evaluateSpringApplication,
  springStabilityWarning,
  type CompiledForce,
  type CompiledSpring,
} from "./forces";
import { buildJoint, stepJointRuntime, type JointRuntime } from "./joints";
import {
  buildRope,
  recoverRopeTensions,
  updateRopeRuntimes,
  type RopeBuildContext,
  type RopeBodyMeta,
  type RopeRuntime,
} from "./ropes";
import { SNAPSHOT_INDEX, SNAPSHOT_HEADER, SNAPSHOT_FLOATS_PER_BODY, snapshotLength, snapshotRopesOffset } from "./snapshot";

const CCD_CONTACT_TOLERANCE = 0.005; // §2.4 — |v|Δt > 5·contactTolerance → force CCD

/**
 * Thickness (m) of a NON-solid static plane — a thin, two-sided surface (§3.2
 * `statics[].solid`). Its `+normal` face is flush with the rendered plane, so a
 * body resting on the visible side sits exactly on it; the slab only occupies
 * this thin band, which leaves the space on both sides of the plane free.
 */
export const STATIC_SURFACE_THICKNESS = 0.04;

/** Non-degenerate plane extent (m) for a surface slab; mirrors the renderer fallbacks. */
function surfaceExtent(extent: [number, number] | undefined, i: 0 | 1, fallback: number): number {
  const v = extent?.[i];
  return typeof v === "number" && Number.isFinite(v) && v > 1e-4 ? v : fallback;
}

export interface EnergyMetrics {
  Ek: number;
  Ep: number;
  Etotal: number;
  E0: number;
  drift: number;
}

interface BodyMeta extends RopeBodyMeta {
  id: string;
  centerOfMass: Vec3;
  principalInertia: Vec3;
  mass: number;
  prevLinvel: Vec3;
  accel: Vec3;
  /** Total net force m·a on the body (N). */
  netForce: Vec3;
  /** Net normal reaction N accumulated from contact-force events (N). */
  normal: Vec3;
  /** Net friction force F_f accumulated from contact-force events (N). */
  friction: Vec3;
  /** Total applied force (parametric forces + springs) of the current substep. */
  applied: Vec3;
}

interface ForceRuntime {
  compiled: CompiledForce;
  body: RAPIER.RigidBody | null;
  bodyIndex: number;
}

interface SpringRuntime {
  spring: CompiledSpring;
  bodyIndexA: number;
  bodyIndexB: number;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Sample an ellipsoid surface point cloud (no native Rapier ellipsoid shape). */
function ellipsoidPoints(a: number, b: number, c: number): Float32Array {
  const pts: number[] = [];
  const LAT = 4;
  const LON = 8;
  pts.push(0, b, 0, 0, -b, 0);
  for (let i = 1; i < LAT; i++) {
    const phi = (Math.PI * i) / LAT;
    const y = Math.cos(phi) * b;
    const r = Math.sin(phi);
    for (let j = 0; j < LON; j++) {
      const theta = (2 * Math.PI * j) / LON;
      pts.push(r * Math.cos(theta) * a, y, r * Math.sin(theta) * c);
    }
  }
  return new Float32Array(pts);
}

/** Local vertices of the wedge prism (X–Z profile × Y depth, +Z up). */
function wedgeVertices(W: number, H: number, D: number, thetaDeg: number): Float32Array {
  const hw = W / 2;
  const hh = H / 2;
  const hd = D / 2;
  const frontTop = Math.max(0.02 * H, H - W * Math.tan((thetaDeg * Math.PI) / 180)) - H / 2;
  const pts: number[] = [];
  for (const sx of [-1, 1]) {
    const zTop = sx === -1 ? hh : frontTop;
    for (const sy of [-1, 1]) {
      pts.push(sx * hw, sy * hd, zTop);
      pts.push(sx * hw, sy * hd, -hh);
    }
  }
  return new Float32Array(pts);
}

/**
 * Normal obtained by rotating the stored `plane.normal` by the entity's
 * RELATIVE `rotation` in the WORLD frame (`rotation · normal`).
 *
 * This is the normal driving the 2D projection: the rotated normal is projected
 * into the vertical X–Z plane (a rotated wall becomes an inclined line, and a
 * pure +Y normal, which would degenerate to zero, falls back to +X). The 2D
 * collider is then built in the base frame of this projected normal.
 *
 * The 3D collider does NOT use this composition: its frame is the rendered
 * world quaternion (`baseQuat(normal) · rotation`, see `buildStatic`), which
 * equals `rotation · normal` only when the rotations commute (a spin about the
 * plane's own normal does not).
 */
export function effectiveStaticNormal(
  stat: MechProject["statics"][number],
  mode: ProjectMode,
): Vec3 {
  const n0 = stat.plane.normal;
  const len = Math.hypot(n0[0], n0[1], n0[2]) || 1;
  const rot: Quat = stat.rotation ?? [0, 0, 0, 1];
  let n: Vec3 = rotateVec3ByQuat([n0[0] / len, n0[1] / len, n0[2] / len], rot);
  if (mode === "2D") {
    n = [n[0], 0, n[2]];
    const lenXZ = Math.hypot(n[0], n[2]);
    n = lenXZ < 1e-6 ? [1, 0, 0] : [n[0] / lenXZ, 0, n[2] / lenXZ];
  }
  return n;
}

export class PhysicsEngine {
  readonly world: RAPIER.World;
  readonly bodyIds: string[] = [];
  readonly dt: number;
  /** Live rigid bodies, indexed like `bodyIds` (snapshot order). */
  readonly bodies: RAPIER.RigidBody[] = [];
  readonly meta: BodyMeta[] = [];
  /** Colliders of the fixed static planes, paired with their entity id. */
  readonly staticColliders: Array<{ id: string; collider: RAPIER.Collider }> = [];

  time = 0;
  private energy0: number | null = null;
  private gravityVec: Vec3;
  private readonly mode: ProjectMode;
  private readonly eventQueue: RAPIER.EventQueue;
  private readonly indexByBody = new Map<RAPIER.RigidBody, number>();
  private readonly forceRuntimes: ForceRuntime[] = [];
  private readonly springRuntimes: SpringRuntime[] = [];
  /** Fixed body at the origin — the world side of rope anchors. */
  readonly worldAnchorBody: RAPIER.RigidBody;
  readonly jointRuntimes: JointRuntime[] = [];
  readonly ropeRuntimes: RopeRuntime[] = [];
  private ropeContext: RopeBuildContext | null = null;

  constructor(project: MechProject, rapier: typeof RAPIER) {
    const w = project.world;
    this.mode = project.meta.mode;
    this.dt = Math.max(1e-5, w.fixedDt);
    // 2D workspace = X–Z plane (Y depth out of plane); project gravity into it.
    this.gravityVec = project.meta.mode === "2D" ? [w.gravity[0], 0, w.gravity[2]] : [...w.gravity] as Vec3;

    this.world = new rapier.World({ x: this.gravityVec[0], y: this.gravityVec[1], z: this.gravityVec[2] });
    this.eventQueue = new rapier.EventQueue(true);
    this.worldAnchorBody = this.world.createRigidBody(rapier.RigidBodyDesc.fixed());

    // §4.4 — solver auto-tune: +2 iterations per extra body and per rope
    // closed loop (m1-pulley-m2-rope), capped (16,16,4).
    const ropeLoops = project.ropes.reduce(
      (n, r) => n + (r.model === "massless" && r.pulleys && r.pulleys.length > 0 ? 1 : 0),
      0,
    );
    const extra = Math.max(0, project.bodies.length - 3) + 2 * ropeLoops;
    const ip = this.world.integrationParameters;
    ip.dt = this.dt;
    ip.numSolverIterations = clamp(w.solverIterations + 2 * extra, 4, 16);
    ip.numAdditionalFrictionIterations = clamp(w.additionalFrictionIterations + extra, 4, 16);
    ip.numInternalPgsIterations = clamp(w.internalPgsIterations + (project.bodies.length > 12 ? 1 : 0), 1, 4);

    // §2.4 — mass-ratio clamp to 1e4.
    const dynamicBodies = project.bodies.filter(
      (b) => !(b.kind === "wedge" && b.geometry.wedge && !b.geometry.wedge.dynamic),
    );
    let minDynamicMass = Infinity;
    let maxDynamicMass = 0;
    for (const b of dynamicBodies) {
      const mp = computeBodyMassProperties(b);
      if (mp.mass < minDynamicMass) minDynamicMass = mp.mass;
      if (mp.mass > maxDynamicMass) maxDynamicMass = mp.mass;
    }

    // 2D mode: jointed bodies may carry custom per-body locks, so they bypass
    // the extra planar auto-lock and let the revolute/prismatic/fixed joint
    // enforce planarity. Free bodies keep the §4.5 X/Z locks (rotation about
    // the out-of-plane +Y axis remains free for everyone in 2D).
    const jointConstrained = new Set<string>();
    if (project.meta.mode === "2D") {
      for (const j of project.joints) {
        if (j.tier !== 1) continue;
        if (j.kind === "revolute" || j.kind === "prismatic" || j.kind === "fixed") {
          if (j.bodyA) jointConstrained.add(j.bodyA);
          if (j.bodyB) jointConstrained.add(j.bodyB);
        }
      }
    }

    // Surface statics are only a few centimetres thick, so a fast body could
    // tunnel through one (a half-space can never be missed). Enable CCD on the
    // moving bodies whenever the scene contains a thin surface plane.
    const hasSurfaceStatics = project.statics.some((s) => !isSolidStatic(s));

    for (const stat of project.statics) {
      this.buildStatic(stat, rapier);
    }
    for (const b of project.bodies) {
      this.buildBody(b, rapier, minDynamicMass, project.meta.mode, jointConstrained, hasSurfaceStatics);
    }
    this.syncBodyIndex();
    this.buildJoints(project, rapier);
    this.buildForces(project.forces);
    this.buildSprings(project);
    this.buildRopes(project, rapier, maxDynamicMass, hasSurfaceStatics);
    this.energy0 = this.computeEnergies().Etotal;
  }

  get snapshotSize(): number {
    return snapshotLength(this.bodies.length, this.ropeRuntimes.length);
  }

  /** Rebuild the rigid-body → engine-index map (after rope segments append). */
  private syncBodyIndex(): void {
    this.indexByBody.clear();
    this.bodies.forEach((rb, i) => this.indexByBody.set(rb, i));
  }

  setGravity(g: Vec3): void {
    this.gravityVec = this.mode === "2D" ? [g[0], 0, g[2]] : ([...g] as Vec3);
    this.world.gravity = { x: this.gravityVec[0], y: this.gravityVec[1], z: this.gravityVec[2] };
    // Energy reference shifts with gravity; recompute the baseline lazily.
    this.energy0 = null;
  }

  /**
   * Build one static plane.
   *
   * The collider FRAME is the single source of truth for the plane's placement:
   * 3D uses exactly the rendered world quaternion (`baseQuat(normal) ·
   * rotation`), 2D the base orientation of the projected normal. Both the solid
   * half-space normal and the thin slab's flush offset are derived from that
   * frame (`local +Z`), so they stay consistent for ANY relative rotation — a
   * spin about the plane's own normal does not commute with the base
   * orientation, so composing the normal separately would tilt the collider
   * away from the drawn rectangle.
   *
   * `solid` planes (the project floor, `isSolidStatic`) are infinite HALF-SPACES:
   * everything on the `−normal` side is filled, so no body can ever exist under
   * it — that is the solid bottom of the project.
   *
   * Every other plane (walls, ceilings, platforms, palette-added planes) is a
   * THIN, TWO-SIDED slab covering only `plane.extent`: it blocks bodies from
   * crossing the surface but leaves BOTH sides free, so objects may live under
   * it. The slab's `+normal` face is flush with the rendered plane, so a body
   * resting on the visible side sits exactly on the plane, and a body under it
   * only has to clear the few centimetres of slab thickness.
   */
  private buildStatic(stat: MechProject["statics"][number], rapier: typeof RAPIER): void {
    const rb = this.world.createRigidBody(rapier.RigidBodyDesc.fixed());
    const p = stat.position ?? [0, 0, 0];

    // Relative-rotation semantics (render parity): the collider is oriented like
    // the rendered mesh. 2D projects the normal into the X–Z plane first, so a
    // rotated wall reads as an inclined line.
    const q: Quat =
      this.mode === "2D"
        ? staticBaseQuat(effectiveStaticNormal(stat, this.mode))
        : quatMultiply(staticBaseQuat(stat.plane.normal), stat.rotation ?? [0, 0, 0, 1]);
    // The plane normal the collider actually has (its local +Z in world space).
    let n = rotateVec3ByQuat([0, 0, 1], q);
    const nLen = Math.hypot(n[0], n[1], n[2]);
    if (!(nLen > 1e-9)) n = [0, 0, 1]; // degenerate normal → horizontal plane
    else if (Math.abs(nLen - 1) > 1e-9) n = [n[0] / nLen, n[1] / nLen, n[2] / nLen];

    if (isSolidStatic(stat)) {
      // Solid floor: infinite half-space, solid on the −normal side.
      const cd = new rapier.ColliderDesc(new rapier.HalfSpace({ x: n[0], y: n[1], z: n[2] }));
      cd.setFriction(stat.friction).setRestitution(stat.restitution);
      // The half-space is infinite through the origin; offset its collider so
      // the plane passes through the entity's position (movable statics).
      if (p[0] !== 0 || p[1] !== 0 || p[2] !== 0) cd.setTranslation(p[0], p[1], p[2]);
      const collider = this.world.createCollider(cd, rb);
      this.staticColliders.push({ id: stat.id, collider });
      return;
    }

    // Two-sided surface slab. Its local +Z is the plane normal, local +X/+Y are
    // the plane's `extent` axes (same frame as the rendered `planeGeometry`).
    // 3D matches the rendered rectangle exactly (extent[0] along local +X,
    // extent[1] along local +Y). 2D renders statics as lines in the X–Z
    // workspace and takes the visible length from a different extent per kind
    // (`FlatBodies`): ground → extent[0] horizontal, wall → extent[1] vertical.
    // Swap for 2D walls so the physical line matches the drawn line.
    const fallback = stat.kind === "ground" ? 20 : 10;
    const e0 = surfaceExtent(stat.plane.extent, 0, fallback);
    const e1 = surfaceExtent(stat.plane.extent, 1, fallback);
    const wall2d = this.mode === "2D" && stat.kind === "wall";
    const alongU = wall2d ? e1 : e0;
    const alongV = wall2d ? e0 : e1;
    const halfT = STATIC_SURFACE_THICKNESS / 2;
    const cd = rapier.ColliderDesc.cuboid(alongU / 2, alongV / 2, halfT)
      .setFriction(stat.friction)
      .setRestitution(stat.restitution)
      // Shift the slab to the −normal side so its top face lands on the plane.
      .setTranslation(p[0] - n[0] * halfT, p[1] - n[1] * halfT, p[2] - n[2] * halfT)
      .setRotation({ x: q[0], y: q[1], z: q[2], w: q[3] });
    const collider = this.world.createCollider(cd, rb);
    this.staticColliders.push({ id: stat.id, collider });
  }

  /** Compile Tier 1 parametric forces (external/torque/thruster). Springs are built separately. */
  private buildForces(forces: MechProject["forces"]): void {
    const bodyIndexById = new Map<string, number>();
    this.bodyIds.forEach((id, i) => bodyIndexById.set(id, i));
    for (const f of forces) {
      if (f.tier !== 1) continue; // Tier 2 plugins — preserved but not built
      if (f.kind !== "external" && f.kind !== "torque" && f.kind !== "thruster") continue;
      const compiled = compileForceEntity(f);
      const bodyIndex = f.body ? (bodyIndexById.get(f.body) ?? -1) : -1;
      if (bodyIndex < 0) {
        emitExprWarning(`force "${f.name}" has no target body and will be ignored`);
        continue;
      }
      this.forceRuntimes.push({ compiled, body: this.bodies[bodyIndex] ?? null, bodyIndex });
    }
  }

  /** Milestone 5 — spring–dampers (Hooke + viscous damping along the line of action). */
  private buildSprings(project: MechProject): void {
    const bodyIndexById = new Map<string, number>();
    this.bodyIds.forEach((id, i) => bodyIndexById.set(id, i));
    for (const f of project.forces) {
      if (f.tier !== 1 || f.kind !== "spring") continue;
      const spring = compileSpring(f);
      if (!spring) continue;
      const indexA = f.body ? (bodyIndexById.get(f.body) ?? -1) : -1;
      if (indexA < 0) {
        emitExprWarning(`spring "${f.name}" has no target body and will be ignored`);
        continue;
      }
      const indexB = spring.anchorBId ? (bodyIndexById.get(spring.anchorBId) ?? -1) : -1;
      if (spring.anchorBId && indexB < 0) {
        emitExprWarning(`spring "${f.name}" anchorB references missing body "${spring.anchorBId}" — binding to the world`);
      }
      if (indexA === indexB && indexB >= 0) {
        emitExprWarning(`spring "${f.name}" connects a body to itself and was skipped`);
        continue;
      }
      // §4.3 — explicit-spring stability guard at world init.
      const massA = this.meta[indexA]?.mass ?? 0;
      const massB = indexB >= 0 ? (this.meta[indexB]?.mass ?? Infinity) : Infinity;
      const warning = springStabilityWarning(spring, massA, massB, this.dt);
      if (warning) emitExprWarning(warning);
      this.springRuntimes.push({ spring, bodyIndexA: indexA, bodyIndexB: indexB });
    }
  }

  /** Milestone 5 — pulleys & ropes (massless + chain). */
  private buildRopes(
    project: MechProject,
    rapier: typeof RAPIER,
    maxDynamicMass: number,
    surfaceStatics: boolean,
  ): void {
    const bodyIndexById = new Map<string, number>();
    project.bodies.forEach((b, i) => bodyIndexById.set(b.id, i));
    const appendSegmentBody = (
      body: RAPIER.RigidBody,
      id: string,
      meta: RopeBodyMeta,
    ): number => {
      this.bodies.push(body);
      this.bodyIds.push(id);
      this.meta.push({
        id,
        centerOfMass: [0, 0, 0],
        principalInertia: [1, 1, 1],
        prevLinvel: [0, 0, 0],
        accel: [0, 0, 0],
        ...meta,
      });
      const index = this.bodies.length - 1;
      this.indexByBody.set(body, index);
      return index;
    };
    this.ropeContext = {
      rapier,
      world: this.world,
      mode: this.mode,
      gravity: this.gravityVec,
      project,
      bodyIndexById,
      bodies: this.bodies,
      meta: this.meta,
      worldAnchorBody: this.worldAnchorBody,
      jointRuntimes: this.jointRuntimes,
      maxDynamicMass,
      surfaceStatics,
      appendSegmentBody,
    };
    for (const rope of project.ropes) {
      this.ropeRuntimes.push(buildRope(rope, this.ropeContext));
    }
  }

  /** Milestone 5 — Tier 1 impulse joints (revolute/spherical/prismatic/fixed). */
  private buildJoints(project: MechProject, rapier: typeof RAPIER): void {
    const bodyIndexById = new Map<string, number>();
    project.bodies.forEach((b, i) => bodyIndexById.set(b.id, i));
    for (const joint of project.joints) {
      if (joint.tier !== 1) continue;
      const runtime = buildJoint(joint, {
        rapier,
        world: this.world,
        mode: this.mode,
        bodyIndexById,
        bodies: this.bodies,
      });
      // Keep one runtime per joint entity (even inert) so rope pulley-mount
      // lookups stay 1:1 with the project.
      this.jointRuntimes.push(runtime ?? {
        entity: joint,
        kind: joint.kind,
        impulseJoint: null,
        bindingA: { body: null, index: -1, isWorld: false },
        bindingB: { body: null, index: -1, isWorld: false },
        axisWorld: [0, 0, 1],
        friction: 0,
        damping: 0,
        anchorWorldA: [0, 0, 0],
        anchorWorldB: [0, 0, 0],
      });
    }
  }

  private buildBody(
    body: RigidBodyEntity,
    rapier: typeof RAPIER,
    minDynamicMass: number,
    mode: "2D" | "3D",
    jointConstrained?: Set<string>,
    surfaceStatics?: boolean,
  ): void {
    const mp = computeBodyMassProperties(body);
    const isFixed = body.kind === "wedge" && body.geometry.wedge && !body.geometry.wedge.dynamic;
    let mass = mp.mass;

    const desc = isFixed ? rapier.RigidBodyDesc.fixed() : rapier.RigidBodyDesc.dynamic();
    const p = body.initial.position;
    const q = body.initial.rotation;
    const v = body.initial.velocity;
    const w = body.initial.angularVelocity;
    desc
      .setTranslation(p[0], p[1], p[2])
      .setRotation({ x: q[0], y: q[1], z: q[2], w: q[3] })
      .setLinvel(v[0], v[1], v[2])
      .setAngvel({ x: w[0], y: w[1], z: w[2] });
    desc.linearDamping = body.linearDamping;
    desc.angularDamping = body.angularDamping;

    // §2.4 — CCD: requested, small bodies, fast bodies, high mass ratios, or
    // any thin surface static in the scene (a 4 cm slab can be tunnelled).
    const minDim = bodyMinDimension(body);
    const speed = Math.hypot(v[0], v[1], v[2]);
    const autoCcd = minDim < 0.1 || speed * this.dt > 5 * CCD_CONTACT_TOLERANCE;
    desc.ccdEnabled = body.ccd || autoCcd || (!isFixed && surfaceStatics === true);

    // §2.4 — clamp extreme mass ratios.
    if (!isFixed && minDynamicMass > 0 && mass > 1e4 * minDynamicMass) {
      mass = 1e4 * minDynamicMass;
    }

    if (!isFixed) {
      desc.setAdditionalMassProperties(
        mass,
        { x: mp.centerOfMass[0], y: mp.centerOfMass[1], z: mp.centerOfMass[2] },
        { x: mp.principalInertia[0], y: mp.principalInertia[1], z: mp.principalInertia[2] },
        { x: mp.principalFrame[0], y: mp.principalFrame[1], z: mp.principalFrame[2], w: mp.principalFrame[3] },
      );
    }

    // §4.5 — 2D is the vertical X–Z plane: lock Y translation and X/Z rotation,
    // leave X/Z translation and Y rotation free (unless the user locked them).
    // Joint-attached bodies keep the same planar locks; revolute/prismatic
    // freedom in 2D is about +Y (see `resolveJointAxis`).
    const locks = body.locks;
    const planar = mode === "2D" && !(jointConstrained && jointConstrained.has(body.id));
    desc.translationsEnabledX = !locks.translate[0];
    desc.translationsEnabledY = !(mode === "2D" || locks.translate[1]);
    desc.translationsEnabledZ = !locks.translate[2];
    desc.rotationsEnabledX = !(planar || locks.rotate[0]);
    desc.rotationsEnabledY = !locks.rotate[1];
    desc.rotationsEnabledZ = !(planar || locks.rotate[2]);

    // Milestone 4 — contact-force extraction for the N / F_f vector overlays:
    // dynamic bodies must never sleep (so resting contacts keep reporting).
    if (!isFixed) {
      desc.setCanSleep(false);
    }

    const rb = this.world.createRigidBody(desc);
    this.attachColliders(body, rb, rapier);

    if (!isFixed) {
      // Contact-force extraction for the N / F_f overlays: enable force events
      // and report every pair (threshold 0) on all colliders of dynamic bodies.
      for (let i = 0; i < rb.numColliders(); i++) {
        rb.collider(i).setActiveEvents(rapier.ActiveEvents.CONTACT_FORCE_EVENTS);
        rb.collider(i).setContactForceEventThreshold(0);
      }
    }

    this.bodies.push(rb);
    this.bodyIds.push(body.id);
    this.meta.push({
      id: body.id,
      centerOfMass: mp.centerOfMass,
      principalInertia: mp.principalInertia,
      mass,
      prevLinvel: [v[0], v[1], v[2]],
      accel: [0, 0, 0],
      netForce: [0, 0, 0],
      normal: [0, 0, 0],
      friction: [0, 0, 0],
      applied: [0, 0, 0],
    });
  }

  private attachColliders(body: RigidBodyEntity, rb: RAPIER.RigidBody, rapier: typeof RAPIER): void {
    const g = body.geometry;

    // §2.2 — per-face friction: six thin massless slabs, each in its own
    // collision group so they never collide with each other.
    if (body.kind === "box" && body.faceFriction && body.faceFriction.length > 0) {
      const W = Math.max(1e-4, g.box?.W ?? 1);
      const H = Math.max(1e-4, g.box?.H ?? 1);
      const D = Math.max(1e-4, g.box?.D ?? 1);
      const eps = 0.02 * Math.min(W, H, D);
      const ff = body.faceFriction;
      // Faces are ordered X+, X−, Y+, Y−, Z+, Z− in the box local frame:
      // W along X, D along Y (depth), H along Z (up).
      const faces: Array<{ he: [number, number, number]; offset: [number, number, number]; mu: number }> = [
        { he: [eps / 2, D / 2, H / 2], offset: [W / 2, 0, 0], mu: ff[0] ?? body.friction },
        { he: [eps / 2, D / 2, H / 2], offset: [-W / 2, 0, 0], mu: ff[1] ?? body.friction },
        { he: [W / 2, eps / 2, H / 2], offset: [0, D / 2, 0], mu: ff[2] ?? body.friction },
        { he: [W / 2, eps / 2, H / 2], offset: [0, -D / 2, 0], mu: ff[3] ?? body.friction },
        { he: [W / 2, D / 2, eps / 2], offset: [0, 0, H / 2], mu: ff[4] ?? body.friction },
        { he: [W / 2, D / 2, eps / 2], offset: [0, 0, -H / 2], mu: ff[5] ?? body.friction },
      ];
      faces.forEach((face, i) => {
        const cd = rapier.ColliderDesc.cuboid(...face.he)
          .setTranslation(face.offset[0], face.offset[1], face.offset[2])
          .setFriction(face.mu)
          .setRestitution(body.restitution)
          .setMass(0)
          .setDensity(0)
          .setCollisionGroups((1 << (16 + i)) | (0xffff ^ (1 << i)));
        this.world.createCollider(cd, rb);
      });
      return;
    }

    let cd: RAPIER.ColliderDesc | null = null;
    switch (body.kind) {
      case "box":
        // W → X, D → Y (depth), H → Z (up).
        cd = rapier.ColliderDesc.cuboid((g.box?.W ?? 1) / 2, (g.box?.D ?? 1) / 2, (g.box?.H ?? 1) / 2);
        break;
      case "sphere":
        cd = rapier.ColliderDesc.ball(g.sphere?.R ?? 0.5);
        break;
      case "ellipsoid":
        cd = rapier.ColliderDesc.convexHull(ellipsoidPoints(g.ellipsoid?.a ?? 0.5, g.ellipsoid?.b ?? 0.5, g.ellipsoid?.c ?? 0.5));
        break;
      case "cylinder": {
        // Rapier's cylinder axis is local +Y; rotate the collider so the
        // cylinder axis follows the schema's +Z height. R stays in X–Y.
        cd = rapier.ColliderDesc.cylinder((g.cylinder?.H ?? 1) / 2, g.cylinder?.R ?? 0.5);
        const s = Math.SQRT1_2;
        cd.setRotation({ x: s, y: 0, z: 0, w: s });
        break;
      }
      case "rod":
        cd = rapier.ColliderDesc.cuboid((g.rod?.L ?? 1) / 2, (g.rod?.thickness ?? 0.05) / 2, (g.rod?.thickness ?? 0.05) / 2);
        break;
      case "wedge":
        cd = rapier.ColliderDesc.convexHull(
          wedgeVertices(g.wedge?.W ?? 1, g.wedge?.H ?? 0.5, g.wedge?.D ?? 1, g.wedge?.thetaDeg ?? 30),
        );
        break;
      default:
        cd = rapier.ColliderDesc.cuboid(0.3, 0.3, 0.3);
        break;
    }
    if (!cd) return;
    cd.setFriction(body.friction)
      .setRestitution(body.restitution)
      .setMass(0)
      .setDensity(0);
    this.world.createCollider(cd, rb);
  }

  /**
   * Pre-simulation initial-collision detection: step the world once (no event
   * queue) to populate the broad phase, then scan every collider pair for a
   * contact manifold whose penetration depth exceeds `margin`. Pairs that share
   * an entity id (e.g. the six per-face friction slabs of one box) and pairs of
   * two statics (fixed-vs-fixed produces no contacts) are skipped. Returns the
   * sorted, unique ids of every offending entity.
   */
  findInitialCollisions(margin = 0.02): string[] {
    // `world.contactPair` reports zero contacts until the broad phase has run at
    // least once, so populate it with a single no-op step (bodies are expected
    // to be fully locked + zero gravity in the detection world).
    this.world.step();

    const entries: Array<{ collider: RAPIER.Collider; entityId: string; isStatic: boolean }> = [];
    for (let i = 0; i < this.bodies.length; i++) {
      const rb = this.bodies[i]!;
      const id = this.bodyIds[i]!;
      for (let j = 0; j < rb.numColliders(); j++) {
        entries.push({ collider: rb.collider(j), entityId: id, isStatic: false });
      }
    }
    for (const entry of this.staticColliders) {
      entries.push({ collider: entry.collider, entityId: entry.id, isStatic: true });
    }

    const flagged = new Set<string>();
    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        const a = entries[i]!;
        const b = entries[j]!;
        if (a.entityId === b.entityId) continue;
        if (a.isStatic && b.isStatic) continue;
        let minDist = Infinity;
        this.world.contactPair(a.collider, b.collider, (manifold) => {
          for (let k = 0; k < manifold.numContacts(); k++) {
            const d = manifold.contactDist(k);
            if (d < minDist) minDist = d;
          }
        });
        if (minDist < -margin) {
          flagged.add(a.entityId);
          flagged.add(b.entityId);
        }
      }
    }
    return [...flagged].sort();
  }

  /** Advance one fixed tick. */
  step(): void {
    for (let i = 0; i < this.bodies.length; i++) {
      const lv = this.bodies[i]!.linvel();
      this.meta[i]!.prevLinvel = [lv.x, lv.y, lv.z];
      this.meta[i]!.applied = [0, 0, 0];
    }
    // rapier3d-compat 0.14 does not auto-reset the user force/torque
    // accumulators between steps (verified empirically) — clear them so each
    // substep applies exactly the freshly evaluated forces below.
    for (const rb of this.bodies) {
      rb.resetForces(true);
      rb.resetTorques(true);
    }
    // Milestone 5 — explicit joint axle friction/damping + chain link damping.
    for (const rt of this.jointRuntimes) stepJointRuntime(rt);
    // Refresh pulley wrap anchors + segment lengths BEFORE the solver runs.
    if (this.ropeContext) updateRopeRuntimes(this.ropeRuntimes, this.ropeContext);
    this.applyForces();
    this.world.step(this.eventQueue);
    this.collectContactForces();
    // Milestone 5 — recover rope tensions from constraint residuals.
    if (this.ropeContext) recoverRopeTensions(this.ropeRuntimes, this.ropeContext);
    this.time += this.dt;
    for (let i = 0; i < this.bodies.length; i++) {
      const b = this.bodies[i]!;
      const lv = b.linvel();
      const prev = this.meta[i]!.prevLinvel;
      const accel: Vec3 = [(lv.x - prev[0]) / this.dt, (lv.y - prev[1]) / this.dt, (lv.z - prev[2]) / this.dt];
      this.meta[i]!.accel = accel;
      // Newton II — total net force (gravity + contacts + applied forces + damping).
      const m = this.meta[i]!.mass;
      this.meta[i]!.netForce = [m * accel[0], m * accel[1], m * accel[2]];
    }
  }

  /** Evaluate every parametric force/torque at the current state and apply it. */
  private applyForces(): void {
    for (const runtime of this.forceRuntimes) {
      const rb = runtime.body;
      const meta = this.meta[runtime.bodyIndex];
      if (!rb || !meta || !runtime.compiled.entity.enabled) continue;
      const t = rb.translation();
      const r = rb.rotation();
      const lv = rb.linvel();
      const av = rb.angvel();
      const application = evaluateForceApplication(
        runtime.compiled,
        {
          position: [t.x, t.y, t.z],
          rotation: [r.x, r.y, r.z, r.w],
          linvel: [lv.x, lv.y, lv.z],
          angvel: [av.x, av.y, av.z],
          centerOfMass: meta.centerOfMass,
        },
        this.time,
        this.mode,
      );
      if (!application) continue;
      if (runtime.compiled.entity.kind === "torque") {
        rb.addTorque(
          { x: application.torque[0], y: application.torque[1], z: application.torque[2] },
          true,
        );
      } else {
        rb.addForceAtPoint(
          { x: application.force[0], y: application.force[1], z: application.force[2] },
          { x: application.anchor[0], y: application.anchor[1], z: application.anchor[2] },
          true,
        );
        meta.applied[0] += application.force[0];
        meta.applied[1] += application.force[1];
        meta.applied[2] += application.force[2];
      }
    }
    this.applySprings();
  }

  /** Milestone 5 — spring-dampers: F_A at r_A on body A, -F_A at r_B on body B. */
  private applySprings(): void {
    for (const runtime of this.springRuntimes) {
      const bodyA = this.bodies[runtime.bodyIndexA];
      const metaA = this.meta[runtime.bodyIndexA];
      if (!bodyA || !metaA || !runtime.spring.entity.enabled) continue;
      const bodyB = runtime.bodyIndexB >= 0 ? this.bodies[runtime.bodyIndexB] : null;
      const stateOf = (index: number): Parameters<typeof evaluateSpringApplication>[1] => {
        const rb = this.bodies[index]!;
        const m = this.meta[index]!;
        const t = rb.translation();
        const r = rb.rotation();
        const lv = rb.linvel();
        const av = rb.angvel();
        return {
          position: [t.x, t.y, t.z],
          rotation: [r.x, r.y, r.z, r.w],
          linvel: [lv.x, lv.y, lv.z],
          angvel: [av.x, av.y, av.z],
          centerOfMass: m.centerOfMass,
        };
      };
      const application = evaluateSpringApplication(
        runtime.spring,
        stateOf(runtime.bodyIndexA),
        bodyB ? stateOf(runtime.bodyIndexB) : null,
        this.mode,
      );
      if (!application) continue;
      bodyA.addForceAtPoint(
        { x: application.force[0], y: application.force[1], z: application.force[2] },
        { x: application.anchorA[0], y: application.anchorA[1], z: application.anchorA[2] },
        true,
      );
      metaA.applied[0] += application.force[0];
      metaA.applied[1] += application.force[1];
      metaA.applied[2] += application.force[2];
      if (bodyB) {
        bodyB.addForceAtPoint(
          { x: -application.force[0], y: -application.force[1], z: -application.force[2] },
          { x: application.anchorB[0], y: application.anchorB[1], z: application.anchorB[2] },
          true,
        );
        const metaB = this.meta[runtime.bodyIndexB];
        if (metaB) {
          metaB.applied[0] -= application.force[0];
          metaB.applied[1] -= application.force[1];
          metaB.applied[2] -= application.force[2];
        }
      }
    }
  }

  /**
   * Read contact-force events of the substep and decompose them per body into
   * the net normal reaction N = (F·n̂)n̂ and friction F_f = F − N, using the
   * strongest-contact direction as the normal (visualization-grade).
   */
  private collectContactForces(): void {
    for (const m of this.meta) {
      m.normal = [0, 0, 0];
      m.friction = [0, 0, 0];
    }
    this.eventQueue.drainContactForceEvents((event) => {
      const f = event.totalForce();
      const n = event.maxForceDirection();
      const nLen = Math.hypot(n.x, n.y, n.z);
      if (nLen < 1e-12) return;
      const nx = n.x / nLen;
      const ny = n.y / nLen;
      const nz = n.z / nLen;
      const dot = f.x * nx + f.y * ny + f.z * nz;

      const add = (rb: RAPIER.RigidBody | null, sign: 1 | -1) => {
        if (!rb) return;
        const index = this.indexByBody.get(rb);
        if (index === undefined) return;
        const meta = this.meta[index];
        if (!meta) return;
        meta.normal = [
          meta.normal[0] + sign * dot * nx,
          meta.normal[1] + sign * dot * ny,
          meta.normal[2] + sign * dot * nz,
        ];
        meta.friction = [
          meta.friction[0] + sign * (f.x - dot * nx),
          meta.friction[1] + sign * (f.y - dot * ny),
          meta.friction[2] + sign * (f.z - dot * nz),
        ];
      };

      // rapier3d-compat 0.14: `totalForce()` is the force applied to
      // collider2 (verified empirically), so body2 gets +F and body1 gets −F.
      // The reported magnitude includes the solver's position-correction term
      // (×1.25 in steady rest) — fine for visualization-grade overlays.
      add(this.world.getCollider(event.collider1()).parent(), -1);
      add(this.world.getCollider(event.collider2()).parent(), 1);
    });
  }

  /** Live mechanical energy (§4.2): KE linear + rotational, PE = −m g·r_CM. */
  computeEnergies(): EnergyMetrics {
    let Ek = 0;
    let Ep = 0;
    const g = this.gravityVec;
    for (let i = 0; i < this.bodies.length; i++) {
      const b = this.bodies[i]!;
      const m = this.meta[i]!;
      const lv = b.linvel();
      Ek += 0.5 * m.mass * (lv.x * lv.x + lv.y * lv.y + lv.z * lv.z);
      const av = b.angvel();
      const rot = b.rotation();
      const wl = rotateVec3ByQuat([av.x, av.y, av.z], quatInvert([rot.x, rot.y, rot.z, rot.w]));
      const I = m.principalInertia;
      Ek += 0.5 * (I[0] * wl[0] * wl[0] + I[1] * wl[1] * wl[1] + I[2] * wl[2] * wl[2]);
      const t = b.translation();
      const cm = localToWorld(m.centerOfMass, [t.x, t.y, t.z], [rot.x, rot.y, rot.z, rot.w]);
      Ep -= m.mass * (g[0] * cm[0] + g[1] * cm[1] + g[2] * cm[2]);
    }
    if (this.energy0 === null) this.energy0 = Ek + Ep;
    const Etotal = Ek + Ep;
    const E0 = this.energy0;
    const drift = E0 !== 0 ? (Etotal - E0) / E0 : 0;
    return { Ek, Ep, Etotal, E0, drift };
  }

  /** Pack the current state into a transferable Float32Array snapshot. */
  writeSnapshot(out: Float32Array): void {
    const e = this.computeEnergies();
    out[SNAPSHOT_INDEX.T] = this.time;
    out[SNAPSHOT_INDEX.EK] = e.Ek;
    out[SNAPSHOT_INDEX.EP] = e.Ep;
    out[SNAPSHOT_INDEX.ETOTAL] = e.Etotal;
    out[SNAPSHOT_INDEX.E0] = e.E0;
    out[SNAPSHOT_INDEX.DRIFT] = e.drift;
    out[SNAPSHOT_INDEX.COUNT] = this.bodies.length;
    out[SNAPSHOT_INDEX.ROPE_COUNT] = this.ropeRuntimes.length;
    for (let i = 0; i < this.bodies.length; i++) {
      const b = this.bodies[i]!;
      const o = SNAPSHOT_HEADER + i * SNAPSHOT_FLOATS_PER_BODY;
      const t = b.translation();
      const r = b.rotation();
      const lv = b.linvel();
      const av = b.angvel();
      const meta = this.meta[i]!;
      out[o + 0] = t.x;
      out[o + 1] = t.y;
      out[o + 2] = t.z;
      out[o + 3] = r.x;
      out[o + 4] = r.y;
      out[o + 5] = r.z;
      out[o + 6] = r.w;
      out[o + 7] = lv.x;
      out[o + 8] = lv.y;
      out[o + 9] = lv.z;
      out[o + 10] = av.x;
      out[o + 11] = av.y;
      out[o + 12] = av.z;
      out[o + 13] = meta.accel[0];
      out[o + 14] = meta.accel[1];
      out[o + 15] = meta.accel[2];
      out[o + 16] = meta.netForce[0];
      out[o + 17] = meta.netForce[1];
      out[o + 18] = meta.netForce[2];
      out[o + 19] = meta.normal[0];
      out[o + 20] = meta.normal[1];
      out[o + 21] = meta.normal[2];
      out[o + 22] = meta.friction[0];
      out[o + 23] = meta.friction[1];
      out[o + 24] = meta.friction[2];
    }
    // Milestone 5 — rope tensions (1 float per rope entity).
    const ro = snapshotRopesOffset(this.bodies.length);
    for (let i = 0; i < this.ropeRuntimes.length; i++) {
      out[ro + i] = this.ropeRuntimes[i]!.tension;
    }
  }
}

function bodyMinDimension(body: RigidBodyEntity): number {
  const g = body.geometry;
  switch (body.kind) {
    case "box":
      return Math.min(g.box?.W ?? 1, g.box?.H ?? 1, g.box?.D ?? 1);
    case "sphere":
      return g.sphere?.R ?? 0.5;
    case "ellipsoid":
      return Math.min(g.ellipsoid?.a ?? 0.5, g.ellipsoid?.b ?? 0.5, g.ellipsoid?.c ?? 0.5);
    case "cylinder":
      return Math.min(g.cylinder?.R ?? 0.5, g.cylinder?.H ?? 1);
    case "rod":
      return g.rod?.thickness ?? 0.05;
    case "wedge":
      return Math.min(g.wedge?.H ?? 0.5, g.wedge?.D ?? 1);
    default:
      return 0.6;
  }
}

export type { Quat };
