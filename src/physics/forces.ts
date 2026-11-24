// physics/forces.ts — Tier 1 parametric forces & torques (ARCHITECTURE.md §4.1)
// plus the Milestone 5 spring–damper.
//
// Pure evaluation core shared by the physics engine (worker thread) and the
// vector-overlay renderer (main thread): compile once against the cached
// mathjs compiler, then evaluate per substep / per frame against a plain
// numeric scope. Any failure (bad expression, NaN, ±Inf) evaluates to 0 and
// emits a rate-limited warning through the expression warning sink.
//
// Scope variables (§4.1):
//   t                       simulation time
//   x, y, z                 world position of the attachment anchor (or CoM)
//   vx, vy, vz              velocity of the anchor: v_CM + ω × r
//   wx, wy, wz              angular velocity

import type { ExprScope } from "../math/expr";
import { compileExpression, emitExprWarning, makeExprScope } from "../math/expr";
import type { ForceEntity, ProjectMode, Quat, Vec3 } from "../core/types";
import { localToWorld, rotateVec3ByQuat } from "../math/rotation";

/** Live state of a force's target body at one evaluation instant. */
export interface ForceBodyState {
  position: Vec3;
  rotation: Quat;
  linvel: Vec3;
  angvel: Vec3;
  /** Local-frame CoM offset (relative to the body origin). */
  centerOfMass: Vec3;
}

type AxisFn = ((scope: ExprScope) => number) | null;

export interface CompiledForce {
  entity: ForceEntity;
  /** Compiled closures for the x/y/z components; null → compile failure (warned once). */
  axis: [AxisFn, AxisFn, AxisFn];
}

/** Compile the three component expressions of a force entity (§4.1). */
export function compileForceEntity(force: ForceEntity): CompiledForce {
  const axis: [AxisFn, AxisFn, AxisFn] = [null, null, null];
  (["x", "y", "z"] as const).forEach((key, i) => {
    const source = force.components?.[key] ?? "0";
    const result = compileExpression(source);
    if (!result.ok) {
      emitExprWarning(`force "${force.name}" (${force.kind}) ${key}-component: ${result.error}`);
      axis[i] = null;
    } else {
      axis[i] = result.fn;
    }
  });
  return { entity: force, axis };
}

export interface ForceApplication {
  /** World-space force to apply at `anchor` (zero vector for torques). */
  force: Vec3;
  /** World-space anchor point of the force. */
  anchor: Vec3;
  /** World-space torque — set only for `torque` entities. */
  torque: Vec3;
}

/**
 * Evaluate a compiled force entity into a world-space application.
 * Returns null when the force is disabled or has no target body.
 *
 * - `external`: F evaluated in world axes (rotated by the body quaternion when
 *   `localFrame`), applied at the world anchor. In 2D mode F_y = 0 (§4.5).
 * - `torque`: M evaluated in world axes (rotated when `localFrame`); in 2D mode
 *   only the Y component survives (§4.5).
 * - `thruster`: force fixed in the body's local frame at the local anchor —
 *   it rotates continuously with the rigid body.
 */
export function evaluateForceApplication(
  compiled: CompiledForce,
  state: ForceBodyState,
  t: number,
  mode: ProjectMode,
): ForceApplication | null {
  const force = compiled.entity;
  if (!force.enabled || !force.body) return null;

  const { position, rotation, linvel, angvel, centerOfMass } = state;

  // An explicit anchor is stored in the owner's local frame; without one the
  // force acts at the center of mass.
  const comWorld = localToWorld(centerOfMass, position, rotation);
  const anchor = force.anchor !== undefined
    ? localToWorld(force.anchor, position, rotation)
    : comWorld;

  // v_anchor = v_CM + ω × r, r = anchor − CoM.
  const rx = anchor[0] - comWorld[0];
  const ry = anchor[1] - comWorld[1];
  const rz = anchor[2] - comWorld[2];
  const wx = angvel[0];
  const wy = angvel[1];
  const wz = angvel[2];
  const scope = makeExprScope(
    t,
    anchor[0], anchor[1], anchor[2],
    linvel[0] + wy * rz - wz * ry,
    linvel[1] + wz * rx - wx * rz,
    linvel[2] + wx * ry - wy * rx,
    wx, wy, wz,
  );

  const evalAxis = (i: number): number => {
    const fn = compiled.axis[i];
    return fn ? fn(scope) : 0;
  };
  const raw: Vec3 = [evalAxis(0), evalAxis(1), evalAxis(2)];

  if (force.kind === "torque") {
    let torque = raw;
    if (force.localFrame) torque = rotateVec3ByQuat(torque, rotation);
    // 2D workspace = X–Z plane → only the out-of-plane Y torque survives.
    if (mode === "2D") torque = [0, torque[1], 0];
    return { force: [0, 0, 0], anchor, torque };
  }

  // external + thruster. A thruster is ALWAYS body-local; `external` respects
  // the localFrame toggle.
  let world = raw;
  if (force.kind === "thruster" || force.localFrame) {
    world = rotateVec3ByQuat(world, rotation);
  }
  if (mode === "2D") world = [world[0], 0, world[2]];
  return { force: world, anchor, torque: [0, 0, 0] };
}

// -----------------------------------------------------------------------------
// Spring–dampers (Milestone 5)
// -----------------------------------------------------------------------------

/** Compiled spring–damper parameters (clamped to sane ranges). */
export interface CompiledSpring {
  entity: ForceEntity;
  k: number;
  restLength: number;
  damping: number;
  /** Body id of anchor B; "" = fixed world anchor. */
  anchorBId: string;
  /** Anchor B point: body-local when `anchorBId` is set, else world coords. */
  anchorBPoint: Vec3;
}

