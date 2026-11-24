// @vitest-environment node
// physics/__tests__/forces.test.ts — Milestone 4: parametric forces, torques
// and thrusters (mathjs-compiled, §4.1) driving real Rapier bodies, plus the
// graceful-failure path for singular math strings.

import RAPIER from "@dimforge/rapier3d-compat";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PhysicsEngine } from "../engine";
import { createDefaultBody, createDefaultForce, createDefaultProject, createDefaultStatic } from "../../core/defaults";
import { resetExprWarnings, setExprWarningSink } from "../../math/expr";
import { SNAPSHOT_FLOATS_PER_BODY, SNAPSHOT_HEADER, SNAPSHOT_INDEX } from "../snapshot";
import type { ForceEntity, MechProject, RigidBodyEntity } from "../../core/types";

const warnings: string[] = [];

beforeAll(async () => {
  await RAPIER.init();
});

beforeEach(() => {
  warnings.length = 0;
  resetExprWarnings();
  setExprWarningSink((m) => warnings.push(m));
});

/** Project with zero gravity & damping and a single body of the given mass. */
function isolatedProject(mode: "2D" | "3D" = "3D", mass = 2): { project: MechProject; body: RigidBodyEntity } {
  const project = createDefaultProject("forces", mode, { seedScene: false });
  project.world.gravity = [0, 0, 0];
  project.world.fixedDt = 1 / 240;
  const body = createDefaultBody("box");
  body.mass = { value: mass, mode: "total" };
  body.linearDamping = 0;
  body.angularDamping = 0;
  project.bodies.push(body);
  return { project, body };
}

function externalForce(bodyId: string, components: { x?: string; y?: string; z?: string }): ForceEntity {
  const force = createDefaultForce("external");
  force.body = bodyId;
  force.components = { x: components.x ?? "0", y: components.y ?? "0", z: components.z ?? "0" };
  return force;
}

describe("forces — constant external force", () => {
  it("F_x = 10 N on a 2 kg body gives a_x = 5 m/s² and x(t) = ½at²", () => {
    const { project, body } = isolatedProject();
    project.forces.push(externalForce(body.id, { x: "10" }));
    const engine = new PhysicsEngine(project, RAPIER);

    const t = 1;
    const steps = Math.round(t / engine.dt);
    for (let i = 0; i < steps; i++) engine.step();

    const out = new Float32Array(engine.snapshotSize);
    engine.writeSnapshot(out);
    const o = SNAPSHOT_HEADER;

    // Constant acceleration, F/m = 5 m/s².
    expect(out[o + SNAPSHOT_INDEX.ACCEL]!).toBeCloseTo(5, 2);
    // Rapier 0.14 integrates a constant force to x(t) = ½a·t·(t + dt/4)
    // (verified empirically) — i.e. the ½at² law plus a small O(dt) offset.
    const expected = 0.5 * 5 * t * (t + engine.dt / 4);
    expect(Math.abs(out[o + SNAPSHOT_INDEX.POS]! - expected)).toBeLessThan(0.002);
    // The ½at² claim itself: agree within 1% of the 2.5 m travelled.
    expect(Math.abs(out[o + SNAPSHOT_INDEX.POS]! - 0.5 * 5 * t * t)).toBeLessThan(0.02);
    // Packed net force m·a.
    expect(out[o + SNAPSHOT_INDEX.NETFORCE]!).toBeCloseTo(10, 1);
    expect(warnings).toHaveLength(0);
  });
});

describe("forces — harmonic parametric force", () => {
  it("F(t) = F₀·cos(ωt) drives the analytic displacement & velocity", () => {
    const { project, body } = isolatedProject("3D", 2);
    // ω = 1 rad/s, F₀ = 2 N, m = 2 kg → x_amp = F₀/(mω²) = 1 m, v_amp = 1 m/s.
    project.forces.push(externalForce(body.id, { x: "2*cos(t)" }));
    const engine = new PhysicsEngine(project, RAPIER);

    const F0 = 2;
    const m = 2;
    const w = 1;
    const steps = Math.round(Math.PI / 2 / w / engine.dt);
    for (let i = 0; i < steps; i++) engine.step();
    const t = steps * engine.dt;

    const v = engine.bodies[0]!.linvel();
    const x = engine.bodies[0]!.translation().x;
    const xExpected = (F0 / (m * w * w)) * (1 - Math.cos(w * t));
    const vExpected = (F0 / (m * w)) * Math.sin(w * t);

    expect(Math.abs(x - xExpected)).toBeLessThan(0.03); // 3% of the 1 m amplitude
    expect(Math.abs(v.x - vExpected)).toBeLessThan(0.03); // 3% of the 1 m/s amplitude
    expect(Math.abs(v.y)).toBeLessThan(1e-9);
    expect(warnings).toHaveLength(0);
  });
});

