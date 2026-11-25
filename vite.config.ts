import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

// Tauri v2 expects a fixed dev-server port (see src-tauri/tauri.conf.json).
const host = process.env.TAURI_DEV_HOST;

// E2E-only alias: when MECHLAB_E2E=1 the Playwright web server swaps the real
// Tauri IPC bridge for an in-memory browser mock (src/test/browserMock.ts).
// Strictly gated — with the env var unset the alias is empty and the built-in
// @tauri-apps/api/core resolves as usual (normal dev/build untouched).
const e2eAlias = process.env.MECHLAB_E2E === "1"
  ? { "@tauri-apps/api/core": fileURLToPath(new URL("./src/test/browserMock.ts", import.meta.url)) }
  : {};

// E2E only: the physics worker imports @dimforge/rapier3d-compat lazily — if
// vite discovers it mid-session (on the first Play click) it re-optimizes deps
// and FULL-RELOADS the page, wiping the test's UI state. Pre-optimizing it at
// server start makes the first Play deterministic. Dev-only option, gated.
const e2eOptimizeDeps = process.env.MECHLAB_E2E === "1"
  ? { optimizeDeps: { include: ["@dimforge/rapier3d-compat"] } }
  : {};

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: e2eAlias,
  },
  ...e2eOptimizeDeps,
  // Prevent Vite from obscuring Rust errors.
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // Don't watch the Rust sources.
      ignored: ["**/src-tauri/**"],
    },
  },
  build: {
    // three.js + R3F + drei is a ~1 MB minified vendor chunk — expected.
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks: {
          three: ["three", "@react-three/fiber", "@react-three/drei", "three-stdlib"],
        },
      },
    },
  },
});
