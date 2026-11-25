// @vitest-environment node
// physics/__tests__/staticsRotation.test.ts — static-plane relative rotation:
// the half-space collider tilts with the entity's `rotation` so physics
// matches the rendered mesh (world quat = baseQuat(normal) × rotation).
// Covers: default normal contracts, an inclined-plane slide with a = g·sinθ
// (μ = 0), the 2D X–Z projection, and unchanged default-ground behavior.

import RAPIER from "@dimforge/rapier3d-compat";
import { beforeAll, describe, expect, it } from "vitest";
import { PhysicsEngine, effectiveStaticNormal } from "../engine";
import { createDefaultBody, createDefaultProject, createDefaultStatic } from "../../core/defaults";
import { eulerDegToQuat, rotateVec3ByQuat } from "../../math/rotation";
import { SNAPSHOT_HEADER, SNAPSHOT_INDEX } from "../snapshot";
import type { MechProject, Quat, Vec3 } from "../../core/types";

beforeAll(async () => {
  await RAPIER.init();
});

const G = 9.81;

function readPos(out: Float32Array, o: number): Vec3 {
  return [out[o + SNAPSHOT_INDEX.POS]!, out[o + SNAPSHOT_INDEX.POS + 1]!, out[o + SNAPSHOT_INDEX.POS + 2]!];
}

function readVel(out: Float32Array, o: number): Vec3 {
  return [out[o + SNAPSHOT_INDEX.LINVEL]!, out[o + SNAPSHOT_INDEX.LINVEL + 1]!, out[o + SNAPSHOT_INDEX.LINVEL + 2]!];
}

function readAngvel(out: Float32Array, o: number): Vec3 {
  return [out[o + SNAPSHOT_INDEX.ANGVEL]!, out[o + SNAPSHOT_INDEX.ANGVEL + 1]!, out[o + SNAPSHOT_INDEX.ANGVEL + 2]!];
}

