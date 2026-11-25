// render/entities/2d/FlatBodies.tsx — flat X–Z-plane (Y = 0) representations of
// bodies and statics for the orthographic 2D viewport (§4.5, Z up).

import { useMemo } from "react";
import * as THREE from "three";
import { Edges } from "@react-three/drei";
import type { Quat, RigidBodyEntity, StaticEntity as StaticEntityType, Vec3 } from "../../../core/types";
import { eulerDegToQuat, quatToEulerDeg } from "../../../math/rotation";
import { EntityGroup, useHighlight } from "../EntityGroup";
import { useSceneStore } from "../../../stores/sceneStore";
import { createWedgeShapeGeometry, DEFAULT_WEDGE } from "../../geometry/wedge";

const FALLBACK_COLOR = "#38bdf8";

function num(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function flatGeometry(body: RigidBodyEntity, isPulley: boolean): THREE.BufferGeometry {
  const g = body.geometry;
  switch (body.kind) {
    case "box": {
      const geo = new THREE.PlaneGeometry(num(g.box?.W, 1), num(g.box?.H, 1));
      geo.rotateZ(0);
      return geo;
    }
    case "sphere":
      return new THREE.CircleGeometry(num(g.sphere?.R, 0.5), 64);
    case "ellipsoid": {
      const geo = new THREE.CircleGeometry(1, 64);
      // Local X–Y silhouette: a along X, c along Z (up → local Y before rotation).
      geo.scale(num(g.ellipsoid?.a, 0.5), num(g.ellipsoid?.c, 0.5), 1);
      return geo;
    }
    case "cylinder":
    case "pulley":
      // A pulley (cylinder referenced by a rope) is modeled as a disk with
      // I_y = ½mR² in 2D — render it as one too. Any cylinder thin enough to
      // be a disk gets the same treatment (a freshly spawned pulley has no
      // rope reference yet, but must still render as the disk its ghost showed).
      if (isPulley || num(g.cylinder?.H, 1) <= 0.2) return new THREE.CircleGeometry(num(g.cylinder?.R, 0.5), 64);
      return new THREE.PlaneGeometry(num(g.cylinder?.R, 0.5) * 2, num(g.cylinder?.H, 1));
    case "rod":
      return new THREE.PlaneGeometry(num(g.rod?.L, 1), num(g.rod?.thickness, 0.05));
    case "wedge":
      return createWedgeShapeGeometry({
        thetaDeg: num(g.wedge?.thetaDeg, DEFAULT_WEDGE.thetaDeg),
        W: num(g.wedge?.W, DEFAULT_WEDGE.W),
        H: num(g.wedge?.H, DEFAULT_WEDGE.H),
        D: 1,
      });
    default:
      return new THREE.PlaneGeometry(0.6, 0.6);
  }
}

export function BodyEntity2D({ body }: { body: RigidBodyEntity }) {
  const highlighted = useHighlight(body.id);
  const color = body.appearance?.color ?? FALLBACK_COLOR;
  const opacity = body.appearance?.opacity ?? 0.85;
  const isPulley = useSceneStore((s) => s.project?.ropes.some((r) => r.pulleys?.includes(body.id)) ?? false);
  const geometry = useMemo(() => flatGeometry(body, isPulley), [body, isPulley]);
  // 2D world = X–Z plane: Y is depth (out of the camera); body rotation is about Y.
  const position: Vec3 = [body.initial.position[0], 0, body.initial.position[2]];

  return (
    <EntityGroup id={body.id} position={position} rotation={body.initial.rotation}>
      <mesh geometry={geometry} rotation={[Math.PI / 2, 0, 0]}>
        <meshBasicMaterial
          color={highlighted ? "#22d3ee" : color}
          transparent
          opacity={opacity}
          side={THREE.DoubleSide}
        />
        <Edges color={highlighted ? "#a5f3fc" : "#d4d4d8"} />
      </mesh>
    </EntityGroup>
  );
}

export function StaticEntity2D({ stat }: { stat: StaticEntityType }) {
  const highlighted = useHighlight(stat.id);
  const color = stat.appearance?.color ?? "#3f3f46";
  const isGround = stat.kind === "ground";
  const extent0 = num(stat.plane.extent[0], isGround ? 20 : 10);
  const extent1 = num(stat.plane.extent[1], isGround ? 20 : 10);

  const geometry = useMemo(() => {
    if (isGround) return new THREE.PlaneGeometry(extent0, 0.08);
    // Walls (normal ±X) appear as vertical lines in the X–Z plane.
    return new THREE.PlaneGeometry(0.08, extent1);
  }, [isGround, extent0, extent1]);

  const position: Vec3 = isGround
    ? [0, 0, stat.position?.[2] ?? 0]
    : [stat.position?.[0] ?? 0, 0, stat.position?.[2] ?? 0];

  // A 2D static rotates only about Y (out-of-plane), like 2D bodies: take the
  // Y (pitch) component of the stored relative rotation so the wall line is
  // inclined at the same angle the physics uses.
  const rotation = useMemo((): Quat => {
    const rel = stat.rotation ?? [0, 0, 0, 1];
    const deg = quatToEulerDeg(rel);
    return eulerDegToQuat([0, deg[1], 0]);
  }, [stat.rotation]);

  return (
    <EntityGroup id={stat.id} position={position} rotation={rotation}>
      <mesh geometry={geometry} rotation={[Math.PI / 2, 0, 0]}>
        <meshBasicMaterial color={highlighted ? "#22d3ee" : color} transparent opacity={0.95} side={THREE.DoubleSide} />
      </mesh>
    </EntityGroup>
  );
}
