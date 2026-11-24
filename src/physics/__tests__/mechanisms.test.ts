// @vitest-environment node
// physics/__tests__/mechanisms.test.ts — Milestone 5: theoretical-mechanics
// verification against exact textbook formulas, driving the real Rapier WASM
// engine in Node (deterministic: fixed dt, fixed iterations, warm start, no
// randomness — §5.3).
//
//   1. Atwood machine with a massive pulley  a = (m₁−m₂)g / (m₁+m₂+I/R²)   < 2%
//   2. Physical pendulum                   T = 2π√(L/g)                    < 1.5%
//   3. Harmonic spring-mass oscillator     T = 2π√(m/k)                    < 1%
//   4. Massive chain catenary              settles, sags, stays finite

import RAPIER from "@dimforge/rapier3d-compat";
import { beforeAll, describe, expect, it } from "vitest";
import { PhysicsEngine } from "../engine";
import {
  createDefaultBody,
  createDefaultForce,
  createDefaultJoint,
  createDefaultProject,
  createDefaultRope,
} from "../../core/defaults";
import { eulerDegToQuat, worldToLocal } from "../../math/rotation";
import { resetExprWarnings, setExprWarningSink } from "../../math/expr";
import { SNAPSHOT_FLOATS_PER_BODY, SNAPSHOT_HEADER, SNAPSHOT_INDEX, snapshotRopesOffset } from "../snapshot";
import type { MechProject, RopeEntity } from "../../core/types";

beforeAll(async () => {
  await RAPIER.init();
});

const G = 9.81;

// -----------------------------------------------------------------------------
// 1. Atwood machine with a massive pulley
// -----------------------------------------------------------------------------

function atwoodProject(mode: "2D" | "3D"): { project: MechProject; m1Id: string; m2Id: string; pulleyId: string } {
  const project = createDefaultProject("atwood", mode, { seedScene: false });
  project.world.fixedDt = 1 / 240;
  project.world.gravity = [0, -G, 0];
  project.world.solverIterations = 8;

  const R = 0.5;
  const pulley = createDefaultBody("cylinder");
  pulley.name = "Pulley";
  pulley.geometry = { cylinder: { R, H: 0.08, hollow: false } };
  pulley.mass = { value: 2, mode: "total" };
  pulley.linearDamping = 0;
  pulley.angularDamping = 0;
  pulley.initial = { ...pulley.initial, position: [0, 3, 0] };
  if (mode === "3D") {
    // Align the cylinder's axis (local Y) with world Z: disk in the XY plane.
    pulley.initial = { ...pulley.initial, rotation: eulerDegToQuat([90, 0, 0]) };
  }
  project.bodies.push(pulley);

  const m1 = createDefaultBody("box");
  m1.name = "m1";
  m1.geometry = { box: { W: 0.3, H: 0.3, D: 0.3 } };
  m1.mass = { value: 3, mode: "total" };
  m1.linearDamping = 0;
  m1.angularDamping = 0;
  m1.initial = { ...m1.initial, position: [-R, 1, 0] };
  project.bodies.push(m1);

  const m2 = createDefaultBody("box");
  m2.name = "m2";
  m2.geometry = { box: { W: 0.3, H: 0.3, D: 0.3 } };
  m2.mass = { value: 1, mode: "total" };
  m2.linearDamping = 0;
  m2.angularDamping = 0;
  m2.initial = { ...m2.initial, position: [R, 1, 0] };
  project.bodies.push(m2);

  // Fixed pulley: revolute mount to the world (axle friction/damping = 0).
  const mount = createDefaultJoint("revolute");
  mount.name = "Pulley mount";
  mount.bodyA = null;
  mount.bodyB = pulley.id;
  mount.anchors = { a: [0, 3, 0], b: [0, 0, 0] };
  mount.axis = "z";
  mount.revolute = { friction: 0, damping: 0 };
  project.joints.push(mount);

  const rope = createDefaultRope("massless");
  rope.path = [
    { anchorId: m1.id, point: [0, 0, 0] },
    { anchorId: m2.id, point: [0, 0, 0] },
  ];
  rope.pulleys = [pulley.id];
  rope.massless = { inextensible: true };
  project.ropes.push(rope);

  return { project, m1Id: m1.id, m2Id: m2.id, pulleyId: pulley.id };
}

