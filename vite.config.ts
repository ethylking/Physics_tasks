import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri v2 expects a fixed dev-server port (see src-tauri/tauri.conf.json).
const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [react()],
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
