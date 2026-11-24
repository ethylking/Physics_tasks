// math/inertia.ts — mass-properties pipeline (§2.3).
//
//  1. Analytic geometric-center inertia tensors `I_geo` for every Tier 1 body.
//  2. Rod with custom linear density λ(x): numeric Simpson integration → exact
//     M, r_CM, I_CM (same machinery computes the uniform case).
//  3. Wedge: right-triangular/trapezoidal prism centroid + inertia via Simpson
//     over the side profile (verified against textbook triangle values).
//  4. Parallel-Axis (Steiner): I_CM = I_geo − m(|d|²E − d⊗d), d = r_CM − r_geo.
//  5. Jacobi eigenvalue diagonalization → principal moments + principal frame
//     quaternion for Rapier's `setAdditionalMassProperties`. Principal moments
//     are clamped to ≥ 1e-9 (§4.6: zero-inertia degeneracies never crash).

import type { Quat, RigidBodyEntity, Vec3 } from "../core/types";
import { compileExpression } from "./expr";

const EPS_PRINCIPAL = 1e-9;
const EPS_MASS = 1e-6;
const EPS_DIM = 1e-4; // §4.6 ε_geo

function num(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function clampDim(v: number): number {
  return Math.max(EPS_DIM, v);
}

function clampMass(m: number): number {
  return Number.isFinite(m) ? Math.max(EPS_MASS, m) : EPS_MASS;
}

export interface MassProperties {
  mass: number;
  /** CoM in the body's local frame (relative to the geometric center). */
  centerOfMass: Vec3;
  /** Inertia tensor at the GEOMETRIC center (3×3 symmetric, row-major). */
  inertiaGeo: number[];
  /** Inertia tensor at the center of mass. */
  inertiaCM: number[];
  /** Principal moments, ascending. */
  principalInertia: Vec3;
  /** Rotation mapping the principal axes into the body local frame. */
  principalFrame: Quat;
}

const DIAG = (xx: number, yy: number, zz: number): number[] => [xx, 0, 0, 0, yy, 0, 0, 0, zz];

function dDotD(d: Vec3): number {
  return d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
}

/** I_point = I_cm + m(|d|²E − d⊗d), d = r_point − r_cm. */
export function shiftCMToPoint(Icm: number[], mass: number, d: Vec3): number[] {
  const s = mass * dDotD(d);
  const m = mass;
  return [
    Icm[0]! + s - m * d[0] * d[0],
    Icm[1]! - m * d[0] * d[1],
    Icm[2]! - m * d[0] * d[2],
    Icm[3]! - m * d[1] * d[0],
    Icm[4]! + s - m * d[1] * d[1],
    Icm[5]! - m * d[1] * d[2],
    Icm[6]! - m * d[2] * d[0],
    Icm[7]! - m * d[2] * d[1],
    Icm[8]! + s - m * d[2] * d[2],
  ];
}

/** I_cm = I_point − m(|d|²E − d⊗d), d = r_cm − r_point (§2.3). */
export function shiftPointToCM(Ipoint: number[], mass: number, d: Vec3): number[] {
  const s = mass * dDotD(d);
  const m = mass;
  return [
    Ipoint[0]! - s + m * d[0] * d[0],
    Ipoint[1]! + m * d[0] * d[1],
    Ipoint[2]! + m * d[0] * d[2],
    Ipoint[3]! + m * d[1] * d[0],
    Ipoint[4]! - s + m * d[1] * d[1],
    Ipoint[5]! + m * d[1] * d[2],
    Ipoint[6]! + m * d[2] * d[0],
    Ipoint[7]! + m * d[2] * d[1],
    Ipoint[8]! - s + m * d[2] * d[2],
  ];
}

function symmetrize(I: number[]): number[] {
  return [
    I[0]!,
    (I[1]! + I[3]!) / 2,
    (I[2]! + I[6]!) / 2,
    (I[1]! + I[3]!) / 2,
    I[4]!,
    (I[5]! + I[7]!) / 2,
    (I[2]! + I[6]!) / 2,
    (I[5]! + I[7]!) / 2,
    I[8]!,
  ];
}

// -----------------------------------------------------------------------------
// Volumes (density mass-mode only)
// -----------------------------------------------------------------------------

function volumeOfBody(body: RigidBodyEntity): number {
  const g = body.geometry;
  switch (body.kind) {
    case "box": {
      const W = clampDim(num(g.box?.W, 1));
      const H = clampDim(num(g.box?.H, 1));
      const D = clampDim(num(g.box?.D, 1));
      return W * H * D;
    }
    case "sphere": {
      const R = clampDim(num(g.sphere?.R, 0.5));
      return g.sphere?.shell ? 4 * Math.PI * R * R * 0.02 * R : (4 / 3) * Math.PI * R * R * R;
    }
    case "ellipsoid": {
      const a = clampDim(num(g.ellipsoid?.a, 0.5));
      const b = clampDim(num(g.ellipsoid?.b, 0.5));
      const c = clampDim(num(g.ellipsoid?.c, 0.5));
      return (4 / 3) * Math.PI * a * b * c;
    }
    case "cylinder": {
      const R = clampDim(num(g.cylinder?.R, 0.5));
      const H = clampDim(num(g.cylinder?.H, 1));
      if (g.cylinder?.hollow) return Math.PI * H * (R * R - Math.pow(0.95 * R, 2));
      return Math.PI * R * R * H;
    }
    case "rod": {
      const L = clampDim(num(g.rod?.L, 1));
      const t = clampDim(num(g.rod?.thickness, 0.05));
      return L * t * t;
    }
    case "wedge": {
      const W = clampDim(num(g.wedge?.W, 1));
      const H = clampDim(num(g.wedge?.H, 0.5));
      const D = clampDim(num(g.wedge?.D, 1));
      const fH = wedgeFrontHeight(num(g.wedge?.thetaDeg, 30), W, H);
      return ((H + fH) / 2) * W * D;
    }
    default:
      return 1;
  }
}

export function wedgeFrontHeight(thetaDeg: number, W: number, H: number): number {
  return Math.max(0.02 * H, H - W * Math.tan((thetaDeg * Math.PI) / 180));
}

// -----------------------------------------------------------------------------
// Analytic geometric-center tensors
// -----------------------------------------------------------------------------

function geometricInertia(kind: string, g: RigidBodyEntity["geometry"], mass: number): number[] {
  switch (kind) {
    case "box": {
      const W = clampDim(num(g.box?.W, 1)); // X
      const H = clampDim(num(g.box?.H, 1)); // Z (up)
      const D = clampDim(num(g.box?.D, 1)); // Y (depth)
      return DIAG(
        (mass / 12) * (D * D + H * H),
        (mass / 12) * (W * W + H * H),
        (mass / 12) * (W * W + D * D),
      );
    }
    case "sphere": {
      const R = clampDim(num(g.sphere?.R, 0.5));
      const k = g.sphere?.shell ? 2 / 3 : 2 / 5;
      const I = k * mass * R * R;
      return DIAG(I, I, I);
    }
    case "ellipsoid": {
      const a = clampDim(num(g.ellipsoid?.a, 0.5));
      const b = clampDim(num(g.ellipsoid?.b, 0.5));
      const c = clampDim(num(g.ellipsoid?.c, 0.5));
      return DIAG((mass / 5) * (b * b + c * c), (mass / 5) * (a * a + c * c), (mass / 5) * (a * a + b * b));
    }
    case "cylinder": {
      const R = clampDim(num(g.cylinder?.R, 0.5));
      const H = clampDim(num(g.cylinder?.H, 1)); // height along local +Z
      if (g.cylinder?.hollow) {
        // thin hoop: I_axis = mR², I_perp = m(6R² + H²)/12
        const axis = mass * R * R;
        const perp = (mass * (6 * R * R + H * H)) / 12;
        return DIAG(perp, perp, axis);
      }
      const axis = 0.5 * mass * R * R;
      const perp = (mass * (3 * R * R + H * H)) / 12;
      return DIAG(perp, perp, axis);
    }
    default:
      return DIAG(mass, mass, mass);
  }
}

// -----------------------------------------------------------------------------
// Rod with linear density λ(x), x ∈ [0, L] (Simpson, 1024 intervals)
// -----------------------------------------------------------------------------

export interface RodMassProperties {
  mass: number;
  /** density-distribution CoM measured from the x = 0 end. */
  rcm: number;
  /** I about the perpendicular axes through the density CoM (thin rod). */
  iPerpAboutCM: number;
}

export function rodLambdaProperties(L: number, thickness: number, densityExpr?: string): RodMassProperties {
  void thickness; // cross-section correction applied by the caller
  if (densityExpr && densityExpr.trim() !== "") {
    const compiled = compileExpression(densityExpr);
    if (!compiled.ok) {
      return { mass: EPS_MASS, rcm: L / 2, iPerpAboutCM: EPS_PRINCIPAL };
    }
    const lam = (s: number): number => Math.max(0, compiled.fn({ x: s }));
    const N = 1024;
    const h = L / N;
    let M = 0;
    let Mcm = 0;
    let I2 = 0;
    const f = (s: number): number => lam(s);
    for (let i = 0; i <= N; i++) {
      const s = i * h;
      const w = i === 0 || i === N ? 1 : i % 2 === 1 ? 4 : 2;
      const v = f(s);
      M += w * v;
      Mcm += w * v * s;
      I2 += w * v * s * s;
    }
    M *= h / 3;
    Mcm *= h / 3;
    I2 *= h / 3;
    if (!(M > EPS_MASS)) return { mass: EPS_MASS, rcm: L / 2, iPerpAboutCM: EPS_PRINCIPAL };
    const rcm = Mcm / M;
    const iCM = Math.max(0, I2 - M * rcm * rcm);
    return { mass: M, rcm, iPerpAboutCM: iCM };
  }
  // uniform rod
  const mass = 1;
  return { mass, rcm: L / 2, iPerpAboutCM: (mass * L * L) / 12 };
}

// -----------------------------------------------------------------------------
// Wedge (trapezoidal prism) — Simpson over the side profile
// -----------------------------------------------------------------------------

interface WedgeIntegrals {
  cx: number;
  cy: number;
  ixx: number; // per-length, about centroid, in-plane horizontal axis
  iyy: number; // per-length, about centroid, in-plane vertical axis
  izz: number;
  ixy: number;
}

function wedgeProfileIntegrals(W: number, H: number, fH: number): WedgeIntegrals {
  const hw = W / 2;
  const yb = -H / 2;
  const slope = (fH - H) / W;
  const hAt = (x: number): number => H + slope * (x + hw);
  const N = 1024;
  const dx = W / N;
  let A = 0;
  let Sx = 0;
  let Sy = 0;
  let Jxx = 0;
  let Jyy = 0;
  let Jxy = 0;
  for (let i = 0; i <= N; i++) {
    const x = -hw + i * dx;
    const w = i === 0 || i === N ? 1 : i % 2 === 1 ? 4 : 2;
    const h = hAt(x);
    A += w * h;
    Sx += w * x * h;
    Sy += w * (yb + h / 2) * h;
    Jyy += w * x * x * h;
    // ∫ (y - yb)² dy over the strip = h³/3 → second moment about yb
    Jxx += w * (h * h * h) / 3;
    // ∫ (x)(y) over the strip = x·(yb·h + h²/2)
    Jxy += w * x * (yb * h + (h * h) / 2);
  }
  const k = dx / 3;
  A *= k;
  Sx *= k;
  Sy *= k;
  Jxx *= k;
  Jyy *= k;
  Jxy *= k;
  const cx = Sx / A;
  const cy = Sy / A;
  // Jxx = ∫(y−yb)² dA is about the BOTTOM line — shift to the centroid.
  const ixx = Jxx - A * (cy - yb) * (cy - yb);
  const iyy = Jyy - 2 * cx * Sx + cx * cx * A;
  const ixy = -(Jxy - cx * Sy - cy * Sx + cx * cy * A);
  return { cx, cy, ixx, iyy, izz: ixx + iyy, ixy };
}

// -----------------------------------------------------------------------------
// Jacobi eigenvalue diagonalization (symmetric 3×3)
// -----------------------------------------------------------------------------

export interface JacobiResult {
  values: Vec3;
  /** Eigenvectors as matrix columns (3×3 row-major), right-handed rotation. */
  vectors: number[];
}

export function jacobiEigen3(Ain: number[]): JacobiResult {
  const a = [...Ain];
  const v = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const n = 3;
  for (let sweep = 0; sweep < 64; sweep++) {
    let p = 0;
    let q = 1;
    let maxOff = 0;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const val = Math.abs(a[i * 3 + j] ?? 0);
        if (val > maxOff) {
          maxOff = val;
          p = i;
          q = j;
        }
      }
    }
    if (maxOff < 1e-14) break;
    const app = a[p * 3 + p] ?? 0;
    const aqq = a[q * 3 + q] ?? 0;
    const apq = a[p * 3 + q] ?? 0;
    const tau = (aqq - app) / (2 * apq);
    // NOTE: use the sign-of-tau formula, NOT Math.sign — for tau = 0 the
    // correct rotation angle is 45° (Math.sign(0) would freeze the sweep).
    const t = (tau >= 0 ? 1 : -1) / (Math.abs(tau) + Math.sqrt(1 + tau * tau));
    const c = 1 / Math.sqrt(1 + t * t);
    const s = t * c;
    a[p * 3 + p] = app - t * apq;
    a[q * 3 + q] = aqq + t * apq;
    a[p * 3 + q] = 0;
    a[q * 3 + p] = 0;
    for (let k = 0; k < n; k++) {
      if (k === p || k === q) continue;
      const akp = a[k * 3 + p] ?? 0;
      const akq = a[k * 3 + q] ?? 0;
      const nextKp = c * akp - s * akq;
      const nextKq = s * akp + c * akq;
      a[k * 3 + p] = nextKp;
      a[p * 3 + k] = nextKp;
      a[k * 3 + q] = nextKq;
      a[q * 3 + k] = nextKq;
    }
    for (let k = 0; k < n; k++) {
      const vkp = v[k * 3 + p] ?? 0;
      const vkq = v[k * 3 + q] ?? 0;
      v[k * 3 + p] = c * vkp - s * vkq;
      v[k * 3 + q] = s * vkp + c * vkq;
    }
  }
  const raw = [a[0] ?? 0, a[4] ?? 0, a[8] ?? 0];
  const order = [0, 1, 2].sort((x, y) => (raw[x] ?? 0) - (raw[y] ?? 0));
  const values: Vec3 = [raw[order[0]!] ?? 0, raw[order[1]!] ?? 0, raw[order[2]!] ?? 0];
  const vectors: number[] = [];
  for (let k = 0; k < 3; k++) {
    for (let col = 0; col < 3; col++) {
      vectors.push(v[k * 3 + order[col]!] ?? 0);
    }
  }
  // Ensure right-handed rotation matrix (det = +1); flip first column if not.
  const det =
    vectors[0]! * (vectors[4]! * vectors[8]! - vectors[5]! * vectors[7]!) -
    vectors[1]! * (vectors[3]! * vectors[8]! - vectors[5]! * vectors[6]!) +
    vectors[2]! * (vectors[3]! * vectors[7]! - vectors[4]! * vectors[6]!);
  if (det < 0) {
    for (let k = 0; k < 3; k++) vectors[k * 3] = -(vectors[k * 3] ?? 0);
  }
  return { values, vectors };
}

