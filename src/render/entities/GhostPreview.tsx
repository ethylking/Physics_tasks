// render/entities/GhostPreview.tsx — semi-transparent placement preview that
// follows the cursor before an entity is instantiated.

import { useMemo } from "react";
import * as THREE from "three";
import type { Vec3 } from "../../core/types";
import { PULLEY_GEOMETRY } from "../../core/defaults";
import { createWedgeGeometry, createWedgeShapeGeometry } from "../geometry/wedge";

interface GhostPreviewProps {
  kind: string;
  position: Vec3;
  flat?: boolean;
}

const GHOST_COLOR = "#22d3ee";

/** Standard primitive for the given tool kind (shared body dims with defaults). */
function ghostGeometry(kind: string, flat: boolean): JSX.Element | null {
  switch (kind) {
    case "box":
      return <boxGeometry args={[1, 1, 1]} />;
    case "sphere":
      return <sphereGeometry args={[0.5, 32, 24]} />;
    case "ellipsoid":
      return <sphereGeometry args={[0.5, 32, 24]} />;
    case "cylinder":
      return <cylinderGeometry args={[0.5, 0.5, 1, 32]} />;
    case "pulley":
      // A pulley is a thin disk, not a full-size cylinder.
      return flat ? (
        <circleGeometry args={[PULLEY_GEOMETRY.R, 32]} />
      ) : (
        <cylinderGeometry args={[PULLEY_GEOMETRY.R, PULLEY_GEOMETRY.R, PULLEY_GEOMETRY.H, 32]} />
      );
    case "rod":
      return <boxGeometry args={[1, 0.05, 0.05]} />;
    case "wedge":
      return null; // custom geometry below
    case "wall":
      return <planeGeometry args={flat ? [0.08, 10] : [10, 10]} />;
    case "ground":
      return <planeGeometry args={flat ? [20, 0.08] : [20, 20]} />;
    default:
      // Connectors (joints, springs, ropes, forces) preview as a marker ball.
      return <sphereGeometry args={[0.14, 20, 14]} />;
  }
}

export function GhostPreview({ kind, position, flat = false }: GhostPreviewProps) {
  const wedge3D = useMemo(
    () => (kind === "wedge" ? createWedgeGeometry() : null),
    [kind],
  );
  const wedge2D = useMemo(
    () => (flat && kind === "wedge" ? createWedgeShapeGeometry() : null),
    [flat, kind],
  );

  // 2D viewport = X–Z plane: rotate the local X–Y silhouettes into it.
  // A 3D wall is a Y–Z plane (normal ±X); ground stays in X–Y (normal +Z).
  const meshRotation: [number, number, number] | undefined =
    flat || kind === "cylinder" || kind === "pulley"
      ? [Math.PI / 2, 0, 0]
      : kind === "wall"
        ? [0, Math.PI / 2, 0]
        : undefined;

  if (kind === "wedge") {
    return (
      <group position={position}>
        <mesh geometry={(flat ? wedge2D : wedge3D) ?? undefined} rotation={meshRotation}>
          <meshBasicMaterial color={GHOST_COLOR} transparent opacity={0.45} depthWrite={false} side={THREE.DoubleSide} />
        </mesh>
      </group>
    );
  }

  return (
    <group position={position}>
      <mesh rotation={meshRotation}>
        {ghostGeometry(kind, flat)}
        <meshBasicMaterial color={GHOST_COLOR} transparent opacity={0.45} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

/** Highlight dot drawn on the snapped anchor while placing. */
export function SnapDot({ point }: { point: Vec3 }) {
  return (
    <mesh position={point}>
      <sphereGeometry args={[0.07, 20, 14]} />
      <meshBasicMaterial color="#a5f3fc" />
    </mesh>
  );
}
