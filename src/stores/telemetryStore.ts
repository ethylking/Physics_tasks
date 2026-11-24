// stores/telemetryStore.ts — transient telemetry + worker lifecycle (§5.2).
//
// The worker owns the Rapier world; snapshots arrive as Transferable
// Float32Arrays at 60 Hz. The LATEST snapshot lives OUTSIDE reactive state
// (read via getSnapshot() inside useFrame) so React never re-renders per
// physics frame — only the HUD (throttled to ~10 Hz) re-renders.

import { create } from "zustand";
import type { MechProject } from "../core/types";
import { useSceneStore } from "./sceneStore";

export type TelemetryStatus = "idle" | "running" | "paused";

export interface EnergyHud {
  t: number;
  Ek: number;
  Ep: number;
  Etotal: number;
  drift: number;
}

interface TelemetryState {
  status: TelemetryStatus;
  ready: boolean;
  projectId: string | null;
  hud: EnergyHud | null;
  error: string | null;
  warnings: string[];

  start: (project: MechProject) => void;
  play: () => void;
  pause: () => void;
  stepOnce: () => void;
  restart: (project: MechProject) => void;
  stop: () => void;
  clearWarnings: () => void;

  /** Latest snapshot — NON-reactive, read inside useFrame via getState(). */
  getSnapshot: () => Float32Array | null;
  getBodyOrder: () => string[];
}

let worker: Worker | null = null;
let latestSnapshot: Float32Array | null = null;
let bodyOrder: string[] = [];
let lastHudAt = 0;

function stopWorker(): void {
  worker?.terminate();
  worker = null;
  latestSnapshot = null;
  bodyOrder = [];
}

function createWorker(project: MechProject): void {
  stopWorker();
  bodyOrder = project.bodies.map((b) => b.id);
  worker = new Worker(new URL("../workers/physics.worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = (ev: MessageEvent) => {
    const msg = ev.data as {
      type: string;
      buffer?: ArrayBuffer;
      message?: string;
    };
    switch (msg.type) {
      case "ready":
        useTelemetryStore.setState({ ready: true });
        break;
      case "snapshot": {
        if (!msg.buffer) return;
        latestSnapshot = new Float32Array(msg.buffer);
        const now = performance.now();
        if (now - lastHudAt > 100) {
          lastHudAt = now;
          const s = latestSnapshot;
          useTelemetryStore.setState({
            hud: { t: s[0] ?? 0, Ek: s[1] ?? 0, Ep: s[2] ?? 0, Etotal: s[3] ?? 0, drift: s[5] ?? 0 },
          });
        }
        break;
      }
      case "warning":
        useTelemetryStore.setState((state) => ({
          warnings: [...state.warnings.slice(-4), String(msg.message ?? "physics warning")],
        }));
        break;
      case "error":
        useTelemetryStore.setState({ status: "idle", ready: false, error: String(msg.message ?? "physics error") });
        break;
      default:
        break;
    }
  };
  worker.postMessage({ type: "initWorld", project });
}

export const useTelemetryStore = create<TelemetryState>()((set) => ({
  status: "idle",
  ready: false,
  projectId: null,
  hud: null,
  error: null,
  warnings: [],

  start: (project) => {
    createWorker(project);
    set({ status: "paused", ready: false, projectId: project.meta.id, hud: null, error: null });
  },

  play: () => {
    worker?.postMessage({ type: "play" });
    useSceneStore.getState().setTool(null);
    set((s) => ({ status: "running", error: s.error }));
  },

  pause: () => {
    worker?.postMessage({ type: "pause" });
    set({ status: "paused" });
  },

  stepOnce: () => {
    worker?.postMessage({ type: "stepOnce" });
    set({ status: "paused" });
  },

  restart: (project) => {
    createWorker(project);
    set({ status: "paused", ready: false, projectId: project.meta.id, hud: null });
  },

  stop: () => {
    stopWorker();
    set({ status: "idle", ready: false, projectId: null, hud: null, error: null });
  },

  clearWarnings: () => set({ warnings: [] }),

  getSnapshot: () => latestSnapshot,
  getBodyOrder: () => bodyOrder,
}));

// Loading a different project invalidates the running simulation.
useSceneStore.subscribe((state, prev) => {
  const id = state.project?.meta.id ?? null;
  if (id !== (prev.project?.meta.id ?? null)) {
    useTelemetryStore.getState().stop();
  }
});
