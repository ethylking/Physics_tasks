// render/SpawnController.tsx — ghost preview + placement.
//
// While a palette tool is active, an invisible raycast surface tracks the
// pointer; the ghost snaps magnetically to nearby semantic anchors (CoM, face
// centers, vertices, rim/axle points) and a left click instantiates the entity
// into the scene store. Right-click cancels the tool.

import { useEffect, useMemo, useState } from "react";
import { useThree } from "@react-three/fiber";
import type { Vec3 } from "../core/types";
import type { SpawnTool } from "../stores/sceneStore";
import { useSceneStore } from "../stores/sceneStore";
import { computeSnapPoints, findSnap, liftBodyPoint, SNAP_RADIUS } from "./gizmos/snapping";
import { GhostPreview, SnapDot } from "./entities/GhostPreview";

const SURFACE_SIZE = 400;

export function SpawnController({ tool, flat }: { tool: SpawnTool; flat: boolean }) {
  const project = useSceneStore((s) => s.project);
  const spawnFromTool = useSceneStore((s) => s.spawnFromTool);
  const setSelected = useSceneStore((s) => s.setSelected);
  const setTool = useSceneStore((s) => s.setTool);
  const gl = useThree((s) => s.gl);

  const [pointer, setPointer] = useState<Vec3 | null>(null);

  const mode = project?.meta.mode ?? "3D";
  const snapPoints = useMemo(() => (project ? computeSnapPoints(project, mode) : []), [project, mode]);
  const snapped = useMemo(() => (pointer ? findSnap(pointer, snapPoints, SNAP_RADIUS) : null), [pointer, snapPoints]);

  // Ghost rests ON the surface point (lifted by half height for bodies).
  const surfacePoint = snapped ? snapped.point : pointer;
  const ghostPoint =
    surfacePoint && tool.category === "bodies" ? liftBodyPoint(tool.kind, surfacePoint, mode) : surfacePoint;

  // Right-click cancels placement.
  useEffect(() => {
    const el = gl.domElement;
    const onContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      setTool(null);
    };
    el.addEventListener("contextmenu", onContextMenu);
    return () => el.removeEventListener("contextmenu", onContextMenu);
  }, [gl, setTool]);

  const place = () => {
    if (!surfacePoint) return;
    const id = spawnFromTool(tool, surfacePoint, snapped);
    if (id) setSelected(id);
  };

  const move = (point: Vec3) => {
    setPointer(point);
  };

  return (
    <>
      {flat ? (
        // 2D: track the XY plane at Z = 0 (slightly above the flat entities).
        <mesh
          position={[0, 0, 0.01]}
          onPointerMove={(e) => {
            e.stopPropagation();
            move([e.point.x, e.point.y, 0]);
          }}
          onClick={(e) => {
            e.stopPropagation();
            place();
          }}
        >
          <planeGeometry args={[SURFACE_SIZE, SURFACE_SIZE]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
      ) : (
        // 3D: track the ground plane at Y = 0 (slightly above the ground mesh).
        <mesh
          rotation={[-Math.PI / 2, 0, 0]}
          position={[0, 0.001, 0]}
          onPointerMove={(e) => {
            e.stopPropagation();
            move([e.point.x, e.point.y, e.point.z]);
          }}
          onClick={(e) => {
            e.stopPropagation();
            place();
          }}
        >
          <planeGeometry args={[SURFACE_SIZE, SURFACE_SIZE]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
      )}

      {ghostPoint && (
        <GhostPreview
          kind={tool.kind}
          position={tool.category === "statics" ? [0, 0, 0] : ghostPoint}
          flat={flat}
        />
      )}
      {snapped && <SnapDot point={snapped.point} />}
    </>
  );
}
