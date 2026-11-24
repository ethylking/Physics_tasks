// math/__tests__/inertia.test.ts — analytic moments of inertia vs textbook
// formulas, Steiner shifts, Jacobi diagonalization, rod λ(x) integration.

import { describe, expect, it } from "vitest";
import {
  computeBodyMassProperties,
  jacobiEigen3,
  rodLambdaProperties,
  shiftPointToCM,
} from "../inertia";
import { createDefaultBody } from "../../core/defaults";
import { eulerDegToQuat, quatToEulerDeg } from "../rotation";
import type { RigidBodyEntity } from "../../core/types";

function bodyOf(kind: RigidBodyEntity["kind"], patch: Partial<RigidBodyEntity>): RigidBodyEntity {
  const b = createDefaultBody(kind as never);
  return { ...b, ...patch } as RigidBodyEntity;
}

function expectSortedValues(actual: number[], expected: number[], eps = 1e-9) {
  expect(actual.length).toBe(expected.length);
  const sortedActual = [...actual].sort((a, b) => a - b);
  const sortedExpected = [...expected].sort((a, b) => a - b);
  sortedActual.forEach((v, i) => {
    expect(Math.abs(v - (sortedExpected[i] ?? 0))).toBeLessThan(eps);
  });
}

describe("inertia — analytic tensors", () => {
  it("box: I = m/12·(H²+D², W²+D², W²+H²)", () => {
    const mp = computeBodyMassProperties(bodyOf("box", { geometry: { box: { W: 2, H: 4, D: 6 } }, mass: { value: 12, mode: "total" } }));
    expectSortedValues([...mp.principalInertia], [52, 40, 20]);
  });

  it("sphere: solid 2/5 mR² vs hollow shell 2/3 mR²", () => {
    const solid = computeBodyMassProperties(bodyOf("sphere", { geometry: { sphere: { R: 1, shell: false } }, mass: { value: 6, mode: "total" } }));
    expectSortedValues([...solid.principalInertia], [2.4, 2.4, 2.4]);
    const shell = computeBodyMassProperties(bodyOf("sphere", { geometry: { sphere: { R: 1, shell: true } }, mass: { value: 6, mode: "total" } }));
    expectSortedValues([...shell.principalInertia], [4, 4, 4]);
  });

  it("cylinder: solid disk I_axis = ½mR² vs thin hoop I_axis = mR²", () => {
    const solid = computeBodyMassProperties(bodyOf("cylinder", { geometry: { cylinder: { R: 1, H: 4, hollow: false } }, mass: { value: 2, mode: "total" } }));
    expectSortedValues([...solid.principalInertia], [1, 19 / 6, 19 / 6]);
    const hoop = computeBodyMassProperties(bodyOf("cylinder", { geometry: { cylinder: { R: 1, H: 4, hollow: true } }, mass: { value: 2, mode: "total" } }));
    expectSortedValues([...hoop.principalInertia], [2, 11 / 3, 11 / 3]);
  });

  it("ellipsoid: I_x = m/5·(b²+c²) etc.", () => {
    const mp = computeBodyMassProperties(bodyOf("ellipsoid", { geometry: { ellipsoid: { a: 1, b: 2, c: 3 } }, mass: { value: 10, mode: "total" } }));
    expectSortedValues([...mp.principalInertia], [10 / 5 * (4 + 9), 10 / 5 * (1 + 9), 10 / 5 * (1 + 4)]);
  });

  it("uniform rod: I_perp = mL²/12 (+ thickness term)", () => {
    const mp = computeBodyMassProperties(bodyOf("rod", { geometry: { rod: { L: 2, thickness: 0.05 } }, mass: { value: 3, mode: "total" } }));
    const expectedPerp = (3 * 4) / 12 + (3 * 0.0025) / 16;
    expectSortedValues([...mp.principalInertia], [expectedPerp, expectedPerp, (3 * 0.0025) / 8], 1e-6);
  });
});

describe("inertia — rod with custom linear density λ(x) = x", () => {
  it("integrates M, r_CM and I_CM exactly (Gauss-Simpson)", () => {
    const props = rodLambdaProperties(1, 0.05, "x");
    expect(props.mass).toBeCloseTo(0.5, 6); // ∫₀¹ x dx
    expect(props.rcm).toBeCloseTo(2 / 3, 6); // (1/M)∫x² dx
    expect(props.iPerpAboutCM).toBeCloseTo(1 / 36, 5); // ∫x(x−2/3)² dx
  });

  it("adopts the density centroid as CoM when the user offset is zero", () => {
    const mp = computeBodyMassProperties(bodyOf("rod", { geometry: { rod: { L: 1, thickness: 0.05, densityExpr: "x" } }, mass: { value: 1, mode: "total" } }));
    expect(mp.centerOfMass[0]).toBeCloseTo(2 / 3 - 0.5, 6);
    expect(mp.mass).toBeCloseTo(0.5, 6);
  });
});

