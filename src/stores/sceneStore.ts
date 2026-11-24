// stores/sceneStore.ts — authoritative EDIT-MODE scene state (Milestone 2).
//
// The scene store owns the working `MechProject` while the user places, moves,
// and edits entities. `projectStore` remains the persistence layer (Tauri FS,
// filenames, project list):
//
//   sceneStore ──commitToProjectStore()──▶ projectStore.currentProject
//   projectStore.currentProject (new object) ──subscription──▶ sceneStore reload
//
// Simulation (Milestone 3) will freeze this store and read it once per run;
// per-frame telemetry will flow through a separate transient store (§5.2).

import { create } from "zustand";
import type {
  ForceEntity,
  JointEntity,
  MechProject,
  MeterEntity,
  ProjectMode,
  Quat,
  RigidBodyEntity,
  RopeEntity,
  StaticEntity,
  Tier1BodyKind,
  Tier1ForceKind,
  Tier1JointKind,
  Vec3,
} from "../core/types";
import {
  applyModeLocks,
  createDefaultBody,
  createDefaultForce,
  createDefaultJoint,
  createDefaultMeter,
  createDefaultRope,
  createDefaultStatic,
  halfHeightOf,
} from "../core/defaults";
import { eulerDegToQuat, quatToEulerDeg, worldToLocal } from "../math/rotation";
import type { SnapPoint } from "../render/gizmos/snapping";
import { useProjectStore } from "./projectStore";

export type EntityCategory = "bodies" | "statics" | "joints" | "forces" | "ropes" | "meters";

export type SceneEntity =
  | RigidBodyEntity
  | StaticEntity
  | JointEntity
  | ForceEntity
  | RopeEntity
  | MeterEntity;

export const ENTITY_CATEGORIES: EntityCategory[] = [
  "bodies",
  "statics",
  "joints",
  "forces",
  "ropes",
  "meters",
];

/** A tool selected in the Spawn Palette. */
export interface SpawnTool {
  category: EntityCategory;
  kind: string;
  label: string;
}

export type TransportStatus = "stopped" | "playing" | "paused";
export type GizmoMode = "translate" | "rotate";

export interface EntityRef {
  category: EntityCategory;
  entity: SceneEntity;
  index: number;
}

/** Locate an entity by id across all categories. */
export function findEntityInProject(project: MechProject | null, id: string | null | undefined): EntityRef | null {
  if (!project || !id) return null;
  for (const category of ENTITY_CATEGORIES) {
    const arr = project[category] as unknown as SceneEntity[];
    const index = arr.findIndex((e) => e.id === id);
    if (index >= 0) {
      const entity = arr[index];
      if (entity) return { category, entity, index };
    }
  }
  return null;
}

function cloneProject(project: MechProject): MechProject {
  return JSON.parse(JSON.stringify(project)) as MechProject;
}

function nextEntityName(project: MechProject, category: EntityCategory, fallback: string): string {
  const base = fallback.charAt(0).toUpperCase() + fallback.slice(1);
  const names = new Set(
    (project[category] as unknown as SceneEntity[]).map((e) => e.name),
  );
  let i = 1;
  while (names.has(`${base} ${i}`)) i += 1;
  return `${base} ${i}`;
}

interface SceneState {
  /** Authoritative working project (mirrors projectStore.currentProject). */
  project: MechProject | null;
  /** Snapshot captured at load time; Reset restores it. */
  initialSnapshot: MechProject | null;
  selectedId: string | null;
  hoveredId: string | null;
  tool: SpawnTool | null;
  transport: TransportStatus;
  gizmoMode: GizmoMode;
  dirty: boolean;
  /** Z gravity before switching to 2D, restored when returning to 3D. */
  gravityZBefore2D: number;

  loadFromProject: (project: MechProject) => void;
  resetToInitial: () => void;
  toProject: () => MechProject | null;
  commitToProjectStore: () => void;

  setSelected: (id: string | null) => void;
  setHovered: (id: string | null) => void;
  setTool: (tool: SpawnTool | null) => void;
  setTransport: (status: TransportStatus) => void;
  setGizmoMode: (mode: GizmoMode) => void;
  setDirty: (dirty: boolean) => void;

  setMode: (mode: ProjectMode) => void;
  setGravity: (axis: 0 | 1 | 2, value: number) => void;

  addEntity: (category: EntityCategory, entity: SceneEntity) => void;
  /** Shallow-merge a patch into the entity (nested objects replace). */
  updateEntity: <T extends SceneEntity = SceneEntity>(id: string, patch: Partial<T>) => void;
  deleteEntity: (id: string) => void;
  /** Write a live gizmo transform back into the store (2D clamps applied). */
  writeTransform: (id: string, position: Vec3, rotation: Quat) => void;
  /** Build + place a default entity from a palette tool at a surface point. */
  spawnFromTool: (tool: SpawnTool, surfacePoint: Vec3, snap: SnapPoint | null) => string | null;
}

