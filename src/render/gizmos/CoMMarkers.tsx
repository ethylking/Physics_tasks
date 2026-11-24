// render/gizmos/CoMMarkers.tsx — two distinct markers on the selected body:
//   1. a subtle geometric-origin marker at the body position,
//   2. a prominent Center of Mass (CoM) crosshair at
//      position + rotation · centerOfMass (§2.3).
// The marker moves with `centerOfMass` edits while the geometry stays put.

import { useMemo } from "react";
import * as THREE from "three";
import type { Quat, RigidBodyEntity, Vec3 } from "../../core/types";
import { localToWorld } from "../../math/rotation";

const CO_COLOR = "#e879f9";

function Crosshair3D({ position, rotation }: { position: Vec3; rotation: Quat }) {
  const axes = useMemo(
    () =>
      (["x", "y", "z"] as const).map((axis) => {
        const offset: Vec3 =
          axis === "x" ? [0.25, 0, 0] : axis === "y" ? [0, 0.25, 0] : [0, 0, 0.25];
        const euler: [number, number, number] =
          axis === "x" ? [0, 0, -Math.PI / 2] : axis === "y" ? [0, 0, 0] : [Math.PI / 2, 0, 0];
        return { offset, euler };
      }),
    [],
  );
  return (
    <group position={position} quaternion={rotation as unknown as [number, number, number, number]}>
      <mesh>
        <sphereGeometry args={[0.07, 16, 12]} />
        <meshBasicMaterial color={CO_COLOR} depthTest={false} />
      </mesh>
      {axes.map(({ offset, euler }) => (
        <mesh key={`${offset[0]}-${offset[1]}-${offset[2]}`} position={offset} rotation={euler}>
          <cylinderGeometry args={[0.012, 0.012, 0.5, 8]} />
          <meshBasicMaterial color={CO_COLOR} depthTest={false} />
        </mesh>
      ))}
    </group>
  );
}

function Crosshair2D({ position }: { position: Vec3 }) {
  return (
    <group position={position}>
      <mesh>
        <circleGeometry args={[0.07, 24]} />
        <meshBasicMaterial color={CO_COLOR} side={THREE.DoubleSide} depthTest={false} />
      </mesh>
      <mesh position={[0.16, 0, 0]}>
        <planeGeometry args={[0.32, 0.02]} />
        <meshBasicMaterial color={CO_COLOR} side={THREE.DoubleSide} depthTest={false} />
      </mesh>
      <mesh position={[0, 0.16, 0]}>
        <planeGeometry args={[0.02, 0.32]} />
        <meshBasicMaterial color={CO_COLOR} side={THREE.DoubleSide} depthTest={false} />
      </mesh>
    </group>
  );
}

export function CoMMarkers({ body, flat = false }: { body: RigidBodyEntity; flat?: boolean }) {
  const comWorld = localToWorld(body.centerOfMass, body.initial.position, body.initial.rotation);

  if (flat) {
    const origin2D: Vec3 = [body.initial.position[0], body.initial.position[1], 0];
    return (
      <group>
        <mesh position={origin2D}>
          <circleGeometry args={[0.045, 20]} />
          <meshBasicMaterial color="#a1a1aa" side={THREE.DoubleSide} depthTest={false} />
        </mesh>
        <Crosshair2D position={[comWorld[0], comWorld[1], 0]} />
      </group>
    );
  }

  return (
    <group>
      {/* geometric origin marker */}
      <mesh position={body.initial.position}>
        <sphereGeometry args={[0.045, 16, 12]} />
        <meshBasicMaterial color="#a1a1aa" depthTest={false} />
      </mesh>
      <Crosshair3D position={comWorld} rotation={body.initial.rotation} />
    </group>
  );
}
