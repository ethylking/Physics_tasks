// stores/uiStore.ts — lightweight UI state (Zustand).
// High-frequency physics telemetry will live in separate transient stores (§5.2).

import { create } from "zustand";

// Session-only panel widths (px). Deliberately not persisted: they reset on reload.
export const LEFT_PANEL_MIN = 160;
export const LEFT_PANEL_MAX = 420;
export const LEFT_PANEL_DEFAULT = 192;
export const RIGHT_PANEL_MIN = 240;
export const RIGHT_PANEL_MAX = 560;
export const RIGHT_PANEL_DEFAULT = 288;

/** Clamp a panel width into [min, max], rounding to whole pixels; non-finite → min. */
export function clampPanelWidth(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.round(Math.min(max, Math.max(min, value)));
}

interface UiState {
  projectManagerOpen: boolean;
  leftPanelWidth: number;
  rightPanelWidth: number;
  openProjectManager: () => void;
  closeProjectManager: () => void;
  toggleProjectManager: () => void;
  setLeftPanelWidth: (width: number) => void;
  setRightPanelWidth: (width: number) => void;
  resetPanelWidths: () => void;
}

export const useUiStore = create<UiState>()((set) => ({
  projectManagerOpen: false,
  leftPanelWidth: LEFT_PANEL_DEFAULT,
  rightPanelWidth: RIGHT_PANEL_DEFAULT,
  openProjectManager: () => set({ projectManagerOpen: true }),
  closeProjectManager: () => set({ projectManagerOpen: false }),
  toggleProjectManager: () => set((s) => ({ projectManagerOpen: !s.projectManagerOpen })),
  setLeftPanelWidth: (width) =>
    set({ leftPanelWidth: clampPanelWidth(width, LEFT_PANEL_MIN, LEFT_PANEL_MAX) }),
  setRightPanelWidth: (width) =>
    set({ rightPanelWidth: clampPanelWidth(width, RIGHT_PANEL_MIN, RIGHT_PANEL_MAX) }),
  resetPanelWidths: () =>
    set({ leftPanelWidth: LEFT_PANEL_DEFAULT, rightPanelWidth: RIGHT_PANEL_DEFAULT }),
}));
