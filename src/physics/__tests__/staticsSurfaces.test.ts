// @vitest-environment node
// physics/__tests__/staticsSurfaces.test.ts — static planes are thin, two-sided
// SURFACES; only a solid plane (the project floor) is an infinite half-space.
//
// Regression for the reported bug: objects could not exist UNDER an added plane
// because every static was built as a half-space (the −normal side was solid).
// Covers: the solidity contract, a body freely falling past / resting on a thin
// plane, a body living behind a wall, the wall's back face still stopping a body,
// and interpenetration detection on both sides of the surface.

import RAPIER from "@dimforge/rapier3d-compat";
import { beforeAll, describe, expect, it } from "vitest";
import { PhysicsEngine, STATIC_SURFACE_THICKNESS } from "../engine";
import { findInitialCollisions, getRapier } from "../collisionCheck";
import {
  applyStaticSolidityDefaults,
  createDefaultBody,
  createDefaultProject,
  createDefaultStatic,
  isSolidStatic,
} from "../../core/defaults";
import { eulerDegToQuat, quatMultiply, rotateVec3ByQuat, staticBaseQuat } from "../../math/rotation";
import type { MechProject, Quat, RigidBodyEntity, StaticEntity, Vec3 } from "../../core/types";

beforeAll(async () => {
  await RAPIER.init();
  await getRapier();
});

const G = 9.81;

/** 3D project with zero gravity by default (tests set it explicitly). */
function blankProject(): MechProject {
  const project = createDefaultProject("surfaces", "3D", { seedScene: false });
  project.world.fixedDt = 1 / 120;
  project.world.gravity = [0, 0, 0];
  return project;
}

/** A palette-style plane: thin, two-sided, no restitution, no friction. */
function surfacePlane(kind: "wall" | "ground", partial: Partial<StaticEntity> = {}): StaticEntity {
  return createDefaultStatic(kind, {
    solid: false,
    friction: 0,
    restitution: 0,
    ...partial,
  });
}

/** A unit box (half 0.5), no damping, at `position`, optionally patched. */
function boxAt(position: Vec3, patch: Partial<RigidBodyEntity> = {}): RigidBodyEntity {
  const box = createDefaultBody("box");
  box.mass = { value: 1, mode: "total" };
  box.friction = 0;
  box.restitution = 0;
  box.linearDamping = 0;
  box.angularDamping = 0;
  box.initial = { ...box.initial, position };
  return { ...box, ...patch };
}

describe("statics — solidity contract (`isSolidStatic`)", () => {
  it("a fresh ground/floor factory is SOLID; a fresh wall factory is a surface", () => {
    expect(isSolidStatic(createDefaultStatic("ground"))).toBe(true);
    expect(isSolidStatic(createDefaultStatic("wall"))).toBe(false);
  });

  it("the explicit `solid` flag always wins (palette planes opt out)", () => {
    expect(isSolidStatic(createDefaultStatic("ground", { solid: false }))).toBe(false);
    expect(isSolidStatic(createDefaultStatic("wall", { solid: true }))).toBe(true);
  });

  it("legacy files without `solid` keep the old rule: ground solid, wall surface", () => {
    const legacyGround = createDefaultStatic("ground");
    delete legacyGround.solid;
    const legacyWall = createDefaultStatic("wall");
    delete legacyWall.solid;
    expect(isSolidStatic(legacyGround)).toBe(true);
    expect(isSolidStatic(legacyWall)).toBe(false);
  });

  it("a palette-spawned plane carries `solid: false` in the serialized schema", () => {
    expect(surfacePlane("ground").solid).toBe(false);
    expect(surfacePlane("wall").solid).toBe(false);
  });

  it("legacy projects get `solid` baked on adopt: first ground = floor, extra planes = surfaces", () => {
    const legacy = createDefaultProject("legacy", "3D", { seedScene: false });
    const floor = createDefaultStatic("ground");
    const ceiling = createDefaultStatic("ground", { position: [0, 0, 3] });
    const wall = createDefaultStatic("wall");
    delete floor.solid;
    delete ceiling.solid;
    delete wall.solid;
    legacy.statics.push(floor, ceiling, wall);

    const migrated = applyStaticSolidityDefaults(legacy);
    expect(migrated.statics.map((s) => s.solid)).toEqual([true, false, false]);
    expect(isSolidStatic(migrated.statics[0]!)).toBe(true);
    expect(isSolidStatic(migrated.statics[1]!)).toBe(false);

    // Projects that already carry explicit values are adopted unchanged.
    const modern = createDefaultProject("modern", "3D");
    expect(applyStaticSolidityDefaults(modern)).toBe(modern);
  });
});

