// stores/collisionStore.ts — best-effort initial-collision detection.
//
// The Physics-Math subagent provides `findInitialCollisions` (cached per
// project object reference), which returns the ids of bodies+statics that
// interpenetrate at load time. This store wraps that result behind a small
// debounced refresh-on-project-change subscription and exposes a per-entity
// selector hook (`useCollisionFlag`) for the renderer to tint overlapping
// geometry before the user starts the simulation.

import { create } from "zustand";
import type { MechProject } from "../core/types";
import { findInitialCollisions } from "../physics/collisionCheck";
import { useSceneStore } from "./sceneStore";

interface CollisionState {
  collidingIds: string[];
  checking: boolean;
  checkNow: (project: MechProject) => Promise<string[]>;
  requestRefresh: (project: MechProject) => void;
  clear: () => void;
}

/** Debounce window for the scene-store-driven automatic refresh. */
const COLLISION_DEBOUNCE_MS = 200;

let refreshTimer: ReturnType<typeof setTimeout> | null = null;

export const useCollisionStore = create<CollisionState>()((set, get) => ({
  collidingIds: [],
  checking: false,

  checkNow: async (project) => {
    set({ checking: true });
    try {
      const ids = await findInitialCollisions(project);
      // Keep only real scene entities (bodies + statics). The detector also
      // walks generated rope chain-segment bodies, whose synthetic ids are not
      // editable entities and must never appear in the highlight or the popup.
      const sceneIds = new Set([
        ...project.bodies.map((b) => b.id),
        ...project.statics.map((s) => s.id),
      ]);
      const sorted = [...new Set(ids)].filter((id) => sceneIds.has(id)).sort();
      set({ collidingIds: sorted, checking: false });
      return sorted;
    } catch (e) {
      console.error("collision check failed", e);
      set({ collidingIds: [], checking: false });
      return [];
    }
  },

  requestRefresh: (project) => {
    if (refreshTimer !== null) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      void get().checkNow(project);
    }, COLLISION_DEBOUNCE_MS);
  },

  clear: () => set({ collidingIds: [], checking: false }),
}));

/** Whether a given entity id is currently flagged as interpenetrating. */
export function useCollisionFlag(id: string): boolean {
  return useCollisionStore((s) => s.collidingIds.includes(id));
}

// -----------------------------------------------------------------------------
// Sync: refresh the collision set whenever the working project is replaced
// (load, JSON apply, fresh create, reset). Edits that reuse the same object
// are picked up explicitly by Play/Step via `checkNow`.
// -----------------------------------------------------------------------------

useSceneStore.subscribe((state, prev) => {
  if (state.project === prev.project) return;
  if (!state.project) {
    useCollisionStore.getState().clear();
    return;
  }
  useCollisionStore.getState().requestRefresh(state.project);
});
