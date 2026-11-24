// stores/overlayStore.ts — UI settings for the live vector overlays and the
// trajectory tracer (Milestone 4). Purely presentational; the overlay renderer
// reads it non-reactively inside useFrame.

import { create } from "zustand";
import type { Vec3 } from "../core/types";

export type VectorKind =
  | "velocity"
  | "accel"
  | "tangential"
  | "normal"
  | "gravity"
  | "reaction"
  | "friction"
  | "external"
  | "tension";

export const VECTOR_KINDS: Array<{ kind: VectorKind; label: string }> = [
  { kind: "velocity", label: "Velocity v⃗" },
  { kind: "accel", label: "Acceleration a⃗" },
  { kind: "tangential", label: "Tangential a_τ" },
  { kind: "normal", label: "Normal a_n" },
  { kind: "gravity", label: "Gravity mg⃗" },
  { kind: "reaction", label: "Normal reaction N⃗" },
  { kind: "friction", label: "Friction F_f" },
  { kind: "external", label: "External forces F_ext" },
  { kind: "tension", label: "Rope tension T" },
];

export interface TrailConfig {
  enabled: boolean;
  /** Trace anchor in the body's local frame (e.g. a rim point → cycloid). */
  anchor: Vec3;
}

interface OverlayState {
  panelOpen: boolean;
  /** Arrow length in meters per physical unit (m per m/s, m per N, …). */
  scale: number;
  vectors: Record<VectorKind, boolean>;
  /** Trajectory-tracer config per body id. */
  trails: Record<string, TrailConfig>;

  togglePanel: () => void;
  setScale: (scale: number) => void;
  toggleVector: (kind: VectorKind) => void;
  setTrailEnabled: (id: string, enabled: boolean) => void;
  setTrailAnchor: (id: string, anchor: Vec3) => void;
}

export const DEFAULT_VECTOR_SCALE = 0.5;

const DEFAULT_VECTORS: Record<VectorKind, boolean> = {
  velocity: true,
  accel: false,
  tangential: false,
  normal: false,
  gravity: false,
  reaction: true,
  friction: true,
  external: true,
  tension: false,
};

export const useOverlayStore = create<OverlayState>()((set) => ({
  panelOpen: false,
  scale: DEFAULT_VECTOR_SCALE,
  vectors: { ...DEFAULT_VECTORS },
  trails: {},

  togglePanel: () => set((s) => ({ panelOpen: !s.panelOpen })),
  setScale: (scale) => set({ scale: Math.min(10, Math.max(0.01, scale)) }),
  toggleVector: (kind) => set((s) => ({ vectors: { ...s.vectors, [kind]: !s.vectors[kind] } })),
  setTrailEnabled: (id, enabled) =>
    set((s) => {
      const current = s.trails[id] ?? { enabled: false, anchor: [0, 0, 0] as Vec3 };
      return { trails: { ...s.trails, [id]: { ...current, enabled } } };
    }),
  setTrailAnchor: (id, anchor) =>
    set((s) => {
      const current = s.trails[id] ?? { enabled: true, anchor: [0, 0, 0] as Vec3 };
      return { trails: { ...s.trails, [id]: { ...current, anchor } } };
    }),
}));
