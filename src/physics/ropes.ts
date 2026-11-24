// physics/ropes.ts — Milestone 5: pulleys & ropes, fully Rapier-integrated
// (ARCHITECTURE.md §2.1 — NO analytic ODE bypass anywhere).
//
// Massless rope (`model: "massless"`):
//   • Two anchors, no pulleys: one native `JointData.rope(maxLength, a1, a2)`
//     (tension-only, slack allowed) or, when `inextensible` is false, a
//     `JointData.spring` (soft, stretchy) between the anchor bodies.
//   • Routed over pulleys: each straight segment becomes a native rope/spring
//     joint whose pulley-side anchor is re-computed every substep as the
//     CURRENT tangent wrap-anchor `r_rim = r_center + R·n̂_tangent` (owned by
//     the pulley body, stored in its local frame). The segment max length is
//     updated by the no-slip payout rule λ = λ₀ + Σ σ·R·Δθ (σ = pay-out sign
//     from the surface-velocity test), so the solver enforces the total path
//     length L₁ + L_arc + L₂ = L_total with the EXACT inertia coupling
//     a = αR: the rope joint applies its impulse at the rim anchor, which
//     exerts the native torque τ = (T₁ − T₂)·R on the pulley body.
//   • Tension T is recovered each substep from the constrained bodies'
//     residual force m·a − m·g − F_contact − F_applied and packed into the
//     snapshot for the T⃗ overlay.
//
// Massive rope / chain (`model: "chain"`):
//   • The path is discretized into N rigid sphere segments (mᵢ = M/N or
//     λ·l per segment) with ball colliders, linked end-to-end by `spherical`
//     (3D) or `revolute` (2D) impulse joints and pinned to the path anchors.
//     Segments interact with pulley grooves via native contact.

import RAPIER from "@dimforge/rapier3d-compat";
import type {
  MechProject,
  ProjectMode,
  Quat,
  RopeEntity,
  Vec3,
} from "../core/types";
import { emitExprWarning } from "../math/expr";
import { localToWorld, quatInvert, quatMultiply, rotateVec3ByQuat } from "../math/rotation";
import type { JointRuntime } from "./joints";

// -----------------------------------------------------------------------------
// Pure wrap geometry — shared by the physics core and the rope renderer
// -----------------------------------------------------------------------------

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function scale(a: Vec3, s: number): Vec3 {
  return [a[0] * s, a[1] * s, a[2] * s];
}

function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function norm(a: Vec3): number {
  return Math.hypot(a[0], a[1], a[2]);
}

function normalize(a: Vec3): Vec3 {
  const l = norm(a);
  return l < 1e-12 ? [0, 0, 0] : [a[0] / l, a[1] / l, a[2] / l];
}

/** Rodrigues rotation of `v` about unit axis `axis` by `angle` (rad). */
function rotateAbout(v: Vec3, axis: Vec3, angle: number): Vec3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const k = cross(axis, v);
  const kd = dot(axis, v);
  return [
    v[0] * c + k[0] * s + axis[0] * kd * (1 - c),
    v[1] * c + k[1] * s + axis[1] * kd * (1 - c),
    v[2] * c + k[2] * s + axis[2] * kd * (1 - c),
  ];
}

/**
 * The two tangent points on the rim as seen from an external point `p`
 * (projected into the pulley plane). Returns null when p is on/inside the rim.
 */
export function tangentPointsFrom(
  p: Vec3,
  center: Vec3,
  radius: number,
  axis: Vec3,
): [Vec3, Vec3] | null {
  const axisN = normalize(axis);
  if (norm(axisN) < 1e-9) return null;
  const R = Math.max(1e-4, radius);
  const d = sub(p, center);
  const p2 = add(p, scale(axisN, -dot(d, axisN)));
  const dd = sub(p2, center);
  const D = norm(dd);
  if (D <= R * 1.001) return null;
  const n = scale(dd, 1 / D);
  const t = normalize(cross(axisN, n));
  const cosA = R / D;
  const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
  const radial = scale(n, R * cosA);
  const tang = scale(t, R * sinA);
  return [add(center, add(radial, tang)), add(center, sub(radial, tang))];
}

/**
 * Pick the tangent candidate consistent with a pay-out sign σ: the tangent
 * where dot(û, â × d̂) has the same sign as σ (û = rope direction away from
 * the tangent toward `p`). Returns null when degenerate.
 */
function pickTangentBySigma(
  p: Vec3,
  center: Vec3,
  radius: number,
  axis: Vec3,
  sigma: number,
): Vec3 | null {
  const cands = tangentPointsFrom(p, center, radius, axis);
  if (!cands) return null;
  const axisN = normalize(axis);
  let best: Vec3 | null = null;
  let bestScore = -Infinity;
  for (const T of cands) {
    const dHat = normalize(sub(T, center));
    const u = normalize(sub(p, T));
    const s = dot(u, cross(axisN, dHat));
    const score = sigma >= 0 ? s : -s;
    if (score > bestScore) {
      bestScore = score;
      best = T;
    }
  }
  return best;
}

