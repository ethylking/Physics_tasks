// e2e/tests/app.spec.ts — MechLab end-to-end UI suite (task T4 + T1/T2/T3 checks).
//
// Runs against `vite dev` with the Tauri backend replaced by the in-memory
// browser mock (MECHLAB_E2E=1 alias). The tests form ONE serial user flow on a
// single page: boot → spawn box → deselect/reselect → edit coordinates → save →
// simulate (drop) → pause/reset → spawn + rotate statics. The `window.__mechlab`
// hook is used ONLY for deterministic assertions / readiness polling — every
// state change is driven through real clicks and keyboard input.
//
// Robustness notes (per lead):
// - The demo project already contains "Box 1" at [0,0,0.5]; the new box is
//   spawned at an off-center canvas point (40% W / 55% H) so the two never
//   overlap, and the reselect click reuses the exact same point (the click ray
//   always re-hits the freshly spawned box — it passes through the footprint).
// - The deselect click goes to the top-left sky corner (15% W / 8% H) whose ray
//   misses all scene geometry (never the selectable ground mesh).
// - Test 5 saves the edited state (real Save click) before Play: the app's
//   Reset restores the last loaded / saved state (see the Reset tooltip), so
//   the saved edit position z=5 is what Reset brings back.

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import {
  clickCanvasAt,
  collectConsoleErrors,
  consoleErrors,
  getBodyOrder,
  getScene,
  getSnapshot,
  getTelemetry,
  pageErrors,
} from "./helpers";

test.describe.configure({ mode: "serial" });

// Snapshot layout (src/physics/snapshot.ts): 8-float header, 25 floats/body.
const HEADER = 8;
const STRIDE = 25;
const OFF_Z = 2; // pos[2]
const OFF_VZ = 9; // linvel[2]

const SPAWN_POINT = { x: 0.4, y: 0.55 };
const DESELECT_POINT = { x: 0.15, y: 0.08 };

let page: Page;
let boxId = "";

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  collectConsoleErrors(page);
  await page.goto("/");
});

test.afterAll(async () => {
  await page.close();
});

/** Current z of the tracked box in the latest physics snapshot (or null). */
async function snapshotBoxZ(): Promise<number | null> {
  const snap = await getSnapshot(page);
  const order = await getBodyOrder(page);
  const idx = order.indexOf(boxId);
  if (idx < 0 || snap.length < HEADER + (idx + 1) * STRIDE) return null;
  return snap[HEADER + idx * STRIDE + OFF_Z] ?? null;
}

test("1. app boots with the seeded project", async () => {
  await expect(page.locator("canvas").first()).toBeVisible({ timeout: 60000 });
  expect(await page.locator("canvas").count()).toBeGreaterThanOrEqual(1);

  await expect.poll(async () => (await getScene(page))?.project?.meta?.name).toBe("Demo");

  const scene = await getScene(page);
  expect(scene.project.statics).toHaveLength(1);
  expect(scene.project.statics[0].kind).toBe("ground");
  expect(scene.project.statics[0].name).toBe("Horizontal plane");
  expect(scene.project.bodies).toHaveLength(1);
});

test("2. spawning a box selects it and shows the axis arrows", async () => {
  await page.getByRole("button", { name: "Box", exact: true }).click();
  await expect.poll(async () => (await getScene(page))?.tool?.kind).toBe("box");

  await clickCanvasAt(page, SPAWN_POINT.x, SPAWN_POINT.y);

  await expect.poll(async () => (await getScene(page))?.project?.bodies?.length).toBe(2);
  let scene = await getScene(page);
  boxId = scene.project.bodies[1].id as string;
  expect(scene.project.bodies[1].name).toBe("Box 2");

  // Spawn selects the new entity and the axis arrows follow the selection.
  await expect.poll(async () => (await getScene(page)).selectedId).toBe(boxId);
  await expect.poll(async () => (await getScene(page)).axisArrowsId).toBe(boxId);

  // Inspector shows the new entity's name.
  await expect(page.getByLabel("Entity name")).toBeVisible();
  await expect(page.getByLabel("Entity name")).toHaveValue("Box 2");

  await page.screenshot({ path: "e2e/artifacts/spawn-arrows.png" });
});

test("3. arrows reappear after deselect + reselect", async () => {
  // The spawn tool is still active after placing — cancel it first (real Esc).
  await page.keyboard.press("Escape");
  await expect.poll(async () => (await getScene(page)).tool).toBeNull();

  // Empty sky corner → onPointerMissed clears the selection AND the arrows.
  await clickCanvasAt(page, DESELECT_POINT.x, DESELECT_POINT.y);
  await expect.poll(async () => (await getScene(page)).selectedId).toBeNull();
  await expect.poll(async () => (await getScene(page)).axisArrowsId).toBeNull();

  // Reselect by clicking the same canvas point the box was spawned under.
  const reselect = async (): Promise<void> => {
    await clickCanvasAt(page, SPAWN_POINT.x, SPAWN_POINT.y);
  };
  await reselect();
  try {
    await expect.poll(async () => (await getScene(page)).selectedId, { timeout: 8000 }).toBe(boxId);
  } catch {
    await page.waitForTimeout(500);
    await reselect(); // one retry with the exact same real mouse click
    await expect.poll(async () => (await getScene(page)).selectedId, { timeout: 8000 }).toBe(boxId);
  }
  await expect.poll(async () => (await getScene(page)).axisArrowsId).toBe(boxId);
});

