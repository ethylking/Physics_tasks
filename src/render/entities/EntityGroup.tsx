// render/entities/EntityGroup.tsx — root group for a transformable entity.
//
// Registers the live Object3D in the entity registry (for the transform gizmo)
// and wires selection / hover events plus direct body drag & drop. Highlight
// styling is computed in the entity components via `useHighlight`.
//
// Pose ownership: while `simulated` (playing, or a stepped frame) the worker
// snapshot drives the transforms; otherwise the EDIT state owns them, so these
// declarative props — and the drag below — are authoritative.

import { Children, cloneElement, isValidElement, useEffect, useMemo, useRef } from "react";
import type { ReactElement, ReactNode } from "react";
import * as THREE from "three";
import { useThree } from "@react-three/fiber";
import type { ThreeEvent } from "@react-three/fiber";
import type { Quat, RigidBodyEntity, StaticEntity, Vec3 } from "../../core/types";
import { findEntityInProject, useSceneStore } from "../../stores/sceneStore";
import { useTelemetryStore } from "../../stores/telemetryStore";
import { entityObjectRegistry } from "../registry";
import { gizmoHandleAxis } from "../gizmos/gizmoHandleAxis";
import { pointerOnPlane } from "../gizmos/pointerPlane";
import { entityWorldPosition, staticWorldQuat } from "./positions";

interface EntityGroupProps {
  id: string;
  position: Vec3;
  rotation: Quat;
  selectable?: boolean;
  children: ReactNode;
}

/** Live state of a direct body drag (absolute positions, no store reads). */
interface EntityDrag {
  /** Plane the cursor is projected onto, through the anchor. */
  plane: THREE.Plane;
  /** Cursor world point grabbed on pointerdown (delta origin). */
  startHit: THREE.Vector3;
  /** Edit-time world anchor at grab time (delta base). */
  anchor: Vec3;
  /** Orientation to preserve while translating. */
  rotation: Quat;
  /** 2D projects drag in the vertical X–Z workspace. */
  is2d: boolean;
}

