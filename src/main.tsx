import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { useSceneStore } from "./stores/sceneStore";
import { useTelemetryStore } from "./stores/telemetryStore";

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
  };
}
