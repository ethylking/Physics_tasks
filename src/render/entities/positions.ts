// render/entities/positions.ts — edit-time world anchors of entities and
// delta-based translation back into the schema (§5.2 selection).
//
// Bodies carry `initial.position`; statics and connectors do not. Their
// placement is derived from plane positions, anchors, and path points. The
// transform gizmo needs a single world anchor per entity plus a way to translate
// that anchor back into the entity's defining fields.

import type {
  ForceEntity,
  JointEntity,
  MechProject,
  MeterEntity,
  Quat,
  RigidBodyEntity,
  RopeEntity,
  StaticEntity,
  Vec3,
} from "../../core/types";
import { localToWorld, quatInvert, quatMultiply, rotateVec3ByQuat } from "../../math/rotation";
import type { EntityCategory } from "../../stores/sceneStore";

export const ORIGIN: Vec3 = [0, 0, 0];

/** Identity quaternion. */
export const IDENTITY_QUAT: Quat = [0, 0, 0, 1];

/**
 * Quaternion rotating +Z onto `normal` (the plane's base orientation).
 * `normal` is assumed ≈ unit or is normalized here; the degenerate
 * n ≈ −Z case rotates 180° about +X, and n ≈ +Z returns the identity.
 */
export function staticBaseQuat(normal: Vec3): Quat {
  const [nx, ny, nz] = normal;
  const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
  const x = nx / len;
  const y = ny / len;
  const z = nz / len;
  const dotZ = z; // dot(n, +Z)
  if (dotZ > 0.9999) return [0, 0, 0, 1];
  if (dotZ < -0.9999) return [1, 0, 0, 0]; // 180° about +X
  // axis = normalize(cross(Z, n)) = normalize(-y, x, 0)
  const ax = -y;
  const ay = x;
  const axisLen = Math.sqrt(ax * ax + ay * ay);
  const ux = ax / axisLen;
  const uy = ay / axisLen;
  const angle = Math.acos(Math.min(1, Math.max(-1, dotZ)));
  const s = Math.sin(angle / 2);
  return [ux * s, uy * s, 0, Math.cos(angle / 2)];
}

/** World quaternion of a static plane mesh: baseQuat(normal) × rotation. */
export function staticWorldQuat(stat: StaticEntity): Quat {
  return quatMultiply(staticBaseQuat(stat.plane.normal), stat.rotation ?? IDENTITY_QUAT);
}

function add3(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function bodyById(project: MechProject, id: string | null | undefined): RigidBodyEntity | null {
  return id ? (project.bodies.find((b) => b.id === id) ?? null) : null;
}

/** Resolve a stored anchor (body-local when `bodyId` is set, world otherwise). */
export function anchorWorld(
  project: MechProject,
  point: Vec3 | undefined,
  bodyId: string | null | undefined,
): Vec3 {
  if (!point) return [...ORIGIN] as Vec3;
  if (!bodyId) return [...point] as Vec3;
  const body = bodyById(project, bodyId);
  if (!body) return [...point] as Vec3;
  return localToWorld(point, body.initial.position, body.initial.rotation);
}

export function jointWorldPosition(project: MechProject, joint: JointEntity): Vec3 {
  return anchorWorld(project, joint.anchors.a, joint.bodyA);
}

export function forceWorldPosition(project: MechProject, force: ForceEntity): Vec3 {
  if (force.anchor) return anchorWorld(project, force.anchor, force.body);
  if (force.body) {
    const b = bodyById(project, force.body);
    if (b) return [...b.initial.position] as Vec3;
  }
  return [...ORIGIN] as Vec3;
}

export function ropeWorldPosition(project: MechProject, rope: RopeEntity): Vec3 {
  const first = rope.path[0];
  if (!first) return [...ORIGIN] as Vec3;
  return anchorWorld(project, first.point, first.anchorId || null);
}

export function meterWorldPosition(project: MechProject, meter: MeterEntity): Vec3 {
  if (meter.position) return [...meter.position] as Vec3;
  const target = meter.target ? bodyById(project, meter.target) : null;
  return target ? ([...target.initial.position] as Vec3) : ([...ORIGIN] as Vec3);
}

/** World anchor of any entity (gizmo target + delta reference). */
export function entityWorldPosition(
  project: MechProject,
  category: EntityCategory,
  entity: unknown,
): Vec3 {
  switch (category) {
    case "bodies":
      return [...(entity as RigidBodyEntity).initial.position] as Vec3;
    case "statics":
      return [...((entity as StaticEntity).position ?? ORIGIN)] as Vec3;
    case "joints":
      return jointWorldPosition(project, entity as JointEntity);
    case "forces":
      return forceWorldPosition(project, entity as ForceEntity);
    case "ropes":
      return ropeWorldPosition(project, entity as RopeEntity);
    case "meters":
      return meterWorldPosition(project, entity as MeterEntity);
    default:
      return [...ORIGIN] as Vec3;
  }
}

/** Translate a stored anchor (world or body-local) by a WORLD `delta`. */
function translatePoint(
  point: Vec3,
  bodyId: string | null | undefined,
  project: MechProject,
  delta: Vec3,
): Vec3 {
  const body = bodyById(project, bodyId);
  if (!body) return add3(point, delta);
  const localDelta = rotateVec3ByQuat(delta, quatInvert(body.initial.rotation));
  return add3(point, localDelta);
}

/**
 * Return a shallow copy of `entity` translated by a WORLD `delta`, applied to
 * the category's defining points. Statics/meters are handled as absolute
 * positions by the caller (they own a `position` field).
 */
export function translateEntityByDelta(
  project: MechProject,
  category: EntityCategory,
  entity: unknown,
  delta: Vec3,
): unknown {
  switch (category) {
    case "joints": {
      const j = entity as JointEntity;
      return {
        ...j,
        anchors: {
          a: translatePoint(j.anchors.a, j.bodyA, project, delta),
          b: translatePoint(j.anchors.b, j.bodyB, project, delta),
        },
      };
    }
    case "forces": {
      const f = entity as ForceEntity;
      if (!f.anchor) return f;
      return { ...f, anchor: translatePoint(f.anchor, f.body, project, delta) };
    }
    case "ropes": {
      const r = entity as RopeEntity;
      return {
        ...r,
        path: r.path.map((p) => ({
          ...p,
          point: translatePoint(p.point, p.anchorId || null, project, delta),
        })),
      };
    }
    default:
      return entity;
  }
}