export function EntityGroup({ id, position, rotation, selectable = true, children }: EntityGroupProps) {
  const ref = useRef<THREE.Group>(null);
  const hoveredId = useSceneStore((s) => s.hoveredId);
  const setSelected = useSceneStore((s) => s.setSelected);
  const setHovered = useSceneStore((s) => s.setHovered);
  const writeTransform = useSceneStore((s) => s.writeTransform);
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  // `makeDefault` cameras (OrbitControls / MapControls) register here; a body
  // drag must not also pan the camera.
  const defaultControls = useThree((s) => s.controls) as unknown as { enabled: boolean } | null;

  // While a simulation is showing frames the worker snapshot owns the
  // transforms — React must not re-apply the edit-time position/rotation props
  // (e.g. on hover re-renders) or meshes would snap back. When this is false,
  // EDIT state wins: the props render the entity and dragging it edits it.
  const simulated = useTelemetryStore((s) => s.status === "running" || s.viewPose);

  const raycaster = useMemo(() => new THREE.Raycaster(), []);
  const dragRef = useRef<EntityDrag | null>(null);
  const endDragRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (ref.current) entityObjectRegistry.set(id, ref.current);
    return () => {
      entityObjectRegistry.delete(id);
    };
  }, [id]);

  // A live drag torn down by an unmount must still release the camera controls
  // and its window listeners.
  useEffect(() => {
    return () => {
      endDragRef.current?.();
    };
  }, []);

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    if (!selectable) return;
    // While a spawn tool is active a click places an entity, not selects.
    if (useSceneStore.getState().tool) return;
    // R3F synthesises a click on pointerup for every object hit on pointerdown,
    // so releasing a drag (axis arrow / gizmo / body drag) over another mesh —
    // typically the ground behind it — would otherwise steal the selection.
    // `delta` is the pointer travel since pointerdown, in pixels.
    if (e.delta > 4) return;
    e.stopPropagation();
    setSelected(id);
  };
  const handlePointerOver = (e: ThreeEvent<PointerEvent>) => {
    if (!selectable) return;
    if (useSceneStore.getState().tool) return;
    e.stopPropagation();
    setHovered(id);
  };
  const handlePointerOut = () => {
    if (hoveredId === id) setHovered(null);
  };

  /**
   * Direct body drag & drop — "click = select, drag = move".
   *
   * The cursor is projected onto a plane through the entity's current world
   * anchor: the horizontal X–Y plane in 3D (Z is repositioned only via the axis
   * arrows / inspector) and the vertical X–Z workspace plane in 2D. The
   * grab-offset delta model keeps the grab point under the cursor and writes
   * `anchor + delta` through `writeTransform`, so the entity follows the cursor
   * without jumping on grab.
   */
  const handlePointerDown = (e: ThreeEvent<PointerEvent>) => {
    if (!selectable || e.button !== 0 || simulated) return;
    const scene = useSceneStore.getState();
    // A spawn click places an entity, and a TransformControls handle press owns
    // the pointer — neither may start a body drag.
    if (scene.tool || gizmoHandleAxis.axis !== null) return;
    const project = scene.project;
    if (!project) return;
    const found = findEntityInProject(project, id);
    if (!found) return;
    // Rigid bodies are draggable from the first press; statics (the ground!)
    // must be selected first so panning the camera never moves the world.
    if (scene.selectedId !== id && found.category !== "bodies") return;

    e.stopPropagation();
    setSelected(id);

    const anchor = entityWorldPosition(project, found.category, found.entity);
    const is2d = project.meta.mode === "2D";
    const normal = is2d ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1);
    const plane = new THREE.Plane(
      normal,
      -normal.dot(new THREE.Vector3(anchor[0], anchor[1], anchor[2])),
    );
    const startHit = pointerOnPlane(
      raycaster,
      camera,
      gl.domElement,
      plane,
      e.nativeEvent.clientX,
      e.nativeEvent.clientY,
    );
    if (!startHit) return;

    // Keep the current orientation: `writeTransform` wants the full rotation
    // (absolute for bodies, relative to the plane base for statics).
    const rotationToKeep: Quat =
      found.category === "bodies"
        ? ((found.entity as RigidBodyEntity).initial.rotation as Quat)
        : found.category === "statics"
          ? staticWorldQuat(found.entity as StaticEntity)
          : [0, 0, 0, 1];

    // Left-drag belongs to the entity now: lock the camera controls and restore
    // exactly the previous state when the drag ends for any reason.
    const previousEnabled = defaultControls ? defaultControls.enabled : null;
    if (defaultControls) defaultControls.enabled = false;

    dragRef.current = { plane, startHit, anchor, rotation: rotationToKeep, is2d };

    const onMove = (ev: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const hit = pointerOnPlane(
        raycaster,
        camera,
        gl.domElement,
        drag.plane,
        ev.clientX,
        ev.clientY,
      );
      if (!hit) return;
      const delta: Vec3 = [
        hit.x - drag.startHit.x,
        hit.y - drag.startHit.y,
        hit.z - drag.startHit.z,
      ];
      // Click = select, drag = move: sub-epsilon movement never touches the
      // store (no dirty flag, no simulation-session exit).
      if (Math.hypot(delta[0], delta[1], delta[2]) < 1e-4) return;
      const next: Vec3 = drag.is2d
        ? [drag.anchor[0] + delta[0], 0, drag.anchor[2] + delta[2]]
        : [drag.anchor[0] + delta[0], drag.anchor[1] + delta[1], drag.anchor[2] + delta[2]];
      writeTransform(id, next, drag.rotation);
    };

    const endDrag = () => {
      if (!dragRef.current) return;
      dragRef.current = null;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", endDrag);
      window.removeEventListener("pointercancel", endDrag);
      if (previousEnabled !== null && defaultControls) defaultControls.enabled = previousEnabled;
      endDragRef.current = null;
    };

    endDragRef.current = endDrag;
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", endDrag);
    window.addEventListener("pointercancel", endDrag);
  };

  // R3F only raycasts objects that have a `raycast` method AND event handlers —
  // handlers on a plain <group> never fire. Inject the selection + drag handlers
  // into the child meshes so the entity is actually pickable and draggable.
  const interactiveChildren = !selectable
    ? children
    : Children.map(children, (child) =>
        isValidElement(child)
          ? cloneElement(child as ReactElement<Record<string, unknown>>, {
              onClick: handleClick,
              onPointerDown: handlePointerDown,
              onPointerOver: handlePointerOver,
              onPointerOut: handlePointerOut,
            })
          : child,
      );

  return (
    <group
      ref={ref}
      position={simulated ? undefined : position}
      quaternion={simulated ? undefined : (rotation as unknown as [number, number, number, number])}
    >
      {interactiveChildren}
    </group>
  );
}

