// render/SpawnController.tsx — ghost preview + placement.
//
// While a palette tool is active, the ghost tracks the surface under the cursor
// directly from canvas pointer events (ray/plane intersection). In 3D this is a
// raycast over the FINITE rendered rectangles of all statics; when none is hit
// the ghost falls back to the horizontal X–Y ground plane (Z = 0). This is
// independent of the scene geometry, so the preview always follows the cursor —
// it can never be blocked by the ground or by an existing object.
//
// A left click that does not drag places the entity; the ghost snaps
// magnetically to nearby semantic anchors. Right-click (without dragging)
// cancels the tool, and Esc cancels too.

import { useEffect, useMemo, useRef, useState } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { Quat, Vec3 } from "../core/types";
import { halfHeightOf } from "../core/defaults";
import type { SpawnSurface, SpawnTool } from "../stores/sceneStore";
import { useSceneStore } from "../stores/sceneStore";
import { computeSnapPoints, findSnap, liftBodyPoint, SNAP_RADIUS } from "./gizmos/snapping";
import { raycastStaticSurface } from "./gizmos/planeRaycast";
import { axisArrowDrag } from "./gizmos/AxisArrows";
import { GhostPreview, SnapDot } from "./entities/GhostPreview";

/** Max pointer travel (CSS px) that still counts as a click, not a camera drag. */
const CLICK_SLOP = 4;

/** Identity quaternion (fallback ghost orientation). */
const IDENTITY_ROTATION: Quat = [0, 0, 0, 1];

export function SpawnController({ tool, flat }: { tool: SpawnTool; flat: boolean }) {
  const project = useSceneStore((s) => s.project);
  const spawnFromTool = useSceneStore((s) => s.spawnFromTool);
  const setSelected = useSceneStore((s) => s.setSelected);
  const setTool = useSceneStore((s) => s.setTool);
  const { camera, gl } = useThree();

  const [pointer, setPointer] = useState<Vec3 | null>(null);
  const [surface, setSurface] = useState<SpawnSurface | null>(null);

  const mode = project?.meta.mode ?? "3D";
  const snapPoints = useMemo(() => (project ? computeSnapPoints(project, mode) : []), [project, mode]);
  const snapped = useMemo(() => (pointer ? findSnap(pointer, snapPoints, SNAP_RADIUS) : null), [pointer, snapPoints]);

  const isBody = tool.category === "bodies";
  // A snap onto a body anchor keeps the legacy +Z lift (the body's own surface
  // already gives the tilt); surface placement only applies to the plane.
  const snappedToBody = snapped
    ? (project?.bodies.some((b) => b.id === snapped.ownerId) ?? false)
    : false;

  // Ghost rests ON the surface point (lifted by half height for bodies).
  const surfacePoint = snapped ? snapped.point : pointer;

  const ghostPosition: Vec3 | null = (() => {
    if (!surfacePoint) return null;
    if (isBody && surface && !snappedToBody) {
      const n = surface.normal;
      const half = halfHeightOf(tool.kind);
      return [surfacePoint[0] + n[0] * half, surfacePoint[1] + n[1] * half, surfacePoint[2] + n[2] * half];
    }
    if (isBody) return liftBodyPoint(tool.kind, surfacePoint, mode);
    return surfacePoint;
  })();

  // Only body tools on a tilted surface get a non-identity orientation.
  const ghostRotation: Quat = isBody && surface && !snappedToBody ? surface.rotation : IDENTITY_ROTATION;

  // Latest values for the imperative DOM listeners.
  const latest = useRef({ snapPoints, tool, project });
  latest.current = { snapPoints, tool, project };

  // A fresh tool starts with no preview until the pointer moves.
  useEffect(() => {
    setPointer(null);
    setSurface(null);
  }, [tool]);

  // Track the surface point + place/cancel straight from canvas DOM events.
  useEffect(() => {
    const el = gl.domElement;
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    // 2D: vertical X–Z workspace (Y = 0). 3D fallback: horizontal X–Y plane (Z = 0).
    const flatPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const groundPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
    const hit = new THREE.Vector3();

    const surfaceAt = (ev: PointerEvent): { point: Vec3; surface: SpawnSurface | null } | null => {
      const rect = el.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return null;
      ndc.set(
        ((ev.clientX - rect.left) / rect.width) * 2 - 1,
        -((ev.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(ndc, camera);

      if (flat) {
        if (!raycaster.ray.intersectPlane(flatPlane, hit)) return null;
        return { point: [hit.x, 0, hit.z], surface: null };
      }

      const projectNow = latest.current.project;
      if (projectNow) {
        const s = raycastStaticSurface(projectNow, raycaster);
        if (s) return { point: s.point, surface: { normal: s.normal, rotation: s.rotation } };
      }
      // Fallback: the horizontal ground plane, so the ghost still follows the
      // cursor exactly as before (identity rotation, +Z normal).
      if (!raycaster.ray.intersectPlane(groundPlane, hit)) return null;
      return { point: [hit.x, hit.y, 0], surface: { normal: [0, 0, 1], rotation: IDENTITY_ROTATION } };
    };

    let downButton = -1;
    let downX = 0;
    let downY = 0;

    const onPointerMove = (ev: PointerEvent) => {
      // While an axis-arrow drag is in progress the ghost must not chase the
      // cursor (the freshly created object is being nudged along an axis).
      if (axisArrowDrag.down) return;
      const r = surfaceAt(ev);
      if (r) {
        setPointer(r.point);
        setSurface(r.surface);
      }
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
      const r = surfaceAt(ev);
      if (!r) return;
      const current = latest.current;
      const snap = findSnap(r.point, current.snapPoints, SNAP_RADIUS);
      const id = spawnFromTool(current.tool, snap ? snap.point : r.point, snap, r.surface);
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
      {ghostPosition && (
        <GhostPreview
          kind={tool.kind}
          position={ghostPosition}
          rotation={ghostRotation}
          flat={flat}
        />
      )}
      {snapped && <SnapDot point={snapped.point} />}
    </>
  );
}
