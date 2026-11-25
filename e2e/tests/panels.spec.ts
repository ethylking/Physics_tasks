// e2e/tests/panels.spec.ts — resizable Spawn Palette / Inspector panels.
//
// Every scenario runs on a FRESH page (the browser mock re-seeds the "Demo"
// project on each load). Input is real mouse/keyboard; the __mechlab hook is
// read-only (readiness + store assertions).
//
// Geometry invariant (verified once in test 1, then relied upon):
//   - the workspace flex row starts at x = 0, so the LEFT divider's x equals the
//     palette width;
//   - the RIGHT panel width = viewport width − (right divider x + its width);
//   - the divider is `w-1.5` = 6 px in CSS, so two dividers take 12 px and the
//     canvas is the remaining flex-1 width.
//
// Clamp drags intentionally travel far past the viewport edge (a real user can
// flick past the bound); pointer capture keeps delivering moves to the divider,
// and the bound is reached long before the off-screen part of the path.

import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import { canvasBox, getScene } from "./helpers";

/** Viewport used by the whole file (also the config default). */
const VIEWPORT = { width: 1600, height: 900 };
const HANDLE_WIDTH = 6;
const LEFT_DEFAULT = 192;
const RIGHT_DEFAULT = 288;

/** Console/page errors collected across the whole file (test 9). */
const errors: string[] = [];

test.beforeEach(async ({ page }) => {
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(`[console.error] ${msg.text()}`);
  });
  page.on("pageerror", (err) => {
    errors.push(`[pageerror] ${err.message}`);
  });

  await page.setViewportSize(VIEWPORT);
  await page.goto("/");
  await expect(page.locator("canvas").first()).toBeVisible({ timeout: 60000 });
  await expect
    .poll(async () => (await getScene(page))?.project?.meta?.name, { timeout: 60000 })
    .toBe("Demo");
  // Let the first R3F frames and the canvas layout settle.
  await page.waitForTimeout(1200);
});

test.afterEach(async () => {
  expect(errors, "the scenario must not log console/page errors").toEqual([]);
});

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function leftHandle(page: Page): Locator {
  return page.getByRole("separator", { name: "Resize spawn palette" });
}

function rightHandle(page: Page): Locator {
  return page.getByRole("separator", { name: "Resize inspector" });
}

async function boxOf(locator: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await locator.boundingBox();
  if (!box) throw new Error(`no bounding box for ${locator.toString()}`);
  return box;
}

export interface PanelMetrics {
  leftWidth: number;
  rightWidth: number;
  canvasWidth: number;
  /** Palette DOM width (independent check of the left-divider invariant). */
  paletteDomWidth: number;
  /** Inspector DOM width (independent check of the right-divider invariant). */
  inspectorDomWidth: number;
  viewportWidth: number;
}

/**
 * Read the panel geometry through the dividers (the invariant) and also read
 * the asides directly so test 1 can prove the invariant holds.
 */
async function panelMetrics(page: Page): Promise<PanelMetrics> {
  const viewport = page.viewportSize() ?? VIEWPORT;
  const left = await boxOf(leftHandle(page));
  const right = await boxOf(rightHandle(page));
  const palette = await boxOf(page.locator("aside").first());
  const inspector = await boxOf(page.locator("aside").last());
  const canvas = await canvasBox(page);
  return {
    leftWidth: left.x,
    rightWidth: viewport.width - (right.x + right.width),
    canvasWidth: canvas.width,
    paletteDomWidth: palette.width,
    inspectorDomWidth: inspector.width,
    viewportWidth: viewport.width,
  };
}

/** A width assertion with an explicit pixel tolerance (default ±2 px). */
function expectClose(actual: number, expected: number, tolerance = 2, label = ""): void {
  expect(
    Math.abs(actual - expected),
    `${label} expected ~${expected} px (±${tolerance}), got ${actual} px`,
  ).toBeLessThanOrEqual(tolerance);
}