test("4. coordinates settable in the right panel — raise the box to z=5", async () => {
  // Make sure the box is selected (re-click if the previous test left it deselected).
  if ((await getScene(page)).selectedId !== boxId) {
    await clickCanvasAt(page, SPAWN_POINT.x, SPAWN_POINT.y);
    await expect.poll(async () => (await getScene(page)).selectedId, { timeout: 8000 }).toBe(boxId);
  }

  const zInput = page.getByLabel("Position z");
  await zInput.fill("5");
  await zInput.blur();
  await expect
    .poll(async () => {
      const scene = await getScene(page);
      return scene.project.bodies.find((b: { id: string }) => b.id === boxId)?.initial?.position?.[2];
    })
    .toBe(5);

  const xInput = page.getByLabel("Position x");
  await xInput.fill("1.5");
  await xInput.blur();
  await expect
    .poll(async () => {
      const scene = await getScene(page);
      return scene.project.bodies.find((b: { id: string }) => b.id === boxId)?.initial?.position?.[0];
    })
    .toBe(1.5);
});

test("5. run simulation → object drops under gravity", async () => {
  // Save the edited state first: the app's Reset restores the last loaded /
  // saved state (tooltip on the Reset button), so saving makes the post-Reset
  // edit position z=5 (this also exercises save_project in the browser mock).
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect.poll(async () => (await getScene(page)).dirty).toBe(false);

  const playAt = Date.now();
  await page.getByRole("button", { name: "Play", exact: true }).click();

  // Worker boots on first Play (Rapier WASM init): wait for running + ready.
  await expect
    .poll(async () => {
      const t = await getTelemetry(page);
      return t.status === "running" && t.ready === true;
    })
    .toBe(true);

  // Mid-fall sample: velocity is negative and the box is between z=1 and z=5.
  await expect
    .poll(async () => {
      const snap = await getSnapshot(page);
      const order = await getBodyOrder(page);
      const idx = order.indexOf(boxId);
      if (idx < 0 || snap.length < HEADER + (idx + 1) * STRIDE) return false;
      const base = HEADER + idx * STRIDE;
      const z = snap[base + OFF_Z] ?? 99;
      const vz = snap[base + OFF_VZ] ?? 0;
      return vz < -0.5 && z > 1 && z < 5;
    })
    .toBe(true);

  // ~2.5 s in: clearly below the launch height.
  await page.waitForTimeout(Math.max(0, 2500 - (Date.now() - playAt)));
  await expect.poll(async () => snapshotBoxZ()).toBeLessThan(2);

  // ~3.5 s in: resting on the ground (half box height 0.5, widened window).
  await page.waitForTimeout(Math.max(0, 3500 - (Date.now() - playAt)));
  await expect.poll(async () => snapshotBoxZ()).toBeLessThanOrEqual(0.75);
  await expect.poll(async () => snapshotBoxZ()).toBeGreaterThanOrEqual(0.3);

  // Energy HUD is live while the simulation runs.
  await expect(page.getByText(/ΣE/).first()).toBeVisible();
  await page.screenshot({ path: "e2e/artifacts/drop-resting.png" });

  // Pause, then Reset — the saved edit position (z=5, x=1.5) comes back.
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await expect.poll(async () => (await getTelemetry(page)).status).toBe("paused");

  await page.getByRole("button", { name: "Reset", exact: true }).click();
  await expect.poll(async () => (await getTelemetry(page)).status).toBe("paused");
  await expect.poll(async () => (await getTelemetry(page)).ready, { timeout: 30000 }).toBe(true);

  const scene = await getScene(page);
  expect(scene.project.bodies).toHaveLength(2);
  const box = scene.project.bodies.find((b: { id: string }) => b.id === boxId);
  expect(box.initial.position[0]).toBe(1.5);
  expect(box.initial.position[2]).toBe(5);
});

test("6. static planes: rename + rotation inputs", async () => {
  // Palette label for the ground static.
  const paletteGround = page.getByRole("button", { name: "Horizontal plane", exact: true });
  await expect(paletteGround).toBeVisible();
  await paletteGround.click();
  await expect.poll(async () => (await getScene(page))?.tool?.kind).toBe("ground");

  await clickCanvasAt(page, 0.6, 0.55);
  await expect.poll(async () => (await getScene(page))?.project?.statics?.length).toBe(2);

  let scene = await getScene(page);
  expect(scene.project.statics[1].kind).toBe("ground");
  expect(scene.project.statics[1].name.startsWith("Horizontal plane")).toBe(true);

  // Numeric rotation input edits the RELATIVE quaternion directly.
  const ryInput = page.getByLabel("Rotation (deg) ry");
  await expect(ryInput).toBeVisible();
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

  // A spawned wall defaults to the vertical X–Z plane (normal +Y) in 3D.
  await page.getByRole("button", { name: "Wall", exact: true }).click();
  await expect.poll(async () => (await getScene(page))?.tool?.kind).toBe("wall");
  await clickCanvasAt(page, 0.55, 0.7);
  await expect.poll(async () => (await getScene(page))?.project?.statics?.length).toBe(3);

  scene = await getScene(page);
  expect(scene.project.statics[2].kind).toBe("wall");
  expect(scene.project.statics[2].plane.normal).toEqual([0, 1, 0]);

  await page.screenshot({ path: "e2e/artifacts/statics-rotated.png" });
});

test("7. zero console errors across all flows", async () => {
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