function runAtwood(mode: "2D" | "3D"): { aMeasured: number; aTheory: number; omegaZ: number } {
  const { project } = atwoodProject(mode);
  const engine = new PhysicsEngine(project, RAPIER);

  const m1Index = engine.bodyIds.indexOf(project.bodies.find((b) => b.name === "m1")!.id);
  const pulleyIndex = engine.bodyIds.indexOf(project.bodies.find((b) => b.name === "Pulley")!.id);

  // Sample the velocity after the constraint transient, 0.4 s apart. The
  // window ends before m2 rises into the pulley (t ≈ 1 s) where contact jams
  // the rope — the formula applies to the free motion only.
  const t1 = 0.4;
  const t2 = 0.8;
  const steps1 = Math.round(t1 / engine.dt);
  const steps2 = Math.round(t2 / engine.dt);
  for (let i = 0; i < steps1; i++) engine.step();
  const v1 = engine.bodies[m1Index]!.linvel();
  for (let i = steps1; i < steps2; i++) engine.step();
  const v2 = engine.bodies[m1Index]!.linvel();
  const aMeasured = (v2.y - v1.y) / (t2 - t1); // falling → negative
  const omega = engine.bodies[pulleyIndex]!.angvel();

  // Exact textbook formula: I = ½·m_p·R² = 0.25, I/R² = 1 kg.
  const m1 = 3;
  const m2 = 1;
  const mp = 2;
  const R = 0.5;
  const I = 0.5 * mp * R * R;
  const aTheory = ((m1 - m2) * G) / (m1 + m2 + I / (R * R));

  return { aMeasured, aTheory, omegaZ: omega.z };
}

describe("mechanisms — Atwood machine with massive pulley (§2.1)", () => {
  it("3D: matches a = (m₁−m₂)g/(m₁+m₂+I/R²) within 2% and the pulley obeys a = αR", () => {
    const { aMeasured, aTheory, omegaZ } = runAtwood("3D");
    expect(Math.abs(aMeasured - -aTheory) / aTheory).toBeLessThan(0.02);
    // a = αR → ω(t) = (a/R)·t.
    const t = 0.8;
    expect(Math.abs(omegaZ - (-aTheory / 0.5) * t) / ((-aTheory / 0.5) * t)).toBeLessThan(0.04);
  });

  it("2D: same textbook acceleration with the disk pulley (I_z = ½mR²)", () => {
    const { aMeasured, aTheory } = runAtwood("2D");
    expect(Math.abs(aMeasured - -aTheory) / aTheory).toBeLessThan(0.03);
  });

  it("the rope tensions T₁ = m₁(g−a), T₂ = m₂(g+a) are recovered into the snapshot", () => {
    const { project } = atwoodProject("3D");
    const engine = new PhysicsEngine(project, RAPIER);
    const steps = Math.round(0.8 / engine.dt);
    for (let i = 0; i < steps; i++) engine.step();
    const out = new Float32Array(engine.snapshotSize);
    engine.writeSnapshot(out);

    const m1Index = engine.bodyIds.indexOf(project.bodies.find((b) => b.name === "m1")!.id);
    const a = engine.meta[m1Index]!.accel[1];
    const T1 = 3 * (G + a); // rope pull on m1 is upward: m₁g − m₁a = m₁(g − |a|)
    const T2 = 1 * (G - a); // m2 accelerates up: T₂ − m₂g = m₂a → T₂ = m₂(g + a)
    const ropeOffset = snapshotRopesOffset(engine.bodies.length);
    const T = out[ropeOffset] ?? 0;
    // Peak tension = T₁ (heavier side). Allow solver residual noise.
    expect(Math.abs(T - Math.max(T1, T2)) / Math.max(T1, T2)).toBeLessThan(0.05);
  });
});

// -----------------------------------------------------------------------------
// 2. Physical pendulum — T = 2π√(L/g)
// -----------------------------------------------------------------------------