export interface PulleyWrapGeometry {
  /** Incoming tangent point on the rim (world). */
  tIn: Vec3;
  /** Outgoing tangent point on the rim (world). */
  tOut: Vec3;
  /** Radial unit vectors center → tangent. */
  dIn: Vec3;
  dOut: Vec3;
  /** Signed arc angle (rad) from tIn to tOut about the pulley axis (wrap direction). */
  arcAngle: number;
  /** Pay-out signs: rope pays out (λ grows) with CCW pulley rotation. */
  sigmaIn: number;
  sigmaOut: number;
}

/**
 * Compute the tangent wrap-anchor pair of a pulley given the two adjacent rope
 * nodes. The tangents are the true tangent points from each node onto the rim;
 * the wrap direction is chosen to lie on the side of the pulley OPPOSITE the
 * nodes (shortest such arc), so a rope hanging below wraps over the top.
 * Returns null for degenerate geometry (node on/inside the rim).
 */
export function computePulleyWrapGeometry(
  prev: Vec3,
  next: Vec3,
  center: Vec3,
  radius: number,
  axis: Vec3,
): PulleyWrapGeometry | null {
  const axisN = normalize(axis);
  if (norm(axisN) < 1e-9) return null;
  const tInCands = tangentPointsFrom(prev, center, radius, axisN);
  const tOutCands = tangentPointsFrom(next, center, radius, axisN);
  if (!tInCands || !tOutCands) return null;

  // Bisector pointing toward the nodes; the wrap should sit on the far side.
  let bisector = normalize(add(normalize(sub(prev, center)), normalize(sub(next, center))));
  if (norm(bisector) < 1e-9) bisector = [0, 0, 0];

  let best: { tIn: Vec3; tOut: Vec3; dIn: Vec3; dOut: Vec3; arcAngle: number; score: number; phi: number } | null = null;
  for (const ti of tInCands) {
    const dIn = normalize(sub(ti, center));
    for (const to of tOutCands) {
      const dOut = normalize(sub(to, center));
      const phi = Math.acos(Math.min(1, Math.max(-1, dot(dIn, dOut))));
      for (const dir of [1, -1] as const) {
        const a = dir * phi;
        const mid = rotateAbout(dIn, axisN, a / 2);
        const score = dot(mid, bisector);
        if (!best || score < best.score || (score === best.score && phi < best.phi)) {
          best = { tIn: ti, tOut: to, dIn, dOut, arcAngle: a, score, phi };
        }
      }
    }
  }
  if (!best) return null;

  const uIn = normalize(sub(prev, best.tIn));
  const uOut = normalize(sub(next, best.tOut));
  const sigmaIn = Math.sign(dot(uIn, cross(axisN, best.dIn))) || 1;
  const sigmaOut = Math.sign(dot(uOut, cross(axisN, best.dOut))) || 1;
  return {
    tIn: best.tIn,
    tOut: best.tOut,
    dIn: best.dIn,
    dOut: best.dOut,
    arcAngle: best.arcAngle,
    sigmaIn,
    sigmaOut,
  };
}

/** Sample the wrap arc (tIn → tOut about `axis`) for rendering. */
export function samplePulleyArc(
  tIn: Vec3,
  center: Vec3,
  axis: Vec3,
  arcAngle: number,
  n: number,
): Vec3[] {
  const dIn = normalize(sub(tIn, center));
  const R = norm(sub(tIn, center));
  const axisN = normalize(axis);
  const pts: Vec3[] = [];
  for (let i = 0; i <= n; i++) {
    const d = rotateAbout(dIn, axisN, (arcAngle * i) / n);
    pts.push(add(center, scale(d, R)));
  }
  return pts;
}

// -----------------------------------------------------------------------------
// Chain discretization helpers (shared with the renderer)
// -----------------------------------------------------------------------------

/** Segment count of a chain rope, clamped to a deterministic [2, 200]. */
export function chainSegmentCount(rope: RopeEntity): number {
  const n = rope.chain?.segments ?? 30;
  return Math.min(200, Math.max(2, Math.round(Number.isFinite(n) ? n : 30)));
}

/** Deterministic ids of a chain rope's segment bodies (`${rope.id}:seg:i`). */
export function chainSegmentIds(rope: RopeEntity): string[] {
  const n = chainSegmentCount(rope);
  const ids: string[] = [];
  for (let i = 0; i < n; i++) ids.push(`${rope.id}:seg:${i}`);
  return ids;
}

