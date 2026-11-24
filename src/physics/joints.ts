// physics/joints.ts — Milestone 5: Tier 1 impulse joints (ARCHITECTURE.md §1.1,
// §4.5). Built on Rapier's `ImpulseJointSet` via `world.createImpulseJoint`.
//
//   revolute   1-DOF rotation about `axis`/`axisVec`; optional limits (rad),
//             rotational damping −c·ω_rel and Coulomb axle friction −τ_f·sign(ω_rel)
//             applied explicitly each substep (Rapier 0.14 exposes no native
//             joint damping/friction parameters).
//   spherical  3-DOF rotation at coincident anchors. Disallowed (warned + skipped)
//             in 2D mode (§4.5).
//   prismatic  1-DOF translation along `axis` with optional limits (m) and
//             sliding friction applied explicitly each substep.
//   fixed      weld: anchors AND relative orientation locked at creation.
//
// Axis / frame note: `JointData.revolute/prismatic` take ONE axis vector that is
// interpreted in BOTH bodies' local frames, and `fixed` takes a per-side frame
// pair. When a side binds to the world (`bodyA`/`bodyB === null`, anchor stored
// in WORLD coordinates), we therefore create a dedicated fixed anchor body with
// the rotation of the OTHER side, so the same axis coordinates read correctly in
// both frames and the world anchor converts to that body's local frame.

import RAPIER from "@dimforge/rapier3d-compat";
import type { JointEntity, ProjectMode, Quat, Vec3 } from "../core/types";
import { quatInvert, quatMultiply, rotateVec3ByQuat } from "../math/rotation";
import { emitExprWarning } from "../math/expr";

export interface JointBodyBinding {
  body: RAPIER.RigidBody | null;
  /** Engine body index, −1 for world/anchor bodies. */
  index: number;
  /** true when this side binds to the world. */
  isWorld: boolean;
}

/** Live runtime state of one Tier 1 joint. */
export interface JointRuntime {
  entity: JointEntity;
  kind: JointEntity["kind"];
  impulseJoint: RAPIER.ImpulseJoint | null;
  bindingA: JointBodyBinding;
  bindingB: JointBodyBinding;
  /** Free/constrained axis of the joint in WORLD space. */
  axisWorld: Vec3;
  /** Coulomb friction magnitude (revolute: N·m, prismatic: N). */
  friction: number;
  /** Viscous damping coefficient (revolute: N·m·s/rad, prismatic: N·s/m). */
  damping: number;
  /** World-space anchors of the joint (for explicit friction application). */
  anchorWorldA: Vec3;
  anchorWorldB: Vec3;
}

const IDENTITY_QUAT: Quat = [0, 0, 0, 1];
const X_AXIS: Vec3 = [1, 0, 0];
const Y_AXIS: Vec3 = [0, 1, 0];
const Z_AXIS: Vec3 = [0, 0, 1];

const AXIS_VECTORS: Record<"x" | "y" | "z", Vec3> = { x: X_AXIS, y: Y_AXIS, z: Z_AXIS };

function normalizeAxis(v: Vec3): Vec3 {
  const len = Math.hypot(v[0], v[1], v[2]);
  if (len < 1e-9) return Z_AXIS;
  return [v[0] / len, v[1] / len, v[2] / len];
}

/**
 * World-space axis of a joint. §4.5 — in 2D mode every revolute/prismatic axis
 * auto-snaps to Z (with a warning) so planar mechanics never leaves the plane.
 */
export function resolveJointAxis(joint: JointEntity, mode: ProjectMode): Vec3 {
  let axis: Vec3;
  if (joint.axis === "custom") {
    const raw = joint.axisVec ?? Z_AXIS;
    axis = normalizeAxis([
      Number.isFinite(raw[0]) ? raw[0] : 0,
      Number.isFinite(raw[1]) ? raw[1] : 0,
      Number.isFinite(raw[2]) ? raw[2] : 0,
    ]);
  } else {
    axis = AXIS_VECTORS[(joint.axis as "x" | "y" | "z") ?? "z"] ?? Z_AXIS;
  }
  if (mode === "2D" && Math.abs(axis[2]) < 0.999) {
    emitExprWarning(
      `joint "${joint.name}" (${joint.kind}) axis auto-snapped to Z in 2D mode (§4.5)`,
    );
    return Z_AXIS;
  }
  return axis;
}

/** The same world axis expressed in a body's local frame. */
function localAxisFor(axisWorld: Vec3, rotation: Quat): Vec3 {
  return rotateVec3ByQuat(axisWorld, quatInvert(rotation));
}

function quatFromRotation(r: RAPIER.Rotation): Quat {
  return [r.x, r.y, r.z, r.w];
}

export interface JointBuildContext {
  rapier: typeof RAPIER;
  world: RAPIER.World;
  mode: ProjectMode;
  /** id → live body + engine index. */
  bodyIndexById: Map<string, number>;
  bodies: RAPIER.RigidBody[];
}

/**
 * Build one Tier 1 joint. Returns null when the joint is unusable (warned).
 * World-bound sides get a dedicated fixed anchor body oriented like the other
 * side, so anchors (stored in world coords) and axis coordinates line up.
 */
