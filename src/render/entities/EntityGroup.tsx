// render/entities/EntityGroup.tsx — root group for a transformable entity.
//
// Registers the live Object3D in the entity registry (for the transform gizmo)
// and wires selection / hover events. Highlight styling is computed in the
// entity components via `useHighlight`.

import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import * as THREE from "three";
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

  return (
    <group
      ref={ref}
      position={simulated ? undefined : position}
      quaternion={simulated ? undefined : (rotation as unknown as [number, number, number, number])}
      onClick={(e) => {
        if (!selectable) return;
        e.stopPropagation();
        setSelected(id);
      }}
      onPointerOver={(e) => {
        if (!selectable) return;
        e.stopPropagation();
        setHovered(id);
      }}
      onPointerOut={() => {
        if (hoveredId === id) setHovered(null);
      }}
    >
      {children}
    </group>
  );
}

/** True when the entity is selected or hovered (drives emissive highlight). */
export function useHighlight(id: string): boolean {
  const selectedId = useSceneStore((s) => s.selectedId);
  const hoveredId = useSceneStore((s) => s.hoveredId);
  return selectedId === id || hoveredId === id;
}