/**
 * Real pointer drag: move to the divider centre → down → `steps` mouse.move
 * events ~12 ms apart → up. Mirrors a human drag; the divider keeps pointer
 * capture so off-viewport coordinates still reach it.
 */
async function dragHandle(page: Page, handle: Locator, dx: number, steps = 10): Promise<void> {
  const box = await boxOf(handle);
  const startX = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(startX, y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(startX + (dx * i) / steps, y);
    await page.waitForTimeout(12);
  }
  await page.mouse.up();
  await page.waitForTimeout(200);
}

/**
 * Focus the divider the way a mouse user does — a real click. `ResizeHandle`
 * focuses itself on pointerdown (preventDefault would otherwise suppress the
 * implicit focus), so this asserts click-to-focus directly. There is
 * deliberately NO `locator.focus()` fallback: that would mask a regression of
 * the click-then-arrow-keys behaviour.
 */
async function clickToFocus(page: Page, handle: Locator, selector: string): Promise<void> {
  await handle.click();
  const focused = await page.evaluate(
    (sel) => document.activeElement === document.querySelector(sel),
    selector,
  );
  expect(focused, `a real mouse click must focus the divider (${selector})`).toBe(true);
}

// -----------------------------------------------------------------------------
// Tests
// -----------------------------------------------------------------------------

test("1. initial widths and reflow", async ({ page }) => {
  const m = await panelMetrics(page);

  expectClose(m.paletteDomWidth, LEFT_DEFAULT, 2, "palette");
  expectClose(m.inspectorDomWidth, RIGHT_DEFAULT, 2, "inspector");

  // Invariant: the left divider's x IS the palette width, and the right width
  // is derived from the right divider's far edge.
  expectClose(m.leftWidth, m.paletteDomWidth, 0.5, "left divider x vs palette width");
  expectClose(m.rightWidth, m.inspectorDomWidth, 0.5, "right divider derived width vs inspector width");

  // Canvas = viewport − palette − inspector − two 6 px dividers.
  expectClose(
    m.canvasWidth,
    VIEWPORT.width - LEFT_DEFAULT - RIGHT_DEFAULT - HANDLE_WIDTH * 2,
    2,
    "canvas width",
  );

  // The dividers advertise themselves as vertical separators.
  const left = leftHandle(page);
  await expect(left).toHaveAttribute("aria-orientation", "vertical");
  await expect(left).toHaveAttribute("aria-valuemin", "160");
  await expect(left).toHaveAttribute("aria-valuemax", "420");
  await expect(left).toHaveAttribute("aria-valuenow", "192");
  await expect(left).toHaveAttribute("data-dragging", "false");
});

test("2. dragging the left divider widens the palette and narrows the canvas", async ({ page }) => {
  const before = await panelMetrics(page);

  await dragHandle(page, leftHandle(page), 100);

  const after = await panelMetrics(page);
  expectClose(after.leftWidth, 292, 2, "palette after +100 px drag");
  expectClose(after.canvasWidth, before.canvasWidth - 100, 2, "canvas after -100 px");
  expectClose(after.rightWidth, RIGHT_DEFAULT, 1, "inspector must not change");
});

test("3. dragging the right divider widens the inspector", async ({ page }) => {
  const before = await panelMetrics(page);

  await dragHandle(page, rightHandle(page), -80);

  const after = await panelMetrics(page);
  expectClose(after.rightWidth, 368, 2, "inspector after -80 px drag");
  expectClose(after.canvasWidth, before.canvasWidth - 80, 2, "canvas after -80 px");
  expectClose(after.leftWidth, LEFT_DEFAULT, 1, "palette must not change");
});