export function buildJoint(joint: JointEntity, ctx: JointBuildContext): JointRuntime | null {
  const { rapier, world, mode } = ctx;

  const resolve = (id: string | null): { body: RAPIER.RigidBody | null; index: number; isWorld: boolean } => {
    if (!id) return { body: null, index: -1, isWorld: true };
    const index = ctx.bodyIndexById.get(id) ?? -1;
    const body = index >= 0 ? (ctx.bodies[index] ?? null) : null;
    if (!body) {
      emitExprWarning(`joint "${joint.name}" references missing body "${id}" and will be ignored`);
      return { body: null, index: -1, isWorld: false };
    }
    return { body, index, isWorld: false };
  };

  const sideA = resolve(joint.bodyA);
  const sideB = resolve(joint.bodyB);
  // Reject missing bodies; world sides are materialized as fixed anchor
  // bodies further down.
  if ((!sideA.body && !sideA.isWorld) || (!sideB.body && !sideB.isWorld)) return null;
  // A joint binding the world to itself is meaningless.
  if (sideA.isWorld && sideB.isWorld) return null;

  if (joint.kind === "spherical" && mode === "2D") {
    emitExprWarning(
      `spherical joint "${joint.name}" is not allowed in 2D mode (§4.5) and was skipped`,
    );
    return null;
  }

  const axisWorld = resolveJointAxis(joint, mode);
  const rotA = sideA.isWorld ? null : quatFromRotation(sideA.body!.rotation());
  const rotB = sideB.isWorld ? null : quatFromRotation(sideB.body!.rotation());
  // Reference rotation for axis/frame bookkeeping: the non-world side's
  // rotation; when both sides are bodies we use side A's.
  const refRot = rotA ?? rotB ?? IDENTITY_QUAT;
  const refRotB = rotB ?? rotA ?? IDENTITY_QUAT;

  // Materialize the world side(s): a fixed body sharing the other side's
  // orientation. Anchors stored in world coordinates convert into its frame.
  let bodyA = sideA.body;
  let bodyB = sideB.body;
  if (sideA.isWorld) {
    const desc = rapier.RigidBodyDesc.fixed().setRotation({ x: refRotB[0], y: refRotB[1], z: refRotB[2], w: refRotB[3] });
    bodyA = world.createRigidBody(desc);
  }
  if (sideB.isWorld) {
    const desc = rapier.RigidBodyDesc.fixed().setRotation({ x: refRot[0], y: refRot[1], z: refRot[2], w: refRot[3] });
    bodyB = world.createRigidBody(desc);
  }
  if (!bodyA || !bodyB) return null;

  const anchorLocal = (worldAnchor: Vec3, isWorld: boolean, otherRot: Quat): { x: number; y: number; z: number } => {
    if (isWorld) {
      const local = rotateVec3ByQuat(worldAnchor, quatInvert(otherRot));
      return { x: local[0], y: local[1], z: local[2] };
    }
    return { x: worldAnchor[0], y: worldAnchor[1], z: worldAnchor[2] };
  };

  const anchorA = anchorLocal(joint.anchors.a, sideA.isWorld, refRotB);
  const anchorB = anchorLocal(joint.anchors.b, sideB.isWorld, refRot);

  // Single axis vector shared by both local frames: expressed in the
  // reference (non-world) side's frame; the world side shares that rotation.
  const axisLocal = localAxisFor(axisWorld, refRot);

  let impulseJoint: RAPIER.ImpulseJoint | null = null;
  switch (joint.kind) {
    case "revolute": {
      impulseJoint = world.createImpulseJoint(
        rapier.JointData.revolute(
          anchorA,
          anchorB,
          { x: axisLocal[0], y: axisLocal[1], z: axisLocal[2] },
        ),
        bodyA,
        bodyB,
        true,
      );
      const limits = joint.revolute?.limits;
      if (
        limits && limits.length === 2 &&
        Number.isFinite(limits[0]) && Number.isFinite(limits[1]) &&
        (limits[0] as number) < (limits[1] as number)
      ) {
        (impulseJoint as unknown as RAPIER.UnitImpulseJoint).setLimits(limits[0] as number, limits[1] as number);
      }
      break;
    }
    case "spherical": {
      impulseJoint = world.createImpulseJoint(
        rapier.JointData.spherical(anchorA, anchorB),
        bodyA,
        bodyB,
        true,
      );
      break;
    }
    case "prismatic": {
      impulseJoint = world.createImpulseJoint(
        rapier.JointData.prismatic(anchorA, anchorB, { x: axisLocal[0], y: axisLocal[1], z: axisLocal[2] }),
        bodyA,
        bodyB,
        true,
      );
      const limits = joint.prismatic?.limits;
      if (
        limits && limits.length === 2 &&
        Number.isFinite(limits[0]) && Number.isFinite(limits[1]) &&
        (limits[0] as number) < (limits[1] as number)
      ) {
        (impulseJoint as unknown as RAPIER.UnitImpulseJoint).setLimits(limits[0] as number, limits[1] as number);
      }
      break;
    }
    case "fixed": {
      // Weld at the CURRENT relative orientation: the constraint requires
      // qA·f1 = qB·f2 in world space, so with f2 = identity we need
      // f1 = qA⁻¹·qB. With a world side, its body already shares the other
      // rotation, so f1/f2 = identity lock the body's current orientation.
      const frame1 = sideA.isWorld ? IDENTITY_QUAT : quatMultiply(quatInvert(rotA!), rotB ?? rotA!);
      const frame2 = IDENTITY_QUAT;
      impulseJoint = world.createImpulseJoint(
        rapier.JointData.fixed(
          anchorA,
          { x: frame1[0], y: frame1[1], z: frame1[2], w: frame1[3] },
          anchorB,
          { x: frame2[0], y: frame2[1], z: frame2[2], w: frame2[3] },
        ),
        bodyA,
        bodyB,
        true,
      );
      break;
    }
    default:
      emitExprWarning(`joint "${joint.name}" has unknown kind "${String(joint.kind)}" and was skipped`);
      return null;
  }

  const posA = bodyA.translation();
  const posB = bodyB.translation();
  const anchorWorldA: Vec3 = sideA.isWorld
    ? [...joint.anchors.a] as Vec3
    : (() => {
        const w = rotateVec3ByQuat(joint.anchors.a, rotA!);
        return [posA.x + w[0], posA.y + w[1], posA.z + w[2]] as Vec3;
      })();
  const anchorWorldB: Vec3 = sideB.isWorld
    ? [...joint.anchors.b] as Vec3
    : (() => {
        const w = rotateVec3ByQuat(joint.anchors.b, rotB!);
        return [posB.x + w[0], posB.y + w[1], posB.z + w[2]] as Vec3;
      })();

  return {
    entity: joint,
    kind: joint.kind,
    impulseJoint,
    bindingA: { body: sideA.isWorld ? null : sideA.body, index: sideA.index, isWorld: sideA.isWorld },
    bindingB: { body: sideB.isWorld ? null : sideB.body, index: sideB.index, isWorld: sideB.isWorld },
    axisWorld,
    friction: joint.kind === "revolute" ? (joint.revolute?.friction ?? 0) : (joint.prismatic?.friction ?? 0),
    damping: joint.kind === "revolute" ? (joint.revolute?.damping ?? 0) : 0,
    anchorWorldA,
    anchorWorldB,
  };
}

