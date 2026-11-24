// render/gizmos/__tests__/snapping.test.ts — anchor snapping math coverage.

import { describe, expect, it } from "vitest";
import { computeBodySnapPoints, computeSnapPoints, findSnap } from "../snapping";
import {
  bodyHalfHeight,
  createDefaultBody,
  createDefaultProject,
  halfHeightOf,
  PULLEY_GEOMETRY,
} from "../../../core/defaults";
import { eulerDegToQuat, localToWorld, quatToEulerDeg, worldToLocal } from "../../../math/rotation";
import type { Vec3 } from "../../../core/types";

function expectClose(actual: Vec3, expected: Vec3, eps = 1e-6) {
  expect(actual.length).toBe(expected.length);
  actual.forEach((v, i) => {
    expect(Math.abs(v - (expected[i] ?? 0))).toBeLessThan(eps);
  });
}

function hasPoint(points: Vec3[], target: Vec3, eps = 1e-6): boolean {
  return points.some((p) =>
    p.every((v, i) => Math.abs(v - (target[i] ?? 0)) < eps),
  );
}

describe("snapping — anchor computation", () => {
  it("computes box face centers, vertices, center and CoM in world space", () => {
    const body = createDefaultBody("box"); // W=H=D=1
    body.initial.position = [1, 2, 3];
    const points = computeBodySnapPoints(body);

    // geometric center & CoM (offset zero by default)
    expect(hasPoint(points.map((p) => p.point), [1, 2, 3])).toBe(true);

    // face centers
    expect(hasPoint(points.map((p) => p.point), [1.5, 2, 3])).toBe(true);
    expect(hasPoint(points.map((p) => p.point), [1, 2.5, 3])).toBe(true);
    expect(hasPoint(points.map((p) => p.point), [1, 2, 3.5])).toBe(true);

    // vertices
    expect(hasPoint(points.map((p) => p.point), [1.5, 2.5, 3.5])).toBe(true);
    expect(hasPoint(points.map((p) => p.point), [0.5, 1.5, 2.5])).toBe(true);
  });

  it("rotates snap points with the body (90° about Z)", () => {
    const body = createDefaultBody("box");
    body.initial.rotation = eulerDegToQuat([0, 0, 90]);
    const points = computeBodySnapPoints(body);
    // +X face center (0.5, 0, 0) rotates to (0, 0.5, 0)
    expect(hasPoint(points.map((p) => p.point), [0, 0.5, 0], 1e-5)).toBe(true);
  });

  it("applies the CoM offset to the com anchor only", () => {
    const body = createDefaultBody("box");
    body.centerOfMass = [0.25, 0, 0];
    const points = computeBodySnapPoints(body);
    const com = points.find((p) => p.kind === "com");
    expect(com).toBeDefined();
    expectClose(com?.point ?? [0, 0, 0], [0.25, 0, 0]);
    // the geometric center anchor is untouched
    const center = points.find((p) => p.kind === "center");
    expectClose(center?.point ?? [0, 0, 0], [0, 0, 0]);
  });

  it("computes sphere rim and cylinder axle/rim anchors", () => {
    const sphere = createDefaultBody("sphere"); // R = 0.5
    const sPoints = computeBodySnapPoints(sphere).map((p) => p.point);
    expect(hasPoint(sPoints, [0.5, 0, 0])).toBe(true);
    expect(hasPoint(sPoints, [0, -0.5, 0])).toBe(true);

    const cyl = createDefaultBody("cylinder"); // R=0.5, H=1, axis +Z
    const cPoints = computeBodySnapPoints(cyl).map((p) => p.point);
    expect(hasPoint(cPoints, [0, 0, 0.5])).toBe(true); // axle top
    expect(hasPoint(cPoints, [0.5, 0, 0.5])).toBe(true); // rim tangent
  });

  it("respects the wedge incline angle when computing vertices", () => {
    const wedge = createDefaultBody("wedge"); // thetaDeg=30, W=1, H=0.5
    const points = computeBodySnapPoints(wedge).map((p) => p.point);
    // back top corner stays at full height; front top drops with the slope.
    // W=1, H=0.5, D=1 → x=±0.5, y depth=±0.5, z top=+0.25.
    expect(hasPoint(points, [-0.5, 0.5, 0.25])).toBe(true);
    // frontTop = clamp(0.02*H, H - W*tan30) = 0.01 → z = 0.01 - 0.25 = -0.24
    expect(hasPoint(points, [0.5, 0.5, -0.24], 1e-5)).toBe(true);
  });

  it("projects every snap point onto Y = 0 in 2D mode", () => {
    const project = createDefaultProject("2D snaps", "2D");
    const points = computeSnapPoints(project, "2D");
    expect(points.length).toBeGreaterThan(0);
    for (const p of points) expect(Math.abs(p.point[1])).toBeLessThan(1e-9);
  });
});

describe("snapping — magnetic search", () => {
  it("snaps to the nearest candidate inside the radius and returns null outside", () => {
    const candidates = [
      { ownerId: "a", kind: "face" as const, point: [1, 0.2, 0] as Vec3, label: "near" },
      { ownerId: "b", kind: "face" as const, point: [3, 0, 0] as Vec3, label: "far" },
    ];
    const near = findSnap([1.05, 0.1, 0], candidates, 0.4);
    expect(near?.ownerId).toBe("a");
    expect(findSnap([10, 10, 10], candidates, 0.4)).toBeNull();
  });
});

describe("body lift — half heights", () => {
  it("matches the default geometry per kind", () => {
    expect(halfHeightOf("box")).toBe(0.5);
    expect(halfHeightOf("sphere")).toBe(0.5);
    expect(halfHeightOf("cylinder")).toBe(0.5);
    expect(halfHeightOf("rod")).toBe(0.025);
    expect(halfHeightOf("wedge")).toBe(0.25);
  });

  it("treats a palette pulley as the thin disk it is", () => {
    expect(halfHeightOf("pulley")).toBe(PULLEY_GEOMETRY.H / 2);
    expect(PULLEY_GEOMETRY.H).toBe(0.08);
  });

  it("bodyHalfHeight reads the CONCRETE geometry, not the kind defaults", () => {
    // A pulley is stored as a cylinder with a custom thin H.
    const pulley = createDefaultBody("cylinder");
    pulley.geometry = { cylinder: { R: 0.5, H: 0.08, hollow: false } };
    expect(bodyHalfHeight(pulley)).toBeCloseTo(0.04, 6);

    const tallBox = createDefaultBody("box");
    tallBox.geometry = { box: { W: 2, H: 3, D: 1 } };
    expect(bodyHalfHeight(tallBox)).toBe(1.5);
  });
});

describe("rotation math", () => {
  it("round-trips Euler degrees through quaternions", () => {
    const deg: Vec3 = [30, -45, 120];
    const q = eulerDegToQuat(deg);
    const back = quatToEulerDeg(q);
    expectClose(back, deg, 1e-4);
  });

  it("converts between world and local coordinates consistently", () => {
    const position: Vec3 = [2, 3, 4];
    const rotation = eulerDegToQuat([0, 0, 90]);
    const world: Vec3 = [2.5, 3.1, 4];
    const local = worldToLocal(world, position, rotation);
    const back = localToWorld(local, position, rotation);
    expectClose(back, world, 1e-6);
  });
});