function sub3(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function dot3(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/**
 * 3D project with a single wall static (no ground) and a single 1×1×1 box,
 * μ = 0, no damping, no restitution. The box rotation is `boxRot` (flush with
 * the wall when both share `rot`), the wall collider normal is rotated by
 * `rot` (identity → vertical y = 0 wall).
 */
function tiltedWallProject(rot: Quat, boxCenter: Vec3, boxRot: Quat): MechProject {
  const project = createDefaultProject("tilted-wall", "3D", { seedScene: false });
  project.world.fixedDt = 1 / 120;
  project.world.gravity = [0, 0, -G];
  project.statics.push(
    createDefaultStatic("wall", {
      plane: { normal: [0, 1, 0], extent: [20, 20] },
      rotation: rot,
      friction: 0,
      restitution: 0,
    } as never),
  );
  const box = createDefaultBody("box");
  box.mass = { value: 1, mode: "total" };
  box.friction = 0;
  box.restitution = 0;
  box.linearDamping = 0;
  box.angularDamping = 0;
  box.initial = { ...box.initial, position: boxCenter, rotation: boxRot };
  project.bodies.push(box);
  return project;
}

describe("statics — default entity contracts (cross-agent guard)", () => {
  it("default wall is a vertical (X–Z) plane with normal +Y; ground is +Z", () => {
    const wall = createDefaultStatic("wall");
    const ground = createDefaultStatic("ground");
    expect(wall.name).toBe("Wall");
    expect(wall.plane.normal).toEqual([0, 1, 0]);
    expect(ground.name).toBe("Horizontal plane");
    expect(ground.plane.normal).toEqual([0, 0, 1]);
  });
});

describe("statics — a rotated wall acts as an inclined plane (3D)", () => {
  it("box sliding on a wall tilted 20° from vertical matches s = ½·g·sin(70°)·t²; the unrotated control free-falls", () => {
    const thetaDeg = 20;
    const theta = (thetaDeg * Math.PI) / 180;
    // Rotation of the +Y wall normal about +X by 20°: n = [0, cosθ, sinθ].
    // The wall tilts in the Y–Z plane; the surface through the origin has
    // height z(y) = −(cosθ/sinθ)·y, so downhill (+Y) is where z decreases.
    // The wall was VERTICAL, so this tilt makes the plane incline at
    // φ = 90° − θ = 70° from the horizontal — the textbook slide
    // acceleration is a = g·sinφ = g·cosθ.
    const incline = (90 - thetaDeg) * (Math.PI / 180);
    const aTheory = G * Math.sin(incline); // = G·cosθ ≈ 9.22 m/s²
    const wallQuat = eulerDegToQuat([thetaDeg, 0, 0]);
    const n = rotateVec3ByQuat([0, 1, 0], wallQuat);
    expect(n[0]).toBeCloseTo(0, 12);
    expect(n[1]).toBeCloseTo(Math.cos(theta), 12);
    expect(n[2]).toBeCloseTo(Math.sin(theta), 12);
    expect(aTheory).toBeCloseTo(G * Math.cos(theta), 12);
    // Unit steepest-descent direction (⊥ n, z falls as y grows):
    const d: Vec3 = [0, n[2], -n[1]]; // [0, sinθ, −cosθ]

    // Flush placement: pick the contact-patch center S on the plane (S·n = 0)
    // at y = −1 → S = [0, −1, cotθ]. A box rotated by the same quaternion has
    // its center at C = S + (H/2)·n, so its bottom face lies exactly ON the
    // tilted plane and it slides without tipping (μ = 0).
    const yS = -1;
    const S: Vec3 = [0, yS, (-n[1] * yS) / n[2]];
    const center: Vec3 = [0, S[1] + 0.5 * n[1], S[2] + 0.5 * n[2]];

    const engine = new PhysicsEngine(tiltedWallProject(wallQuat, center, wallQuat), RAPIER);
    const out = new Float32Array(engine.snapshotSize);
    const o = SNAPSHOT_HEADER; // the box is the only body

    // 60 steps of 1/120 s = 0.5 s; sample every 10 steps.
    const samples: Array<{ t: number; p: Vec3; v: Vec3; w: Vec3 }> = [];
    for (let i = 0; i <= 60; i++) {
      if (i % 10 === 0) {
        engine.writeSnapshot(out);
        samples.push({ t: i * engine.dt, p: readPos(out, o), v: readVel(out, o), w: readAngvel(out, o) });
      }
      if (i < 60) engine.step();
    }
    expect(samples.length).toBe(7);

    // Travelled distance along the slope at t = 0.5 s vs s = ½·a·t².
    // 15% slack absorbs the O(dt) semi-implicit-Euler offset (+≈1.7% at
    // dt = 1/120) and the tiny initial contact settlement.
    const sEnd = dot3(sub3(samples[6]!.p, center), d);
    const sTheory = 0.5 * aTheory * 0.5 * 0.5;
    expect(sEnd).toBeGreaterThan(0.1); // actually slid downhill
    expect(Math.abs(sEnd - sTheory) / sTheory).toBeLessThan(0.15);

    // Acceleration from the velocity window 0.25 s → 0.5 s vs g·cosθ.
    const aMeasured = dot3(sub3(samples[6]!.v, samples[3]!.v), d) / (samples[6]!.t - samples[3]!.t);
    expect(Math.abs(aMeasured - aTheory) / aTheory).toBeLessThan(0.1);

    // The box stays flush on the tilted plane (its H/2 offset along n is
    // preserved) and picks up no spin (pure translation).
    expect(Math.abs(dot3(sub3(samples[6]!.p, S), n) - 0.5)).toBeLessThan(0.05);
    expect(Math.hypot(samples[6]!.w[0], samples[6]!.w[1], samples[6]!.w[2])).toBeLessThan(0.05);

    // Control: identity rotation keeps the wall vertical (the y = 0 plane,
    // solid on the −Y side). A box in front of it at [0, 1, 1] has nothing
    // to rest on and just free-falls — x and y stay put, z(t) = z₀ − ½gt².
    // Proves the rotation is what created the incline.
    const control = new PhysicsEngine(tiltedWallProject([0, 0, 0, 1], [0, 1, 1], [0, 0, 0, 1]), RAPIER);
    for (let i = 0; i < 60; i++) control.step();
    const p = control.bodies[0]!.translation();
    expect(Math.abs(p.x)).toBeLessThan(1e-6);
    expect(Math.abs(p.y - 1)).toBeLessThan(1e-6);
    const drop = 0.5 * G * 0.5 * 0.5;
    expect(Math.abs(p.z - (1 - drop))).toBeLessThan(0.01 * drop);
  });
});

describe("statics — 2D projects the rotated normal into the X–Z plane", () => {
  it("effectiveStaticNormal: 3D keeps the rotated normal; 2D projects into X–Z", () => {
    const q45 = eulerDegToQuat([45, 0, 0]);
    const wall = createDefaultStatic("wall", {
      plane: { normal: [0, 1, 0], extent: [10, 10] },
      rotation: q45,
    } as never);

    // (i) 3D: the stored +Y normal rotated by the quaternion — [0, √½, √½].
    const got3d = effectiveStaticNormal(wall, "3D");
    const expected3d = rotateVec3ByQuat([0, 1, 0], q45);
    expect(got3d[0]).toBeCloseTo(expected3d[0], 12);
    expect(got3d[1]).toBeCloseTo(expected3d[1], 12);
    expect(got3d[2]).toBeCloseTo(expected3d[2], 12);
    expect(got3d[1]).toBeCloseTo(Math.SQRT1_2, 12);
    expect(got3d[2]).toBeCloseTo(Math.SQRT1_2, 12);

    // (ii) 2D: projected into X–Z and renormalized → horizontal line [0,0,1].
    const got2d = effectiveStaticNormal(wall, "2D");
    expect(got2d[0]).toBeCloseTo(0, 12);
    expect(got2d[1]).toBeCloseTo(0, 12);
    expect(got2d[2]).toBeCloseTo(1, 12);

    // (iii) ground [0,0,1] + identity rotation stays [0,0,1] in 3D.
    const ground = createDefaultStatic("ground");
    expect(effectiveStaticNormal(ground, "3D")).toEqual([0, 0, 1]);

    // (iv) 2D fallback: a pure +Y normal projects to zero → +X.
    const flatWall = createDefaultStatic("wall", {
      plane: { normal: [0, 1, 0], extent: [10, 10] },
      rotation: [0, 0, 0, 1],
    } as never);
    expect(effectiveStaticNormal(flatWall, "2D")).toEqual([1, 0, 0]);
  });

  it("a 45°-tilted wall reads as a horizontal line in 2D and supports a dropped box", () => {
    const project = createDefaultProject("2d-stat", "2D", { seedScene: false });
    project.statics.push(
      createDefaultStatic("wall", {
        plane: { normal: [0, 1, 0], extent: [20, 20] },
        rotation: eulerDegToQuat([45, 0, 0]),
      } as never),
    );
    const box = createDefaultBody("box");
    box.linearDamping = 0;
    box.angularDamping = 0;
    box.initial = { ...box.initial, position: [0, 0, 2] };
    project.bodies.push(box);

    const engine = new PhysicsEngine(project, RAPIER);
    for (let i = 0; i < 240; i++) engine.step(); // 2 s — bounce settles
    const t = engine.bodies[0]!.translation();
    expect(Math.abs(t.y)).toBeLessThan(1e-9); // 2D stays on Y = 0
    expect(t.z).toBeGreaterThan(0.4); // resting ON the projected half-space
    expect(t.z).toBeLessThan(0.55); // at its half height 0.5
  });
});

describe("statics — default ground behavior unchanged", () => {
  it("the seeded ground still supports the demo box at z = H/2 with no drift", () => {
    const project = createDefaultProject("ground-check", "3D");
    const engine = new PhysicsEngine(project, RAPIER);
    for (let i = 0; i < 120; i++) engine.step(); // 1 s
    const t = engine.bodies[0]!.translation();
    expect(Math.abs(t.z - 0.5)).toBeLessThan(0.05);
    expect(Math.abs(t.x)).toBeLessThan(0.05);
    expect(Math.abs(t.y)).toBeLessThan(0.05);
  });
});
