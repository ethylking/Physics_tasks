// stores/uiStore.ts — lightweight UI state (Zustand).
// High-frequency physics telemetry will live in separate transient stores (§5.2).

import { create } from "zustand";

interface UiState {
  projectManagerOpen: boolean;
  openProjectManager: () => void;
  closeProjectManager: () => void;
  toggleProjectManager: () => void;
}

export const useUiStore = create<UiState>()((set) => ({
  projectManagerOpen: false,
  openProjectManager: () => set({ projectManagerOpen: true }),
  closeProjectManager: () => set({ projectManagerOpen: false }),
  toggleProjectManager: () => set((s) => ({ projectManagerOpen: !s.projectManagerOpen })),
}));