export const useSceneStore = create<SceneState>()((set, get) => ({
  project: null,
  initialSnapshot: null,
  selectedId: null,
  hoveredId: null,
  tool: null,
  transport: "stopped",
  gizmoMode: "translate",
  dirty: false,
  gravityZBefore2D: 0,

  loadFromProject: (project) => {
    const prevSelected = get().selectedId;
    const stillExists = findEntityInProject(project, prevSelected);
    set({
      project,
      initialSnapshot: cloneProject(project),
      dirty: false,
      selectedId: stillExists ? prevSelected : null,
      hoveredId: null,
    });
  },

  resetToInitial: () => {
    const snapshot = get().initialSnapshot;
    if (!snapshot) return;
    const restored = cloneProject(snapshot);
    const selected = get().selectedId;
    set({
      project: restored,
      dirty: false,
      transport: "stopped",
      hoveredId: null,
      tool: null,
      selectedId: selected && findEntityInProject(restored, selected) ? selected : null,
    });
  },

  toProject: () => get().project,

  commitToProjectStore: () => {
    const project = get().project;
    if (!project) return;
    useProjectStore.getState().replaceCurrentProject(project);
  },

  setSelected: (id) => set({ selectedId: id }),
  setHovered: (id) => set({ hoveredId: id }),
  setTool: (tool) => set({ tool }),
  setTransport: (status) => set({ transport: status }),
  setGizmoMode: (mode) => set({ gizmoMode: mode }),
  setDirty: (dirty) => set({ dirty }),

  setMode: (mode) => {
    const project = get().project;
    if (!project || project.meta.mode === mode) return;
    const world = { ...project.world };
    if (mode === "2D") {
      set({ gravityZBefore2D: world.gravity[2] });
      world.gravity = [world.gravity[0], world.gravity[1], 0];
    } else {
      world.gravity = [world.gravity[0], world.gravity[1], get().gravityZBefore2D];
    }
    // §4.5 — 2D-in-3D locking on entry, free motion restored on exit.
    const locks2d = {
      translate: [false, false, true] as [boolean, boolean, boolean],
      rotate: [true, true, false] as [boolean, boolean, boolean],
    };
    const locksFree = {
      translate: [false, false, false] as [boolean, boolean, boolean],
      rotate: [false, false, false] as [boolean, boolean, boolean],
    };
    const bodies = project.bodies.map((b) => ({ ...b, locks: mode === "2D" ? locks2d : locksFree }));
    set({
      project: { ...project, meta: { ...project.meta, mode }, world, bodies },
      dirty: true,
    });
  },

  setGravity: (axis, value) => {
    const project = get().project;
    if (!project || !Number.isFinite(value)) return;
    const gravity = [...project.world.gravity] as Vec3;
    gravity[axis] = value;
    set({ project: { ...project, world: { ...project.world, gravity } }, dirty: true });
  },

  addEntity: (category, entity) => {
    const project = get().project;
    if (!project) return;
    const arr = [...(project[category] as unknown as SceneEntity[]), entity];
    set({
      project: { ...project, [category]: arr } as MechProject,
      dirty: true,
      selectedId: entity.id,
    });
  },

  updateEntity: (id, patch) => {
    const project = get().project;
    const found = findEntityInProject(project, id);
    if (!found || !project) return;
    const updated = { ...found.entity, ...patch } as SceneEntity;
    const arr = [...(project[found.category] as unknown as SceneEntity[])];
    arr[found.index] = updated;
    set({ project: { ...project, [found.category]: arr } as MechProject, dirty: true });
  },

  deleteEntity: (id) => {
    const project = get().project;
    const found = findEntityInProject(project, id);
    if (!found || !project) return;
    const arr = (project[found.category] as unknown as SceneEntity[]).filter((e) => e.id !== id);
    set({
      project: { ...project, [found.category]: arr } as MechProject,
      dirty: true,
      selectedId: get().selectedId === id ? null : get().selectedId,
      hoveredId: get().hoveredId === id ? null : get().hoveredId,
    });
  },

  writeTransform: (id, position, rotation) => {
    const project = get().project;
    const found = findEntityInProject(project, id);
    if (!found || !project || found.category !== "bodies") return;
    const body = found.entity as RigidBodyEntity;
    let pos: Vec3 = position;
    let rot: Quat = rotation;
    if (project.meta.mode === "2D") {
      // §4.5 — keep 2D bodies locked to the XY plane and to Z-rotation.
      pos = [position[0], position[1], 0];
      const deg = quatToEulerDeg(rotation);
      rot = eulerDegToQuat([0, 0, deg[2]]);
    }
    const updated = { ...body, initial: { ...body.initial, position: pos, rotation: rot } };
    const arr = [...(project.bodies as RigidBodyEntity[])];
    arr[found.index] = updated;
    set({ project: { ...project, bodies: arr }, dirty: true });
  },

  spawnFromTool: (tool, surfacePoint, snap) => {
    const state = get();
    const project = state.project;
    if (!project) return null;
    const mode = project.meta.mode;
    const owner = snap ? (project.bodies.find((b) => b.id === snap.ownerId) ?? null) : null;

    let entity: SceneEntity;
    switch (tool.category) {
      case "bodies": {
        if (tool.kind === "pulley") {
          // A pulley is a rigid body (Milestone 5 adds the revolute joint + I).
          const pulley = createDefaultBody("cylinder");
          pulley.name = "Pulley";
          pulley.geometry = { cylinder: { R: 0.5, H: 0.08, hollow: false } };
          pulley.appearance = { color: "#f59e0b", opacity: 1 };
          entity = pulley;
        } else {
          entity = createDefaultBody(tool.kind as Tier1BodyKind);
        }
        break;
      }
      case "statics":
        entity = createDefaultStatic(tool.kind === "ground" ? "ground" : "wall");
        break;
      case "joints":
        entity = createDefaultJoint(tool.kind as Tier1JointKind);
        break;
      case "forces":
        entity = createDefaultForce(tool.kind as Tier1ForceKind);
        break;
      case "ropes":
        entity = createDefaultRope();
        break;
      case "meters":
        entity = createDefaultMeter("telemetry");
        break;
      default:
        return null;
    }

    entity.name = nextEntityName(project, tool.category, entity.name);

    if (tool.category === "bodies") {
      const body = entity as RigidBodyEntity;
      const base = snap ? snap.point : surfacePoint;
      const half = halfHeightOf(body.kind);
      body.initial = {
        ...body.initial,
        position: [base[0], base[1] + half, mode === "2D" ? 0 : base[2]],
      };
      applyModeLocks([body], mode);
    } else if (tool.category !== "statics") {
      attachConnector(entity, tool.category, surfacePoint, snap, owner, mode);
    }

    const arr = [...(project[tool.category] as unknown as SceneEntity[]), entity];
    set({
      project: { ...project, [tool.category]: arr } as MechProject,
      dirty: true,
      selectedId: entity.id,
    });
    return entity.id;
  },
}));

