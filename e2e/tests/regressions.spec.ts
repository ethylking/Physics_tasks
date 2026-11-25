// e2e/tests/regressions.spec.ts — round-2 regression suite (R1–R4).
//
// Covers the user-reported regressions after the pose-ownership fix:
//   1. direct body drag&drop moves the body in the horizontal X–Y plane, Z is
//      untouched, and the rendered mesh follows the store immediately;
//   2. a click without movement only selects (no store write, no dirty flag);
//   3. after Play → Pause the edit state owns the scene again: the mesh leaves
//      the simulated pose, the body can be dragged, an edit auto-stops the
//      session, and inspector coordinates are rendered immediately;
//   4. the +Z axis arrows still work after a simulation and the drag auto-stops
//      the paused session;
//   5. Reset returns to the loaded state AND to the editor (idle worker, edit
//      ownership, body draggable again).
//
// Every scenario runs on a FRESH page: the browser mock re-seeds the demo
// project ("Box 1" — a 1×1×1 rigid box at [0, 0, 0.5]) on each page load, so
// the tests are independent. State changes are driven through real mouse /
// keyboard input; the __mechlab hook is used only for deterministic assertions
// (store state, telemetry state, live rendered Object3D transforms).

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { getRenderTransform, getScene, getTelemetry, projectWorld } from "./helpers";

type Vec3 = [number, number, number];

/** Seeded demo body: 1×1×1 box whose center sits at [0, 0, 0.5]. */
const BOX_POS: Vec3 = [0, 0, 0.5];

/**
 * +Z axis-arrow shaft midpoint, relative to the box center:
 * AxisArrows puts the shaft at `outerR + SHAFT_LEN/2` where
 * `outerR = sqrt(0.75) + MARGIN(0.16)` for a unit box (corner distance) and
 * `SHAFT_LEN/2 = 0.21`.
 */
const Z_ARROW_OFFSET = Math.sqrt(0.75) + 0.16 + 0.21;

/** Console/page errors collected per scenario; the file must stay silent. */
const errors: string[] = [];

test.beforeEach(async ({ page }) => {
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(`[console.error] ${msg.text()}`);
  });
  page.on("pageerror", (err) => {
    errors.push(`[pageerror] ${err.message}`);
  });

  await page.goto("/");
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

/** Id of the seeded box (always the first body of the demo project). */
async function seededBoxId(page: Page): Promise<string> {
  const scene = await getScene(page);
  return scene.project.bodies[0].id as string;
}

/** Edit-store position of a body (`initial.position`, the editable pose). */
async function storePosition(page: Page, id: string): Promise<Vec3> {
  const scene = await getScene(page);
  const body = scene.project.bodies.find((b: { id: string }) => b.id === id);
  if (!body) throw new Error(`body ${id} not found in the scene store`);
  return body.initial.position as Vec3;
}

async function renderedPosition(page: Page, id: string): Promise<Vec3> {
  const transform = await getRenderTransform(page, id);
  if (!transform) throw new Error(`entity ${id} has no live Object3D`);
  return transform.position;
}

/** Max per-axis distance between the rendered mesh and the edit store. */
async function renderStoreDelta(page: Page, id: string): Promise<number> {
  const [store, render] = await Promise.all([storePosition(page, id), getRenderTransform(page, id)]);
  if (!render) return Number.POSITIVE_INFINITY;
  return Math.max(
    Math.abs(render.position[0] - store[0]),
    Math.abs(render.position[1] - store[1]),
    Math.abs(render.position[2] - store[2]),
  );
}

async function expectRenderMatchesStore(page: Page, id: string, tolerance = 1e-4): Promise<void> {
  await expect
    .poll(async () => renderStoreDelta(page, id), { timeout: 10000 })
    .toBeLessThan(tolerance);
}

/**
 * Real pointer drag: move → down → `steps` mouse.move events ~12 ms apart (so
 * R3F receives many pointermove events) → up. Mirrors a human drag.
 */
async function dragBy(
  page: Page,
  from: { x: number; y: number },
  dx: number,
  dy: number,
  steps = 12,
): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(from.x + (dx * i) / steps, from.y + (dy * i) / steps);
    await page.waitForTimeout(12);
  }
  await page.mouse.up();
  await page.waitForTimeout(200);
}

