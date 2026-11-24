// render/gizmos/snapping.ts — semantic anchor snapping (§5.2 / Milestone 2).
//
// Pure math over the schema: computes snap points on Tier 1 entities (CoM,
// geometric center, face centers, box/wedge vertices, sphere/cylinder rim
// points, rod ends, pulley axle/rim) in WORLD coordinates and finds the nearest
// candidate within a magnetic radius.

import type { MechProject, ProjectMode, Quat, RigidBodyEntity, StaticEntity, Vec3 } from "../../core/types";
import { halfHeightOf } from "../../core/defaults";
import { localToWorld } from "../../math/rotation";

export type SnapKind = "center" | "com" | "face" | "vertex" | "rim" | "end" | "surface";

export interface SnapPoint {
  /** Id of the entity that owns the anchor. */
  ownerId: string;
  kind: SnapKind;
  /** World-space anchor position. */
  point: Vec3;
  label: string;
}

/** Default magnetic radius (world units) for ghost snapping. */
export const SNAP_RADIUS = 0.4;

interface LocalAnchor {
  kind: SnapKind;
  point: Vec3;
  label: string;
}

// -----------------------------------------------------------------------------
// Small vec helpers (kept local — no three dependency in this module)
// -----------------------------------------------------------------------------

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function normalize(v: Vec3): Vec3 {
  const len = Math.hypot(v[0], v[1], v[2]);
  if (len < 1e-9) return [0, 0, 1];
  return [v[0] / len, v[1] / len, v[2] / len];
}

