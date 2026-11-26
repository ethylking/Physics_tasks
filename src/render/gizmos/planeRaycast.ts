// render/gizmos/planeRaycast.ts — raycast against the FINITE rendered
// rectangles of all statics (used by the spawn ghost in 3D).
//
// A static plane mesh is a `planeGeometry [extent[0], extent[1]]` centered at
// `stat.position`, oriented by `staticWorldQuat(stat)` so its local +X axis is
// `u`, its local +Y axis is `v`, and its local +Z axis is the world normal `n`.
// The visible rectangle therefore spans ±extent[0]/2 along `u` and ±extent[1]/2
// along `v` around the center `p`.

import * as THREE from "three";
import type { MechProject, Quat, StaticEntity, Vec3 } from "../../core/types";
import { rotateVec3ByQuat } from "../../math/rotation";
import { staticWorldQuat } from "../entities/positions";

/** Nearest static-surface hit (or null when no finite rectangle is crossed). */
export interface StaticSurfaceHit {
  point: Vec3;
  normal: Vec3;
  rotation: Quat;
  distance: number;
}

function num(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

/**
 * Intersect the raycaster's ray with every static's finite rendered rectangle
 * and return the nearest hit in front of the camera. `raycaster` must already
 * have its ray set from the camera (`setFromCamera`).
 */
export function raycastStaticSurface(
  project: MechProject,
  raycaster: THREE.Raycaster,
): StaticSurfaceHit | null {
  let best: StaticSurfaceHit | null = null;
  const hit = new THREE.Vector3();

  for (const stat of project.statics) {
    const quat = staticWorldQuat(stat);
    const n = rotateVec3ByQuat([0, 0, 1], quat);
    const u = rotateVec3ByQuat([1, 0, 0], quat);
    const v = rotateVec3ByQuat([0, 1, 0], quat);
    const p: Vec3 = (stat.position ?? [0, 0, 0]) as Vec3;

    const normal = new THREE.Vector3(n[0], n[1], n[2]);
    const center = new THREE.Vector3(p[0], p[1], p[2]);
    const plane = new THREE.Plane(normal, -normal.dot(center));

    if (!raycaster.ray.intersectPlane(plane, hit)) continue;

    const distance = raycaster.ray.origin.distanceTo(hit);
    const hu = num(stat.plane.extent[0], isStaticGround(stat) ? 20 : 10) / 2;
    const hv = num(stat.plane.extent[1], isStaticGround(stat) ? 20 : 10) / 2;

    const d: Vec3 = [hit.x - p[0], hit.y - p[1], hit.z - p[2]];
    const du = d[0] * u[0] + d[1] * u[1] + d[2] * u[2];
    const dv = d[0] * v[0] + d[1] * v[1] + d[2] * v[2];
    if (Math.abs(du) > hu || Math.abs(dv) > hv) continue;

    if (!best || distance < best.distance) {
      best = { point: [hit.x, hit.y, hit.z], normal: n, rotation: quat, distance };
    }
  }

  return best;
}

function isStaticGround(stat: StaticEntity): boolean {
  return stat.kind === "ground";
}