/** Angular/linear-velocity deadband below which Coulomb friction is not applied. */
const OMEGA_EPS = 1e-3;

/**
 * Apply the joint's explicit friction/damping each substep (before the solver).
 * Revolute: equal & opposite torques −(c·ω_rel + τ_f·sign(ω_rel))·â on B / + on A.
 * Prismatic: equal & opposite forces −(c·v_rel + f·sign(v_rel))·â at the anchors.
 * World-bound sides have no live body — their share is simply not applied
 * (the world absorbs it, which is exactly the fixed-anchor limit).
 */
export function stepJointRuntime(rt: JointRuntime): void {
  const a = rt.bindingA.body;
  const b = rt.bindingB.body;
  if (!a && !b) return;
  const axis = rt.axisWorld;

  if (rt.kind === "revolute") {
    const wa = a ? a.angvel() : { x: 0, y: 0, z: 0 };
    const wb = b ? b.angvel() : { x: 0, y: 0, z: 0 };
    const omegaRel =
      (wb.x - wa.x) * axis[0] + (wb.y - wa.y) * axis[1] + (wb.z - wa.z) * axis[2];
    const tau =
      rt.damping * omegaRel +
      (Math.abs(omegaRel) > OMEGA_EPS ? rt.friction * (omegaRel > 0 ? 1 : -1) : 0);
    if (tau === 0) return;
    const t = { x: -tau * axis[0], y: -tau * axis[1], z: -tau * axis[2] };
    b?.addTorque(t, true);
    a?.addTorque({ x: -t.x, y: -t.y, z: -t.z }, true);
    return;
  }

  if (rt.kind === "prismatic") {
    const va = a ? a.linvel() : { x: 0, y: 0, z: 0 };
    const vb = b ? b.linvel() : { x: 0, y: 0, z: 0 };
    const vRel =
      (vb.x - va.x) * axis[0] + (vb.y - va.y) * axis[1] + (vb.z - va.z) * axis[2];
    const f =
      rt.damping * vRel +
      (Math.abs(vRel) > OMEGA_EPS ? rt.friction * (vRel > 0 ? 1 : -1) : 0);
    if (f === 0) return;
    const force = { x: -f * axis[0], y: -f * axis[1], z: -f * axis[2] };
    b?.addForceAtPoint(force, { x: rt.anchorWorldB[0], y: rt.anchorWorldB[1], z: rt.anchorWorldB[2] }, true);
    a?.addForceAtPoint(
      { x: -force.x, y: -force.y, z: -force.z },
      { x: rt.anchorWorldA[0], y: rt.anchorWorldA[1], z: rt.anchorWorldA[2] },
      true,
    );
  }
}
