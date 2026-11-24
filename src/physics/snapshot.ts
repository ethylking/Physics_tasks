// physics/snapshot.ts — layout of the zero-copy Float32Array snapshot shared
// between the physics worker and the main thread (§5.2).
//
// Header (8 floats):
//   [0] t          simulation time (s)
//   [1] Ek         kinetic energy (J)
//   [2] Ep         gravitational potential energy (J)
//   [3] Etotal     Ek + Ep
//   [4] E0         energy at simulation start
//   [5] drift      (Etotal − E0) / E0
//   [6] count      number of bodies (project bodies + chain-segment bodies)
//   [7] ropeCount  number of rope entities (tension slots that follow)
//
// Bodies (25 floats each, in project.bodies order, then rope chain segments):
//   pos[3] quat[4] linvel[3] angvel[3] accel[3]
//   netForce[3]   m·a — total net force on the body (N)
//   normal[3]     net normal reaction N accumulated from contact events (N)
//   friction[3]   net friction force F_f accumulated from contact events (N)
//
// Ropes (1 float each, in project.ropes order — Milestone 5):
//   tension       peak scalar rope tension recovered from constraint impulses (N);
//                 chain ropes report 0 (per-link tension lives in the joints).

export const SNAPSHOT_HEADER = 8;
export const SNAPSHOT_FLOATS_PER_BODY = 25;
export const SNAPSHOT_FLOATS_PER_ROPE = 1;

export const SNAPSHOT_INDEX = {
  T: 0,
  EK: 1,
  EP: 2,
  ETOTAL: 3,
  E0: 4,
  DRIFT: 5,
  COUNT: 6,
  ROPE_COUNT: 7,
  // per body
  POS: 0,
  QUAT: 3,
  LINVEL: 7,
  ANGVEL: 10,
  ACCEL: 13,
  NETFORCE: 16,
  NORMAL: 19,
  FRICTION: 22,
  // per rope
  TENSION: 0,
} as const;

/** Byte offset of the rope-tension section (after header + all bodies). */
export function snapshotRopesOffset(bodyCount: number): number {
  return SNAPSHOT_HEADER + bodyCount * SNAPSHOT_FLOATS_PER_BODY;
}

export function snapshotLength(bodyCount: number, ropeCount = 0): number {
  return SNAPSHOT_HEADER + bodyCount * SNAPSHOT_FLOATS_PER_BODY + ropeCount * SNAPSHOT_FLOATS_PER_ROPE;
}
