import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { useSceneStore } from "./stores/sceneStore";
import { useTelemetryStore } from "./stores/telemetryStore";
import { useCollisionStore } from "./stores/collisionStore";
import { entityObjectRegistry } from "./render/registry";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// Dev/test-only debug hook so the Playwright E2E suite can assert on state
// deterministically. Never exposed in production builds (the guard handles that).
if (import.meta.env.DEV || import.meta.env.MODE === "test") {
  (window as unknown as Record<string, unknown>).__mechlab = {
    scene: useSceneStore,
    telemetry: useTelemetryStore,
    collision: useCollisionStore,
    /** Live rendered transform of an entity's Object3D (null when not mounted). */
    getRenderTransform: (id: string) => {
      const obj = entityObjectRegistry.get(id);
      if (!obj) return null;
      return {
        position: obj.position.toArray(),
        quaternion: obj.quaternion.toArray(),
      };
    },
  };
}