/**
 * Fill connector-specific fields from a placement point / snapped anchor.
 * Anchors are stored in the OWNER's local frame when snapped (Rapier expects
 * per-body local anchors); free placement stores world coordinates.
 */
function attachConnector(
  entity: SceneEntity,
  category: EntityCategory,
  surfacePoint: Vec3,
  snap: SnapPoint | null,
  owner: RigidBodyEntity | null,
  mode: ProjectMode,
): void {
  const point = snap ? snap.point : surfacePoint;
  let local = owner ? worldToLocal(point, owner.initial.position, owner.initial.rotation) : point;
  if (mode === "2D") local = [local[0], local[1], 0];

  switch (category) {
    case "joints": {
      const joint = entity as JointEntity;
      joint.bodyA = owner ? owner.id : null;
      joint.bodyB = null;
      joint.anchors = { a: local, b: local };
      break;
    }
    case "forces": {
      const force = entity as ForceEntity;
      if (force.kind === "spring" && force.spring) {
        force.spring = { ...force.spring, anchorB: owner ? owner.id : "", anchorBPoint: local };
        force.anchor = local;
      } else {
        force.body = owner ? owner.id : null;
        force.anchor = local;
      }
      break;
    }
    case "ropes": {
      const rope = entity as RopeEntity;
      rope.path = [{ anchorId: owner ? owner.id : "", point: local }];
      break;
    }
    default:
      break;
  }
}

// -----------------------------------------------------------------------------
// Sync: whenever the persistence layer adopts a NEW project object (project
// load, JSON editor apply, fresh create), the scene store mirrors it. Commits
// in the other direction reuse the same object reference and are skipped.
// -----------------------------------------------------------------------------

useProjectStore.subscribe((state, prev) => {
  const project = state.currentProject;
  if (project && project !== prev.currentProject) {
    const scene = useSceneStore.getState();
    if (scene.project !== project) {
      scene.loadFromProject(project);
    }
  }
});
