import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Test harness for the UI & core logic — runs fully in Node/jsdom with a mocked
// Tauri backend (see src/test/mocks/tauriCoreMock.ts), no Rust binary required.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: false,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    css: false,
  },
});
