// @vitest-environment node
// physics/__tests__/collisionCheck.test.ts — pre-simulation initial-collision
// detection: build minimal projects, step the throwaway world once, and assert
// which entities interpenetrate at time zero (highlight-red / block Play).

import { beforeAll, describe, expect, it } from "vitest";
import { COLLISION_MARGIN, findInitialCollisions, getRapier } from "../collisionCheck";
import { createDefaultBody, createDefaultProject, createDefaultStatic } from "../../core/defaults";
import type { MechProject } from "../../core/types";

beforeAll(async () => {
  await getRapier();
});

/** Minimal empty project (no seeded scene) in 3D mode. */
function blankProject(): MechProject {
  return createDefaultProject("cc", "3D", { seedScene: false });
}

/** A unit box (half 0.5) at `position`. */
function boxAt(position: [number, number, number]) {
  const box = createDefaultBody("box");
  box.initial = { ...box.initial, position };
  return box;
}

describe("collisionCheck — body vs ground half-space", () => {
  it("a box resting exactly on the ground is NOT flagged", async () => {
    const project = blankProject();
    project.statics.push(createDefaultStatic("ground"));
    const box = boxAt([0, 0, 0.5]); // bottom exactly at z = 0
    project.bodies.push(box);

    await expect(findInitialCollisions(project)).resolves.toEqual([]);
  });

  it("a box penetrating the ground is flagged", async () => {
    const project = blankProject();
    project.statics.push(createDefaultStatic("ground"));
    const box = boxAt([0, 0, 0.25]); // bottom 0.25 into the ground
    project.bodies.push(box);

    const ids = await findInitialCollisions(project);
    expect(ids).toContain(box.id);
  });

  it("a half-space plane positioned above a box still flags the box", async () => {
    const project = blankProject();
    // Horizontal plane through z = 2, solid below it — the box underneath is inside.
    project.statics.push(createDefaultStatic("ground", { position: [0, 0, 2] }));
    const box = boxAt([0, 0, 0]); // top z = 0.5 < 2
    project.bodies.push(box);

    const ids = await findInitialCollisions(project);
    expect(ids).toContain(box.id);
  });

  it("a vertical wall half-space cutting through a box flags the box", async () => {
    const project = blankProject();
    project.statics.push(
      createDefaultStatic("wall", {
        plane: { normal: [1, 0, 0], extent: [10, 10] },
      } as never),
    );
    const box = boxAt([0, 0, 0]); // the x = 0 plane slices through its centre
    project.bodies.push(box);

    const ids = await findInitialCollisions(project);
    expect(ids).toContain(box.id);
  });
});

describe("collisionCheck — body vs body", () => {
  it("two overlapping boxes (box-in-box) flag BOTH ids", async () => {
    const project = blankProject();
    const outer = createDefaultBody("box");
    outer.geometry.box = { W: 2, H: 2, D: 2 }; // half 1.0
    outer.initial = { ...outer.initial, position: [0, 0, 0] };
    const inner = boxAt([0, 0, 0]); // half 0.5, fully inside
    project.bodies.push(outer, inner);

    const ids = await findInitialCollisions(project);
    expect(ids).toContain(outer.id);
    expect(ids).toContain(inner.id);
    expect(ids).toHaveLength(2);
  });

  it("two well-separated boxes are NOT flagged", async () => {
    const project = blankProject();
    project.bodies.push(boxAt([0, 0, 0]), boxAt([3, 0, 0]));

    await expect(findInitialCollisions(project)).resolves.toEqual([]);
  });

  it("two boxes with faces exactly touching are NOT flagged", async () => {
    const project = blankProject();
    project.bodies.push(boxAt([0, 0, 0]), boxAt([1, 0, 0])); // faces at x = 0.5

    await expect(findInitialCollisions(project)).resolves.toEqual([]);
  });

  it("two boxes overlapping by less than COLLISION_MARGIN are NOT flagged", async () => {
    const project = blankProject();
    // A face at x = 0.5, B face at x = 0.49 → overlap 0.01 < 0.02.
    project.bodies.push(boxAt([0, 0, 0]), boxAt([0.99, 0, 0]));

    await expect(findInitialCollisions(project)).resolves.toEqual([]);
  });

  it("COLLISION_MARGIN is the documented 0.02", () => {
    expect(COLLISION_MARGIN).toBe(0.02);
  });
});
