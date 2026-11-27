// e2e/tests/round4.spec.ts — round-4 feature coverage:
//
//   S1  spawn-on-plane inherits the inclined plane's orientation + normal lift
//   S2  a plane ABOVE an object is a thin two-sided surface: the object stays
//       under it, no collision is reported, and Play runs (regression fix)
//   S3  box-in-box initial collision is detected, highlighted, and blocks Play
//   S4  grid renders under the axis arrows (screenshot artifact, zero errors)
//   S5  inspector rotation controls (reset + ry stepper)
//
// Every scenario runs on a FRESH page: the browser mock re-seeds the "Demo"
// project ("Horizontal plane" ground at z=0 + "Box 1" 1×1×1 at [0,0,0.5]) on
// each load. State is driven through real mouse/keyboard input; the
// `window.__mechlab` hook is read-only (readiness + deterministic assertions on
// the scene store, the collision store, and telemetry).
//
// The collision store lazily loads rapier3d-compat WASM on the MAIN thread on
// the first check (~1–2 s) and is debounced 200 ms after each edit, so every
// collision assertion uses `expect.poll` with a generous timeout and waits for
// `checking === false` before reading the final `collidingIds`.

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { getBodyOrder, getScene, getSnapshot, getTelemetry, projectWorld } from "./helpers";

type Vec3 = [number, number, number];
type Quat = [number, number, number, number];

/** Console/page errors collected across the whole file (asserted per test). */
const errors: string[] = [];

/** Read the collision store state through the dev hook. */
interface CollisionState {
  collidingIds: string[];
  checking: boolean;
}

async function getCollision(page: Page): Promise<CollisionState> {
  return page.evaluate(() => (window as any).__mechlab.collision.getState());
}

/** Wait for the debounced collision check to settle on the given expectation. */
async function expectCollisionSettled(
  page: Page,
  predicate: (c: CollisionState) => boolean,
  timeout = 20000,
): Promise<void> {
  await expect
    .poll(async () => {
      const c = await getCollision(page);
      return c.checking === false && predicate(c);
    }, { timeout })
    .toBe(true);
}

/** Edit-store rotation of a body (`initial.rotation`, the editable quaternion). */
async function bodyRotation(page: Page, id: string): Promise<Quat> {
  const scene = await getScene(page);
  const body = scene.project.bodies.find((b: { id: string }) => b.id === id);
  if (!body) throw new Error(`body ${id} not found`);
  return body.initial.rotation as Quat;
}

test.beforeEach(async ({ page }) => {
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(`[console.error] ${msg.text()}`);
  });
  page.on("pageerror", (err) => {
    errors.push(`[pageerror] ${err.message}`);
  });

  await page.goto("/");
  // Readiness: the dev hook, the scene store's project, AND the collision store
  // must all be mounted before any assertion reads them.
  await page.waitForFunction(() => {
    const w = window as any;
    return !!(w.__mechlab?.scene?.getState && w.__mechlab?.collision?.getState && w.__mechlab.scene.getState().project);
  });
  await expect(page.locator("canvas").first()).toBeVisible({ timeout: 60000 });
  await expect
    .poll(async () => (await getScene(page))?.project?.meta?.name, { timeout: 60000 })
    .toBe("Demo");
  // Let the first R3F frames, the canvas layout and the OrbitControls lookAt
  // settle before the replicated projection camera positions any mouse input.
  await page.waitForTimeout(1200);
});

test.afterEach(async () => {
  expect(errors, "the scenario must not log console/page errors").toEqual([]);
});

// -----------------------------------------------------------------------------
// S1 — spawn-on-plane inherits orientation
// -----------------------------------------------------------------------------

