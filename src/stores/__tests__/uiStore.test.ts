// stores/__tests__/uiStore.test.ts — resizable panel-width state.
//
// Pure store logic (no DOM): the documented defaults/bounds, the clamp helper,
// and the three actions. The ui store also owns the Project Manager open flag,
// so every action test proves the unrelated flag is left untouched.

import { beforeEach, describe, expect, it } from "vitest";
import {
  LEFT_PANEL_DEFAULT,
  LEFT_PANEL_MAX,
  LEFT_PANEL_MIN,
  RIGHT_PANEL_DEFAULT,
  RIGHT_PANEL_MAX,
  RIGHT_PANEL_MIN,
  clampPanelWidth,
  useUiStore,
} from "../uiStore";

beforeEach(() => {
  useUiStore.setState({
    leftPanelWidth: LEFT_PANEL_DEFAULT,
    rightPanelWidth: RIGHT_PANEL_DEFAULT,
    projectManagerOpen: false,
  });
});

describe("uiStore — panel width defaults", () => {
  it("exposes the documented default widths and bounds", () => {
    expect(LEFT_PANEL_DEFAULT).toBe(192);
    expect(LEFT_PANEL_MIN).toBe(160);
    expect(LEFT_PANEL_MAX).toBe(420);
    expect(RIGHT_PANEL_DEFAULT).toBe(288);
    expect(RIGHT_PANEL_MIN).toBe(240);
    expect(RIGHT_PANEL_MAX).toBe(560);
  });

  it("starts with the palette at 192 and the inspector at 288", () => {
    const state = useUiStore.getState();
    expect(state.leftPanelWidth).toBe(192);
    expect(state.rightPanelWidth).toBe(288);
  });
});

describe("clampPanelWidth", () => {
  it("returns min for a value below min", () => {
    expect(clampPanelWidth(100, LEFT_PANEL_MIN, LEFT_PANEL_MAX)).toBe(LEFT_PANEL_MIN);
    expect(clampPanelWidth(0, RIGHT_PANEL_MIN, RIGHT_PANEL_MAX)).toBe(RIGHT_PANEL_MIN);
  });

  it("returns max for a value above max", () => {
    expect(clampPanelWidth(9999, LEFT_PANEL_MIN, LEFT_PANEL_MAX)).toBe(LEFT_PANEL_MAX);
    expect(clampPanelWidth(9999, RIGHT_PANEL_MIN, RIGHT_PANEL_MAX)).toBe(RIGHT_PANEL_MAX);
  });

  it("returns min for every non-finite value (NaN, ±Infinity)", () => {
    expect(clampPanelWidth(Number.NaN, LEFT_PANEL_MIN, LEFT_PANEL_MAX)).toBe(LEFT_PANEL_MIN);
    expect(clampPanelWidth(Number.POSITIVE_INFINITY, LEFT_PANEL_MIN, LEFT_PANEL_MAX)).toBe(
      LEFT_PANEL_MIN,
    );
    expect(clampPanelWidth(Number.NEGATIVE_INFINITY, LEFT_PANEL_MIN, LEFT_PANEL_MAX)).toBe(
      LEFT_PANEL_MIN,
    );
    // The min argument, not a hard-coded 160, is what non-finite values fall back to.
    expect(clampPanelWidth(Number.NaN, RIGHT_PANEL_MIN, RIGHT_PANEL_MAX)).toBe(RIGHT_PANEL_MIN);
  });

  it("rounds fractional values to whole pixels", () => {
    expect(clampPanelWidth(200.6, LEFT_PANEL_MIN, LEFT_PANEL_MAX)).toBe(201);
    expect(clampPanelWidth(200.4, LEFT_PANEL_MIN, LEFT_PANEL_MAX)).toBe(200);
    // Rounding happens after clamping, so the result never exceeds the bounds.
    expect(clampPanelWidth(419.6, LEFT_PANEL_MIN, LEFT_PANEL_MAX)).toBe(LEFT_PANEL_MAX);
    expect(clampPanelWidth(160.4, LEFT_PANEL_MIN, LEFT_PANEL_MAX)).toBe(LEFT_PANEL_MIN);
  });

  it("leaves an in-range value unchanged", () => {
    expect(clampPanelWidth(300, LEFT_PANEL_MIN, LEFT_PANEL_MAX)).toBe(300);
    expect(clampPanelWidth(LEFT_PANEL_MIN, LEFT_PANEL_MIN, LEFT_PANEL_MAX)).toBe(LEFT_PANEL_MIN);
    expect(clampPanelWidth(LEFT_PANEL_MAX, LEFT_PANEL_MIN, LEFT_PANEL_MAX)).toBe(LEFT_PANEL_MAX);
  });
});

describe("uiStore — panel width actions", () => {
  it("setLeftPanelWidth clamps to [160, 420] and leaves the inspector alone", () => {
    useUiStore.getState().setLeftPanelWidth(10);
    expect(useUiStore.getState().leftPanelWidth).toBe(160);
    expect(useUiStore.getState().rightPanelWidth).toBe(RIGHT_PANEL_DEFAULT);

    useUiStore.getState().setLeftPanelWidth(9999);
    expect(useUiStore.getState().leftPanelWidth).toBe(420);
    expect(useUiStore.getState().rightPanelWidth).toBe(RIGHT_PANEL_DEFAULT);
  });

  it("setRightPanelWidth clamps to [240, 560] and leaves the palette alone", () => {
    useUiStore.getState().setRightPanelWidth(10);
    expect(useUiStore.getState().rightPanelWidth).toBe(240);
    expect(useUiStore.getState().leftPanelWidth).toBe(LEFT_PANEL_DEFAULT);

    useUiStore.getState().setRightPanelWidth(9999);
    expect(useUiStore.getState().rightPanelWidth).toBe(560);
    expect(useUiStore.getState().leftPanelWidth).toBe(LEFT_PANEL_DEFAULT);
  });

  it("resetPanelWidths restores both defaults after changes", () => {
    useUiStore.getState().setLeftPanelWidth(350);
    useUiStore.getState().setRightPanelWidth(400);
    expect(useUiStore.getState().leftPanelWidth).toBe(350);
    expect(useUiStore.getState().rightPanelWidth).toBe(400);

    useUiStore.getState().resetPanelWidths();

    expect(useUiStore.getState().leftPanelWidth).toBe(LEFT_PANEL_DEFAULT);
    expect(useUiStore.getState().rightPanelWidth).toBe(RIGHT_PANEL_DEFAULT);
  });

  it("never changes the Project Manager flag", () => {
    useUiStore.getState().openProjectManager();
    expect(useUiStore.getState().projectManagerOpen).toBe(true);

    useUiStore.getState().setLeftPanelWidth(300);
    useUiStore.getState().setRightPanelWidth(500);
    useUiStore.getState().resetPanelWidths();

    expect(useUiStore.getState().projectManagerOpen).toBe(true);
  });
});