function dist3(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** A unit-vector basis (u, v) spanning the plane perpendicular to `normal`. */
function planeBasis(normal: Vec3): [Vec3, Vec3] {
  // Keep the ground's extents aligned with world X/Y.
  if (Math.abs(normal[2]) > 0.999) return [[1, 0, 0], [0, 1, 0]];
  const ref: Vec3 = Math.abs(normal[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const u = normalize(cross(ref, normal));
  const v = cross(normal, u);
  return [u, v];
}

// -----------------------------------------------------------------------------
// Body anchors
// -----------------------------------------------------------------------------

function num(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** Local-space snap points for a Tier 1 body. */
export function bodyLocalSnapPoints(body: RigidBodyEntity): LocalAnchor[] {
  const out: LocalAnchor[] = [
    { kind: "center", point: [0, 0, 0], label: "geometric center" },
    { kind: "com", point: [...body.centerOfMass] as Vec3, label: "center of mass" },
  ];
  const g = body.geometry;

  switch (body.kind) {
    case "box": {
      const hw = num(g.box?.W, 1) / 2;
      const hh = num(g.box?.H, 1) / 2; // Z (up)
      const hd = num(g.box?.D, 1) / 2; // Y (depth)
      out.push(
        { kind: "face", point: [hw, 0, 0], label: "+X face" },
        { kind: "face", point: [-hw, 0, 0], label: "-X face" },
        { kind: "face", point: [0, hd, 0], label: "+Y face" },
        { kind: "face", point: [0, -hd, 0], label: "-Y face" },
        { kind: "face", point: [0, 0, hh], label: "+Z face" },
        { kind: "face", point: [0, 0, -hh], label: "-Z face" },
      );
      // Eight vertices: W on X, D on Y, H on Z.
      for (const sx of [-1, 1]) {
        for (const sy of [-1, 1]) {
          for (const sz of [-1, 1]) {
            out.push({ kind: "vertex", point: [sx * hw, sy * hd, sz * hh], label: "box vertex" });
          }
        }
      }
      break;
    }
    case "sphere": {
      const R = num(g.sphere?.R, 0.5);
      out.push(
        { kind: "rim", point: [R, 0, 0], label: "sphere +X" },
        { kind: "rim", point: [-R, 0, 0], label: "sphere -X" },
        { kind: "rim", point: [0, R, 0], label: "sphere +Y" },
        { kind: "rim", point: [0, -R, 0], label: "sphere -Y" },
        { kind: "rim", point: [0, 0, R], label: "sphere +Z" },
        { kind: "rim", point: [0, 0, -R], label: "sphere -Z" },
      );
      break;
    }
    case "ellipsoid": {
      const a = num(g.ellipsoid?.a, 0.5);
      const b = num(g.ellipsoid?.b, 0.5);
      const c = num(g.ellipsoid?.c, 0.5);
      out.push(
        { kind: "rim", point: [a, 0, 0], label: "ellipsoid +a" },
        { kind: "rim", point: [-a, 0, 0], label: "ellipsoid -a" },
        { kind: "rim", point: [0, b, 0], label: "ellipsoid +b" },
        { kind: "rim", point: [0, -b, 0], label: "ellipsoid -b" },
        { kind: "rim", point: [0, 0, c], label: "ellipsoid +c" },
        { kind: "rim", point: [0, 0, -c], label: "ellipsoid -c" },
      );
      break;
    }
    case "cylinder": {
      const R = num(g.cylinder?.R, 0.5);
      const hh = num(g.cylinder?.H, 1) / 2;
      out.push(
        // Cylinder axis is local +Z.
        { kind: "rim", point: [0, 0, hh], label: "axle top" },
        { kind: "rim", point: [0, 0, -hh], label: "axle bottom" },
        // rim tangents in the X–Y cross-section
        { kind: "rim", point: [R, 0, hh], label: "rim top +X" },
        { kind: "rim", point: [-R, 0, hh], label: "rim top -X" },
        { kind: "rim", point: [R, 0, -hh], label: "rim bottom +X" },
        { kind: "rim", point: [-R, 0, -hh], label: "rim bottom -X" },
        { kind: "rim", point: [R, 0, 0], label: "side +X" },
        { kind: "rim", point: [-R, 0, 0], label: "side -X" },
        { kind: "rim", point: [0, R, 0], label: "side +Y" },
        { kind: "rim", point: [0, -R, 0], label: "side -Y" },
      );
      break;
    }
    case "rod": {
      const hl = num(g.rod?.L, 1) / 2;
      out.push(
        { kind: "end", point: [hl, 0, 0], label: "rod end +X" },
        { kind: "end", point: [-hl, 0, 0], label: "rod end -X" },
      );
      break;
    }
    case "wedge": {
      const theta = (num(g.wedge?.thetaDeg, 30) * Math.PI) / 180;
      const W = num(g.wedge?.W, 1);
      const H = num(g.wedge?.H, 0.5);
      const D = num(g.wedge?.D, 1);
      const hw = W / 2;
      const hh = H / 2;
      const hd = D / 2;
      const frontTop = Math.max(0.02 * H, H - W * Math.tan(theta)) - H / 2;
      out.push(
        { kind: "face", point: [0, 0, -hh], label: "wedge base" },
        { kind: "face", point: [-hw, 0, 0], label: "wedge back" },
        { kind: "face", point: [hw, 0, (frontTop - hh) / 2], label: "wedge front" },
        { kind: "face", point: [0, 0, (frontTop + hh) / 2], label: "wedge slope" },
      );
      // 8 corners of the trapezoidal prism: X width, Y depth, Z height.
      for (const sx of [-1, 1]) {
        const zTop = sx === -1 ? hh : frontTop;
        for (const sy of [-1, 1]) {
          out.push({ kind: "vertex", point: [sx * hw, sy * hd, zTop], label: "wedge vertex" });
          out.push({ kind: "vertex", point: [sx * hw, sy * hd, -hh], label: "wedge vertex" });
        }
      }
      break;
    }
    default:
      break;
  }
  return out;
}

/** World-space snap points for a body (position + rotation applied). */
export function computeBodySnapPoints(body: RigidBodyEntity): SnapPoint[] {
  const { position, rotation } = body.initial;
  return bodyLocalSnapPoints(body).map((a) => ({
    ownerId: body.id,
    kind: a.kind,
    point: localToWorld(a.point, position, rotation),
    label: a.label,
  }));
}

// -----------------------------------------------------------------------------
// Static anchors
// -----------------------------------------------------------------------------

function computeStaticSnapPoints(stat: StaticEntity): SnapPoint[] {
  const normal = stat.plane.normal;
  const ex = num(stat.plane.extent[0], 10);
  const ey = num(stat.plane.extent[1], 10);
  const [u, v] = planeBasis(normal);
  const center: Vec3 = [...(stat.position ?? [0, 0, 0])] as Vec3;
  const out: SnapPoint[] = [{ ownerId: stat.id, kind: "surface", point: center, label: "surface center" }];
  for (const su of [-1, 1]) {
    for (const sv of [-1, 1]) {
      out.push({
        ownerId: stat.id,
        kind: "surface",
        point: [
          center[0] + (su * u[0] * ex) / 2 + (sv * v[0] * ey) / 2,
          center[1] + (su * u[1] * ex) / 2 + (sv * v[1] * ey) / 2,
          center[2] + (su * u[2] * ex) / 2 + (sv * v[2] * ey) / 2,
        ],
        label: "surface corner",
      });
    }
  }
  return out;
}

// -----------------------------------------------------------------------------
// Project-wide snapping
// -----------------------------------------------------------------------------

/**
 * All snap candidates for the current scene. In 2D mode (X–Z workspace) every
 * point is projected onto the Y = 0 plane (§4.5).
 */
export function computeSnapPoints(project: MechProject, mode: ProjectMode): SnapPoint[] {
  const points: SnapPoint[] = [];
  for (const body of project.bodies) {
    points.push(...computeBodySnapPoints(body));
  }
  for (const stat of project.statics) {
    points.push(...computeStaticSnapPoints(stat));
  }
  if (mode === "2D") {
    for (const p of points) p.point = [p.point[0], 0, p.point[2]];
  }
  return points;
}

/** Nearest candidate within `radius`, or null. */
export function findSnap(point: Vec3, candidates: SnapPoint[], radius: number = SNAP_RADIUS): SnapPoint | null {
  let best: SnapPoint | null = null;
  let bestDist = radius;
  for (const c of candidates) {
    const d = dist3(point, c.point);
    if (d <= bestDist) {
      bestDist = d;
      best = c;
    }
  }
  return best;
}

/** Resting position for a body spawned at surface point `p` (+Z is up). */
export function liftBodyPoint(kind: string, p: Vec3, mode: ProjectMode): Vec3 {
  const half = halfHeightOf(kind);
  return [p[0], mode === "2D" ? 0 : p[1], p[2] + half];
}

export type { Quat };
