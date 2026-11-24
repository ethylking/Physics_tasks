// ui/inspector/__tests__/Inspector.test.tsx — properties inspector UI tests:
// per-face friction inputs, live geometry editing, and the §2.3 CoM invariant
// (moving the CoM offset never moves the geometric mesh).

import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import Inspector from "../Inspector";
import { useSceneStore } from "../../../stores/sceneStore";
import { createDefaultProject } from "../../../core/defaults";
import type { MechProject, RigidBodyEntity } from "../../../core/types";

const FACE_LABELS = ["+X (right)", "-X (left)", "+Y (top)", "-Y (bottom)", "+Z (front)", "-Z (back)"];

function loadScene(project: MechProject, selectedId: string) {
  useSceneStore.setState({
    project,
    initialSnapshot: JSON.parse(JSON.stringify(project)) as MechProject,
    selectedId,
    hoveredId: null,
    tool: null,
    transport: "stopped",
    gizmoMode: "translate",
    dirty: false,
    gravityZBefore2D: 0,
  });
}

function selectedBox(): RigidBodyEntity {
  return useSceneStore.getState().project!.bodies[0] as RigidBodyEntity;
}

beforeEach(() => {
  const project = createDefaultProject("Inspector Test", "3D");
  loadScene(project, project.bodies[0]!.id);
});

describe("Inspector", () => {
  it("renders all six per-face friction inputs for a selected box", () => {
    render(<Inspector />);
    for (const label of FACE_LABELS) {
      expect(screen.getByLabelText(`${label} friction`)).toBeInTheDocument();
    }
  });

  it("does not render per-face friction for a non-box body", () => {
    const store = useSceneStore.getState();
    const id = store.spawnFromTool({ category: "bodies", kind: "sphere", label: "Sphere" }, [0, 0, 0], null);
    useSceneStore.getState().setSelected(id);
    render(<Inspector />);
    expect(screen.queryByLabelText("+X (right) friction")).not.toBeInTheDocument();
  });

  it("changing box dimensions updates the store geometry and marks the scene dirty", () => {
    render(<Inspector />);
    fireEvent.change(screen.getByLabelText("Width (W)"), { target: { value: "2.5" } });
    fireEvent.change(screen.getByLabelText("Height (H)"), { target: { value: "0.75" } });

    const body = selectedBox();
    expect(body.geometry.box?.W).toBe(2.5);
    expect(body.geometry.box?.H).toBe(0.75);
    expect(useSceneStore.getState().dirty).toBe(true);
  });

  it("editing per-face friction writes the faceFriction array", () => {
    render(<Inspector />);
    fireEvent.change(screen.getByLabelText("+X (right) friction"), { target: { value: "0.9" } });
    fireEvent.change(screen.getByLabelText("-Y (bottom) friction"), { target: { value: "0.2" } });

    const body = selectedBox();
    expect(body.faceFriction).toHaveLength(6);
    expect(body.faceFriction?.[0]).toBe(0.9);
    expect(body.faceFriction?.[3]).toBe(0.2);
  });

  it("shifting the CoM offset moves centerOfMass but leaves initial.position untouched", () => {
    const before = [...selectedBox().initial.position] as [number, number, number];
    render(<Inspector />);

    fireEvent.change(screen.getByLabelText("CoM offset dx"), { target: { value: "0.3" } });
    fireEvent.change(screen.getByLabelText("CoM offset dy"), { target: { value: "-0.2" } });

    const body = selectedBox();
    expect(body.centerOfMass[0]).toBe(0.3);
    expect(body.centerOfMass[1]).toBe(-0.2);
    // §2.3 UX invariant — geometry (initial.position) untouched
    expect(body.initial.position).toEqual(before);
  });

  it("editing name and mass updates the store", () => {
    render(<Inspector />);
    fireEvent.change(screen.getByLabelText("Entity name"), { target: { value: "Crate" } });
    fireEvent.change(screen.getByLabelText("Mass (kg)"), { target: { value: "12" } });

    const body = selectedBox();
    expect(body.name).toBe("Crate");
    expect(body.mass.value).toBe(12);
  });
});