describe("statics — the collider frame matches the RENDERED plane", () => {
  // A spin about the plane's own normal (rz) does NOT commute with the base
  // orientation derived from `plane.normal`, so composing the plane normal
  // separately from the mesh quaternion used to tilt/offset the collider away
  // from the drawn rectangle. The collider frame must be `staticWorldQuat`.
  const drawnNormalOf = (normal: Vec3, rotation: Quat): Vec3 =>
    rotateVec3ByQuat([0, 0, 1], quatMultiply(staticBaseQuat(normal), rotation));

  it("a thin slab's normal, offset and orientation follow the rendered plane for a non-commuting rotation", () => {
    const rotation = eulerDegToQuat([0, 0, 90]); // spin about the plane's own normal
    const plane = surfacePlane("wall", {
      plane: { normal: [0, 1, 0], extent: [10, 4] },
      position: [0, 0, 2],
      rotation,
    });
    const project = blankProject();
    project.statics.push(plane);

    const engine = new PhysicsEngine(project, RAPIER);
    const collider = engine.staticColliders[0]!.collider;
    const drawn = drawnNormalOf(plane.plane.normal, rotation);

    // The collider's local +Z is the plane the user sees.
    const frame = collider.rotation();
    const frameNormal = rotateVec3ByQuat([0, 0, 1], [frame.x, frame.y, frame.z, frame.w]);
    for (let k = 0; k < 3; k++) expect(frameNormal[k]!).toBeCloseTo(drawn[k]!, 6);

    // …and the slab is shifted along THAT normal, so its +face is flush.
    const c = collider.translation();
    const p = plane.position as Vec3;
    const halfT = STATIC_SURFACE_THICKNESS / 2;
    const got: Vec3 = [c.x, c.y, c.z];
    for (let k = 0; k < 3; k++) expect(got[k]!).toBeCloseTo(p[k]! - drawn[k]! * halfT, 6);
  });

  it("a SOLID plane's half-space normal follows the rendered plane too", () => {
    const rotation = eulerDegToQuat([0, 0, 90]);
    const solid = createDefaultStatic("wall", {
      solid: true,
      plane: { normal: [0, 1, 0], extent: [10, 4] },
      position: [0, 0, 0],
      rotation,
    });
    const project = blankProject();
    project.statics.push(solid);

    const engine = new PhysicsEngine(project, RAPIER);
    const shape = engine.staticColliders[0]!.collider.shape as RAPIER.HalfSpace;
    expect(shape.type).toBe(RAPIER.ShapeType.HalfSpace);
    const drawn = drawnNormalOf(solid.plane.normal, rotation);
    expect(shape.normal.x).toBeCloseTo(drawn[0]!, 6);
    expect(shape.normal.y).toBeCloseTo(drawn[1]!, 6);
    expect(shape.normal.z).toBeCloseTo(drawn[2]!, 6);
  });
});

describe("statics — a thin plane is two-sided (objects may exist under it)", () => {
  it("a box UNDER a horizontal plane falls through the scene instead of being ejected above it", () => {
    const project = blankProject();
    project.world.gravity = [0, 0, -G];
    // A ceiling/platform plane at z = 3; the box starts below it.
    project.statics.push(surfacePlane("ground", { plane: { normal: [0, 0, 1], extent: [20, 20] }, position: [0, 0, 3] }));
    project.bodies.push(boxAt([0, 0, 1]));

    const engine = new PhysicsEngine(project, RAPIER);
    for (let i = 0; i < 120; i++) engine.step(); // 1 s

    const t = engine.bodies[0]!.translation();
    // Free fall from z = 1 (z ≈ 1 − ½·g·t²), and crucially NOT pushed above
    // the plane (the old half-space ejected the box to z > 3.5).
    expect(Math.abs(t.z - (1 - 0.5 * G))).toBeLessThan(0.05);
    expect(t.z).toBeLessThan(0);
    expect(Math.abs(t.x)).toBeLessThan(1e-6);
    expect(Math.abs(t.y)).toBeLessThan(1e-6);
  });

  it("a box parked UNDER a horizontal plane is not ejected through it", () => {
    const project = blankProject(); // zero gravity: only the plane can move it
    project.statics.push(surfacePlane("ground", { plane: { normal: [0, 0, 1], extent: [20, 20] }, position: [0, 0, 3] }));
    project.bodies.push(boxAt([0, 0, 2])); // 0.5 m of clearance below the plane

    const engine = new PhysicsEngine(project, RAPIER);
    for (let i = 0; i < 120; i++) engine.step();
    const t = engine.bodies[0]!.translation();
    // The old half-space treated everything below z = 3 as solid and shoved the
    // box above the plane; a thin surface leaves it exactly where it was.
    expect(Math.abs(t.z - 2)).toBeLessThan(1e-6);
    expect(Math.abs(t.x)).toBeLessThan(1e-6);
    expect(Math.abs(t.y)).toBeLessThan(1e-6);
  });

  it("a box resting ON a thin plane sits exactly on the visible surface (flush +normal face)", () => {
    const project = blankProject();
    project.world.gravity = [0, 0, -G];
    project.statics.push(surfacePlane("ground", { plane: { normal: [0, 0, 1], extent: [20, 20] }, position: [0, 0, 3] }));
    project.bodies.push(boxAt([0, 0, 4])); // 0.5 m above the plane

    const engine = new PhysicsEngine(project, RAPIER);
    for (let i = 0; i < 360; i++) engine.step(); // 3 s — fall + settle
    const t = engine.bodies[0]!.translation();
    // Bottom face on the plane → centre z = 3 + H/2 = 3.5. The tolerance is
    // tighter than half the slab thickness (0.02): the slab's top face must be
    // exactly ON the visible plane, not the slab centre.
    expect(Math.abs(t.z - 3.5)).toBeLessThan(0.01);
    expect(Math.abs(t.x)).toBeLessThan(0.02);
    expect(Math.abs(t.y)).toBeLessThan(0.02);
  });

  it("a body BEHIND a wall (on the −normal side) is not pushed away", () => {
    const project = blankProject();
    project.world.gravity = [0, 0, -G];
    // Vertical wall through y = 0 with normal +Y: its solid side used to be y < 0.
    project.statics.push(surfacePlane("wall", { plane: { normal: [0, 1, 0], extent: [10, 10] }, position: [0, 0, 0] }));
    project.bodies.push(boxAt([0, -1, 1]));

    const engine = new PhysicsEngine(project, RAPIER);
    for (let i = 0; i < 120; i++) engine.step();
    const t = engine.bodies[0]!.translation();
    expect(Math.abs(t.y + 1)).toBeLessThan(1e-6); // still behind the wall
    expect(t.z).toBeLessThan(0.5); // and fell freely
  });

  it("a body moving at the wall's BACK face is still stopped (the surface is two-sided)", () => {
    const project = blankProject();
    project.statics.push(surfacePlane("wall", { plane: { normal: [0, 1, 0], extent: [10, 10] }, position: [0, 0, 0] }));
    const mover = boxAt([0, -1, 0.5]);
    mover.initial = { ...mover.initial, velocity: [0, 3, 0] };
    project.bodies.push(mover);

    const engine = new PhysicsEngine(project, RAPIER);
    for (let i = 0; i < 120; i++) engine.step(); // 1 s
    const t = engine.bodies[0]!.translation();
    // Back face of the slab sits at y = −thickness, so the box centre stops at
    // −(0.5 + thickness); it must NOT cross the plane.
    expect(t.y).toBeLessThan(-0.5);
    expect(t.y).toBeGreaterThan(-(0.5 + STATIC_SURFACE_THICKNESS + 0.05));
  });
});