test("1. spawn-on-plane inherits the inclined plane's orientation and normal lift", async ({ page }) => {
  // 1) Spawn a NEW Horizontal plane at a known point on the ground (z = 0).
  await page.getByRole("button", { name: "Horizontal plane", exact: true }).click();
  await expect.poll(async () => (await getScene(page))?.tool?.kind).toBe("ground");

  const spawnScreen = await projectWorld(page, [0, 0, 0]);
  await page.mouse.click(spawnScreen.x, spawnScreen.y);
  await expect.poll(async () => (await getScene(page))?.project?.statics?.length).toBe(2);

  const planeId = (await getScene(page)).project.statics[1].id as string;
  expect((await getScene(page)).project.statics[1].name).toBe("Horizontal plane 1");

  // 2) Tilt it 30° about +Y through the inspector.
  const ryInput = page.getByRole("spinbutton", { name: "Rotation (deg) ry" });
  await ryInput.fill("30");
  await ryInput.blur();
  const sin15 = Math.sin(Math.PI / 12);
  const cos15 = Math.cos(Math.PI / 12);
  await expect
    .poll(async () => {
      const r = (await getScene(page)).project?.statics?.[1]?.rotation;
      return (
        Array.isArray(r) &&
        r.length === 4 &&
        Math.abs(r[0]) < 1e-4 &&
        Math.abs(r[1] - sin15) < 1e-4 &&
        Math.abs(r[2]) < 1e-4 &&
        Math.abs(r[3] - cos15) < 1e-4
      );
    })
    .toBe(true);

  // 3) Read the plane's actual spawn point P (it passes through P) and pick a
  //    point Q on the inclined plane that is ABOVE the ground (the −X side, so
  //    the ground plane does not occlude it). World normal after ry=30 is
  //    n = [sin30, 0, cos30]; Q = P + [-2, 0, +2·tan30°] satisfies n·(Q−P)=0.
  const P = (await getScene(page)).project.statics[1].position as Vec3;
  const n: Vec3 = [0.5, 0, Math.cos(Math.PI / 6)];
  const Q: Vec3 = [P[0] - 2, P[1], P[2] + 2 * Math.tan(Math.PI / 6)];

  await page.getByRole("button", { name: "Box", exact: true }).click();
  await expect.poll(async () => (await getScene(page))?.tool?.kind).toBe("box");

  const qScreen = await projectWorld(page, Q);
  await page.mouse.click(qScreen.x, qScreen.y);
  await expect.poll(async () => (await getScene(page))?.project?.bodies?.length).toBe(2);

  const box = (await getScene(page)).project.bodies[1];
  const boxId = box.id as string;
  expect(box.name).toBe("Box 2");
  expect(boxId).not.toBe(planeId);

  // 4) The box inherits the plane's world quaternion = baseQuat([0,0,1]) ×
  //    eulerDegToQuat([0,30,0]) = [0, sin15°, 0, cos15°] (Euler ~ [0,30,0]).
  const rot = await bodyRotation(page, boxId);
  expect(Math.abs(rot[0])).toBeLessThan(1e-4);
  expect(Math.abs(rot[1] - sin15)).toBeLessThan(1e-4);
  expect(Math.abs(rot[2])).toBeLessThan(1e-4);
  expect(Math.abs(rot[3] - cos15)).toBeLessThan(1e-4);

  // 5) Its position is Q lifted half the box height (H=1 → +0.5) along n.
  const pos = box.initial.position as Vec3;
  const expectedPos: Vec3 = [Q[0] + 0.5 * n[0], Q[1] + 0.5 * n[1], Q[2] + 0.5 * n[2]];
  expect(Math.abs(pos[0] - expectedPos[0])).toBeLessThan(0.05);
  expect(Math.abs(pos[1] - expectedPos[1])).toBeLessThan(0.05);
  expect(Math.abs(pos[2] - expectedPos[2])).toBeLessThan(0.05);
});

// -----------------------------------------------------------------------------
// S2 (updated) — a plane above an object is a THIN SURFACE, not a half-space:
// objects may exist under it, no collision is reported, Play is allowed and the
// object is never ejected above the plane. (Regression: statics used to be
// infinite half-spaces, so nothing could live under an added plane.)
// -----------------------------------------------------------------------------

