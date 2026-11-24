// ui/hud/hudTelemetry.ts — pure telemetry assembly for the hover HUD
// (Milestone 4). Kept free of React so the physics formatting is trivially
// unit-tested; the HoverTelemetry component only feeds it snapshot slices.

import type { MechProject, Quat, RigidBodyEntity, Vec3 } from "../../core/types";
import { computeBodyMassProperties } from "../../math/inertia";
import { localToWorld, quatInvert, rotateVec3ByQuat } from "../../math/rotation";
import { SNAPSHOT_FLOATS_PER_BODY, SNAPSHOT_HEADER, SNAPSHOT_INDEX } from "../../physics/snapshot";

/** Per-body state read from the worker snapshot. */
export interface BodySnapshotSlice {
  position: Vec3;
  rotation: Quat;
  velocity: Vec3;
  angularVelocity: Vec3;
  accel: Vec3;
  netForce: Vec3;
}

export interface BodyTelemetry {
  id: string;
  name: string;
  kind: string;
  mass: number;
  position: Vec3;
  velocity: Vec3;
  speed: number;
  accel: Vec3;
  accelMagnitude: number;
  angularVelocity: Vec3;
  angularSpeed: number;
  /** Kinetic energy (translational + rotational), J. */
  Ek: number;
  /** Gravitational potential energy, J. */
  Ep: number;
  netForce: Vec3;
}

export function vecMagnitude(v: Vec3): number {
  return Math.hypot(v[0], v[1], v[2]);
}

/** Read a body's slice from the Float32Array snapshot (null → not available). */
export function readBodySlice(snapshot: Float32Array | null, bodyIndex: number): BodySnapshotSlice | null {
  if (!snapshot || bodyIndex < 0) return null;
  const o = SNAPSHOT_HEADER + bodyIndex * SNAPSHOT_FLOATS_PER_BODY;
  if (o + SNAPSHOT_FLOATS_PER_BODY > snapshot.length) return null;
  return {
    position: [snapshot[o + SNAPSHOT_INDEX.POS] ?? 0, snapshot[o + SNAPSHOT_INDEX.POS + 1] ?? 0, snapshot[o + SNAPSHOT_INDEX.POS + 2] ?? 0],
    rotation: [
      snapshot[o + SNAPSHOT_INDEX.QUAT] ?? 0,
      snapshot[o + SNAPSHOT_INDEX.QUAT + 1] ?? 0,
      snapshot[o + SNAPSHOT_INDEX.QUAT + 2] ?? 0,
      snapshot[o + SNAPSHOT_INDEX.QUAT + 3] ?? 1,
    ],
    velocity: [snapshot[o + SNAPSHOT_INDEX.LINVEL] ?? 0, snapshot[o + SNAPSHOT_INDEX.LINVEL + 1] ?? 0, snapshot[o + SNAPSHOT_INDEX.LINVEL + 2] ?? 0],
    angularVelocity: [snapshot[o + SNAPSHOT_INDEX.ANGVEL] ?? 0, snapshot[o + SNAPSHOT_INDEX.ANGVEL + 1] ?? 0, snapshot[o + SNAPSHOT_INDEX.ANGVEL + 2] ?? 0],
    accel: [snapshot[o + SNAPSHOT_INDEX.ACCEL] ?? 0, snapshot[o + SNAPSHOT_INDEX.ACCEL + 1] ?? 0, snapshot[o + SNAPSHOT_INDEX.ACCEL + 2] ?? 0],
    netForce: [snapshot[o + SNAPSHOT_INDEX.NETFORCE] ?? 0, snapshot[o + SNAPSHOT_INDEX.NETFORCE + 1] ?? 0, snapshot[o + SNAPSHOT_INDEX.NETFORCE + 2] ?? 0],
  };
}

/**
 * Assemble all HUD quantities for a body. With a null slice (worker never
 * started / no snapshot yet) the entity's initial state is used and the
 * acceleration / net force read as zero.
 */
export function buildBodyTelemetry(
  body: RigidBodyEntity,
  project: MechProject,
  slice: BodySnapshotSlice | null,
): BodyTelemetry {
  const mp = computeBodyMassProperties(body);
  const position = slice?.position ?? body.initial.position;
  const rotation = slice?.rotation ?? body.initial.rotation;
  const velocity = slice?.velocity ?? body.initial.velocity;
  const angularVelocity = slice?.angularVelocity ?? body.initial.angularVelocity;
  const accel = slice?.accel ?? [0, 0, 0];
  const netForce = slice?.netForce ?? [0, 0, 0];

  const speed = vecMagnitude(velocity);
  const accelMagnitude = vecMagnitude(accel);
  const angularSpeed = vecMagnitude(angularVelocity);

  // Rotational kinetic energy about the CoM principal axes.
  const omegaLocal = rotateVec3ByQuat(angularVelocity, quatInvert(rotation));
  const I = mp.principalInertia;
  const EkRot = 0.5 * (I[0] * omegaLocal[0] * omegaLocal[0] + I[1] * omegaLocal[1] * omegaLocal[1] + I[2] * omegaLocal[2] * omegaLocal[2]);
  const Ek = 0.5 * mp.mass * speed * speed + EkRot;

  // Same convention as the engine: Ep = −m g·r_CM.
  const g = project.world.gravity;
  const com = localToWorld(mp.centerOfMass, position, rotation);
  const Ep = -mp.mass * (g[0] * com[0] + g[1] * com[1] + g[2] * com[2]);

  return {
    id: body.id,
    name: body.name,
    kind: body.kind,
    mass: mp.mass,
    position,
    velocity,
    speed,
    accel,
    accelMagnitude,
    angularVelocity,
    angularSpeed,
    Ek,
    Ep,
    netForce,
  };
}

export interface TelemetryRow {
  label: string;
  value: string;
}

export function fmt(v: number, digits = 2): string {
  if (!Number.isFinite(v)) return "—";
  return v.toFixed(digits);
}

export function fmtVec3(v: Vec3, digits = 2): string {
  return `(${fmt(v[0], digits)}, ${fmt(v[1], digits)}, ${fmt(v[2], digits)})`;
}

/** Human-readable rows for the HUD card — one row per required quantity. */
export function formatTelemetry(t: BodyTelemetry): TelemetryRow[] {
  return [
    { label: "Mass m", value: `${fmt(t.mass, 3)} kg` },
    { label: "Position", value: `${fmtVec3(t.position)} m` },
    { label: "Velocity v⃗", value: `${fmtVec3(t.velocity)} m/s` },
    { label: "Speed |v|", value: `${fmt(t.speed)} m/s` },
    { label: "Acceleration a⃗", value: `${fmtVec3(t.accel)} m/s²` },
    { label: "|a|", value: `${fmt(t.accelMagnitude)} m/s²` },
    { label: "Angular velocity ω⃗", value: `${fmtVec3(t.angularVelocity)} rad/s` },
    { label: "|ω|", value: `${fmt(t.angularSpeed)} rad/s` },
    { label: "Eₖ (kinetic)", value: `${fmt(t.Ek)} J` },
    { label: "Eₚ (potential)", value: `${fmt(t.Ep)} J` },
    { label: "Net force ΣF⃗", value: `${fmtVec3(t.netForce)} N` },
  ];
}
