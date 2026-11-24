// core/id.ts — UUID generation with a deterministic-friendly fallback.

import type { UUID } from "./types";

/**
 * Create a new UUID v4.
 * Uses the platform `crypto.randomUUID` when available (browsers, Tauri WebView,
 * Node >= 19); falls back to a Math.random-based v4 in exotic environments.
 */
export function newId(): UUID {
  const c = typeof globalThis !== "undefined" ? (globalThis as { crypto?: Crypto }).crypto : undefined;
  if (c && typeof c.randomUUID === "function") {
    return c.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => {
    const r = Math.floor(Math.random() * 16);
    const v = ch === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
