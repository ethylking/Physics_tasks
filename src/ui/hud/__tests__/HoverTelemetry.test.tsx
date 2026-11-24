// ui/hud/__tests__/HoverTelemetry.test.tsx — Milestone 4 HUD: the telemetry
// builder assembles every required physical quantity (mass, pos, vel, accel,
// omega, Ek, Ep, netForce) from a snapshot slice, and the HUD card renders the
// hovered body's values without a running worker.

import { beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import HoverTelemetry from "../HoverTelemetry";
import { buildBodyTelemetry, formatTelemetry, readBodySlice } from "../hudTelemetry";
import { useSceneStore } from "../../../stores/sceneStore";
import { createDefaultProject } from "../../../core/defaults";
import type { BodySnapshotSlice } from "../hudTelemetry";
import type { MechProject, RigidBodyEntity } from "../../../core/types";
import { SNAPSHOT_FLOATS_PER_BODY, SNAPSHOT_HEADER } from "../../../physics/snapshot";

function sphereProject(): { project: MechProject; body: RigidBodyEntity } {
  // seedScene default → the project comes with one box we morph into a sphere.
  const project = createDefaultProject("HUD Test", "3D");
  const body = project.bodies[0] as RigidBodyEntity;
  body.kind = "sphere";
  body.geometry = { sphere: { R: 0.5, shell: false } };
  body.mass = { value: 2, mode: "total" };
  body.name = "Probe";
  body.initial = { ...body.initial, position: [1, 2, 0] };
  return { project, body };
}

const SLICE: BodySnapshotSlice = {
  position: [1, 2, 0],
  rotation: [0, 0, 0, 1],
  velocity: [3, 4, 0],
  angularVelocity: [0, 0, 0],
  accel: [0, -9.81, 0],
  netForce: [0, -19.62, 0],
};

describe("hoverTelemetry — data building", () => {
  it("assembles every required physical quantity from a snapshot slice", () => {
    const { project, body } = sphereProject();
    const t = buildBodyTelemetry(body, project, SLICE);

    expect(t.name).toBe("Probe");
    expect(t.kind).toBe("sphere");
    expect(t.mass).toBe(2);
    expect(t.position).toEqual([1, 2, 0]);
    expect(t.velocity).toEqual([3, 4, 0]);
    expect(t.speed).toBeCloseTo(5, 9);
    expect(t.accel).toEqual([0, -9.81, 0]);
    expect(t.accelMagnitude).toBeCloseTo(9.81, 6);
    expect(t.angularVelocity).toEqual([0, 0, 0]);
    expect(t.angularSpeed).toBe(0);
    // Translational kinetic energy only (ω = 0).
    expect(t.Ek).toBeCloseTo(0.5 * 2 * 25, 9);
    // Ep = −m g·r_CM = 2 · 9.81 · 2 (matches the engine convention).
    expect(t.Ep).toBeCloseTo(2 * 9.81 * 2, 6);
    expect(t.netForce).toEqual([0, -19.62, 0]);
  });

  it("includes rotational kinetic energy about the principal axes", () => {
    const { project, body } = sphereProject();
    const t = buildBodyTelemetry(body, project, {
      ...SLICE,
      velocity: [0, 0, 0],
      angularVelocity: [0, 0, 2],
    });
    // I = (2/5)·m·R² = 0.2 kg·m² → E_rot = ½·I·ω² = 0.4 J.
    expect(t.Ek).toBeCloseTo(0.5 * 0.2 * 4, 9);
    expect(t.angularSpeed).toBeCloseTo(2, 9);
  });

  it("falls back to the entity's initial state without a snapshot", () => {
    const { project, body } = sphereProject();
    body.initial = { ...body.initial, velocity: [1, 0, 0] };
    const t = buildBodyTelemetry(body, project, null);
    expect(t.position).toEqual([1, 2, 0]);
    expect(t.velocity).toEqual([1, 0, 0]);
    expect(t.accel).toEqual([0, 0, 0]);
    expect(t.netForce).toEqual([0, 0, 0]);
  });

  it("formats one row per required quantity with stable labels", () => {
    const { project, body } = sphereProject();
    const rows = formatTelemetry(buildBodyTelemetry(body, project, SLICE));
    const labels = rows.map((r) => r.label);
    expect(labels).toEqual([
      "Mass m",
      "Position",
      "Velocity v⃗",
      "Speed |v|",
      "Acceleration a⃗",
      "|a|",
      "Angular velocity ω⃗",
      "|ω|",
      "Eₖ (kinetic)",
      "Eₚ (potential)",
      "Net force ΣF⃗",
    ]);
    expect(rows[0]!.value).toContain("kg");
    expect(rows[2]!.value).toContain("m/s");
    expect(rows[10]!.value).toContain("N");
  });

  it("reads a body slice from a Float32Array snapshot", () => {
    const snapshot = new Float32Array(SNAPSHOT_HEADER + 2 * SNAPSHOT_FLOATS_PER_BODY);
    const o = SNAPSHOT_HEADER + SNAPSHOT_FLOATS_PER_BODY;
    snapshot[o] = 7; // x
    snapshot[o + 8] = -2; // vy
    snapshot[o + 16] = 3; // netForce.x
    const slice = readBodySlice(snapshot, 1);
    expect(slice).not.toBeNull();
    expect(slice!.position).toEqual([7, 0, 0]);
    expect(slice!.velocity).toEqual([0, -2, 0]);
    expect(slice!.netForce).toEqual([3, 0, 0]);
    expect(readBodySlice(snapshot, 5)).toBeNull();
    expect(readBodySlice(null, 0)).toBeNull();
  });
});

describe("hoverTelemetry — HUD card", () => {
  beforeEach(() => {
    const { project, body } = sphereProject();
    useSceneStore.setState({
      project,
      initialSnapshot: JSON.parse(JSON.stringify(project)) as MechProject,
      selectedId: null,
      hoveredId: body.id,
      tool: null,
      transport: "stopped",
      gizmoMode: "translate",
      dirty: false,
      gravityZBefore2D: 0,
    });
  });

  it("renders the hovered body's card with all quantities", () => {
    render(<HoverTelemetry />);
    const card = screen.getByTestId("hover-telemetry");
    expect(card).toBeInTheDocument();
    expect(screen.getByText("Probe")).toBeInTheDocument();
    expect(screen.getByText("sphere")).toBeInTheDocument();
    for (const label of [
      "Mass m",
      "Position",
      "Velocity v⃗",
      "Speed |v|",
      "Acceleration a⃗",
      "Angular velocity ω⃗",
      "Eₖ (kinetic)",
      "Eₚ (potential)",
      "Net force ΣF⃗",
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getByText("2.000 kg")).toBeInTheDocument();
  });

  it("hides the card when nothing is hovered or selected", () => {
    useSceneStore.setState({ hoveredId: null, selectedId: null });
    render(<HoverTelemetry />);
    expect(screen.queryByTestId("hover-telemetry")).not.toBeInTheDocument();
  });
});