/** Rotation matrix (columns = basis axes) → quaternion (x,y,z,w). */
export function mat3ToQuat(m: number[]): Quat {
  const m00 = m[0] ?? 1;
  const m11 = m[4] ?? 1;
  const m22 = m[8] ?? 1;
  const tr = m00 + m11 + m22;
  let x = 0;
  let y = 0;
  let z = 0;
  let w = 1;
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    w = 0.25 * s;
    x = ((m[5] ?? 0) - (m[7] ?? 0)) / s;
    y = ((m[6] ?? 0) - (m[2] ?? 0)) / s;
    z = ((m[1] ?? 0) - (m[3] ?? 0)) / s;
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    w = ((m[5] ?? 0) - (m[7] ?? 0)) / s;
    x = 0.25 * s;
    y = ((m[1] ?? 0) + (m[3] ?? 0)) / s;
    z = ((m[2] ?? 0) + (m[6] ?? 0)) / s;
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    w = ((m[6] ?? 0) - (m[2] ?? 0)) / s;
    x = ((m[1] ?? 0) + (m[3] ?? 0)) / s;
    y = 0.25 * s;
    z = ((m[5] ?? 0) + (m[7] ?? 0)) / s;
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    w = ((m[1] ?? 0) - (m[3] ?? 0)) / s;
    x = ((m[2] ?? 0) + (m[6] ?? 0)) / s;
    y = ((m[5] ?? 0) + (m[7] ?? 0)) / s;
    z = 0.25 * s;
  }
  const len = Math.hypot(x, y, z, w) || 1;
  return [x / len, y / len, z / len, w / len];
}

