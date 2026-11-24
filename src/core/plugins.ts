// core/plugins.ts — Tier 2 entity plugin registry (§3.3).
//
// Tier 2 kinds are NOT hard-coded in the core schema. They are declared by an
// `EntityPlugin` and only loadable when registered. The core loader preserves
// unknown kinds verbatim and emits a warning — never a hard failure.

import type { EntityPlugin } from "./types";

const registry = new Map<string, EntityPlugin<string>>();

/** Register a Tier 2 entity plugin (called from plugin modules). */
export function registerPlugin<K extends string>(plugin: EntityPlugin<K>): void {
  registry.set(plugin.kind, plugin as unknown as EntityPlugin<string>);
}

/** Look up a registered plugin by kind. */
export function getPlugin(kind: string): EntityPlugin<string> | undefined {
  return registry.get(kind);
}

/** Whether a plugin for this kind is currently registered. */
export function hasPlugin(kind: string): boolean {
  return registry.has(kind);
}

/** All registered plugins, in registration order. */
export function listPlugins(): EntityPlugin<string>[] {
  return [...registry.values()];
}

/**
 * Future wiring point (Milestone 3+): sweep `src/plugins/*` modules and call
 * `registerPlugin` for each exported `EntityPlugin`.
 */
export function loadBuiltinPlugins(): void {
  // Intentionally empty in Milestone 1 — no Tier 2 plugins ship yet.
}
