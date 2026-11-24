// render/geometry/wedge.ts — wedge (inclined plane) geometry, 3D + 2D.
//
// Local frame: origin at the box corner of the bounding volume, X along the
// incline direction (back = tall side at -X), Y up, Z depth. Top edge slopes
// from full height H at the back down to H - W·tan(θ) at the front.

import * as THREE from "three";

export interface WedgeParams {
  thetaDeg: number;
  W: number;
  H: number;
  D: number;
}

export const DEFAULT_WEDGE: WedgeParams = { thetaDeg: 30, W: 1, H: 0.5, D: 1 };

/** Front (low side) height after the incline, clamped to avoid degenerate tips. */
export function wedgeFrontHeight(p: WedgeParams): number {
  return Math.max(0.02 * p.H, p.H - p.W * Math.tan((p.thetaDeg * Math.PI) / 180));
}

/** Side-profile corners (XY), used by both the 3D extrusion and the 2D shape. */
export function wedgeProfile(p: WedgeParams): Array<[number, number]> {
  const hw = p.W / 2;
  const hh = p.H / 2;
  const frontTop = wedgeFrontHeight(p) - p.H / 2;
  return [
    [-hw, -hh],
    [hw, -hh],
    [hw, frontTop],
    [-hw, hh],
  ];
}

/** Extruded 3D prism, centered on the profile. */
export function createWedgeGeometry(p: WedgeParams = DEFAULT_WEDGE): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape();
  const profile = wedgeProfile(p);
  profile.forEach(([x, y], i) => {
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  });
  shape.closePath();
  const geom = new THREE.ExtrudeGeometry(shape, { depth: p.D, bevelEnabled: false });
  geom.translate(0, 0, -p.D / 2);
  return geom;
}

/** Flat triangle profile for the 2D viewport. */
export function createWedgeShapeGeometry(p: WedgeParams = DEFAULT_WEDGE): THREE.ShapeGeometry {
  const shape = new THREE.Shape();
  const profile = wedgeProfile(p);
  profile.forEach(([x, y], i) => {
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  });
  shape.closePath();
  return new THREE.ShapeGeometry(shape);
}