// -----------------------------------------------------------------------------
// Full pipeline
// -----------------------------------------------------------------------------

function isZero(v: Vec3): boolean {
  return v[0] === 0 && v[1] === 0 && v[2] === 0;
}

export function computeBodyMassProperties(body: RigidBodyEntity): MassProperties {
  const g = body.geometry;

  let mass: number;
  let Igeo: number[];
  let cDist: Vec3 = [0, 0, 0];

  const densityExpr = body.kind === "rod" ? g.rod?.densityExpr : undefined;

  if (body.kind === "rod") {
    const L = clampDim(num(g.rod?.L, 1));
    const t = clampDim(num(g.rod?.thickness, 0.05));
    if (densityExpr && densityExpr.trim() !== "") {
      const props = rodLambdaProperties(L, t, densityExpr);
      mass = clampMass(props.mass);
      cDist = [props.rcm - L / 2, 0, 0];
      const iPerp = props.iPerpAboutCM + (mass * t * t) / 16;
      const iAxial = (mass * t * t) / 8;
      // The rod lies along local +X: smallest moment about X, equal perpendicular moments.
      Igeo = shiftCMToPoint(DIAG(iAxial, iPerp, iPerp), mass, cDist);
    } else {
      mass = body.mass.mode === "density" ? body.mass.value * L * t * t : body.mass.value;
      mass = clampMass(mass);
      const iPerp = (mass * L * L) / 12 + (mass * t * t) / 16;
      const iAxial = (mass * t * t) / 8;
      Igeo = DIAG(iAxial, iPerp, iPerp);
    }
  } else if (body.kind === "wedge") {
    const thetaDeg = num(g.wedge?.thetaDeg, 30);
    const W = clampDim(num(g.wedge?.W, 1));
    const H = clampDim(num(g.wedge?.H, 0.5));
    const D = clampDim(num(g.wedge?.D, 1));
    mass = body.mass.mode === "density" ? body.mass.value * volumeOfBody(body) : body.mass.value;
    mass = clampMass(mass);
    const fH = wedgeFrontHeight(thetaDeg, W, H);
    const pr = wedgeProfileIntegrals(W, H, fH);
    const A = ((H + fH) / 2) * W;
    const perLength = mass / A;
    // Profile coordinates are (x horizontal, y vertical); the depth D is along
    // world Y whereas the vertical profile axis maps to world Z.
    const ix = perLength * pr.ixx + (mass * D * D) / 12; // about X
    const iy = perLength * pr.izz; // about Y (depth)
    const iz = perLength * pr.iyy + (mass * D * D) / 12; // about Z (up)
    const ixz = perLength * pr.ixy;
    cDist = [pr.cx, 0, pr.cy];
    const Icentroid = [ix, 0, ixz, 0, iy, 0, ixz, 0, iz];
    Igeo = shiftCMToPoint(Icentroid, mass, cDist);
  } else {
    mass = body.mass.mode === "density" ? body.mass.value * volumeOfBody(body) : body.mass.value;
    mass = clampMass(mass);
    Igeo = geometricInertia(body.kind, g, mass);
  }

  // Effective CoM: explicit user offset wins; otherwise adopt the computed
  // density-distribution centroid (rod λ, wedge).
  let centerOfMass: Vec3 = body.centerOfMass;
  if (isZero(centerOfMass) && !isZero(cDist)) {
    centerOfMass = cDist;
  }

  let inertiaCM = shiftPointToCM(Igeo, mass, centerOfMass);
  inertiaCM = symmetrize(inertiaCM);
  const eigen = jacobiEigen3(inertiaCM);
  const principalInertia: Vec3 = [
    clampPrincipal(eigen.values[0]),
    clampPrincipal(eigen.values[1]),
    clampPrincipal(eigen.values[2]),
  ];
  const principalFrame = mat3ToQuat(eigen.vectors);

  return {
    mass,
    centerOfMass,
    inertiaGeo: symmetrize(Igeo),
    inertiaCM,
    principalInertia,
    principalFrame,
  };
}

function clampPrincipal(v: number): number {
  if (!Number.isFinite(v) || v < EPS_PRINCIPAL) return EPS_PRINCIPAL;
  return v;
}
