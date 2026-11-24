// core/__tests__/validator.test.ts — schema & semantic validator coverage.

import { describe, expect, it } from "vitest";
import {
  createDefaultBody,
  createDefaultForce,
  createDefaultJoint,
  createDefaultProject,
  createDefaultRope,
} from "../defaults";
import { validateProject, validateProjectText } from "../validator";
import type { BodyGeometry, ForceEntity, JointEntity, MechProject, RigidBodyEntity, RopeEntity } from "../types";

const rawOf = (p: unknown): string => JSON.stringify(p, null, 2);

describe("validator — schema v2 & reference integrity", () => {
  it("accepts a fresh default 3D project with zero diagnostics", () => {
    const project = createDefaultProject("Clean", "3D");
    const result = validateProject(project, rawOf(project));
    expect(result.ok).toBe(true);
    expect(result.diagnostics).toHaveLength(0);
    expect(result.project?.meta.name).toBe("Clean");
  });

  it("accepts a fresh default 2D project (X–Z plane locks, gravity down -Z)", () => {
    const project = createDefaultProject("Clean 2D", "2D");
    const result = validateProject(project, rawOf(project));
    expect(result.ok).toBe(true);
    expect(project.world.gravity).toEqual([0, 0, -9.81]);
    for (const body of project.bodies) {
      expect(body.locks.translate).toEqual([false, true, false]);
      expect(body.locks.rotate).toEqual([true, false, true]);
    }
  });

  it("rejects schemaVersion != 2", () => {
    const result = validateProject({ schemaVersion: 1 }, "");
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]?.code).toBe("E_SCHEMA_VERSION");
  });

  it("rejects a non-object root", () => {
    const result = validateProject([1, 2, 3]);
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]?.code).toBe("E_INVALID_ROOT");
  });

  it("reports an unresolved joint bodyA reference as a structured, line-numbered error", () => {
    const project = createDefaultProject("Broken joint", "3D");
    const joint = createDefaultJoint("revolute");
    joint.bodyA = "ghost-body";
    joint.bodyB = null;
    project.joints.push(joint as JointEntity);

    const result = validateProject(project, rawOf(project));
    expect(result.ok).toBe(false);

    const error = result.diagnostics.find(
      (d) => d.code === "E_UNRESOLVED_REFERENCE" && d.data?.refId === "ghost-body",
    );
    expect(error).toBeDefined();
    expect(error?.severity).toBe("error");
    expect(error?.path).toBe("joints[0].bodyA");
    expect(error?.line).toEqual(expect.any(Number));
    expect(error?.message).toContain("ghost-body");
    expect(error?.data).toMatchObject({ field: "bodyA", category: "joints", index: 0 });
  });

  it("reports unresolved spring anchorB and rope path anchor references", () => {
    const project = createDefaultProject("Broken anchors", "3D");
    project.forces.push({
      ...createDefaultForce("spring"),
      spring: { k: 10, restLength: 1, damping: 1, anchorB: "no-such-anchor", anchorBPoint: [0, 0, 0] },
    } as ForceEntity);
    project.ropes.push({
      ...createDefaultRope("massless"),
      path: [{ anchorId: "no-such-anchor", point: [0, 0, 0] }],
    } as RopeEntity);

    const result = validateProject(project, rawOf(project));
    const refErrors = result.diagnostics.filter((d) => d.code === "E_UNRESOLVED_REFERENCE");
    expect(refErrors).toHaveLength(2);
    expect(refErrors.map((d) => d.path)).toContain("forces[0].spring.anchorB");
    expect(refErrors.map((d) => d.path)).toContain("ropes[0].path[0].anchorId");
    expect(result.ok).toBe(false);
  });

  it("reports duplicate entity ids across categories", () => {
    const project = createDefaultProject("Duplicates", "3D");
    const body = createDefaultBody("box");
    project.bodies.push(body);
    project.bodies.push({ ...body }); // same id twice

    const result = validateProject(project, rawOf(project));
    const dup = result.diagnostics.filter((d) => d.code === "E_DUPLICATE_ID");
    expect(dup.length).toBeGreaterThanOrEqual(2);
    expect(result.ok).toBe(false);
  });

  it("preserves unknown Tier 2 body kinds with a warning and stays valid", () => {
    const project = createDefaultProject("Tier 2", "3D");
    const hull: RigidBodyEntity = {
      ...createDefaultBody("box"),
      id: "hull-1",
      name: "Convex Hull",
      kind: "convexHull",
      tier: 2,
      geometry: { points: [[0, 0, 0], [1, 1, 1]] } as unknown as BodyGeometry,
    };
    project.bodies.push(hull);

    const result = validateProject(project, rawOf(project));
    expect(result.ok).toBe(true); // warnings only — never blocks the load
    expect(result.diagnostics.some((d) => d.code === "W_UNKNOWN_KIND_PRESERVED" && d.message.includes("convexHull"))).toBe(true);
    expect(result.project?.bodies).toHaveLength(2);
  });

  it("hard-errors on unknown Tier 1 kinds (never silently preserved)", () => {
    const project = createDefaultProject("Bad tier 1", "3D");
    project.bodies.push({ ...createDefaultBody("box"), kind: "blob", tier: 1 } as RigidBodyEntity);

    const result = validateProject(project);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((d) => d.code === "E_UNKNOWN_TIER1_KIND" && d.message.includes("blob"))).toBe(true);
  });

  it("preserves unknown root-level keys into _raw with a warning", () => {
    const project = {
      ...createDefaultProject("Forward compat", "3D"),
      futureGears: [{ id: "g1" }],
    } as unknown as MechProject & { futureGears: unknown };

    const result = validateProject(project, rawOf(project));
    expect(result.ok).toBe(true);
    expect(result.project?._raw.futureGears).toBeDefined();
    expect(result.diagnostics.some((d) => d.code === "W_UNKNOWN_ROOT_KEY" && d.message.includes("futureGears"))).toBe(true);
  });

  it("flags banned tokens in force expressions as warnings (§4.1)", () => {
    const project = createDefaultProject("Unsafe expr", "3D");
    project.forces.push({
      ...createDefaultForce("external"),
      components: { x: "eval(t)", y: "0", z: "0" },
    } as ForceEntity);

    const result = validateProject(project);
    expect(result.ok).toBe(true);
    expect(result.diagnostics.some((d) => d.code === "W_UNSAFE_EXPRESSION" && d.path === "forces[0].components.x")).toBe(true);
  });

  it("validateProjectText reports malformed JSON with a line number", () => {
    const result = validateProjectText('{\n  "schemaVersion": 2,\n  "bodies": [\n}');
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]?.code).toBe("E_MALFORMED_JSON");
    expect(result.diagnostics[0]?.line).toEqual(expect.any(Number));
    expect(result.diagnostics[0]?.line).toBeGreaterThanOrEqual(3);
    expect(result.project).toBeNull();
  });
});
