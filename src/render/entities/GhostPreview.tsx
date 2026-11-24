// render/entities/GhostPreview.tsx — semi-transparent placement preview that
// follows the cursor before an entity is instantiated.

import { useMemo } from "react";
import * as THREE from "three";
import type { Vec3 } from "../../core/types";
import { createWedgeGeometry, createWedgeShapeGeometry } from "../geometry/wedge";

interface GhostPreviewProps {
  kind: string;
  position: Vec3;
  flat?: boolean;
}

const GHOST_COLOR = "#22d3ee";

/** Standard primitive for the given tool kind (shared 3D body dims with defaults). */
function ghostGeometry3D(kind: string): JSX.Element | null {
  switch (kind) {
    case "box":
      return <boxGeometry args={[1, 1, 1]} />;
    case "sphere":
      return <sphereGeometry args={[0.5, 32, 24]} />;
    case "ellipsoid":
      return <sphereGeometry args={[0.5, 32, 24]} />;
    case "cylinder":
    case "pulley":
      return <cylinderGeometry args={[0.5, 0.5, 1, 32]} />;
    case "rod":
      return <boxGeometry args={[1, 0.05, 0.05]} />;
    case "wedge":
      return null; // custom geometry below
    case "wall":
      return <planeGeometry args={[10, 10]} />;
    case "ground":
      return <planeGeometry args={[20, 20]} />;
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

  if (kind === "wedge") {
    return (
      <group position={position}>
        <mesh geometry={(flat ? wedge2D : wedge3D) ?? undefined}>
          <meshBasicMaterial color={GHOST_COLOR} transparent opacity={0.45} depthWrite={false} side={THREE.DoubleSide} />
        </mesh>
      </group>
    );
  }

  return (
    <group position={position}>
      <mesh>
        {ghostGeometry3D(kind)}
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
