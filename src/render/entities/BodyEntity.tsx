// render/entities/BodyEntity.tsx — Tier 1 rigid bodies in the 3D viewport.

import { useMemo } from "react";
import type { RigidBodyEntity, Vec3 } from "../../core/types";
import { EntityGroup, useHighlight } from "./EntityGroup";
import { useCollisionFlag } from "../../stores/collisionStore";
import { createWedgeGeometry, DEFAULT_WEDGE } from "../geometry/wedge";

const FALLBACK_COLOR = "#38bdf8";

function num(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

export function BodyEntity({ body }: { body: RigidBodyEntity }) {
  const highlighted = useHighlight(body.id);
  const colliding = useCollisionFlag(body.id);
  const color = body.appearance?.color ?? FALLBACK_COLOR;
  const opacity = body.appearance?.opacity ?? 1;
  const g = body.geometry;

  // Wedge needs a custom extruded geometry; every other Tier 1 kind maps to a
  // standard primitive (possibly unit-scaled).
  const wedgeGeometry = useMemo(() => {
    if (body.kind !== "wedge") return null;
    return createWedgeGeometry({
      thetaDeg: num(g.wedge?.thetaDeg, DEFAULT_WEDGE.thetaDeg),
      W: num(g.wedge?.W, DEFAULT_WEDGE.W),
      H: num(g.wedge?.H, DEFAULT_WEDGE.H),
      D: num(g.wedge?.D, DEFAULT_WEDGE.D),
    });
  }, [body.kind, g.wedge]);

  const scale: Vec3 =
    body.kind === "ellipsoid"
      ? [num(g.ellipsoid?.a, 0.5), num(g.ellipsoid?.b, 0.5), num(g.ellipsoid?.c, 0.5)]
      : [1, 1, 1];

  // Three's cylinder axis is local +Y; rotate the mesh so H follows +Z (up).
  const meshRotation: Vec3 | undefined = body.kind === "cylinder" ? [Math.PI / 2, 0, 0] : undefined;

  const renderGeometry = () => {
    switch (body.kind) {
      case "box":
        // W → X, D → Y (depth), H → Z (up).
        return <boxGeometry args={[num(g.box?.W, 1), num(g.box?.D, 1), num(g.box?.H, 1)]} />;
      case "sphere":
        return <sphereGeometry args={[num(g.sphere?.R, 0.5), 48, 32]} />;
      case "ellipsoid":
        return <sphereGeometry args={[1, 48, 32]} />;
      case "cylinder":
        return (
          <cylinderGeometry
            args={[num(g.cylinder?.R, 0.5), num(g.cylinder?.R, 0.5), num(g.cylinder?.H, 1), 48]}
          />
        );
      case "rod": {
        const t = num(g.rod?.thickness, 0.05);
        return <boxGeometry args={[num(g.rod?.L, 1), t, t]} />;
      }
      case "wedge":
        return null; // wedgeGeometry attached to the mesh
      default:
        // Tier 2 / plugin kinds — placeholder prism until the plugin renders it.
        return <boxGeometry args={[0.6, 0.6, 0.6]} />;
    }
  };

  return (
    <EntityGroup id={body.id} position={body.initial.position} rotation={body.initial.rotation}>
      <mesh castShadow receiveShadow geometry={wedgeGeometry ?? undefined} scale={scale} rotation={meshRotation}>
        {renderGeometry()}
        <meshStandardMaterial
          color={colliding ? "#dc2626" : color}
          transparent={opacity < 1}
          opacity={opacity}
          emissive={colliding ? "#dc2626" : highlighted ? "#22d3ee" : "#000000"}
          emissiveIntensity={colliding ? 0.6 : highlighted ? 0.35 : 0}
        />
      </mesh>
    </EntityGroup>
  );
}