test("4. clamping", async ({ page }) => {
  // Left divider dragged far left: the store clamps at 160 px.
  await dragHandle(page, leftHandle(page), -500);
  let m = await panelMetrics(page);
  expectClose(m.leftWidth, 160, 0.5, "palette at its minimum");
  expect(Math.round(m.leftWidth)).toBe(160);
  await expect(leftHandle(page)).toHaveAttribute("aria-valuenow", "160");

  // A further drag past the bound must not go lower.
  await dragHandle(page, leftHandle(page), -80);
  m = await panelMetrics(page);
  expectClose(m.leftWidth, 160, 0.5, "palette still at its minimum");

  // Right divider dragged far right: the store clamps at 240 px.
  await dragHandle(page, rightHandle(page), 500);
  m = await panelMetrics(page);
  expectClose(m.rightWidth, 240, 0.5, "inspector at its minimum");
  expect(Math.round(m.rightWidth)).toBe(240);
  await expect(rightHandle(page)).toHaveAttribute("aria-valuenow", "240");

  // A further drag past the bound must not go lower.
  await dragHandle(page, rightHandle(page), 80);
  m = await panelMetrics(page);
  expectClose(m.rightWidth, 240, 0.5, "inspector still at its minimum");

  // Both clamped panels: the canvas takes all remaining space.
  expectClose(m.canvasWidth, VIEWPORT.width - 160 - 240 - HANDLE_WIDTH * 2, 2, "canvas width");
});

test("5. double-click resets both", async ({ page }) => {
  // Resize both panels away from their defaults.
  await dragHandle(page, leftHandle(page), 80);
  await dragHandle(page, rightHandle(page), -60);
  let m = await panelMetrics(page);
  expectClose(m.leftWidth, 272, 2, "palette before double-click");
  expectClose(m.rightWidth, 348, 2, "inspector before double-click");

  // Double-clicking the LEFT divider resets BOTH panels.
  await leftHandle(page).dblclick();
  await page.waitForTimeout(150);
  m = await panelMetrics(page);
  expectClose(m.leftWidth, LEFT_DEFAULT, 1, "palette after left double-click");
  expectClose(m.rightWidth, RIGHT_DEFAULT, 1, "inspector after left double-click");
  expect(await page.evaluate(() => document.body.classList.contains("resizing-panels"))).toBe(false);

  // Same story from the RIGHT divider, starting from a different non-default state.
  // (The inspector grows when its divider moves left, so -40 px → 288 + 40.)
  await dragHandle(page, leftHandle(page), 50);
  await dragHandle(page, rightHandle(page), -40);
  m = await panelMetrics(page);
  expectClose(m.leftWidth, 242, 2, "palette before right double-click");
  expectClose(m.rightWidth, 328, 2, "inspector before right double-click");

  await rightHandle(page).dblclick();
  await page.waitForTimeout(150);
  m = await panelMetrics(page);
  expectClose(m.leftWidth, LEFT_DEFAULT, 1, "palette after right double-click");
  expectClose(m.rightWidth, RIGHT_DEFAULT, 1, "inspector after right double-click");
  expect(await page.evaluate(() => document.body.classList.contains("resizing-panels"))).toBe(false);
});

test("6. keyboard resize", async ({ page }) => {
  // Put the inspector at a non-default width so Home has something to reset.
  await dragHandle(page, rightHandle(page), -40);
  expectClose((await panelMetrics(page)).rightWidth, 328, 2, "inspector before keyboard");

  const handle = leftHandle(page);
  // Click-to-focus: a real click must move focus onto the separator itself;
  // no programmatic focus() fallback is allowed here.
  await clickToFocus(page, handle, '[aria-label="Resize spawn palette"]');

  // The separator role and its current value are exposed to AT.
  await expect(handle).toHaveAttribute("role", "separator");
  await expect(handle).toHaveAttribute("aria-valuenow", "192");
  await expect(handle).toHaveAttribute("aria-valuetext", "192 pixels");

  await page.keyboard.press("ArrowRight");
  await expect(handle).toHaveAttribute("aria-valuenow", "208");
  await page.keyboard.press("ArrowRight");
  await expect(handle).toHaveAttribute("aria-valuenow", "224");
  expectClose((await panelMetrics(page)).leftWidth, 224, 1, "palette after +2 steps");

  await page.keyboard.press("ArrowLeft");
  await expect(handle).toHaveAttribute("aria-valuenow", "208");
  expectClose((await panelMetrics(page)).leftWidth, 208, 1, "palette after one step back");

  // Home resets BOTH panels to their defaults.
  await page.keyboard.press("Home");
  await expect(handle).toHaveAttribute("aria-valuenow", "192");
  const m = await panelMetrics(page);
  expectClose(m.leftWidth, LEFT_DEFAULT, 1, "palette after Home");
  expectClose(m.rightWidth, RIGHT_DEFAULT, 1, "inspector after Home");
});