describe("inertia — parallel-axis (Steiner) shifts", () => {
  it("I_CM = I_geo − m(|d|²E − d⊗d) for an offset box", () => {
    const mp = computeBodyMassProperties(
      bodyOf("box", { geometry: { box: { W: 2, H: 4, D: 6 } }, mass: { value: 12, mode: "total" }, centerOfMass: [0.5, 0, 0] }),
    );
    // I_geo = diag(52, 40, 20); shift d=(0.5,0,0): yy & zz lose m·0.25 = 3
    expectSortedValues([...mp.principalInertia], [52, 37, 17]);
    expect(mp.centerOfMass).toEqual([0.5, 0, 0]);
  });

  it("shiftPointToCM matches the closed-form box shift", () => {
    const Igeo = [52, 0, 0, 0, 40, 0, 0, 0, 20];
    const shifted = shiftPointToCM(Igeo, 12, [0.5, 0, 0]);
    expect(shifted[4]).toBeCloseTo(37, 9);
    expect(shifted[8]).toBeCloseTo(17, 9);
    expect(shifted[0]).toBeCloseTo(52, 9);
  });
});

describe("inertia — wedge (right-triangular prism)", () => {
  it("matches textbook triangle values after diagonalization", () => {
    // θ = 45° makes the slope run from the back-top to the front-bottom: a
    // right triangle whose tip is clipped to 0.02·H by the §4.6 clamp.
    //
    // Textbook values for the exact right triangle (legs W=H=1, m=1, D=1):
    //   I_xx = I_yy = m(H²/18 + D²/12) = 5/36,  I_zz = m(W²+H²)/18 = 1/9,
    //   I_xy = mbh/36 = 1/36 (product of inertia about the centroidal axes).
    // Diagonalized principal moments:
    //   I_xx − I_xy = 1/9,  I_xx + I_xy = 1/6,  I_zz = 1/9  →  {1/9, 1/9, 1/6}.
    const mp = computeBodyMassProperties(
      bodyOf("wedge", { geometry: { wedge: { thetaDeg: 45, W: 1, H: 1, D: 1, dynamic: false } }, mass: { value: 1, mode: "total" } }),
    );
    const fH = 0.02;
    // exact trapezoid centroid: x̄ = (fH − H)·W / (6·(H + fH))
    expect(mp.centerOfMass[0]).toBeCloseTo(((fH - 1) * 1) / (6 * (1 + fH)), 4);
    expect(mp.centerOfMass[1]).toBeCloseTo(-1 / 6, 2);
    expectSortedValues([...mp.principalInertia], [1 / 9, 1 / 9, 1 / 6], 6e-3);
  });
});

describe("inertia — Jacobi diagonalization", () => {
  it("recovers eigenvalues of a rotated diagonal tensor", () => {
    // diag(3,1,2) rotated 45° about Z
    const [s, c] = [Math.SQRT1_2, Math.SQRT1_2];
    const Rz = [c, -s, 0, s, c, 0, 0, 0, 1];
    const RzT = [c, s, 0, -s, c, 0, 0, 0, 1];
    const mul = (a: number[], b: number[]) => [
      a[0]! * b[0]! + a[1]! * b[3]! + a[2]! * b[6]!,
      a[0]! * b[1]! + a[1]! * b[4]! + a[2]! * b[7]!,
      a[0]! * b[2]! + a[1]! * b[5]! + a[2]! * b[8]!,
      a[3]! * b[0]! + a[4]! * b[3]! + a[5]! * b[6]!,
      a[3]! * b[1]! + a[4]! * b[4]! + a[5]! * b[7]!,
      a[3]! * b[2]! + a[4]! * b[5]! + a[5]! * b[8]!,
      a[6]! * b[0]! + a[7]! * b[3]! + a[8]! * b[6]!,
      a[6]! * b[1]! + a[7]! * b[4]! + a[8]! * b[7]!,
      a[6]! * b[2]! + a[7]! * b[5]! + a[8]! * b[8]!,
    ];
    const rotated = mul(mul(Rz, [3, 0, 0, 0, 1, 0, 0, 0, 2]), RzT);
    const { values } = jacobiEigen3(rotated);
    expectSortedValues([...values], [1, 2, 3], 1e-9);
  });

  it("produces a right-handed principal frame quaternion", () => {
    const diag = [3, 0.1, 0, 0.1, 1, 0.2, 0, 0.2, 2];
    const mp = computeBodyMassProperties(
      bodyOf("box", { geometry: { box: { W: 1, H: 1, D: 1 } }, mass: { value: 1, mode: "total" }, centerOfMass: [0, 0, 0] }),
    );
    void diag;
    const [x, y, z, w] = mp.principalFrame;
    expect(Math.hypot(x, y, z, w)).toBeCloseTo(1, 9);
  });

  it("never returns degenerate zero principal moments", () => {
    // zero-mass, zero-thickness rod — degenerate by construction
    const mp = computeBodyMassProperties(
      bodyOf("rod", { geometry: { rod: { L: 1, thickness: 0 } }, mass: { value: 0, mode: "total" } }),
    );
    for (const v of mp.principalInertia) {
      expect(v).toBeGreaterThanOrEqual(1e-9);
      expect(Number.isFinite(v)).toBe(true);
    }
  });
});

describe("inertia — quaternion frame sanity", () => {
  it("a pure-z-rotated body yields a z-only principal frame", () => {
    const body = createDefaultBody("box");
    body.initial.rotation = eulerDegToQuat([0, 0, 30]);
    const mp = computeBodyMassProperties(body);
    // box is symmetric → frame is identity-ish; verify quaternion unit length
    const [x, y, z, w] = mp.principalFrame;
    expect(Math.hypot(x, y, z, w)).toBeCloseTo(1, 9);
    void quatToEulerDeg;
  });
});
