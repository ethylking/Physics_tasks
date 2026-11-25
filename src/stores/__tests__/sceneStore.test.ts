// stores/__tests__/sceneStore.test.ts — scene store mutations, mode locking,
// connector attachment, and persistence round-trips.

import { beforeEach, describe, expect, it } from "vitest";
import { useSceneStore } from "../sceneStore";
import { useProjectStore } from "../projectStore";
import { createDefaultProject, createDefaultStatic } from "../../core/defaults";
import { computeBodySnapPoints } from "../../render/gizmos/snapping";
import { staticBaseQuat } from "../../render/entities/positions";
import { eulerDegToQuat, quatMultiply, quatToEulerDeg } from "../../math/rotation";
import type { JointEntity, MechProject, Quat } from "../../core/types";

function resetStores() {
  useProjectStore.setState({
    projects: [],
    listLoaded: false,
    busy: false,
    error: null,
    currentProject: null,
    currentFilename: null,
    dirty: false,
    diagnostics: [],
  });
  useSceneStore.setState({
    project: null,
    initialSnapshot: null,
    selectedId: null,
    hoveredId: null,
    tool: null,
    axisArrowsId: null,
    transport: "stopped",
    gizmoMode: "translate",
    dirty: false,
    gravityYBefore2D: 0,
  });
}

beforeEach(resetStores);

describe("sceneStore — load & persistence", () => {
  it("loadFromProject clears dirty and keeps a valid selection", () => {
    const project = createDefaultProject("Scene", "3D");
    const boxId = project.bodies[0]?.id;
    useSceneStore.setState({ selectedId: boxId ?? null, dirty: true });

    useSceneStore.getState().loadFromProject(project);

    const state = useSceneStore.getState();
    expect(state.project).toBe(project);
    expect(state.dirty).toBe(false);
    expect(state.selectedId).toBe(boxId);
    expect(state.initialSnapshot).not.toBeNull();
  });

  it("mirrors a new project adopted by the persistence layer", () => {
    const project = createDefaultProject("Mirror", "3D");
    useProjectStore.setState({ currentProject: project });
    expect(useSceneStore.getState().project).toBe(project);
  });

  it("commitToProjectStore pushes the scene into the persistence layer", () => {
    const project = createDefaultProject("Commit", "3D");
    useSceneStore.getState().loadFromProject(project);
    useSceneStore.getState().commitToProjectStore();
    expect(useProjectStore.getState().currentProject).toBe(project);
    expect(useProjectStore.getState().dirty).toBe(true);
  });

  it("toProject round-trips through JSON serialization", () => {
    const project = createDefaultProject("Roundtrip", "3D");
    useSceneStore.getState().loadFromProject(project);
    const json = JSON.stringify(useSceneStore.getState().toProject());
    const parsed = JSON.parse(json) as MechProject;
    expect(parsed.schemaVersion).toBe(2);
    expect(parsed.bodies.length).toBe(project.bodies.length);
    expect(parsed.world.gravity).toEqual([0, 0, -9.81]);
  });

  it("resetToInitial restores the loaded snapshot and stops transport", () => {
    const project = createDefaultProject("Reset", "3D");
    useSceneStore.getState().loadFromProject(project);
    const original = useSceneStore.getState().project?.bodies[0]?.initial.position[0];

    useSceneStore.getState().updateEntity(project.bodies[0]!.id, {
      initial: { ...project.bodies[0]!.initial, position: [99, 99, 99] },
    });
    useSceneStore.getState().setTransport("playing");
    expect(useSceneStore.getState().dirty).toBe(true);

    useSceneStore.getState().resetToInitial();

    const state = useSceneStore.getState();
    expect(state.dirty).toBe(false);
    expect(state.transport).toBe("stopped");
    expect(state.project?.bodies[0]?.initial.position[0]).toBe(original);
  });
});

