// test/setup.ts — global vitest setup.
//
// - Registers jest-dom matchers.
// - Mocks @tauri-apps/api/core so UI tests run cleanly in Node/jsdom with the
//   in-memory backend from ./mocks/tauriCoreMock.ts (no Rust binary required).
// - Cleans up the React tree after every test.

import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

vi.mock("@tauri-apps/api/core", async () => {
  const mock = await import("./mocks/tauriCoreMock");
  return { invoke: mock.invoke };
});

afterEach(() => {
  cleanup();
});