/** Mirrors the engine build conditions: does this chain rope append segment bodies? */
export function chainRopeBuildsSegments(rope: RopeEntity, project: MechProject): boolean {
  if (rope.tier !== 1 || rope.model !== "chain") return false;
  if (rope.path.length < 2) return false;
  const waypoints = chainWaypoints(rope, project);
  if (waypoints.length < 2) return false;
  let total = 0;
  for (let i = 1; i < waypoints.length; i++) {
    const d = sub(waypoints[i]!, waypoints[i - 1]!);
    total += norm(d);
  }
  return total >= 1e-6;
}

/** World point of one rope path node (initial configuration for placement). */
export function ropeNodeInitialWorld(
  node: { anchorId: string; point: Vec3 },
  project: MechProject,
): Vec3 | null {
  if (!node.anchorId) return node.point;
  const body = project.bodies.find((b) => b.id === node.anchorId);
  if (!body) return null;
  return localToWorld(node.point, body.initial.position, body.initial.rotation);
}

/**
 * Placement polyline for a chain: path nodes with pulley centers inserted
 * between consecutive nodes (pulley i lies between node i and node i+1).
 */
export function chainWaypoints(rope: RopeEntity, project: MechProject): Vec3[] {
  const pts: Vec3[] = [];
  for (let i = 0; i < rope.path.length; i++) {
    const w = ropeNodeInitialWorld(rope.path[i]!, project);
    if (w) pts.push(w);
    if (i < rope.path.length - 1) {
      const pulleyId = rope.pulleys?.[i];
      if (pulleyId) {
        const pulley = project.bodies.find((b) => b.id === pulleyId);
        if (pulley) pts.push([...pulley.initial.position] as Vec3);
      }
    }
  }
  return pts;
}

// -----------------------------------------------------------------------------
// Live runtimes (engine side)
// -----------------------------------------------------------------------------

/** Minimal engine body-meta view needed for tension recovery. */
export interface RopeBodyMeta {
  mass: number;
  netForce: Vec3;
  normal: Vec3;
  friction: Vec3;
  applied: Vec3;
}

export interface RopeBuildContext {
  rapier: typeof RAPIER;
  world: RAPIER.World;
  mode: ProjectMode;
  gravity: Vec3;
  project: MechProject;
  /** id → engine body index (project bodies only). */
  bodyIndexById: Map<string, number>;
  /** Live rigid bodies in engine order. */
  bodies: RAPIER.RigidBody[];
  meta: RopeBodyMeta[];
  /** Shared fixed body at the origin — world side of rope anchors. */
  worldAnchorBody: RAPIER.RigidBody;
  /** Joint runtimes (to find a pulley's revolute mounting axis). */
  jointRuntimes: JointRuntime[];
  /** Heaviest dynamic project body — chain segments clamp above massRatio⁻¹·it. */
  maxDynamicMass: number;
  /** Append a chain segment body (engine keeps it in snapshot order). */
  appendSegmentBody: (body: RAPIER.RigidBody, id: string, meta: RopeBodyMeta) => number;
}

interface PulleySpin {
  body: RAPIER.RigidBody;
  bodyIndex: number;
  radius: number;
  axisWorld: Vec3;
  /** Accumulated rotation about the axis since rope build (rad). */
  theta: number;
  lastQuat: Quat;
}

interface SegmentSide {
  /** Fixed world side (uses the shared world anchor body). */
  isWorld: boolean;
  /** Engine body index; ≥ 0 for body/pulley sides, −1 for world. */
  bodyIndex: number;
  /** Anchor in the side body's local frame (world coords for world sides). */
  localPoint: Vec3;
  /** Set for pulley sides: pay-out bookkeeping. */
  pulley?: PulleySpin;
  sigma: number;
}

interface PulleySegment {
  sideA: SegmentSide;
  sideB: SegmentSide;
  length0: number;
  elastic: boolean;
  joint: RAPIER.ImpulseJoint | null;
}

interface DirectSegment {
  joint: RAPIER.ImpulseJoint;
  sideA: SegmentSide;
  sideB: SegmentSide;
}

interface LinkRuntime {
  indexA: number;
  indexB: number;
  /** Mean link inertia about the joint — scales the angular damping rate. */
  iMean: number;
  dampingRate: number;
}

export interface RopeRuntime {
  entity: RopeEntity;
  model: "massless" | "chain";
  /** Recovered peak scalar tension (N) — packed into the snapshot. */
  tension: number;
  /** Massless without pulleys: static joints, never re-created. */
  directSegments: DirectSegment[];
  /** Massless over pulleys: re-anchored + re-lengthened every substep. */
  pulleySegments: PulleySegment[];
  /** Chain model. */
  segmentIndices: number[];
  linkRuntimes: LinkRuntime[];
  /** Warnings already emitted (rate-limit one per kind). */
  warned: Set<string>;
}