test("1. direct drag&drop moves the body in the horizontal plane and the mesh follows", async ({
  page,
}) => {
  const id = await seededBoxId(page);

  // Select the box by clicking its projected center.
  const center = await projectWorld(page, BOX_POS);
  await page.mouse.click(center.x, center.y);
  await expect.poll(async () => (await getScene(page)).selectedId).toBe(id);
  await expect.poll(async () => (await getScene(page)).axisArrowsId).toBe(id);
  await page.waitForTimeout(250); // gizmo / arrows mount

  const before = await storePosition(page, id);
  expect(before).toEqual(BOX_POS);

  // Press the body and drag it in the horizontal plane.
  await dragBy(page, center, 120, 30);

  const after = await storePosition(page, id);
  const horizontalMove = Math.abs(after[0] - before[0]) + Math.abs(after[1] - before[1]);
  expect(
    horizontalMove,
    `body must move in the horizontal plane (before ${JSON.stringify(before)}, after ${JSON.stringify(after)})`,
  ).toBeGreaterThan(0.2);
  // A body drag happens on the horizontal X–Y plane: Z must not change at all.
  expect(after[2], "a horizontal body drag must not change Z").toBe(0.5);
  await expectRenderMatchesStore(page, id);
  expect((await getScene(page)).dirty).toBe(true);
  // A drag release must not steal the selection: the click R3F synthesises on
  // pointerup carries the drag delta and is filtered (`e.delta > 4`), so the box
  // (and its arrows) stay selected after the body drag.
  await expect.poll(async () => (await getScene(page)).selectedId).toBe(id);
  await expect.poll(async () => (await getScene(page)).axisArrowsId).toBe(id);

  await page.screenshot({ path: "e2e/artifacts/after-drag.png" });
});

test("2. click without movement only selects (no write)", async ({ page }) => {
  const id = await seededBoxId(page);

  const center = await projectWorld(page, BOX_POS);
  await page.mouse.click(center.x, center.y);
  await expect.poll(async () => (await getScene(page)).selectedId).toBe(id);

  // A press that never moves is only a selection: no store write, no dirty flag.
  expect(await storePosition(page, id)).toEqual(BOX_POS);
  expect((await getScene(page)).dirty).toBe(false);
  expect((await getTelemetry(page)).status).toBe("idle");
  const render = await renderedPosition(page, id);
  expect(render[0]).toBeCloseTo(0, 4);
  expect(render[1]).toBeCloseTo(0, 4);
  expect(render[2]).toBeCloseTo(0.5, 4);
  await expectRenderMatchesStore(page, id);
});

test("3. after Play → Pause the editor owns the scene and objects can be moved again", async ({
  page,
}) => {
  const id = await seededBoxId(page);

  // 1) Inspector edit before the sim: the render follows the coordinates.
  const center = await projectWorld(page, BOX_POS);
  await page.mouse.click(center.x, center.y);
  await expect.poll(async () => (await getScene(page)).selectedId).toBe(id);

  const zInput = page.getByLabel("Position z");
  await zInput.fill("3");
  await zInput.blur();
  await expect.poll(async () => (await storePosition(page, id))[2]).toBe(3);
  await expectRenderMatchesStore(page, id);

  // 2) Play: the worker snapshot owns the pose — the mesh drops from z=3 even
  // though the edit store still says z=3.
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
  await expect
    .poll(async () => (await getRenderTransform(page, id))?.position[2] ?? Number.POSITIVE_INFINITY, {
      timeout: 15000,
    })
    .toBeLessThan(1);
  expect((await storePosition(page, id))[2]).toBe(3);

  // 3) Pause: the edit state owns the pose again and the mesh snaps back.
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  const paused = await getTelemetry(page);
  expect(paused.status).toBe("paused");
  expect(paused.viewPose).toBe(false);
  await expect
    .poll(async () => {
      const render = await getRenderTransform(page, id);
      return render ? Math.abs(render.position[2] - 3) : Number.POSITIVE_INFINITY;
    }, { timeout: 10000 })
    .toBeLessThan(1e-3);
  await expectRenderMatchesStore(page, id);

  // 4) The body is still draggable while paused; the first edit auto-stops the
  // session, so Z (the horizontal drag plane) is untouched.
  const centerAtThree = await projectWorld(page, [0, 0, 3]);
  const beforeDrag = await storePosition(page, id);
  await dragBy(page, centerAtThree, 100, 0);
  const afterDrag = await storePosition(page, id);
  expect(
    Math.abs(afterDrag[0] - beforeDrag[0]),
    `body drag after Pause must move the body (before ${JSON.stringify(beforeDrag)}, after ${JSON.stringify(afterDrag)})`,
  ).toBeGreaterThan(0.1);
  expect(afterDrag[2]).toBe(3);
  await expectRenderMatchesStore(page, id);
  await expect.poll(async () => (await getTelemetry(page)).status).toBe("idle");

  // 5) Inspector edit after the sim: the mesh follows the new coordinates.
  await zInput.fill("4");
  await zInput.blur();
  await expect.poll(async () => (await storePosition(page, id))[2]).toBe(4);
  await expect
    .poll(async () => {
      const render = await getRenderTransform(page, id);
      return render ? Math.abs(render.position[2] - 4) : Number.POSITIVE_INFINITY;
    })
    .toBeLessThan(1e-3);
  await expectRenderMatchesStore(page, id);

  await page.screenshot({ path: "e2e/artifacts/after-pause-edit.png" });
});