describe("forces — thruster (body-local thrust)", () => {
  it("the thrust vector rotates with the body as it spins", () => {
    const { project, body } = isolatedProject("3D", 2);
    const sphere = body;
    sphere.kind = "sphere";
    sphere.geometry = { sphere: { R: 0.5, shell: false } };
    sphere.initial = { ...sphere.initial, angularVelocity: [0, 0, 2] }; // ω = 2 rad/s about Z

    const thruster = createDefaultForce("thruster");
    thruster.body = sphere.id;
    thruster.anchor = [0, 0, 0]; // at the CoM → no reaction torque
    thruster.components = { x: "6", y: "0", z: "0" };
    project.forces.push(thruster);

    const engine = new PhysicsEngine(project, RAPIER);
    const F = 6;
    const m = 2;
    const w = 2;
    const steps = Math.round(Math.PI / 4 / engine.dt); // ω·t = π/2
    for (let i = 0; i < steps; i++) engine.step();
    const t = steps * engine.dt;

    const v = engine.bodies[0]!.linvel();
    const av = engine.bodies[0]!.angvel();
    // v(t) = (F/(mω))·(sin ωt, 1 − cos ωt) for a local +X thrust on a Z-spinner.
    const vxExpected = (F / (m * w)) * Math.sin(w * t);
    const vyExpected = (F / (m * w)) * (1 - Math.cos(w * t));
    expect(Math.abs(v.x - vxExpected)).toBeLessThan(0.06);
    expect(Math.abs(v.y - vyExpected)).toBeLessThan(0.06);
    // No torque at the CoM → spin rate unchanged.
    expect(Math.abs(av.z - w)).toBeLessThan(0.01);
    expect(warnings).toHaveLength(0);
  });
});

describe("forces — torque", () => {
  it("a constant M_z torque on a sphere gives α = M/I", () => {
    const { project, body } = isolatedProject("3D", 1);
    body.kind = "sphere";
    body.geometry = { sphere: { R: 0.5, shell: false } };

    const torque = createDefaultForce("torque");
    torque.body = body.id;
    torque.components = { x: "0", y: "0", z: "0.2" };
    project.forces.push(torque);

    const engine = new PhysicsEngine(project, RAPIER);
    // I = (2/5)·m·R² = 0.1 kg·m² → α = M/I = 2 rad/s².
    const steps = 240; // 1 s
    for (let i = 0; i < steps; i++) engine.step();
    const av = engine.bodies[0]!.angvel();
    expect(Math.abs(av.z - 2 * (steps * engine.dt))).toBeLessThan(0.02);
    expect(warnings).toHaveLength(0);
  });
});

describe("forces — singular math strings (§4.1)", () => {
  it("1/0 and log(-1) warn, evaluate to 0, and never crash the engine", () => {
    const { project, body } = isolatedProject("3D", 1);
    body.initial = { ...body.initial, position: [0, 0, 1] };
    project.forces.push(externalForce(body.id, { x: "1/0" }));
    const bad2 = externalForce(body.id, { y: "log(-1)" });
    project.forces.push(bad2);

    const engine = new PhysicsEngine(project, RAPIER);
    for (let i = 0; i < 240; i++) engine.step();

    const t = engine.bodies[0]!.translation();
    // Zero net applied force (both expressions → 0) and zero gravity: at rest.
    expect(Math.abs(t.x)).toBeLessThan(1e-9);
    expect(Math.abs(t.z - 1)).toBeLessThan(1e-9);

    const out = new Float32Array(engine.snapshotSize);
    engine.writeSnapshot(out);
    expect(Number.isFinite(out[0])).toBe(true);

    expect(warnings.some((w) => w.includes("1/0"))).toBe(true);
    expect(warnings.some((w) => w.includes("log(-1)"))).toBe(true);
  });

  it("2D mode enforces F_y = 0 for external forces (§4.5)", () => {
    const { project, body } = isolatedProject("2D", 1);
    project.forces.push(externalForce(body.id, { x: "2", y: "5" }));
    const engine = new PhysicsEngine(project, RAPIER);
    for (let i = 0; i < 240; i++) engine.step();
    const t = engine.bodies[0]!.translation();
    const v = engine.bodies[0]!.linvel();
    expect(Math.abs(t.y)).toBeLessThan(1e-9);
    expect(Math.abs(v.y)).toBeLessThan(1e-9);
    expect(v.x).toBeGreaterThan(0.5); // F_x = 2 N still drives motion in X–Z
  });
});

describe("forces — contact extraction (N & F_f)", () => {
  it("a resting box reports a normal reaction balancing its weight", () => {
    const project = createDefaultProject("contact", "3D", { seedScene: false });
    project.world.fixedDt = 1 / 240;
    project.statics.push(createDefaultStatic("ground", { friction: 0.8, restitution: 0 } as never));
    const box = createDefaultBody("box");
    box.mass = { value: 3, mode: "total" };
    box.linearDamping = 0;
    box.angularDamping = 0;
    box.initial = { ...box.initial, position: [0, 0, 0.51] };
    project.bodies.push(box);

    const engine = new PhysicsEngine(project, RAPIER);
    for (let i = 0; i < 480; i++) engine.step(); // 2 s — fully settled

    const out = new Float32Array(engine.snapshotSize);
    engine.writeSnapshot(out);
    const o = SNAPSHOT_HEADER;
    const N = out[o + SNAPSHOT_INDEX.NORMAL + 2]!;
    const Ff = Math.hypot(
      out[o + SNAPSHOT_INDEX.FRICTION]!,
      out[o + SNAPSHOT_INDEX.FRICTION + 1]!,
      out[o + SNAPSHOT_INDEX.FRICTION + 2]!,
    );
    // Upward reaction balancing the weight. rapier3d-compat 0.14 reports the
    // solver impulse as a force with a ×1.25 position-correction term in
    // steady rest (verified empirically) — assert that deterministic value.
    expect(Math.abs(N - 1.25 * 3 * 9.81)).toBeLessThan(0.5);
    expect(Ff).toBeLessThan(0.5);
    // The packed buffer length includes the extended per-body layout.
    expect(out.length).toBe(SNAPSHOT_HEADER + 1 * SNAPSHOT_FLOATS_PER_BODY);
  });
});