const EPS_MASS = 1e-6;

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

function quatFromRotation(r: RAPIER.Rotation): Quat {
  return [r.x, r.y, r.z, r.w];
}

function warnOnce(rt: RopeRuntime, key: string, message: string): void {
  if (rt.warned.has(key)) return;
  rt.warned.add(key);
  emitExprWarning(message);
}

/** Signed rotation angle of `cur` relative to `prev` about `axis` (rad). */
function signedAngleAbout(prev: Quat, cur: Quat, axis: Vec3): number {
  const rel = quatMultiply(cur, quatInvert(prev));
  const v: Vec3 = [rel[0], rel[1], rel[2]];
  const vn = norm(v);
  if (vn < 1e-12) return 0;
  const angle = 2 * Math.atan2(vn, Math.abs(rel[3]));
  return (dot(v, axis) >= 0 ? 1 : -1) * angle;
}

/** Find the revolute joint mounting a pulley body (its axis lives there). */
function findPulleyMount(
  pulleyIndex: number,
  ctx: RopeBuildContext,
): { axisWorld: Vec3 } | null {
  for (const rt of ctx.jointRuntimes) {
    if (rt.kind !== "revolute" || !rt.impulseJoint) continue;
    if (rt.bindingA.index === pulleyIndex || rt.bindingB.index === pulleyIndex) {
      return { axisWorld: rt.axisWorld };
    }
  }
  return null;
}

function pulleyRadius(entity: MechProject["bodies"][number] | undefined): number {
  const g = entity?.geometry as Record<string, unknown> | undefined;
  const c = g?.cylinder as Record<string, unknown> | undefined;
  const R = typeof c?.R === "number" && Number.isFinite(c.R) ? (c.R as number) : 0.25;
  return Math.max(1e-3, R);
}

/** Create a native rope (tension-only) or spring (stretchy) joint between two sides. */
function createRopeJoint(
  ctx: RopeBuildContext,
  sideA: SegmentSide,
  sideB: SegmentSide,
  length: number,
  elastic: boolean,
): RAPIER.ImpulseJoint {
  const bodyA = sideA.isWorld ? ctx.worldAnchorBody : ctx.bodies[sideA.bodyIndex]!;
  const bodyB = sideB.isWorld ? ctx.worldAnchorBody : ctx.bodies[sideB.bodyIndex]!;
  const a1 = { x: sideA.localPoint[0], y: sideA.localPoint[1], z: sideA.localPoint[2] };
  const a2 = { x: sideB.localPoint[0], y: sideB.localPoint[1], z: sideB.localPoint[2] };
  if (elastic) {
    // Soft, stretchy rope: native spring joint (k, c are fixed defaults —
    // the massless schema carries no stiffness parameters).
    return ctx.world.createImpulseJoint(
      ctx.rapier.JointData.spring(length, 400, 20, a1, a2),
      bodyA,
      bodyB,
      true,
    );
  }
  return ctx.world.createImpulseJoint(
    ctx.rapier.JointData.rope(length, a1, a2),
    bodyA,
    bodyB,
    true,
  );
}

