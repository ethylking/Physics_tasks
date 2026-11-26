// render/gizmos/AxisArrows.tsx — post-creation axis-constrained move controls.
//
// Six short arrows (+X, −X, +Y, −Y, +Z, −Z) along the freshly created entity's
// local axes (2D mode shows X and Z only). Dragging an arrow moves the entity
// so it follows the cursor, but the movement vector is projected onto that
// axis: the cursor ray is intersected with a billboard plane through the
// entity anchor (works for both perspective and orthographic cameras), and the
// projected cursor displacement is written back via `writeTransform` (which
// applies the 2D clamps and connector anchor math). The grab offset is
// preserved, so the entity moves 1:1 with the cursor along the axis.

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { useThree } from "@react-three/fiber";
import type { ThreeEvent } from "@react-three/fiber";
import type { Quat, RigidBodyEntity, Vec3 } from "../../core/types";
import type { EntityCategory, SceneEntity } from "../../stores/sceneStore";
import { findEntityInProject, useSceneStore } from "../../stores/sceneStore";
import { entityWorldPosition } from "../entities/positions";
import { bodyLocalSnapPoints } from "./snapping";

/**
 * Module-level drag flag shared with SpawnController: while an axis arrow is
 * being dragged, the spawn tool's ghost preview must not chase the cursor
 * (and its click logic must not fire a placement).
 */
export const axisArrowDrag = { down: false };

const SHAFT_LEN = 0.42;
const SHAFT_R = 0.018;
const HEAD_LEN = 0.14;
const HEAD_R = 0.055;
/** Gap between the entity surface and the arrow start. */
const MARGIN = 0.16;
/** Radius of the invisible, fat hit cylinder around each arrow. */
const HIT_R = 0.1;

interface ArrowDef {
  /** Local axis direction (unit). */
  dir: Vec3;
  axis: 0 | 1 | 2;
  sign: 1 | -1;
  color: string;
  hoverColor: string;
}

const ARROWS_3D: ArrowDef[] = [
  { dir: [1, 0, 0], axis: 0, sign: 1, color: "#ef4444", hoverColor: "#fca5a5" },
  { dir: [-1, 0, 0], axis: 0, sign: -1, color: "#b91c1c", hoverColor: "#f87171" },
  { dir: [0, 1, 0], axis: 1, sign: 1, color: "#22c55e", hoverColor: "#86efac" },
  { dir: [0, -1, 0], axis: 1, sign: -1, color: "#15803d", hoverColor: "#4ade80" },
  { dir: [0, 0, 1], axis: 2, sign: 1, color: "#3b82f6", hoverColor: "#93c5fd" },
  { dir: [0, 0, -1], axis: 2, sign: -1, color: "#1d4ed8", hoverColor: "#60a5fa" },
];

/** In the 2D X–Z workspace the out-of-plane ±Y arrows are meaningless. */
function arrowsFor(flat: boolean): ArrowDef[] {
  return flat ? ARROWS_3D.filter((a) => a.axis !== 1) : ARROWS_3D;
}

/** Distance from the entity anchor to the arrow start (outside the geometry). */
function outerRadiusOf(entity: SceneEntity, category: EntityCategory): number {
  if (category !== "bodies") return 0.42;
  const body = entity as RigidBodyEntity;
  let max = 0.01;
  for (const p of bodyLocalSnapPoints(body)) {
    const d = Math.hypot(p.point[0], p.point[1], p.point[2]);
    if (d > max) max = d;
  }
  return max + MARGIN;
}

interface AxisArrowsProps {
  entity: SceneEntity;
  category: EntityCategory;
  flat: boolean;
}

