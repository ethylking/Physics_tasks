// render/gizmos/pointerPlane.ts — cursor → world-space point on a drag plane.
//
// Same raycast recipe AxisArrows uses for its axis drags: screen coordinates →
// NDC using the canvas rect → camera ray → plane intersection. Shared by the
// direct body drag in EntityGroup so both drag flavors map the cursor the same
// way (perspective 3D and orthographic 2D alike).

import * as THREE from "three";

/**
 * Intersect the cursor ray with `plane` and return the world hit point (written
 * into `target`), or null when the canvas is not measurable or the ray never
 * crosses the plane.
 */
export function pointerOnPlane(
  raycaster: THREE.Raycaster,
  camera: THREE.Camera,
  element: HTMLElement,
  plane: THREE.Plane,
  clientX: number,
  clientY: number,
  target: THREE.Vector3 = new THREE.Vector3(),
): THREE.Vector3 | null {
  const rect = element.getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1) return null;
  const ndc = new THREE.Vector2(
    ((clientX - rect.left) / rect.width) * 2 - 1,
    -((clientY - rect.top) / rect.height) * 2 + 1,
  );
  raycaster.setFromCamera(ndc, camera);
  return raycaster.ray.intersectPlane(plane, target) ? target : null;
}