test("2. a plane above an object does not collide: the object stays under it and Play runs", async ({ page }) => {
  // Spawn a new Horizontal plane off to the side, then lift it to z = 2 so the
  // seeded "Box 1" (z ∈ [0, 1]) lives UNDER it.
  await page.getByRole("button", { name: "Horizontal plane", exact: true }).click();
  await expect.poll(async () => (await getScene(page))?.tool?.kind).toBe("ground");

  const spawnScreen = await projectWorld(page, [3, 0, 0]);
  await page.mouse.click(spawnScreen.x, spawnScreen.y);
  await expect.poll(async () => (await getScene(page))?.project?.statics?.length).toBe(2);

  const scene = await getScene(page);
  const boxId = scene.project.bodies[0].id as string;
  // A palette-placed plane is serialized as a thin surface (not a solid floor).
  expect(scene.project.statics[1].solid).toBe(false);

  const zInput = page.getByRole("spinbutton", { name: "Position z" });
  await zInput.fill("2");
  await zInput.blur();
  await expect
    .poll(async () => (await getScene(page)).project?.statics?.[1]?.position?.[2])
    .toBe(2);

  // The pre-simulation detector must NOT flag the box/plane pair: an object may
  // exist under a plane (the old half-space swallowed it and blocked Play).
  await expectCollisionSettled(page, (c) => c.collidingIds.length === 0);

  // Play is allowed — no collision dialog — and the worker boots.
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Object collision" })).toHaveCount(0);
  await expect
    .poll(
      async () => {
        const t = await getTelemetry(page);
        return t.status === "running" && t.ready === true;
      },
      { timeout: 30000 },
    )
    .toBe(true);

  // Let ≥ 1 s of simulated time run, then check the box stayed UNDER the plane:
  // it rests on the ground (z ≈ 0.5), never jumps above z = 2.
  const order = await getBodyOrder(page);
  const boxIndex = order.indexOf(boxId);
  expect(boxIndex).toBeGreaterThanOrEqual(0);
  await expect
    .poll(async () => {
      const snap = await getSnapshot(page);
      return snap.length > 8 + boxIndex * 25 ? snap[0]! : 0; // snapshot sim time
    }, { timeout: 20000 })
    .toBeGreaterThan(1);

  const snap = await getSnapshot(page);
  const boxZ = snap[8 + boxIndex * 25 + 2]!; // POS z
  expect(boxZ).toBeLessThan(1); // never pushed up through the plane
  expect(boxZ).toBeGreaterThan(0.4); // resting on the ground at H/2

  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await expect.poll(async () => (await getTelemetry(page)).status).toBe("paused");

  // Prove the detector was live (so the empty collision set above was a real
  // "no collision", not a check that never ran): lower the plane onto the box —
  // a surface slicing a body IS reported.
  await zInput.fill("0.5");
  await zInput.blur();
  await expect
    .poll(async () => (await getScene(page)).project?.statics?.[1]?.position?.[2])
    .toBe(0.5);
  await expectCollisionSettled(page, (c) => c.collidingIds.includes(boxId));
});

// -----------------------------------------------------------------------------
// S3 — box-in-box overlap highlighted + blocked
// -----------------------------------------------------------------------------