/** Build a massless or chain rope. Always returns a runtime (possibly inert). */
export function buildRope(rope: RopeEntity, ctx: RopeBuildContext): RopeRuntime {
  const runtime: RopeRuntime = {
    entity: rope,
    model: rope.model === "chain" ? "chain" : "massless",
    tension: 0,
    directSegments: [],
    pulleySegments: [],
    segmentIndices: [],
    linkRuntimes: [],
    warned: new Set(),
  };

  if (rope.tier !== 1) return runtime;
  if (rope.path.length < 2) {
    warnOnce(runtime, "path", `rope "${rope.name}" needs at least 2 path anchors and was skipped`);
    return runtime;
  }

  const nodeSide = (node: { anchorId: string; point: Vec3 }, label: string): SegmentSide | null => {
    if (!node.anchorId) {
      return { isWorld: true, bodyIndex: -1, localPoint: [...node.point] as Vec3, sigma: 0 };
    }
    const index = ctx.bodyIndexById.get(node.anchorId) ?? -1;
    if (index < 0) {
      warnOnce(runtime, `node:${node.anchorId}`, `rope "${rope.name}" ${label} references missing body "${node.anchorId}"`);
      return null;
    }
    return { isWorld: false, bodyIndex: index, localPoint: [...node.point] as Vec3, sigma: 0 };
  };

  if (runtime.model === "chain") {
    buildChain(rope, ctx, runtime);
    return runtime;
  }

  // --- massless ---------------------------------------------------------------
  const elastic = rope.massless?.inextensible === false;

  // Resolve pulley spins up front (pulley i sits between node i and node i+1).
  const gaps = rope.path.length - 1;
  const pulleySpins: Array<PulleySpin | null> = [];
  if (rope.pulleys) {
    if (rope.pulleys.length > gaps) {
      warnOnce(runtime, "pulleys", `rope "${rope.name}" has more pulleys than path gaps — extra pulleys were ignored`);
    }
    for (let i = 0; i < gaps; i++) {
      const pulleyId = rope.pulleys[i];
      if (!pulleyId) {
        pulleySpins.push(null);
        continue;
      }
      const index = ctx.bodyIndexById.get(pulleyId) ?? -1;
      const body = index >= 0 ? (ctx.bodies[index] ?? null) : null;
      if (!body) {
        warnOnce(runtime, `pulley:${pulleyId}`, `rope "${rope.name}" pulley "${pulleyId}" does not resolve to a body`);
        pulleySpins.push(null);
        continue;
      }
      const entity = ctx.project.bodies[index];
      const R = pulleyRadius(entity);
      if (ctx.mode === "2D") {
        // §2.1 — a 2D pulley is a disk in the XY plane: I_z = ½·m·R², so the
        // Atwood coupling a = αR holds with the exact textbook inertia.
        const diskMass = ctx.meta[index]?.mass ?? 1;
        const g = entity?.geometry as Record<string, unknown> | undefined;
        const c = g?.cylinder as Record<string, unknown> | undefined;
        const H = typeof c?.H === "number" && Number.isFinite(c.H) ? (c.H as number) : 0.08;
        const iPerp = (diskMass * (3 * R * R + H * H)) / 12;
        body.setAdditionalMassProperties(
          diskMass,
          { x: 0, y: 0, z: 0 },
          { x: iPerp, y: iPerp, z: 0.5 * diskMass * R * R },
          { x: 0, y: 0, z: 0, w: 1 },
          true,
        );
      }
      const mount = findPulleyMount(index, ctx);
      if (!mount) {
        warnOnce(
          runtime,
          `mount:${pulleyId}`,
          `pulley "${entity?.name ?? pulleyId}" has no revolute mount — assuming a free pulley about Z`,
        );
      }
      const quat = quatFromRotation(body.rotation());
      pulleySpins.push({
        body,
        bodyIndex: index,
        radius: pulleyRadius(entity),
        axisWorld: mount?.axisWorld ?? [0, 0, 1],
        theta: 0,
        lastQuat: quat,
      });
    }
  }

  const sideWorldAt = (side: SegmentSide): Vec3 => {
    if (side.isWorld) return side.localPoint;
    const body = ctx.bodies[side.bodyIndex];
    if (!body) return [0, 0, 0];
    const t = body.translation();
    const w = rotateVec3ByQuat(side.localPoint, quatFromRotation(body.rotation()));
    return [t.x + w[0], t.y + w[1], t.z + w[2]];
  };

  const nodeSides: Array<SegmentSide | null> = rope.path.map((node, i) => nodeSide(node, `path[${i}]`));

  for (let i = 0; i < gaps; i++) {
    const spin = pulleySpins[i] ?? null;
    const nodeA = nodeSides[i];
    const nodeB = nodeSides[i + 1];
    if (!nodeA || !nodeB) {
      warnOnce(runtime, `seg${i}`, `rope "${rope.name}" segment ${i} has an unresolved anchor and was skipped`);
      continue;
    }

    if (!spin) {
      // Direct segment between two consecutive nodes (hook / wall anchor).
      const pa = sideWorldAt(nodeA);
      const pb = sideWorldAt(nodeB);
      const len0 = norm(sub(pb, pa));
      if (len0 < 1e-9) continue;
      const joint = createRopeJoint(ctx, nodeA, nodeB, len0, elastic);
      runtime.directSegments.push({ joint, sideA: nodeA, sideB: nodeB });
      continue;
    }

    const pa = sideWorldAt(nodeA);
    const pb = sideWorldAt(nodeB);
    const t = spin.body.translation();
    const center: Vec3 = [t.x, t.y, t.z];
    const geo = computePulleyWrapGeometry(pa, pb, center, spin.radius, spin.axisWorld);
    if (!geo) {
      warnOnce(runtime, `wrap:${i}`, `rope "${rope.name}" node lies on the rim of a pulley — wrapping skipped for segment ${i}`);
      continue;
    }
    const pulleyQuat = quatFromRotation(spin.body.rotation());
    const localOf = (p: Vec3): Vec3 => rotateVec3ByQuat(sub(p, center), quatInvert(pulleyQuat));
    const pulleyIn: SegmentSide = {
      isWorld: false,
      bodyIndex: spin.bodyIndex,
      localPoint: localOf(geo.tIn),
      pulley: spin,
      sigma: geo.sigmaIn,
    };
    const pulleyOut: SegmentSide = {
      isWorld: false,
      bodyIndex: spin.bodyIndex,
      localPoint: localOf(geo.tOut),
      pulley: spin,
      sigma: geo.sigmaOut,
    };

    // Segment A: node i → pulley IN tangent.
    const lenA = norm(sub(geo.tIn, pa));
    if (lenA > 1e-9) {
      const joint = createRopeJoint(ctx, nodeA, pulleyIn, lenA, elastic);
      runtime.pulleySegments.push({ sideA: nodeA, sideB: pulleyIn, length0: lenA, elastic, joint });
    }
    // Segment B: pulley OUT tangent → node i+1.
    const lenB = norm(sub(pb, geo.tOut));
    if (lenB > 1e-9) {
      const joint = createRopeJoint(ctx, pulleyOut, nodeB, lenB, elastic);
      runtime.pulleySegments.push({ sideA: pulleyOut, sideB: nodeB, length0: lenB, elastic, joint });
    }
  }

  return runtime;
}