describe("mechanisms — physical pendulum (revolute joint)", () => {
  it("oscillation period matches T = 2π√(L/g) within 1.5%", () => {
    const project = createDefaultProject("pendulum", "3D", { seedScene: false });
    project.world.fixedDt = 1 / 240;
    project.world.gravity = [0, -G, 0];

    const L = 2;
    const theta0 = (5 * Math.PI) / 180;
    const pos: [number, number, number] = [L * Math.sin(theta0), -L * Math.cos(theta0), 0];

    const bob = createDefaultBody("sphere");
    bob.name = "Bob";
    bob.geometry = { sphere: { R: 0.05, shell: false } };
    bob.mass = { value: 1, mode: "total" };
    bob.linearDamping = 0;
    bob.angularDamping = 0;
    bob.initial = { ...bob.initial, position: pos };
    project.bodies.push(bob);

    const joint = createDefaultJoint("revolute");
    joint.name = "Pivot";
    joint.bodyA = null;
    joint.bodyB = bob.id;
    joint.anchors = { a: [0, 0, 0], b: worldToLocal([0, 0, 0], pos, [0, 0, 0, 1]) };
    joint.axis = "z";
    joint.revolute = { friction: 0, damping: 0 };
    project.joints.push(joint);

    const engine = new PhysicsEngine(project, RAPIER);
    const bobBody = engine.bodies[0]!;
    const dt = engine.dt;
    const total = Math.round(8 / dt);

    // Detect x zero-crossings with vx > 0 (left-to-right swings); the first
    // occurs at 3T/4, the next one period later.
    const crossings: number[] = [];
    let prevX = bobBody.translation().x;
    let prevVx = 0;
    for (let i = 1; i <= total; i++) {
      engine.step();
      const t = bobBody.translation();
      const v = bobBody.linvel();
      if (prevX < 0 && t.x >= 0 && v.x > 0 && crossings.length < 2) {
        // Linear interpolation of the crossing time.
        const frac = prevX / (prevX - t.x);
        crossings.push((i - frac) * dt);
      }
      prevX = t.x;
      prevVx = v.x;
    }
    void prevVx;
    expect(crossings.length).toBeGreaterThanOrEqual(2);
    const t1 = crossings[0]!;
    const t2 = crossings[1]!;
    const TMeasured = t2 - t1;
    const TTheory = 2 * Math.PI * Math.sqrt(L / G);
    expect(Math.abs(TMeasured - TTheory) / TTheory).toBeLessThan(0.015);
  });
});

// -----------------------------------------------------------------------------
// 3. Harmonic spring-mass oscillator — T = 2π√(m/k)
// -----------------------------------------------------------------------------

describe("mechanisms — harmonic spring-mass oscillator (§4.3)", () => {
  it("oscillation period matches T = 2π√(m/k) within 1%", () => {
    const project = createDefaultProject("spring", "3D", { seedScene: false });
    project.world.fixedDt = 1 / 240;
    project.world.gravity = [0, 0, 0];

    const mass = createDefaultBody("box");
    mass.name = "Mass";
    mass.geometry = { box: { W: 0.3, H: 0.3, D: 0.3 } };
    mass.mass = { value: 2, mode: "total" };
    mass.linearDamping = 0;
    mass.angularDamping = 0;
    mass.initial = { ...mass.initial, position: [0.5, 0, 0] };
    project.bodies.push(mass);

    const spring = createDefaultForce("spring");
    spring.name = "Spring";
    spring.body = mass.id;
    spring.anchor = [0, 0, 0];
    spring.spring = { k: 50, restLength: 1, damping: 0, anchorB: "", anchorBPoint: [0, 0, 0] };
    spring.enabled = true;
    project.forces.push(spring);

    const engine = new PhysicsEngine(project, RAPIER);
    const body = engine.bodies[0]!;
    const dt = engine.dt;
    const total = Math.round(5 / dt);

    // Equilibrium at x = 1 (L₀ from the world anchor at the origin); start at
    // x = 0.5 → crossings of x = 1 with vx > 0 at T/4, T/4 + T, …
    const crossings: number[] = [];
    let prev = body.translation().x - 1;
    for (let i = 1; i <= total; i++) {
      engine.step();
      const t = body.translation();
      const v = body.linvel();
      const cur = t.x - 1;
      if (prev < 0 && cur >= 0 && v.x > 0 && crossings.length < 2) {
        const frac = prev / (prev - cur);
        crossings.push((i - frac) * dt);
      }
      prev = cur;
    }
    expect(crossings.length).toBeGreaterThanOrEqual(2);
    const TMeasured = crossings[1]! - crossings[0]!;
    const TTheory = 2 * Math.PI * Math.sqrt(2 / 50);
    expect(Math.abs(TMeasured - TTheory) / TTheory).toBeLessThan(0.01);
  });

  it("stiff springs emit the §4.3 stability warning at world init", () => {
    const project = createDefaultProject("stiff", "3D", { seedScene: false });
    project.world.gravity = [0, 0, 0];
    project.world.fixedDt = 1 / 60; // coarse dt makes the guard fire
    const mass = createDefaultBody("box");
    mass.mass = { value: 1, mode: "total" };
    mass.linearDamping = 0;
    mass.angularDamping = 0;
    project.bodies.push(mass);

    const spring = createDefaultForce("spring");
    spring.body = mass.id;
    spring.anchor = [0, 0, 0];
    spring.spring = { k: 5000, restLength: 1, damping: 0, anchorB: "", anchorBPoint: [1, 0, 0] };
    project.forces.push(spring);

    const warnings: string[] = [];
    resetExprWarnings();
    setExprWarningSink((m) => warnings.push(m));
    try {
      void new PhysicsEngine(project, RAPIER);
    } finally {
      setExprWarningSink(null);
    }
    expect(warnings.some((w) => w.includes("ω_eff·Δt") || w.includes("stiff"))).toBe(true);
  });
});

