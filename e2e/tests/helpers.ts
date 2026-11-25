// e2e/tests/helpers.ts — shared page-state readers for the MechLab E2E suite.
//
// The __mechlab hook (src/main.tsx) is used ONLY for deterministic assertions
// and readiness polling — never to drive application state. Float32Array
// snapshots cannot cross the evaluate boundary, so they are converted to plain
// number arrays inside the page.

import type { Page } from "@playwright/test";
import * as THREE from "three";

/** Console errors + page errors collected across the whole run (test 7). */
export const consoleErrors: string[] = [];
export const pageErrors: string[] = [];

export function collectConsoleErrors(page: Page): void {
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(`[console.error] ${msg.text()}`);
  });
  page.on("pageerror", (err) => {
    pageErrors.push(`[pageerror] ${err.message}`);
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getScene(page: Page): Promise<any> {
  return page.evaluate(() => (window as any).__mechlab.scene.getState());
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getTelemetry(page: Page): Promise<any> {
  return page.evaluate(() => (window as any).__mechlab.telemetry.getState());
}

/** Latest physics snapshot as a plain number array (header + body records). */
export async function getSnapshot(page: Page): Promise<number[]> {
  return page.evaluate(() => {
    // NOTE: __mechlab.telemetry is the raw zustand store — the actions live on
    // its state object, so the snapshot reader must go through getState().
    const t = (window as any).__mechlab.telemetry;
    const s = t.getState().getSnapshot();
    return s ? Array.from(s) : [];
  });
}

export async function getBodyOrder(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const t = (window as any).__mechlab.telemetry;
    return [...t.getState().getBodyOrder()];
  });
}

/** The R3F canvas bounding box (first canvas element). */
export async function canvasBox(page: Page): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await page.locator("canvas").first().boundingBox();
  if (!box) throw new Error("canvas has no bounding box — is the app rendered?");
  return box;
}

/** Real mouse click at a fractional position inside the canvas (0..1). */
export async function clickCanvasAt(page: Page, xFrac: number, yFrac: number): Promise<void> {
  const box = await canvasBox(page);
  await page.mouse.click(box.x + box.width * xFrac, box.y + box.height * yFrac);
}

/** Live rendered transform of an entity's Object3D (null while not mounted). */
export interface RenderTransform {
  position: [number, number, number];
  quaternion: [number, number, number, number];
}

/**
 * Read the actual rendered pose through the dev hook (`getRenderTransform` on
 * `window.__mechlab`, backed by the entity Object3D registry). This is how the
 * suite proves that meshes follow the store coordinates (edit ownership) or the
 * worker snapshot (simulation ownership).
 */
export async function getRenderTransform(page: Page, id: string): Promise<RenderTransform | null> {
  return page.evaluate((entityId) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const hook = (window as any).__mechlab;
    return (hook.getRenderTransform(entityId) ?? null) as RenderTransform | null;
  }, id);
}

/**
 * Screen position (viewport pixels) of a world point in the 3D viewport.
 *
 * The projection replicates the R3F canvas camera EXACTLY: the Canvas3D camera
 * is `position [9,-9,7]`, `up [0,0,1]`, `fov 50`, `near 0.1`, `far 500`, and
 * OrbitControls starts with `target [0,0,0.5]`, so it looks at that target on
 * the first update. The aspect comes from the live canvas bounding box and the
 * NDC point is mapped back through the same box.
 *
 * Valid only while the camera has not been orbited/panned — the regression
 * scenarios never touch the camera controls.
 */
export async function projectWorld(
  page: Page,
  world: [number, number, number],
): Promise<{ x: number; y: number }> {
  const box = await canvasBox(page);
  const camera = new THREE.PerspectiveCamera(50, box.width / box.height, 0.1, 500);
  camera.position.set(9, -9, 7);
  camera.up.set(0, 0, 1);
  camera.lookAt(0, 0, 0.5);
  camera.updateMatrixWorld();

  const projected = new THREE.Vector3(world[0], world[1], world[2]).project(camera);
  return {
    x: box.x + ((projected.x + 1) / 2) * box.width,
    y: box.y + ((1 - projected.y) / 2) * box.height,
  };
}