describe("sceneStore — entity mutations", () => {
  it("addEntity / updateEntity / deleteEntity mutate the project and mark dirty", () => {
    const project = createDefaultProject("Mutations", "3D");
    useSceneStore.getState().loadFromProject(project);
    const store = useSceneStore.getState();
    const boxId = project.bodies[0]!.id;

    store.updateEntity(boxId, { friction: 0.9 });
    expect(useSceneStore.getState().project?.bodies[0]?.friction).toBe(0.9);
    expect(useSceneStore.getState().dirty).toBe(true);

    store.deleteEntity(boxId);
    expect(useSceneStore.getState().project?.bodies).toHaveLength(0);
    expect(useSceneStore.getState().selectedId).toBeNull();
  });

  it("spawnFromTool names bodies sequentially and selects the new entity", () => {
    const project = createDefaultProject("Naming", "3D"); // seeds "Box 1"
    useSceneStore.getState().loadFromProject(project);

    const id = useSceneStore.getState().spawnFromTool(
      { category: "bodies", kind: "box", label: "Box" },
      [0, 0, 0],
      null,
    );
    expect(id).toBeTruthy();
    const bodies = useSceneStore.getState().project?.bodies ?? [];
    expect(bodies).toHaveLength(2);
    expect(bodies[1]?.name).toBe("Box 2");
    expect(useSceneStore.getState().selectedId).toBe(id);
    expect(useSceneStore.getState().dirty).toBe(true);
  });

  it("spawnFromTool lifts bodies so they rest on the placement surface", () => {
    const project = createDefaultProject("Lift", "3D");
    useSceneStore.getState().loadFromProject(project);

    const id = useSceneStore.getState().spawnFromTool(
      { category: "bodies", kind: "sphere", label: "Sphere" },
      [1, 0, 0],
      null,
    );
    const sphere = useSceneStore.getState().project?.bodies.find((b) => b.id === id);
    expect(sphere?.initial.position).toEqual([1, 0, 0.5]);
  });

  it("spawnFromTool lifts a pulley by its ACTUAL thin-disk half-height", () => {
    const project = createDefaultProject("Pulley lift", "3D");
    useSceneStore.getState().loadFromProject(project);

    const id = useSceneStore.getState().spawnFromTool(
      { category: "bodies", kind: "pulley", label: "Pulley" },
      [2.5, -1, 0],
      null,
    );
    const pulley = useSceneStore.getState().project?.bodies.find((b) => b.id === id);
    expect(pulley?.kind).toBe("cylinder");
    expect(pulley?.initial.position[0]).toBe(2.5);
    expect(pulley?.initial.position[1]).toBe(-1);
    // H = 0.08 → rests on the placement plane, not the default cylinder H/2 = 0.5.
    expect(pulley?.initial.position[2]).toBeCloseTo(0.04, 6);
  });

  it("spawnFromTool places statics at the placement point (not the origin)", () => {
    const project = createDefaultProject("Static place", "3D");
    useSceneStore.getState().loadFromProject(project);

    const id = useSceneStore.getState().spawnFromTool(
      { category: "statics", kind: "wall", label: "Wall" },
      [3.2, 4.1, 0],
      null,
    );
    const wall = useSceneStore.getState().project?.statics.find((s) => s.id === id);
    expect(wall?.position).toEqual([3.2, 4.1, 0]);

    // Ground follows the click point too (its height = placement z).
    const groundId = useSceneStore.getState().spawnFromTool(
      { category: "statics", kind: "ground", label: "Ground" },
      [1, 2, 0.25],
      null,
    );
    const ground = useSceneStore.getState().project?.statics.find((s) => s.id === groundId);
    expect(ground?.position).toEqual([1, 2, 0.25]);
  });

  it("spawnFromTool gives 2D walls an in-plane normal while 3D walls stay vertical", () => {
    const project2d = createDefaultProject("2D wall", "2D");
    useSceneStore.getState().loadFromProject(project2d);
    const wall2dId = useSceneStore.getState().spawnFromTool(
      { category: "statics", kind: "wall", label: "Wall" },
      [1, 0, 2],
      null,
    );
    const wall2d = useSceneStore.getState().project?.statics.find((s) => s.id === wall2dId);
    // A 2D wall is a vertical LINE in the X–Z workspace: +Y would degenerate.
    expect(wall2d?.plane.normal).toEqual([1, 0, 0]);

    const project3d = createDefaultProject("3D wall", "3D");
    useSceneStore.getState().loadFromProject(project3d);
    const wall3dId = useSceneStore.getState().spawnFromTool(
      { category: "statics", kind: "wall", label: "Wall" },
      [1, 2, 3],
      null,
    );
    const wall3d = useSceneStore.getState().project?.statics.find((s) => s.id === wall3dId);
    // 3D walls keep the new vertical default (normal ±Y, spanning X–Z).
    expect(wall3d?.plane.normal).toEqual([0, 1, 0]);
  });

  it("writeTransform stores a static's position and base-relative rotation", () => {
    const project = createDefaultProject("Static rot", "3D");
    useSceneStore.getState().loadFromProject(project);
    const ground = project.statics[0]!;
    // Ground base orientation is identity (normal +Z), so the stored rotation
    // equals the incoming world rotation.
    useSceneStore.getState().updateEntity(ground.id, {
      plane: { normal: [0, 0, 1], extent: [20, 20] },
    });
    useSceneStore.getState().writeTransform(ground.id, [2, 3, 4], eulerDegToQuat([0, 30, 0]));
    const updatedGround = useSceneStore.getState().project?.statics.find((s) => s.id === ground.id);
    expect(updatedGround?.name).toBe("Horizontal plane");
    expect(updatedGround?.position).toEqual([2, 3, 4]);
    expect(quatToEulerDeg(updatedGround?.rotation ?? [0, 0, 0, 1])[1]).toBeCloseTo(30, 5);
  });

  it("writeTransform stores wall rotation relative to the wall's own base orientation", () => {
    const project = createDefaultProject("Wall rot", "3D");
    useSceneStore.getState().loadFromProject(project);
    // The default wall normal is now [0,1,0] (vertical, spanning X–Z).
    const wall = createDefaultStatic("wall");
    useSceneStore.getState().addEntity("statics", wall);
    expect(wall.name).toBe("Wall");
    expect(wall.plane.normal).toEqual([0, 1, 0]);

    // Rotating the wall 90° about X from its initial orientation ⇒ the
    // stored rotation is 90° about X RELATIVE to the wall's base frame.
    const baseQuat = staticBaseQuat(wall.plane.normal);
    const worldAfterX90 = quatMultiply(baseQuat, eulerDegToQuat([90, 0, 0]));
    useSceneStore.getState().writeTransform(wall.id, [1, 2, 3], worldAfterX90);
    const rotatedWall = useSceneStore.getState().project?.statics.find((s) => s.id === wall.id);
    expect(rotatedWall?.position).toEqual([1, 2, 3]);
    const relEuler = quatToEulerDeg(rotatedWall?.rotation ?? [0, 0, 0, 1]);
    expect(relEuler[0]).toBeCloseTo(90, 5);

    // Round-trip: base ∘ rel must reproduce the gizmo's world quaternion for
    // an arbitrary raw world rotation (pins the writeTransform decomposition).
    const rawWorld = eulerDegToQuat([90, 0, 0]);
    useSceneStore.getState().writeTransform(wall.id, [1, 2, 3], rawWorld);
    const rawWall = useSceneStore.getState().project?.statics.find((s) => s.id === wall.id);
    const rawRel = rawWall?.rotation ?? [0, 0, 0, 1];
    const back = quatMultiply(baseQuat, rawRel);
    const dot = Math.abs(
      back[0] * rawWorld[0] + back[1] * rawWorld[1] + back[2] * rawWorld[2] + back[3] * rawWorld[3],
    );
    expect(dot).toBeCloseTo(1, 5);
  });

  it("shows the post-creation axis arrows only for the freshly spawned entity", () => {
    const project = createDefaultProject("Arrows", "3D");
    useSceneStore.getState().loadFromProject(project);
    const store = useSceneStore.getState();
    const otherId = project.bodies[0]!.id;

    const boxId = store.spawnFromTool(
      { category: "bodies", kind: "box", label: "Box" },
      [1, 0, 0],
      null,
    );
    expect(useSceneStore.getState().axisArrowsId).toBe(boxId);

    // Re-selecting the same entity keeps the arrows.
    useSceneStore.getState().setSelected(boxId);
    expect(useSceneStore.getState().axisArrowsId).toBe(boxId);

    // Selecting another entity MOVES the arrows to that entity (bug fix).
    useSceneStore.getState().setSelected(otherId);
    expect(useSceneStore.getState().axisArrowsId).toBe(otherId);

    // Deselecting clears the arrows.
    useSceneStore.getState().setSelected(null);
    expect(useSceneStore.getState().axisArrowsId).toBeNull();

    // Spawning again moves the arrows to the new entity…
    const sphereId = useSceneStore.getState().spawnFromTool(
      { category: "bodies", kind: "sphere", label: "Sphere" },
      [1, 0, 0],
      null,
    );
    expect(useSceneStore.getState().axisArrowsId).toBe(sphereId);

    // …picking a palette tool dismisses them…
    useSceneStore.getState().setTool({ category: "bodies", kind: "rod", label: "Rod" });
    expect(useSceneStore.getState().axisArrowsId).toBeNull();

    // …and deleting the entity dismisses them.
    useSceneStore.getState().spawnFromTool(
      { category: "bodies", kind: "box", label: "Box" },
      [1, 0, 0],
      null,
    );
    const freshId = useSceneStore.getState().axisArrowsId;
    expect(freshId).toBeTruthy();
    useSceneStore.getState().deleteEntity(freshId!);
    expect(useSceneStore.getState().axisArrowsId).toBeNull();
  });

  it("attaches connectors to the snapped body with LOCAL anchors", () => {
    const project = createDefaultProject("Attach", "3D");
    useSceneStore.getState().loadFromProject(project);
    const body = project.bodies[0]!;
    body.initial.position = [2, 1, 0];

    const snap = computeBodySnapPoints(body).find((p) => p.kind === "face" && p.label === "+X face");
    expect(snap).toBeDefined();

    const jointId = useSceneStore.getState().spawnFromTool(
      { category: "joints", kind: "revolute", label: "Revolute" },
      snap?.point ?? [0, 0, 0],
      snap ?? null,
    );
    const joint = useSceneStore.getState().project?.joints.find((j) => j.id === jointId) as JointEntity;
    expect(joint.bodyA).toBe(body.id);
    // world snap point (2.5, 1, 0) → body-local (0.5, 0, 0)
    expect(joint.anchors.a[0]).toBeCloseTo(0.5, 6);
    expect(joint.anchors.a[1]).toBeCloseTo(0, 6);
  });

  it("keeps free-floating connector anchors in world coordinates", () => {
    const project = createDefaultProject("Free", "3D");
    useSceneStore.getState().loadFromProject(project);

    const jointId = useSceneStore.getState().spawnFromTool(
      { category: "joints", kind: "revolute", label: "Revolute" },
      [1.5, 2, 3],
      null,
    );
    const joint = useSceneStore.getState().project?.joints.find((j) => j.id === jointId) as JointEntity;
    expect(joint.bodyA).toBeNull();
    expect(joint.anchors.a).toEqual([1.5, 2, 3]);
  });
});

