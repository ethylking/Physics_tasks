// physics/collisionCheck.ts — pre-simulation initial-collision detection.
//
// Builds a throwaway, fully-locked Rapier world from a deep-cloned project,
// steps it once to populate the broad phase, and reports the ids of every
// entity whose colliders interpenetrate beyond a tolerance. The scene store
// replaces the project object on any edit, so object identity is a safe cache
// key (a WeakMap keyed by the project reference).

import type { MechProject } from "../core/types";
import { PhysicsEngine } from "./engine";

let rapierPromise: Promise<typeof import("@dimforge/rapier3d-compat")> | null = null;

/** Lazily load + initialize rapier3d-compat, caching the promise. */
export function getRapier(): Promise<typeof import("@dimforge/rapier3d-compat")> {
  rapierPromise ??= (async () => {
    const m = await import("@dimforge/rapier3d-compat");
    await m.init();
    return m;
  })();
  return rapierPromise;
}

/** Penetration deeper than this (metres) is reported as an initial collision. */
export const COLLISION_MARGIN = 0.02;

const cache = new WeakMap<MechProject, Promise<string[]>>();

/**
 * Sorted, unique ids of entities that interpenetrate at time zero. Cached per
 * project object reference (the scene store always replaces the project object
 * on any edit, so identity is a safe key).
 */
export function findInitialCollisions(project: MechProject): Promise<string[]> {
  let cached = cache.get(project);
  if (!cached) {
    cached = (async () => {
      const RAPIER = await getRapier();
      const prepared = prepareProject(project);
      const engine = new PhysicsEngine(prepared, RAPIER);
      return engine.findInitialCollisions(COLLISION_MARGIN);
    })();
    cache.set(project, cached);
  }
  return cached;
}

/**
 * Deep-clone the project and neutralize every motion so the single detection
 * step cannot move anything: zero gravity, zero velocities, and fully lock all
 * six DOFs of every body. Wedges are forced dynamic so fixed-vs-fixed collider
 * pairs (which Rapier never reports contacts for) cannot silently hide a wedge
 * resting against a static.
 */
function prepareProject(project: MechProject): MechProject {
  const clone = JSON.parse(JSON.stringify(project)) as MechProject;
  clone.world.gravity = [0, 0, 0];
  for (const body of clone.bodies) {
    body.initial.velocity = [0, 0, 0];
    body.initial.angularVelocity = [0, 0, 0];
    body.locks.translate = [true, true, true];
    body.locks.rotate = [true, true, true];
    if (body.kind === "wedge" && body.geometry.wedge) {
      body.geometry.wedge = { ...body.geometry.wedge, dynamic: true };
    }
  }
  return clone;
}
