// render/SpawnController.tsx — ghost preview + placement.
//
// While a palette tool is active, the ghost tracks the ground plane directly
// from canvas pointer events (ray/plane intersection). This is independent of
// the scene geometry, so the preview always follows the cursor — it can never
// be blocked by the ground or by an existing object.
//
// A left click that does not drag places the entity; the ghost snaps
// magnetically to nearby semantic anchors. Right-click (without dragging)
// cancels the tool, and Esc cancels too.

import { useEffect, useMemo, useRef, useState } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { Vec3 } from "../core/types";
import type { SpawnTool } from "../stores/sceneStore";
import { useSceneStore } from "../stores/sceneStore";
import { computeSnapPoints, findSnap, liftBodyPoint, SNAP_RADIUS } from "./gizmos/snapping";
import { axisArrowDrag } from "./gizmos/AxisArrows";
import { GhostPreview, SnapDot } from "./entities/GhostPreview";

/** Max pointer travel (CSS px) that still counts as a click, not a camera drag. */
const CLICK_SLOP = 4;

export function SpawnController({ tool, flat }: { tool: SpawnTool; flat: boolean }) {
  const project = useSceneStore((s) => s.project);
  const spawnFromTool = useSceneStore((s) => s.spawnFromTool);
  const setSelected = useSceneStore((s) => s.setSelected);
  const setTool = useSceneStore((s) => s.setTool);
  const { camera, gl } = useThree();

  const [pointer, setPointer] = useState<Vec3 | null>(null);

  const mode = project?.meta.mode ?? "3D";
  const snapPoints = useMemo(() => (project ? computeSnapPoints(project, mode) : []), [project, mode]);
  const snapped = useMemo(() => (pointer ? findSnap(pointer, snapPoints, SNAP_RADIUS) : null), [pointer, snapPoints]);

  // Ghost rests ON the surface point (lifted by half height for bodies).
  const surfacePoint = snapped ? snapped.point : pointer;
  const ghostPoint =
    surfacePoint && tool.category === "bodies" ? liftBodyPoint(tool.kind, surfacePoint, mode) : surfacePoint;

  // Latest values for the imperative DOM listeners.
  const latest = useRef({ snapPoints, tool });
  latest.current = { snapPoints, tool };

  // A fresh tool starts with no preview until the pointer moves.
  useEffect(() => {
    setPointer(null);
  }, [tool]);

  // Track the ground point + place/cancel straight from canvas DOM events.
  useEffect(() => {
    const el = gl.domElement;
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    // 3D: horizontal X–Y ground plane (Z = 0). 2D: vertical X–Z workspace (Y = 0).
    const plane = flat
      ? new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
      : new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
    const hit = new THREE.Vector3();

    const groundPoint = (ev: PointerEvent): Vec3 | null => {
      const rect = el.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return null;
      ndc.set(
        ((ev.clientX - rect.left) / rect.width) * 2 - 1,
        -((ev.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(ndc, camera);
      if (!raycaster.ray.intersectPlane(plane, hit)) return null;
      return flat ? [hit.x, 0, hit.z] : [hit.x, hit.y, 0];
    };

    let downButton = -1;
    let downX = 0;
    let downY = 0;

    const onPointerMove = (ev: PointerEvent) => {
      // While an axis-arrow drag is in progress the ghost must not chase the
      // cursor (the freshly created object is being nudged along an axis).
      if (axisArrowDrag.down) return;
      const p = groundPoint(ev);
      if (p) setPointer(p);
    };

    const onPointerDown = (ev: PointerEvent) => {
      if (axisArrowDrag.down) return;
      downButton = ev.button;
      downX = ev.clientX;
      downY = ev.clientY;
    };

    const onPointerUp = (ev: PointerEvent) => {
      // Clicking/dragging a post-creation axis arrow must never place an entity.
      if (axisArrowDrag.down) {
        downButton = -1;
        return;
      }
      const button = downButton;
      const moved = Math.hypot(ev.clientX - downX, ev.clientY - downY);
      downButton = -1;
      if (button < 0 || ev.button !== button || moved > CLICK_SLOP) return;
      if (button === 2) {
        setTool(null);
        return;
      }
      if (button !== 0) return;
      const rect = el.getBoundingClientRect();
      if (
        ev.clientX < rect.left ||
        ev.clientX > rect.right ||
        ev.clientY < rect.top ||
        ev.clientY > rect.bottom
      ) {
        return;
      }
      const p = groundPoint(ev);
      if (!p) return;
      const current = latest.current;
      const snap = findSnap(p, current.snapPoints, SNAP_RADIUS);
      const id = spawnFromTool(current.tool, snap ? snap.point : p, snap);
      if (id) setSelected(id);
    };

    const onContextMenu = (ev: MouseEvent) => ev.preventDefault();

    el.addEventListener("pointermove", onPointerMove);
    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("contextmenu", onContextMenu);
    window.addEventListener("pointerup", onPointerUp);
    return () => {
      el.removeEventListener("pointermove", onPointerMove);
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("contextmenu", onContextMenu);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, [gl, camera, flat, spawnFromTool, setSelected, setTool]);

  return (
    <>
      {ghostPoint && (
        <GhostPreview
          kind={tool.kind}
          position={ghostPoint}
          flat={flat}
        />
      )}
      {snapped && <SnapDot point={snapped.point} />}
    </>
  );
}
