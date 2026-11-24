// render/entities/shared.tsx — visuals shared by the 2D and 3D viewports
// (ropes as tubes, force arrows, spring helices). They render correctly under
// both perspective and orthographic cameras.

import { useMemo } from "react";
import * as THREE from "three";
import type { Vec3 } from "../../core/types";

function pointsKey(points: Vec3[]): string {
  return points.map((p) => p.map((n) => n.toFixed(4)).join(",")).join(";");
}

/** Smooth tube through a list of world points (ropes, joint links). */
export function TubeLine({ points, radius = 0.02, color = "#e4e4e7" }: { points: Vec3[]; radius?: number; color?: string }) {
  const key = pointsKey(points);
  const geometry = useMemo(() => {
    if (points.length < 2) return null;
    const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(p[0], p[1], p[2])));
    return new THREE.TubeGeometry(curve, Math.max(8, points.length * 16), radius, 8);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, radius]);
  if (!geometry) return null;
  return (
    <mesh geometry={geometry}>
      <meshBasicMaterial color={color} />
    </mesh>
  );
}

/** Force arrow along +Z (up) from its base point (constant direction in M2). */
export function ArrowMesh({
  position,
  color = "#ef4444",
  length = 1,
  thickness = 0.02,
}: {
  position: Vec3;
  color?: string;
  length?: number;
  thickness?: number;
}) {
  return (
    <group position={position}>
      <mesh position={[0, 0, length / 2]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[thickness, thickness, length, 12]} />
        <meshBasicMaterial color={color} />
      </mesh>
      <mesh position={[0, 0, length + 0.11]} rotation={[Math.PI / 2, 0, 0]}>
        <coneGeometry args={[thickness * 4, 0.24, 16]} />
        <meshBasicMaterial color={color} />
      </mesh>
    </group>
  );
}

/** Spring helix between two world points. */
export function HelixSpring({
  a,
  b,
  color = "#fb7185",
}: {
  a: Vec3;
  b: Vec3;
  color?: string;
}) {
  const key = pointsKey([a, b]);
  const geometry = useMemo(() => {
    const start = new THREE.Vector3(a[0], a[1], a[2]);
    const end = new THREE.Vector3(b[0], b[1], b[2]);
    const axis = end.clone().sub(start);
    const length = axis.length();
    if (length < 1e-4) return null;
    const dir = axis.clone().normalize();

    const COILS = 8;
    const RADIUS = 0.08;

    class SpringCurve extends THREE.Curve<THREE.Vector3> {
      constructor(
        private readonly s: THREE.Vector3,
        private readonly d: THREE.Vector3,
        private readonly len: number,
      ) {
        super();
      }
      getPoint(t: number, target: THREE.Vector3 = new THREE.Vector3()): THREE.Vector3 {
        const angle = t * Math.PI * 2 * COILS;
        // Z-up: use +Z as the stable reference unless the spring is vertical.
        const up = Math.abs(this.d.z) < 0.99 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
        const u = new THREE.Vector3().crossVectors(this.d, up).normalize();
        const v = new THREE.Vector3().crossVectors(u, this.d).normalize();
        return target
          .copy(this.s)
          .addScaledVector(this.d, t * this.len)
          .addScaledVector(u, Math.cos(angle) * RADIUS)
          .addScaledVector(v, Math.sin(angle) * RADIUS);
      }
    }

    return new THREE.TubeGeometry(new SpringCurve(start, dir, length), 160, 0.015, 8);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  if (!geometry) return null;
  return (
    <mesh geometry={geometry}>
      <meshBasicMaterial color={color} />
    </mesh>
  );
}
