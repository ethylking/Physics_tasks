// e2e/playwright.config.ts — headless Chromium UI tests against vite dev.
//
// The webServer swaps the Tauri backend for an in-memory browser mock
// (src/test/browserMock.ts) via the MECHLAB_E2E=1 alias in vite.config.ts.
// Windows note: Playwright runs the webServer command through cmd.exe, so the
// env var is set with `set "X=1" && ...`. Node 24 from the harness runtime is
// used explicitly — the system Node (v15) cannot run Vite 6.

import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  timeout: 90000,
  expect: { timeout: 30000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  outputDir: "./test-results",
  use: {
    baseURL: "http://127.0.0.1:5199",
    viewport: { width: 1600, height: 900 },
    headless: true,
    screenshot: "only-on-failure",
    trace: "off",
  },
  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium" },
    },
  ],
  webServer: {
    // Playwright spawns webServer commands with cwd = the config directory and
    // cmd.exe quoting is fragile, so the vite dev invocation lives in a batch
    // wrapper that cds into the repo root and sets MECHLAB_E2E=1 (browser Tauri
    // mock alias) before launching vite on 127.0.0.1:5199.
    command: "D:\\Physics_tasks\\e2e\\dev-server.cmd",
    url: "http://127.0.0.1:5199",
    reuseExistingServer: false,
    timeout: 120000,
  },
});