test("7. mid-drag affordances and cancel cleanup", async ({ page }) => {
  const handle = leftHandle(page);
  const before = await panelMetrics(page);

  // Start a real drag and move far enough to resize.
  const box = await boxOf(handle);
  const startX = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(startX, y);
  await page.mouse.down();
  await page.mouse.move(startX + 20, y, { steps: 4 });
  await page.waitForTimeout(80);

  // Mid-drag affordances: global resize cursor / no text selection + local flag.
  expect(await page.evaluate(() => document.body.classList.contains("resizing-panels"))).toBe(true);
  await expect(handle).toHaveAttribute("data-dragging", "true");
  expectClose((await panelMetrics(page)).leftWidth, before.leftWidth + 20, 2, "width mid-drag");

  // A real pointercancel (dispatched on the divider) aborts the drag cleanly.
  await handle.evaluate((el) => {
    el.dispatchEvent(
      new PointerEvent("pointercancel", { bubbles: true, cancelable: true, pointerId: 1 }),
    );
  });
  await expect
    .poll(() => page.evaluate(() => document.body.classList.contains("resizing-panels")))
    .toBe(false);
  await expect(handle).toHaveAttribute("data-dragging", "false");
  await page.mouse.up();
  await page.waitForTimeout(100);

  // The component stays functional: a subsequent normal drag still resizes.
  const mid = await panelMetrics(page);
  await dragHandle(page, handle, 60);
  const after = await panelMetrics(page);
  expectClose(after.leftWidth, mid.leftWidth + 60, 2, "palette after a drag following pointercancel");
  expect(after.leftWidth).toBeGreaterThan(before.leftWidth);
});

test("8. panels stay usable after resizing", async ({ page }) => {
  // Widen both panels to ~350 px.
  await dragHandle(page, leftHandle(page), 350 - LEFT_DEFAULT);
  await dragHandle(page, rightHandle(page), -(350 - RIGHT_DEFAULT));

  let m = await panelMetrics(page);
  expectClose(m.leftWidth, 350, 2, "palette widened to 350");
  expectClose(m.rightWidth, 350, 2, "inspector widened to 350");

  await page.screenshot({ path: "e2e/artifacts/panels-resized.png" });

  // The palette still spawns tools through a real click.
  await page.getByRole("button", { name: "Box", exact: true }).click();
  await expect.poll(async () => (await getScene(page))?.tool?.kind).toBe("box");
  expect((await getScene(page)).tool).toBeTruthy();

  // Escape cancels the tool and the panels remain fully rendered.
  await page.keyboard.press("Escape");
  await expect.poll(async () => (await getScene(page))?.tool).toBeNull();

  await expect(page.getByRole("heading", { name: "Spawn Palette" })).toBeVisible();
  await expect(page.locator("aside").first()).toBeVisible();
  await expect(page.locator("aside").last()).toBeVisible();

  // The inspector shows its placeholder (nothing selected) or the selected
  // entity's fields — either way it must be usable, not collapsed.
  const selectedId = (await getScene(page)).selectedId as string | null;
  if (selectedId) {
    await expect(page.getByLabel("Entity name")).toBeVisible();
  } else {
    await expect(
      page.getByText("Select an entity in the viewport to edit its properties."),
    ).toBeVisible();
  }

  m = await panelMetrics(page);
  expectClose(m.canvasWidth, VIEWPORT.width - 350 - 350 - HANDLE_WIDTH * 2, 2, "canvas width at 350/350");
});

test("9. zero console errors across all flows", async () => {
  expect(errors).toEqual([]);
});