/**
 * Re-anchor + re-lengthen one pulley segment to the current geometry:
 * λ = λ₀ + Σ σ·R·Δθ over its pulley ends; each pulley side's local anchor is
 * moved to the live tangent point consistent with its pay-out sign σ.
 */
function refreshPulleySegment(
  seg: PulleySegment,
  sideWorld: (side: SegmentSide) => Vec3,
  ctx: RopeBuildContext,
): void {
  let lam = seg.length0;
  const adjust = (side: SegmentSide, otherWorld: Vec3): void => {
    const spin = side.pulley;
    if (!spin) return;
    lam += side.sigma * spin.radius * spin.theta;
    const body = spin.body;
    const t = body.translation();
    const center: Vec3 = [t.x, t.y, t.z];
    const tangent = pickTangentBySigma(otherWorld, center, spin.radius, spin.axisWorld, side.sigma);
    if (tangent) {
      const quat = quatFromRotation(body.rotation());
      side.localPoint = rotateVec3ByQuat(sub(tangent, center), quatInvert(quat));
    }
  };
  adjust(seg.sideA, sideWorld(seg.sideB));
  adjust(seg.sideB, sideWorld(seg.sideA));
  lam = Math.max(1e-4, lam);

  if (seg.joint) ctx.world.removeImpulseJoint(seg.joint, true);
  seg.joint = createRopeJoint(ctx, seg.sideA, seg.sideB, lam, seg.elastic);
}

/**
 * Integrate pulley rotations, refresh every pulley segment (called each substep
 * BEFORE `world.step`) and apply chain link damping torques.
 */
export function updateRopeRuntimes(runtimes: RopeRuntime[], ctx: RopeBuildContext): void {
  for (const rt of runtimes) {
    if (rt.model === "massless") {
      if (rt.pulleySegments.length === 0) continue;
      const spins = new Set<PulleySpin>();
      for (const seg of rt.pulleySegments) {
        if (seg.sideA.pulley) spins.add(seg.sideA.pulley);
        if (seg.sideB.pulley) spins.add(seg.sideB.pulley);
      }
      for (const spin of spins) {
        const q = quatFromRotation(spin.body.rotation());
        spin.theta += signedAngleAbout(spin.lastQuat, q, spin.axisWorld);
        spin.lastQuat = q;
      }
      const sideWorld = (side: SegmentSide): Vec3 => {
        if (side.isWorld) return side.localPoint;
        const body = ctx.bodies[side.bodyIndex];
        if (!body) return [0, 0, 0];
        const t = body.translation();
        const w = rotateVec3ByQuat(side.localPoint, quatFromRotation(body.rotation()));
        return [t.x + w[0], t.y + w[1], t.z + w[2]];
      };
      for (const seg of rt.pulleySegments) refreshPulleySegment(seg, sideWorld, ctx);
    } else {
      // Chain link angular damping: τ = −c·I_link·ω_rel on the child, + on the parent.
      for (const link of rt.linkRuntimes) {
        const a = ctx.bodies[link.indexA];
        const b = ctx.bodies[link.indexB];
        if (!a || !b) continue;
        const c = link.dampingRate * link.iMean;
        if (c === 0) continue;
        const wa = a.angvel();
        const wb = b.angvel();
        const torque = {
          x: -c * (wb.x - wa.x),
          y: -c * (wb.y - wa.y),
          z: -c * (wb.z - wa.z),
        };
        b.addTorque(torque, true);
        a.addTorque({ x: -torque.x, y: -torque.y, z: -torque.z }, true);
      }
    }
  }
}

