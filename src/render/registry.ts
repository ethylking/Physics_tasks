// render/registry.ts — maps entity ids to their live THREE.Object3D roots.
//
// Entity components register their root group here; the transform gizmo and
// CoM markers read it back. Purely imperative — no re-renders involved.

import * as THREE from "three";

export const entityObjectRegistry = new Map<string, THREE.Object3D>();
