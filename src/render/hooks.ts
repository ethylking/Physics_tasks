// render/hooks.ts — canvas-wide keyboard handling.
// Escape cancels the active spawn tool first, then deselects.

import { useEffect } from "react";
import { useSceneStore } from "../stores/sceneStore";

export function useCanvasKeyboard(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const state = useSceneStore.getState();
      if (state.tool) state.setTool(null);
      else if (state.selectedId) state.setSelected(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