test("3. box-in-box overlap is detected, highlighted, and blocks Play", async ({ page }) => {
  // Spawn a second box off to the side, then move it onto "Box 1".
  await page.getByRole("button", { name: "Box", exact: true }).click();
  await expect.poll(async () => (await getScene(page))?.tool?.kind).toBe("box");

  const spawnScreen = await projectWorld(page, [3, 0, 0]);
  await page.mouse.click(spawnScreen.x, spawnScreen.y);
  await expect.poll(async () => (await getScene(page))?.project?.bodies?.length).toBe(2);

  const scene = await getScene(page);
  const seededBoxId = scene.project.bodies[0].id as string;
  const newBoxId = scene.project.bodies[1].id as string;
  expect(newBoxId).not.toBe(seededBoxId);

  // The new box spawns at [3,0,0.5]; move it onto the seeded box's position.
  const xInput = page.getByRole("spinbutton", { name: "Position x" });
  await xInput.fill("0");
  await xInput.blur();
  await expect
    .poll(async () => {
      const b = (await getScene(page)).project.bodies.find((x: { id: string }) => x.id === newBoxId);
      return b?.initial?.position?.[0];
    })
    .toBe(0);

  // Both boxes now interpenetrate.
  await expectCollisionSettled(
    page,
    (c) => c.collidingIds.includes(seededBoxId) && c.collidingIds.includes(newBoxId),
  );

  // Play blocked + dialog lists the entities.
  await page.getByRole("button", { name: "Play", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Object collision" });
  await expect(dialog).toBeVisible({ timeout: 10000 });
  expect((await getTelemetry(page)).status).not.toBe("running");
  await expect(dialog).toContainText("Box 1");

  await dialog.getByRole("button", { name: "Close" }).last().click();
  await expect(dialog).toBeHidden();

  // Move the new box apart; the collision set clears and Play starts.
  await xInput.fill("3");
  await xInput.blur();
  await expectCollisionSettled(page, (c) => c.collidingIds.length === 0);

  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect
    .poll(
      async () => {
        const t = await getTelemetry(page);
        return t.status === "running" && t.ready === true;
      },
      { timeout: 30000 },
    )
    .toBe(true);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await expect.poll(async () => (await getTelemetry(page)).status).toBe("paused");
});

// -----------------------------------------------------------------------------
// S5 — rotation controls (reset + stepper)
// -----------------------------------------------------------------------------

test("4. reset rotation and the ry stepper", async ({ page }) => {
  const seededBoxId = (await getScene(page)).project.bodies[0].id as string;

  // Select "Box 1" so the body inspector (with rotation fields) renders.
  const center = await projectWorld(page, [0, 0, 0.5]);
  await page.mouse.click(center.x, center.y);
  await expect.poll(async () => (await getScene(page)).selectedId).toBe(seededBoxId);

  // Set a non-identity rotation first so the reset actually changes something.
  const ryInput = page.getByRole("spinbutton", { name: "Rotation (deg) ry" });
  await ryInput.fill("30");
  await ryInput.blur();
  await expect
    .poll(async () => Math.abs((await bodyRotation(page, seededBoxId))[1] - Math.sin(Math.PI / 12)))
    .toBeLessThan(1e-4);

  // Reset rotation → identity quaternion.
  await page.getByRole("button", { name: "Reset rotation", exact: true }).click();
  await expect
    .poll(async () => {
      const r = await bodyRotation(page, seededBoxId);
      return r[0] === 0 && r[1] === 0 && r[2] === 0 && r[3] === 1;
    })
    .toBe(true);

  // The ry "+" stepper increments by the field step (0.1° by default).
  await page.getByRole("button", { name: "Rotation (deg) ry increment" }).click();
  await expect(ryInput).toHaveValue("0.1");
  await expect
    .poll(async () => {
      const r = await bodyRotation(page, seededBoxId);
      // eulerDegToQuat([0, 0.1, 0]) has a small positive Y component.
      return r[0] === 0 && r[2] === 0 && r[1] > 0 && r[3] < 1;
    })
    .toBe(true);
});

// -----------------------------------------------------------------------------
// S4 — grid renders under the axis arrows (artifact + no errors)
// -----------------------------------------------------------------------------

test("5. grid renders under the axis arrows (screenshot artifact, no errors)", async ({ page }) => {
  const seededBoxId = (await getScene(page)).project.bodies[0].id as string;

  // Select the body so the axis arrows + gizmo mount over the grid.
  const center = await projectWorld(page, [0, 0, 0.5]);
  await page.mouse.click(center.x, center.y);
  await expect.poll(async () => (await getScene(page)).selectedId).toBe(seededBoxId);
  await expect.poll(async () => (await getScene(page)).axisArrowsId).toBe(seededBoxId);
  await page.waitForTimeout(400); // arrows + gizmo mount

  await page.screenshot({ path: "e2e/artifacts/grid-vs-arrows.png", fullPage: true });

  // Light assertion: the app is still rendered (the zero-error check lives in
  // the afterEach hook; the visual "arrows over grid" review is separate).
  await expect(page.locator("canvas").first()).toBeVisible();
});
