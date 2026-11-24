// math/rotation.ts — pure quaternion & vector helpers (no THREE dependency).
//
// Shared by the scene store, snapping math, and the inspector. Kept dependency
// free so it unit-tests trivially in Node/jsdom.

import type { Quat, Vec3 } from "../core/types";

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

/** Rotate vector `v` by unit quaternion `q`. */
export function rotateVec3ByQuat(v: Vec3, q: Quat): Vec3 {
  const [x, y, z] = v;
  const [qx, qy, qz, qw] = q;
  // t = 2 * cross(q.xyz, v)
  const tx = 2 * (qy * z - qz * y);
  const ty = 2 * (qz * x - qx * z);
  const tz = 2 * (qx * y - qy * x);
  return [
    x + qw * tx + (qy * tz - qz * ty),
    y + qw * ty + (qz * tx - qx * tz),
    z + qw * tz + (qx * ty - qy * tx),
  ];
}

/** Hamilton product a * b (apply a, then b). */
export function quatMultiply(a: Quat, b: Quat): Quat {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

/** Inverse of a unit quaternion. */
export function quatInvert(q: Quat): Quat {
  const [x, y, z, w] = q;
  const len2 = x * x + y * y + z * z + w * w;
  if (len2 < 1e-12) return [0, 0, 0, 1];
  return [-x / len2, -y / len2, -z / len2, w / len2];
}

/** World point → entity-local point. */
export function worldToLocal(world: Vec3, position: Vec3, rotation: Quat): Vec3 {
  const d: Vec3 = [world[0] - position[0], world[1] - position[1], world[2] - position[2]];
  return rotateVec3ByQuat(d, quatInvert(rotation));
}

/** Entity-local point → world point. */
export function localToWorld(local: Vec3, position: Vec3, rotation: Quat): Vec3 {
  const r = rotateVec3ByQuat(local, rotation);
  return [r[0] + position[0], r[1] + position[1], r[2] + position[2]];
}

/**
 * Quaternion → Euler angles in degrees (ZYX intrinsic order, i.e.
 * R = Rz(yaw)·Ry(pitch)·Rx(roll)).
 */
export function quatToEulerDeg(q: Quat): Vec3 {
  const [x, y, z, w] = q;
  const sinrCosp = 2 * (w * x + y * z);
  const cosrCosp = 1 - 2 * (x * x + y * y);
  const roll = Math.atan2(sinrCosp, cosrCosp);

  const sinp = 2 * (w * y - z * x);
  const pitch = Math.abs(sinp) >= 1 ? (Math.sign(sinp) * Math.PI) / 2 : Math.asin(sinp);

  const sinyCosp = 2 * (w * z + x * y);
  const cosyCosp = 1 - 2 * (y * y + z * z);
  const yaw = Math.atan2(sinyCosp, cosyCosp);

  return [roll * RAD2DEG, pitch * RAD2DEG, yaw * RAD2DEG];
}

/** Euler angles in degrees (roll/pitch/yaw about X/Y/Z, ZYX intrinsic) → quaternion. */
export function eulerDegToQuat(deg: Vec3): Quat {
  const rx = (deg[0] * DEG2RAD) / 2;
  const ry = (deg[1] * DEG2RAD) / 2;
  const rz = (deg[2] * DEG2RAD) / 2;
  const cx = Math.cos(rx);
  const sx = Math.sin(rx);
  const cy = Math.cos(ry);
  const sy = Math.sin(ry);
  const cz = Math.cos(rz);
  const sz = Math.sin(rz);
  // q = qz · qy · qx (ZYX intrinsic), verified term by term.
  return [
    sx * cy * cz - cx * sy * sz,
    cx * sy * cz + sx * cy * sz,
    cx * cy * sz - sx * sy * cz,
    cx * cy * cz + sx * sy * sz,
  ];
}

/** Distance between two points. */
export function dist3(a: Vec3, b: Vec3): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}