// -----------------------------------------------------------------------------
// Chain construction
// -----------------------------------------------------------------------------

function buildChain(rope: RopeEntity, ctx: RopeBuildContext, rt: RopeRuntime): void {
  const N = chainSegmentCount(rope);
  const waypoints = chainWaypoints(rope, ctx.project);
  if (waypoints.length < 2) {
    warnOnce(rt, "chainpath", `chain "${rope.name}" has an unusable path and was skipped`);
    return;
  }

  const cum: number[] = [0];
  for (let i = 1; i < waypoints.length; i++) {
    cum.push(cum[i - 1]! + norm(sub(waypoints[i]!, waypoints[i - 1]!)));
  }
  const total = cum[cum.length - 1]!;
  if (total < 1e-6) {
    warnOnce(rt, "chainlen", `chain "${rope.name}" has zero path length and was skipped`);
    return;
  }

  const chain = rope.chain;
  const chainMass = typeof chain?.mass === "number" && Number.isFinite(chain.mass) ? chain.mass : 1;
  const chainLinear = typeof chain?.linearDensity === "number" && chain.linearDensity > 0 ? chain.linearDensity : 0;
  const chainDamping = typeof chain?.damping === "number" && Number.isFinite(chain.damping) ? chain.damping : 10;
  const lambda = chainLinear;
  const totalMass = Math.max(EPS_MASS, chainMass);
  const segLen = total / N;
  const thickness = Number.isFinite(rope.appearance?.thickness) ? (rope.appearance?.thickness as number) : 0.02;
  const radius = clamp(thickness, 1e-3, segLen * 0.45);
  const mi = Math.max(
    lambda > 0 ? lambda * segLen : totalMass / N,
    ctx.maxDynamicMass > 0 ? ctx.maxDynamicMass / 1e4 : EPS_MASS,
  );
  const inertia = (2 / 5) * mi * radius * radius;
  const dampingRate = clamp(chainDamping, 0, 1e4);

  const pointAt = (s: number): Vec3 => {
    const sc = clamp(s, 0, total);
    let i = 1;
    while (i < cum.length - 1 && cum[i]! < sc) i++;
    const a = waypoints[i - 1]!;
    const b = waypoints[i]!;
    const segLenAB = Math.max(1e-9, cum[i]! - cum[i - 1]!);
    const tt = (sc - cum[i - 1]!) / segLenAB;
    return [
      a[0] + (b[0] - a[0]) * tt,
      a[1] + (b[1] - a[1]) * tt,
      a[2] + (b[2] - a[2]) * tt,
    ];
  };
  const tangentAt = (s: number): Vec3 => {
    const eps = Math.max(1e-6, segLen * 0.25);
    return normalize(sub(pointAt(Math.min(total, s + eps)), pointAt(Math.max(0, s - eps))));
  };

  const ids = chainSegmentIds(rope);
  const segBodies: RAPIER.RigidBody[] = [];
  const centers: Vec3[] = [];
  for (let i = 0; i < N; i++) {
    const s = (i + 0.5) * segLen;
    const center = pointAt(s);
    centers.push(center);
    const desc = ctx.rapier.RigidBodyDesc.dynamic()
      .setTranslation(center[0], center[1], center[2])
      .setLinvel(0, 0, 0)
      .setAdditionalMassProperties(
        mi,
        { x: 0, y: 0, z: 0 },
        { x: inertia, y: inertia, z: inertia },
        { x: 0, y: 0, z: 0, w: 1 },
      );
    desc.linearDamping = 0.5;
    desc.angularDamping = 0.2;
    if (ctx.mode === "2D") {
      // Z-translation lock only: the revolute links (and the joint solver,
      // which cannot drive a free axis against locked X/Y rotations) keep the
      // chain planar.
      desc.translationsEnabledX = true;
      desc.translationsEnabledY = true;
      desc.translationsEnabledZ = false;
    }
    const body = ctx.world.createRigidBody(desc);
    const cd = ctx.rapier.ColliderDesc.ball(radius)
      .setFriction(0.6)
      .setRestitution(0.05)
      .setMass(0)
      .setDensity(0);
    ctx.world.createCollider(cd, body);
    segBodies.push(body);
  }

  for (let i = 0; i < N; i++) {
    const index = ctx.appendSegmentBody(segBodies[i]!, ids[i]!, {
      mass: mi,
      netForce: [0, 0, 0],
      normal: [0, 0, 0],
      friction: [0, 0, 0],
      applied: [0, 0, 0],
    });
    rt.segmentIndices.push(index);
  }

  const anchorLocal = (v: Vec3): { x: number; y: number; z: number } => ({ x: v[0], y: v[1], z: v[2] });

  // Link joints between consecutive segments (anchors at ±l/2 along the link).
  for (let i = 0; i < N - 1; i++) {
    const dir = normalize(sub(centers[i + 1]!, centers[i]!));
    const half = scale(dir, segLen / 2);
    const a1 = anchorLocal(half);
    const a2 = anchorLocal(scale(half, -1));
    if (ctx.mode === "2D") {
      ctx.world.createImpulseJoint(
        ctx.rapier.JointData.revolute(a1, a2, { x: 0, y: 0, z: 1 }),
        segBodies[i]!,
        segBodies[i + 1]!,
        true,
      );
    } else {
      ctx.world.createImpulseJoint(
        ctx.rapier.JointData.spherical(a1, a2),
        segBodies[i]!,
        segBodies[i + 1]!,
        true,
      );
    }
    rt.linkRuntimes.push({
      indexA: rt.segmentIndices[i]!,
      indexB: rt.segmentIndices[i + 1]!,
      iMean: inertia,
      dampingRate,
    });
  }

  // Pin the ends to the path anchors.
  const pinEnd = (segment: number, node: { anchorId: string; point: Vec3 }, dir: Vec3, first: boolean): void => {
    const segBody = segBodies[segment]!;
    const local = anchorLocal(scale(dir, first ? -segLen / 2 : segLen / 2));
    if (node.anchorId) {
      const index = ctx.bodyIndexById.get(node.anchorId) ?? -1;
      const body = index >= 0 ? (ctx.bodies[index] ?? null) : null;
      if (!body) {
        warnOnce(rt, `pin:${node.anchorId}`, `chain "${rope.name}" end anchor references missing body "${node.anchorId}"`);
        return;
      }
      ctx.world.createImpulseJoint(
        ctx.rapier.JointData.spherical(anchorLocal(node.point), local),
        body,
        segBody,
        true,
      );
    } else {
      ctx.world.createImpulseJoint(
        ctx.rapier.JointData.spherical(anchorLocal(node.point), local),
        ctx.worldAnchorBody,
        segBody,
        true,
      );
    }
  };

  if (rope.path[0]) pinEnd(0, rope.path[0], tangentAt(0), true);
  if (rope.path[rope.path.length - 1]) {
    pinEnd(N - 1, rope.path[rope.path.length - 1]!, tangentAt(total), false);
  }
}

