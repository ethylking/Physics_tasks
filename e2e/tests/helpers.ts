// e2e/tests/helpers.ts — shared page-state readers for the MechLab E2E suite.
//
// The __mechlab hook (src/main.tsx) is used ONLY for deterministic assertions
// and readiness polling — never to drive application state. Float32Array
// snapshots cannot cross the evaluate boundary, so they are converted to plain
// number arrays inside the page.

import type { Page } from "@playwright/test";

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