/** Compile a `kind: "spring"` force entity. Returns null when unusable (warned). */
export function compileSpring(force: ForceEntity): CompiledSpring | null {
  const s = force.spring;
  if (!s) {
    emitExprWarning(`spring "${force.name}" has no spring parameters and was skipped`);
    return null;
  }
  const k = Math.max(0, Number.isFinite(s.k) ? s.k : 0);
  const restLength = Math.max(0, Number.isFinite(s.restLength) ? s.restLength : 0);
  const damping = Math.max(0, Number.isFinite(s.damping) ? s.damping : 0);
  if (k <= 0) {
    emitExprWarning(`spring "${force.name}" has zero stiffness (k = 0) and was skipped`);
    return null;
  }
  return {
    entity: force,
    k,
    restLength,
    damping,
    anchorBId: typeof s.anchorB === "string" ? s.anchorB : "",
    anchorBPoint: [
      Number.isFinite(s.anchorBPoint?.[0]) ? (s.anchorBPoint[0] as number) : 0,
      Number.isFinite(s.anchorBPoint?.[1]) ? (s.anchorBPoint[1] as number) : 0,
      Number.isFinite(s.anchorBPoint?.[2]) ? (s.anchorBPoint[2] as number) : 0,
    ],
  };
}

export interface SpringApplication {
  /** Force applied to body A at `anchorA`; body B receives the exact opposite. */
  force: Vec3;
  anchorA: Vec3;
  anchorB: Vec3;
  /** Current spring length (m) — for telemetry / rendering. */
  length: number;
  /** Unit line of action û = (r_B − r_A)/L. */
  dir: Vec3;
}

/**
 * Evaluate the spring law at the current state (§2.1, milestone 5):
 *
 *   L = |r_B − r_A|, û = (r_B − r_A)/L
 *   F = k·(L − L₀) + c·(v_B − v_A)·û   (scalar, along û)
 *   F_A = F·û at r_A ,  F_B = −F·û at r_B
 *
 * Anchor velocities include the rigid-body spin: v_anchor = v_CM + ω × r.
 * Returns null when the spring is disabled, has no body A, or the anchors
 * coincide (L ≈ 0 — no line of action).
 */
export function evaluateSpringApplication(
  spring: CompiledSpring,
  stateA: ForceBodyState,
  stateB: ForceBodyState | null,
  mode: ProjectMode,
): SpringApplication | null {
  const force = spring.entity;
  if (!force.enabled || !force.body) return null;

  const anchorOf = (state: ForceBodyState, anchorLocal: Vec3 | undefined, hasAnchor: boolean): { p: Vec3; v: Vec3 } => {
    const com = localToWorld(state.centerOfMass, state.position, state.rotation);
    const p = hasAnchor ? localToWorld(anchorLocal!, state.position, state.rotation) : com;
    const rx = p[0] - com[0];
    const ry = p[1] - com[1];
    const rz = p[2] - com[2];
    const v: Vec3 = [
      state.linvel[0] + state.angvel[1] * rz - state.angvel[2] * ry,
      state.linvel[1] + state.angvel[2] * rx - state.angvel[0] * rz,
      state.linvel[2] + state.angvel[0] * ry - state.angvel[1] * rx,
    ];
    return { p, v };
  };

  const sideA = anchorOf(stateA, force.anchor, force.anchor !== undefined);
  const sideB = stateB
    ? anchorOf(stateB, spring.anchorBPoint, true)
    : { p: spring.anchorBPoint, v: [0, 0, 0] as Vec3 };

  const d: Vec3 = [sideB.p[0] - sideA.p[0], sideB.p[1] - sideA.p[1], sideB.p[2] - sideA.p[2]];
  const L = Math.hypot(d[0], d[1], d[2]);
  if (L < 1e-9) return null;
  let dir: Vec3 = [d[0] / L, d[1] / L, d[2] / L];
  if (mode === "2D") dir = [dir[0], 0, dir[2]];

  const vRel: Vec3 = [sideB.v[0] - sideA.v[0], sideB.v[1] - sideA.v[1], sideB.v[2] - sideA.v[2]];
  const fScalar =
    spring.k * (L - spring.restLength) +
    spring.damping * (vRel[0] * dir[0] + vRel[1] * dir[1] + vRel[2] * dir[2]);

  let forceVec: Vec3 = [fScalar * dir[0], fScalar * dir[1], fScalar * dir[2]];
  if (mode === "2D") forceVec = [forceVec[0], 0, forceVec[2]];
  return { force: forceVec, anchorA: sideA.p, anchorB: sideB.p, length: L, dir };
}

/**
 * §4.3 — explicit spring stability guard. Returns a diagnostic string when
 * ω_eff·Δt > 0.5 (recommend a smaller `fixedDt` or lower `k`), else null.
 * `massB` of Infinity models a world-fixed anchor B.
 */
export function springStabilityWarning(
  spring: CompiledSpring,
  massA: number,
  massB: number,
  dt: number,
): string | null {
  if (!(spring.k > 0) || !(massA > 0)) return null;
  const inv = 1 / massA + (Number.isFinite(massB) && massB > 0 ? 1 / massB : 0);
  const mEff = 1 / inv;
  const omega = Math.sqrt(spring.k / mEff);
  if (omega * dt > 0.5) {
    return (
      `spring "${spring.entity.name}" is stiff: ω_eff·Δt = ${(omega * dt).toFixed(2)} > 0.5 ` +
      `(ω_eff = ${omega.toFixed(1)} rad/s, k = ${spring.k} N/m). ` +
      `Reduce k or the world fixedDt (Δt < 2/ω_eff ≈ ${(2 / omega).toExponential(2)} s) to stay stable (§4.3).`
    );
  }
  return null;
}