export function AxisArrows({ entity, category, flat }: AxisArrowsProps) {
  const project = useSceneStore((s) => s.project);
  const writeTransform = useSceneStore((s) => s.writeTransform);
  const { camera, gl } = useThree();
  const [hovered, setHovered] = useState<string | null>(null);

  const raycaster = useMemo(() => new THREE.Raycaster(), []);
  const dragRef = useRef<{
    axis: THREE.Vector3;
    start: THREE.Vector3;
    startHit: THREE.Vector3;
    plane: THREE.Plane;
  } | null>(null);
  const moveRef = useRef<((ev: PointerEvent) => void) | null>(null);
  const upRef = useRef<((ev: PointerEvent) => void) | null>(null);

  // The arrows live in the entity's LOCAL frame ("inner axes").
  const rotation: Quat =
    category === "bodies" ? (entity as RigidBodyEntity).initial.rotation : [0, 0, 0, 1];

  const anchor: Vec3 = project ? entityWorldPosition(project, category, entity) : [0, 0, 0];
  const outerR = outerRadiusOf(entity, category);
  const arrows = useMemo(() => arrowsFor(flat), [flat]);

  const quats = useMemo(
    () =>
      arrows.map((a) =>
        new THREE.Quaternion().setFromUnitVectors(
          new THREE.Vector3(0, 1, 0),
          new THREE.Vector3(a.dir[0], a.dir[1], a.dir[2]),
        ),
      ),
    [arrows],
  );

  // Tear down a live drag if the component unmounts mid-drag.
  useEffect(() => {
    return () => {
      moveRef.current && window.removeEventListener("pointermove", moveRef.current);
      upRef.current && window.removeEventListener("pointerup", upRef.current);
      upRef.current && window.removeEventListener("pointercancel", upRef.current);
      axisArrowDrag.down = false;
    };
  }, []);

  if (!project) return null;

  const startDrag = (e: ThreeEvent<PointerEvent>, arrow: ArrowDef) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const state = useSceneStore.getState();
    const p = state.project;
    if (!p) return;
    const found = findEntityInProject(p, entity.id);
    if (!found) return;

    const axis = new THREE.Vector3(arrow.dir[0], arrow.dir[1], arrow.dir[2])
      .applyQuaternion(new THREE.Quaternion(rotation[0], rotation[1], rotation[2], rotation[3]))
      .normalize();
    const start = new THREE.Vector3(...entityWorldPosition(p, found.category, found.entity));

    // Drag plane through the anchor, facing the camera (billboard). The cursor
    // ray always crosses it (perspective AND orthographic cameras — a plane
    // spanned by the axis and the view direction would be parallel to
    // orthographic rays and never intersect), and the hit point is the cursor's
    // world position at the entity's depth. Projecting the hit − start vector
    // onto the axis is exactly "follow the cursor, moved along the axis".
    const view = new THREE.Vector3();
    camera.getWorldDirection(view);
    const normal = view.clone().negate();
    const plane = new THREE.Plane(normal, -normal.dot(start));

    // Cursor world position on the drag plane (shared by the grab and moves).
    const raycastPlane = (clientX: number, clientY: number): THREE.Vector3 | null => {
      const rect = gl.domElement.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return null;
      const ndc = new THREE.Vector2(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -((clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(ndc, camera);
      const hit = new THREE.Vector3();
      return raycaster.ray.intersectPlane(plane, hit) ? hit : null;
    };

    // Remember the grab point so the entity moves by exactly the cursor's
    // projected movement (the grab offset is preserved — no jump on grab).
    const startHit = raycastPlane(e.nativeEvent.clientX, e.nativeEvent.clientY);
    if (!startHit) return;
    dragRef.current = { axis, start, startHit, plane };
    axisArrowDrag.down = true;

    const onMove = (ev: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const hit = raycastPlane(ev.clientX, ev.clientY);
      if (!hit) return;
      // Project the cursor displacement onto the axis.
      const t = hit.sub(d.startHit).dot(d.axis);
      const target: Vec3 = [
        d.start.x + d.axis.x * t,
        d.start.y + d.axis.y * t,
        d.start.z + d.axis.z * t,
      ];
      writeTransform(entity.id, target, rotation);
    };
    const onUp = () => {
      dragRef.current = null;
      moveRef.current = null;
      upRef.current = null;
      axisArrowDrag.down = false;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
    moveRef.current = onMove;
    upRef.current = onUp;
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  const arrowGroups = arrows.map((a, i) => {
    const key = `${a.axis}${a.sign}`;
    const isHovered = hovered === key;
    const color = isHovered ? a.hoverColor : a.color;
    const scale: [number, number, number] = isHovered ? [1.3, 1, 1.3] : [1, 1, 1];
    return (
      // R3F only delivers pointer events to raycastable MESHES — the handlers
      // live on the fat invisible hit cylinder, not on this group.
      <group
        key={key}
        quaternion={quats[i]!.toArray() as unknown as [number, number, number, number]}
      >
        <mesh position={[0, outerR + SHAFT_LEN / 2, 0]} scale={scale} renderOrder={100}>
          <cylinderGeometry args={[SHAFT_R, SHAFT_R, SHAFT_LEN, 10]} />
          <meshBasicMaterial color={color} transparent depthTest={false} depthWrite={false} />
        </mesh>
        <mesh position={[0, outerR + SHAFT_LEN + HEAD_LEN / 2, 0]} scale={scale} renderOrder={100}>
          <coneGeometry args={[HEAD_R, HEAD_LEN, 12]} />
          <meshBasicMaterial color={color} transparent depthTest={false} depthWrite={false} />
        </mesh>
        {/* Fat invisible hit target — opacity 0 keeps it raycastable. */}
        <mesh
          position={[0, outerR + (SHAFT_LEN + HEAD_LEN) / 2, 0]}
          onPointerDown={(e) => startDrag(e, a)}
          onPointerOver={(e) => {
            e.stopPropagation();
            setHovered(key);
          }}
          onPointerOut={() => setHovered((h) => (h === key ? null : h))}
        >
          <cylinderGeometry args={[HIT_R, HIT_R, SHAFT_LEN + HEAD_LEN, 6]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
      </group>
    );
  });

  return (
    <group position={anchor} quaternion={rotation as unknown as [number, number, number, number]}>
      {arrowGroups}
    </group>
  );
}