test("4. axis arrows still work after a simulation", async ({ page }) => {
  const id = await seededBoxId(page);

  // Run a short simulation first, then pause: the editor owns the pose again.
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
  await page.waitForTimeout(800);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await expect.poll(async () => (await getTelemetry(page)).status).toBe("paused");
  expect((await getTelemetry(page)).viewPose).toBe(false);

  // Select the box at its (restored) edit pose: the paused snapshot was dropped,
  // so the center used for the click is the edit position [0, 0, 0.5].
  const center = await projectWorld(page, BOX_POS);
  await page.mouse.click(center.x, center.y);
  await expect.poll(async () => (await getScene(page)).selectedId).toBe(id);
  await expect.poll(async () => (await getScene(page)).axisArrowsId).toBe(id);
  // A selection click is not an edit: pressing the body without moving must not
  // write the store nor exit the paused session.
  expect((await getTelemetry(page)).status).toBe("paused");
  await page.waitForTimeout(250); // arrows mount + attach to the entity

  const before = await storePosition(page, id);
  expect(before, "the simulation must never write the edit store").toEqual(BOX_POS);
  await expectRenderMatchesStore(page, id);

  // Drag the +Z arrow shaft midpoint 80 px upward.
  const arrow = await projectWorld(page, [0, 0, BOX_POS[2] + Z_ARROW_OFFSET]);
  await dragBy(page, arrow, 0, -80);

  const after = await storePosition(page, id);
  expect(
    after[2] - before[2],
    `dragging the +Z arrow must raise the body (before ${JSON.stringify(before)}, after ${JSON.stringify(after)})`,
  ).toBeGreaterThan(0.2);
  await expectRenderMatchesStore(page, id);
  // The arrow drag is an edit: it auto-stops the paused session.
  await expect.poll(async () => (await getTelemetry(page)).status).toBe("idle");

  // Drag-release clicks are filtered by `e.delta > 4`, so the selection must
  // stay on the box (and its arrows) instead of flipping to the ground static
  // behind the release point.
  await expect.poll(async () => (await getScene(page)).selectedId).toBe(id);
  await expect.poll(async () => (await getScene(page)).axisArrowsId).toBe(id);

  await page.screenshot({ path: "e2e/artifacts/arrows-after-sim.png" });
});

test("5. Reset returns to the editor", async ({ page }) => {
  const id = await seededBoxId(page);

  // Direct body drag straight away (rigid bodies are draggable on first press).
  const center = await projectWorld(page, BOX_POS);
  await dragBy(page, center, 110, 20);
  const moved = await storePosition(page, id);
  expect(
    Math.abs(moved[0] - BOX_POS[0]) + Math.abs(moved[1] - BOX_POS[1]),
    `body must drag away from the origin (now ${JSON.stringify(moved)})`,
  ).toBeGreaterThan(0.2);
  expect(moved[2]).toBe(0.5);
  expect((await getScene(page)).selectedId).toBe(id);

  // Reset = resetToInitial() + stop(): loaded state, idle worker, editor owns.
  await page.getByRole("button", { name: "Reset", exact: true }).click();
  await expect.poll(async () => (await getTelemetry(page)).status).toBe("idle");
  expect((await getTelemetry(page)).ready).toBe(false);
  expect((await getTelemetry(page)).viewPose).toBe(false);
  expect(await storePosition(page, id)).toEqual(BOX_POS);
  await expectRenderMatchesStore(page, id);

  // The scene is editable immediately: a second body drag works.
  const centerAgain = await projectWorld(page, BOX_POS);
  await dragBy(page, centerAgain, -90, 0);
  const movedAgain = await storePosition(page, id);
  expect(
    Math.abs(movedAgain[0] - BOX_POS[0]),
    `a drag after Reset must still move the body (now ${JSON.stringify(movedAgain)})`,
  ).toBeGreaterThan(0.2);
  expect(movedAgain[2]).toBe(0.5);
  await expectRenderMatchesStore(page, id);

  await page.screenshot({ path: "e2e/artifacts/reset-returns-editor.png" });
});