// -----------------------------------------------------------------------------
// Tension recovery (§2.1.1 — constraint-impulse read-back substitute)
// -----------------------------------------------------------------------------

/**
 * Recover the scalar rope tension after `world.step`: for each constrained
 * BODY side, the rope force is the residual m·a − m·g − F_contact − F_applied;
 * the tension is its component along the rope direction. Exact in the absence
 * of damping (the tests); visualization-grade otherwise.
 */
export function recoverRopeTensions(runtimes: RopeRuntime[], ctx: RopeBuildContext): void {
  for (const rt of runtimes) {
    let tension = 0;
    if (rt.model === "massless") {
      const sideWorld = (side: SegmentSide): Vec3 => {
        if (side.isWorld) return side.localPoint;
        const body = ctx.bodies[side.bodyIndex];
        if (!body) return [0, 0, 0];
        const t = body.translation();
        const w = rotateVec3ByQuat(side.localPoint, quatFromRotation(body.rotation()));
        return [t.x + w[0], t.y + w[1], t.z + w[2]];
      };
      const bodyTension = (side: SegmentSide, toward: Vec3): number => {
        if (side.isWorld || side.bodyIndex < 0) return 0;
        const meta = ctx.meta[side.bodyIndex];
        if (!meta || meta.mass <= 0) return 0;
        const g = ctx.gravity;
        const rope: Vec3 = [
          meta.netForce[0] - meta.mass * g[0] - meta.normal[0] - meta.friction[0] - meta.applied[0],
          meta.netForce[1] - meta.mass * g[1] - meta.normal[1] - meta.friction[1] - meta.applied[1],
          meta.netForce[2] - meta.mass * g[2] - meta.normal[2] - meta.friction[2] - meta.applied[2],
        ];
        const dir = normalize(sub(toward, sideWorld(side)));
        const along = dot(rope, dir);
        return along > 0 ? along : 0;
      };
      for (const seg of rt.directSegments) {
        tension = Math.max(tension, bodyTension(seg.sideA, sideWorld(seg.sideB)));
        tension = Math.max(tension, bodyTension(seg.sideB, sideWorld(seg.sideA)));
      }
      for (const seg of rt.pulleySegments) {
        tension = Math.max(tension, bodyTension(seg.sideA, sideWorld(seg.sideB)));
        tension = Math.max(tension, bodyTension(seg.sideB, sideWorld(seg.sideA)));
      }
    }
    rt.tension = tension;
  }
}
