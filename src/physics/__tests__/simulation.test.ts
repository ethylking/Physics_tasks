// @vitest-environment node
// physics/__tests__/simulation.test.ts — Rapier3D integration: free-fall
// kinematics, mechanical-energy conservation, per-face friction. Runs the real
// WASM engine in Node.

import RAPIER from "@dimforge/rapier3d-compat";
import { beforeAll, describe, expect, it } from "vitest";
import { PhysicsEngine } from "../engine";
import { createDefaultBody, createDefaultProject, createDefaultStatic } from "../../core/defaults";
import type { MechProject } from "../../core/types";

beforeAll(async () => {
  await RAPIER.init();
});

function fallingProject(): MechProject {
  const project = createDefaultProject("fall", "3D", { seedScene: false });
  const sphere = createDefaultBody("sphere");
  sphere.geometry = { sphere: { R: 0.5, shell: false } };
  sphere.mass = { value: 2, mode: "total" };
  sphere.linearDamping = 0;
  sphere.angularDamping = 0;
  sphere.initial = { ...sphere.initial, position: [0, 0, 10] };
  project.bodies.push(sphere);
  project.world.fixedDt = 1 / 240;
  project.world.gravity = [0, 0, -9.81];
  return project;
}

function frictionProject(mu: number): MechProject {
  const project = createDefaultProject("friction", "3D", { seedScene: false });
  project.statics.push(
    createDefaultStatic("ground", { friction: 0, restitution: 0 } as never),
  );
  const box = createDefaultBody("box");
  // Only the bottom face (Z−) touches the ground; this also pins the face
  // ordering to the Z-up box local frame (face 5 = −Z).
  box.faceFriction = [0, 0, 0, 0, 0, mu];
  box.linearDamping = 0;
  box.angularDamping = 0;
  box.initial = { ...box.initial, position: [0, 0, 0.5], velocity: [3, 0, 0] };
  project.bodies.push(box);
  project.world.fixedDt = 1 / 240;
  return project;
}

describe("simulation — free fall", () => {
  it("falling sphere matches z(t) = z₀ − ½gt²", () => {
    const project = fallingProject();
    const engine = new PhysicsEngine(project, RAPIER);
    const t = 1;
    const steps = Math.round(t / engine.dt);
    for (let i = 0; i < steps; i++) engine.step();

    const z = engine.bodies[0]!.translation().z;
    const expected = 10 - 0.5 * 9.81 * t * t;
    const drop = 10 - expected;
    expect(Math.abs(z - expected)).toBeLessThan(0.01 * drop);
  });

  it("conserves mechanical energy within 0.5% over 1 s", () => {
    const project = fallingProject();
    const engine = new PhysicsEngine(project, RAPIER);
    const e0 = engine.computeEnergies();
    const steps = Math.round(1 / engine.dt);
    for (let i = 0; i < steps; i++) engine.step();
    const e1 = engine.computeEnergies();
    const drift = (e1.Etotal - e0.Etotal) / e0.Etotal;
    expect(Math.abs(drift)).toBeLessThan(0.005);
  });

  it("energy monitor baseline E0 is captured and drift is reported", () => {
    const project = fallingProject();
    const engine = new PhysicsEngine(project, RAPIER);
    const out = new Float32Array(engine.snapshotSize);
    engine.writeSnapshot(out);
    expect(out[4]!).toBeCloseTo(out[3]!, 9); // E0 == Etotal at t=0
    expect(out[5]!).toBeCloseTo(0, 9);
  });
});

describe("simulation — per-face friction (§2.2)", () => {
  it("a high-friction bottom face decelerates the box much faster", () => {
    const hi = frictionProject(1.0);
    const lo = frictionProject(0.1);
    const engineHi = new PhysicsEngine(hi, RAPIER);
    const engineLo = new PhysicsEngine(lo, RAPIER);
    const steps = Math.round(0.5 / engineHi.dt);
    for (let i = 0; i < steps; i++) {
      engineHi.step();
      engineLo.step();
    }
    const vHi = Math.abs(engineHi.bodies[0]!.linvel().x);
    const vLo = Math.abs(engineLo.bodies[0]!.linvel().x);
    // μ_eff = average(0, μ) → a_hi/a_lo = 10; after 0.5 s the ratio is dramatic.
    expect(vHi).toBeLessThan(3 * 0.35); // μ=1: slowed well below 1 m/s
    expect(vLo).toBeGreaterThan(2.4); // μ=0.1: barely slowed
    expect(vHi).toBeLessThan(vLo * 0.4);
  });

  it("box rests ON the slab surface without sinking through the ground", () => {
    const project = frictionProject(0.5);
    const engine = new PhysicsEngine(project, RAPIER);
    for (let i = 0; i < 240; i++) engine.step();
    const z = engine.bodies[0]!.translation().z;
    // resting height ≈ H/2 (0.5), within the slab thickness band
    expect(z).toBeGreaterThan(0.4);
    expect(z).toBeLessThan(0.55);
  });
});

describe("simulation — 2D locking (§4.5)", () => {
  it("2D bodies stay on the Y = 0 plane, rotate only about Y, but still move in XZ", () => {
    const project = createDefaultProject("2d", "2D", { seedScene: false });
    const box = createDefaultBody("box");
    box.linearDamping = 0;
    box.angularDamping = 0;
    box.initial = { ...box.initial, position: [0, 0, 2], angularVelocity: [1, 1, 1] };
    project.bodies.push(box);
    const engine = new PhysicsEngine(project, RAPIER);
    for (let i = 0; i < 120; i++) engine.step();
    const t = engine.bodies[0]!.translation();
    const r = engine.bodies[0]!.rotation();
    // Falls in X–Z (0.5 s of gravity along -Z) …
    expect(t.z).toBeLessThan(2 - 0.9);
    // … but never leaves the Y = 0 plane and never tips out of plane.
    expect(Math.abs(t.y)).toBeLessThan(1e-9);
    expect(Math.abs(r.x)).toBeLessThan(1e-9);
    expect(Math.abs(r.z)).toBeLessThan(1e-9);
  });
});