describe("sceneStore — mode & gravity", () => {
  it("setMode(2D) locks bodies to the X–Z plane and zeroes gravity y; setMode(3D) restores", () => {
    const project = createDefaultProject("Mode", "3D");
    useSceneStore.getState().loadFromProject(project);
    useSceneStore.getState().setGravity(1, 5); // gy = 5 in 3D
    const gz3d = useSceneStore.getState().project?.world.gravity[2];

    useSceneStore.getState().setMode("2D");
    let state = useSceneStore.getState();
    expect(state.project?.meta.mode).toBe("2D");
    expect(state.project?.world.gravity[1]).toBe(0);
    expect(state.project?.world.gravity[2]).toBe(gz3d); // gravity stays down (-Z)
    for (const b of state.project?.bodies ?? []) {
      expect(b.locks.translate).toEqual([false, true, false]);
      expect(b.locks.rotate).toEqual([true, false, true]);
    }

    useSceneStore.getState().setMode("3D");
    state = useSceneStore.getState();
    expect(state.project?.world.gravity[1]).toBe(5);
    for (const b of state.project?.bodies ?? []) {
      expect(b.locks.translate).toEqual([false, false, false]);
      expect(b.locks.rotate).toEqual([false, false, false]);
    }
  });

  it("writeTransform clamps position and rotation to the 2D X–Z plane", () => {
    const project = createDefaultProject("2D write", "2D");
    useSceneStore.getState().loadFromProject(project);
    const boxId = project.bodies[0]!.id;

    useSceneStore.getState().writeTransform(boxId, [1.2, 3.4, 7], [0.1, 0.2, 0.7, 0.5] as Quat);
    const body = useSceneStore.getState().project?.bodies.find((b) => b.id === boxId);
    expect(body?.initial.position).toEqual([1.2, 0, 7]);
    // only a Y rotation may survive
    const [qx, qy, qz] = body?.initial.rotation ?? [0, 0, 0];
    expect(qx).toBeCloseTo(0, 6);
    expect(qz).toBeCloseTo(0, 6);
    expect(Math.abs(qy)).toBeGreaterThan(0.01);
  });
});
