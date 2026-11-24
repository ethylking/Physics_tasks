// render/entities/EntityGroup.tsx — root group for a transformable entity.
//
// Registers the live Object3D in the entity registry (for the transform gizmo)
// and wires selection / hover events. Highlight styling is computed in the
// entity components via `useHighlight`.

import { Children, cloneElement, isValidElement, useEffect, useRef } from "react";
import type { ReactElement, ReactNode } from "react";
import * as THREE from "three";
import type { ThreeEvent } from "@react-three/fiber";
import type { Quat, Vec3 } from "../../core/types";
import { useSceneStore } from "../../stores/sceneStore";
import { useTelemetryStore } from "../../stores/telemetryStore";
import { entityObjectRegistry } from "../registry";

interface EntityGroupProps {
  id: string;
  position: Vec3;
  rotation: Quat;
  selectable?: boolean;
  children: ReactNode;
}

export function EntityGroup({ id, position, rotation, selectable = true, children }: EntityGroupProps) {
  const ref = useRef<THREE.Group>(null);
  const hoveredId = useSceneStore((s) => s.hoveredId);
  const setSelected = useSceneStore((s) => s.setSelected);
  const setHovered = useSceneStore((s) => s.setHovered);

  // While a simulation session is live (running OR paused), the worker snapshot
  // owns the transforms — React must not re-apply the edit-time position/rotation
  // props (e.g. on hover re-renders), or meshes would snap back.
  const simulated = useTelemetryStore((s) => s.status !== "idle");

  useEffect(() => {
    if (ref.current) entityObjectRegistry.set(id, ref.current);
    return () => {
      entityObjectRegistry.delete(id);
    };
  }, [id]);

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    if (!selectable) return;
    // While a spawn tool is active a click places an entity, not selects.
    if (useSceneStore.getState().tool) return;
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

  // R3F only raycasts objects that have a `raycast` method AND event handlers —
  // handlers on a plain <group> never fire. Inject the selection handlers into
  // the child meshes so the entity is actually pickable.
  const interactiveChildren = !selectable
    ? children
    : Children.map(children, (child) =>
        isValidElement(child)
          ? cloneElement(child as ReactElement<Record<string, unknown>>, {
              onClick: handleClick,
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
