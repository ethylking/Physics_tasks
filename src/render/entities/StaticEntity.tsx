// render/entities/StaticEntity.tsx — walls & ground in the 3D viewport.
// Statics are infinite planes anchored at `stat.position` (default: origin).

import { useMemo } from "react";
import * as THREE from "three";
import type { Quat, StaticEntity as StaticEntityType, Vec3 } from "../../core/types";
import { EntityGroup, useHighlight } from "./EntityGroup";

const ORIGIN: Vec3 = [0, 0, 0];

function num(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

export function StaticEntity({ stat }: { stat: StaticEntityType }) {
  const highlighted = useHighlight(stat.id);
  const color = stat.appearance?.color ?? "#3f3f46";
  const opacity = stat.appearance?.opacity ?? 0.85;

  // Orient the plane mesh so its +Z normal points along the wall/ground normal.
  const rotation = useMemo((): Quat => {
    const normal = new THREE.Vector3(stat.plane.normal[0], stat.plane.normal[1], stat.plane.normal[2]);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
    return [q.x, q.y, q.z, q.w];
  }, [stat.plane.normal]);

  const isGround = stat.kind === "ground";
  const w = num(stat.plane.extent[0], isGround ? 20 : 10);
  const h = num(stat.plane.extent[1], isGround ? 20 : 10);

  return (
    <EntityGroup id={stat.id} position={stat.position ?? ORIGIN} rotation={rotation}>
      <mesh receiveShadow>
        <planeGeometry args={[w, h]} />
        <meshStandardMaterial
          color={highlighted ? "#22d3ee" : color}
          transparent
          // A selected ground must stay see-through (it is a huge plane and
          // would otherwise cover the whole scene with the highlight tint).
          opacity={highlighted ? (isGround ? 0.1 : 0.9) : opacity}
          depthWrite={!(highlighted && isGround)}
          // The ground is exactly coplanar with the grid at z = 0 — push its
          // fragments slightly behind so the grid wins instead of z-fighting.
          polygonOffset={isGround}
          polygonOffsetFactor={1}
          polygonOffsetUnits={1}
          side={THREE.DoubleSide}
        />
      </mesh>
    </EntityGroup>
  );
}