/** True when the entity is selected or hovered (drives emissive highlight). */
export function useHighlight(id: string): boolean {
  const selectedId = useSceneStore((s) => s.selectedId);
  const hoveredId = useSceneStore((s) => s.hoveredId);
  return selectedId === id || hoveredId === id;
}

// -----------------------------------------------------------------------------
// Selection plumbing for connectors (joints/forces/ropes/meters)
// -----------------------------------------------------------------------------

/**
 * Click/hover handlers that make an arbitrary visual group selectable. Note:
 * R3F never delivers events to handlers on plain groups — the handlers must
 * live on a raycastable mesh. Use `<SelectionProxy>` (an invisible sphere at
 * the entity's world anchor) instead of spreading these onto a `<group>`.
 */
export function useSelectionHandlers(id: string): {
  onClick: (e: ThreeEvent<MouseEvent>) => void;
  onPointerOver: (e: ThreeEvent<PointerEvent>) => void;
  onPointerOut: () => void;
} {
  const hoveredId = useSceneStore((s) => s.hoveredId);
  const setSelected = useSceneStore((s) => s.setSelected);
  const setHovered = useSceneStore((s) => s.setHovered);
  return {
    onClick: (e) => {
      if (useSceneStore.getState().tool) return;
      // A drag release must not change the selection (see EntityGroup.handleClick).
      if (e.delta > 4) return;
      e.stopPropagation();
      setSelected(id);
    },
    onPointerOver: (e) => {
      if (useSceneStore.getState().tool) return;
      e.stopPropagation();
      setHovered(id);
    },
    onPointerOut: () => {
      if (hoveredId === id) setHovered(null);
    },
  };
}

/**
 * Invisible, raycastable sphere at the entity's world anchor that carries the
 * selection handlers for connector entities whose visuals are positioned
 * imperatively (they cannot use `EntityGroup`). Opacity-0 keeps it pickable.
 */
export function SelectionProxy({
  id,
  position,
  radius = 0.28,
}: {
  id: string;
  position: Vec3;
  radius?: number;
}) {
  const handlers = useSelectionHandlers(id);
  return (
    <mesh position={position} {...handlers}>
      <sphereGeometry args={[radius, 14, 10]} />
      <meshBasicMaterial transparent opacity={0} depthWrite={false} />
    </mesh>
  );
}

/**
 * Registers an invisible Object3D at the entity's world anchor so the transform
 * gizmo has something to attach to and read `position` from. The connector's
 * visual group positions itself imperatively (world-space children), so the
 * anchor is kept as a separate, empty group.
 */
export function EntityAnchor({ id, position }: { id: string; position: Vec3 }) {
  const ref = useRef<THREE.Group>(null);
  useEffect(() => {
    if (ref.current) entityObjectRegistry.set(id, ref.current);
    return () => {
      entityObjectRegistry.delete(id);
    };
  }, [id]);
  return <group ref={ref} position={position} />;
}