// -----------------------------------------------------------------------------
// 4. Massive chain catenary
// -----------------------------------------------------------------------------

function catenaryProject(): { project: MechProject; rope: RopeEntity } {
  const project = createDefaultProject("catenary", "3D", { seedScene: false });
  project.world.fixedDt = 1 / 240;
  project.world.gravity = [0, -G, 0];

  const rope = createDefaultRope("chain");
  rope.name = "Chain";
  rope.path = [
    { anchorId: "", point: [-1.5, 2, 0] },
    { anchorId: "", point: [0, 1.5, 0] },
    { anchorId: "", point: [1.5, 2, 0] },
  ];
  rope.chain = { mass: 1, segments: 30, stiffness: 1000, damping: 10 };
  rope.appearance = { color: "#e4e4e7", thickness: 0.02 };
  project.ropes.push(rope);
  return { project, rope };
}

describe("mechanisms — massive chain catenary (§2.1.2)", () => {
  it("a pinned chain settles into a stable sagging curve without NaN or explosion", () => {
    const { project, rope } = catenaryProject();
    const engine = new PhysicsEngine(project, RAPIER);
    const out = new Float32Array(engine.snapshotSize);
    const segCount = 30;

    // 8 s of settling.
    const settleSteps = Math.round(8 / engine.dt);
    for (let i = 0; i < settleSteps; i++) engine.step();

    engine.writeSnapshot(out);
    expect(out[SNAPSHOT_INDEX.COUNT]).toBe(segCount);
    for (let i = 0; i < out.length; i++) {
      expect(Number.isFinite(out[i]!)).toBe(true);
    }

    const segY = (i: number): number => {
      const o = SNAPSHOT_HEADER + i * SNAPSHOT_FLOATS_PER_BODY;
      return out[o + SNAPSHOT_INDEX.POS + 1] ?? NaN;
    };
    const segV = (i: number): number => {
      const o = SNAPSHOT_HEADER + i * SNAPSHOT_FLOATS_PER_BODY;
      const vx = out[o + SNAPSHOT_INDEX.LINVEL] ?? 0;
      const vy = out[o + SNAPSHOT_INDEX.LINVEL + 1] ?? 0;
      return Math.hypot(vx, vy);
    };

    // The chain (path length 3.16 m > 3 m span) sags below the pin line y = 2.
    const mid = segY(15);
    expect(mid).toBeGreaterThan(0.5);
    expect(mid).toBeLessThan(2 - 0.05);

    // Symmetry about x = 0.
    expect(Math.abs(segY(14) - segY(15))).toBeLessThan(0.02);
    expect(Math.abs(segY(5) - segY(24))).toBeLessThan(0.05);

    // Settled: segment speeds are small and the middle stays put.
    // A tiny residual wobble (≲ 0.08 m/s on a 1 kg chain) is acceptable —
    // "stable" is established by the mid-segment drift check below.
    const maxV = Math.max(...Array.from({ length: segCount }, (_, i) => segV(i)));
    expect(maxV).toBeLessThan(0.1);

    const midBefore = segY(15);
    for (let i = 0; i < Math.round(1 / engine.dt); i++) engine.step();
    engine.writeSnapshot(out);
    expect(Math.abs(segY(15) - midBefore)).toBeLessThan(0.005);

    void rope;
  });
});