describe("statics — 2D surface extents follow the DRAWN line", () => {
  it("a 2D wall's in-plane length comes from extent[1] (its vertical line), not extent[0]", () => {
    const project = createDefaultProject("2d-wall-extent", "2D", { seedScene: false });
    project.world.fixedDt = 1 / 120;
    project.world.gravity = [0, 0, 0];
    // A wall with extent [4, 20]: the 2D renderer draws it as a VERTICAL line of
    // length extent[1] = 20 (FlatBodies), so the collider must be 20 long too.
    project.statics.push(
      surfacePlane("wall", { plane: { normal: [1, 0, 0], extent: [4, 20] }, position: [0, 0, 0] }),
    );
    // A body at z = 5 is inside the drawn 20-long line (but outside a 4-long one).
    const mover = boxAt([-1, 0, 5]);
    mover.locks = { translate: [false, true, false], rotate: [true, false, true] };
    mover.initial = { ...mover.initial, velocity: [3, 0, 0] };
    project.bodies.push(mover);

    const engine = new PhysicsEngine(project, RAPIER);
    for (let i = 0; i < 120; i++) engine.step(); // 1 s at 3 m/s → would reach x = 2

    const t = engine.bodies[0]!.translation();
    // Stopped by the wall's back face (x = −thickness) instead of flying past.
    expect(t.x).toBeLessThan(-0.4);
    expect(t.x).toBeGreaterThan(-(0.5 + STATIC_SURFACE_THICKNESS + 0.05));
    expect(Math.abs(t.z - 5)).toBeLessThan(0.05);
    expect(Math.abs(t.y)).toBeLessThan(1e-9); // still on the 2D X–Z workspace
  });
});

describe("statics — pre-simulation interpenetration on a thin plane", () => {
  it("a plane ABOVE a box is NOT a collision anymore (objects may live under it)", async () => {
    const project = blankProject();
    project.statics.push(surfacePlane("ground", { plane: { normal: [0, 0, 1], extent: [20, 20] }, position: [0, 0, 3] }));
    const box = boxAt([0, 0, 1]);
    project.bodies.push(box);

    await expect(findInitialCollisions(project)).resolves.toEqual([]);
  });

  it("a thin plane slicing through a box IS still flagged", async () => {
    const project = blankProject();
    const plane = surfacePlane("wall", { plane: { normal: [0, 1, 0], extent: [10, 10] }, position: [0, 0, 0] });
    project.statics.push(plane);
    const box = boxAt([0, 0, 0]);
    project.bodies.push(box);

    const ids = await findInitialCollisions(project);
    expect(ids).toContain(box.id);
    expect(ids).toContain(plane.id);
  });

  it("a SOLID floor above a box is still flagged (nothing may exist under a solid plane)", async () => {
    const project = blankProject();
    project.statics.push(createDefaultStatic("ground", { position: [0, 0, 2] })); // solid: true
    const box = boxAt([0, 0, 0]);
    project.bodies.push(box);

    const ids = await findInitialCollisions(project);
    expect(ids).toContain(box.id);
  });
});
