// test/mocks/tauriCoreMock.ts — in-memory stand-in for the Rust backend.
//
// Mirrors the semantics of src-tauri/src/{commands,project,fs}.rs exactly
// (filename sanitization, metadata shapes, duplicate naming, structured errors)
// so UI components can be tested in Node/jsdom without a running Rust binary.
//
// The vitest setup file (src/test/setup.ts) re-exports `invoke` from this module
// as `@tauri-apps/api/core`. Tests import the state/helpers below directly —
// both resolve to the same module instance.

import { vi } from "vitest";

export interface MockProjectMetadata {
  filename: string;
  id: string | null;
  name: string;
  mode: "2D" | "3D";
  createdAt: string;
  modifiedAt: string;
  sizeBytes: number;
}

interface MockError {
  code: string;
  message: string;
}

export const tauriMockState: {
  projects: Map<string, string>;
  failNextWith: MockError | null;
  calls: Array<{ command: string; args?: Record<string, unknown> }>;
} = {
  projects: new Map(),
  failNextWith: null,
  calls: [],
};

/** Reset the virtual `./projects/` folder and the recorded command log. */
export function resetTauriMock(): void {
  tauriMockState.projects.clear();
  tauriMockState.failNextWith = null;
  tauriMockState.calls.length = 0;
}

/** Seed a `.mech.json` file (JSON-serializes the object). */
export function seedProjectFile(filename: string, project: unknown): void {
  tauriMockState.projects.set(filename, JSON.stringify(project, null, 2));
}

/** Make the next Tauri command reject with a structured error (mirrors Rust). */
export function failNextCommand(code: string, message: string): void {
  tauriMockState.failNextWith = { code, message };
}

function err(code: string, message: string): MockError {
  return { code, message };
}

/** Mirrors `fs::sanitize_filename` (path-traversal rejection + extension). */
function sanitizeFilename(filename: unknown): string {
  const name = String(filename ?? "").trim();
  if (!name) throw err("INVALID_FILENAME", "filename must not be empty");
  if (name.length > 255) throw err("INVALID_FILENAME", "filename too long (max 255 characters)");
  if (name.includes("..") || name.includes("/") || name.includes("\\") || name.includes("\0")) {
    throw err("INVALID_FILENAME", `filename '${name}' is not allowed: '..', '/', '\\' and NUL characters are rejected`);
  }
  return name.endsWith(".mech.json") ? name : `${name}.mech.json`;
}

/** Mirrors `project::meta_from_value`. */
function metadataFor(filename: string, content: string): MockProjectMetadata {
  const sizeBytes = new TextEncoder().encode(content).length;
  const fallback: MockProjectMetadata = {
    filename,
    id: null,
    name: filename.replace(/\.mech\.json$/, ""),
    mode: "3D",
    createdAt: "",
    modifiedAt: "",
    sizeBytes,
  };
  try {
    const parsed = JSON.parse(content) as {
      meta?: { id?: unknown; name?: unknown; mode?: unknown; createdAt?: unknown; modifiedAt?: unknown };
    };
    const meta = parsed.meta ?? {};
    return {
      filename,
      id: typeof meta.id === "string" ? meta.id : null,
      name: typeof meta.name === "string" && meta.name.length > 0 ? meta.name : fallback.name,
      mode: meta.mode === "2D" ? "2D" : "3D",
      createdAt: typeof meta.createdAt === "string" ? meta.createdAt : "",
      modifiedAt: typeof meta.modifiedAt === "string" ? meta.modifiedAt : "",
      sizeBytes,
    };
  } catch {
    return fallback;
  }
}

function newId(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16);
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function uniqueCopyFilename(stem: string): string {
  let candidate = `${stem} (copy).mech.json`;
  for (let i = 2; tauriMockState.projects.has(candidate); i++) {
    candidate = `${stem} (copy ${i}).mech.json`;
  }
  return candidate;
}

/** The mocked `invoke` — mirrors commands.rs command for command. */
export const invoke = vi.fn(async (command: string, args?: Record<string, unknown>): Promise<unknown> => {
  tauriMockState.calls.push({ command, args });
  if (tauriMockState.failNextWith) {
    const failure = tauriMockState.failNextWith;
    tauriMockState.failNextWith = null;
    throw failure;
  }
  switch (command) {
    case "list_projects":
      return [...tauriMockState.projects.entries()]
        .map(([filename, content]) => metadataFor(filename, content))
        .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));

    case "load_project": {
      const filename = sanitizeFilename(args?.filename);
      const content = tauriMockState.projects.get(filename);
      if (content === undefined) throw err("NOT_FOUND", `project '${filename}' not found`);
      try {
        JSON.parse(content);
      } catch {
        throw err("MALFORMED_JSON", `'${filename}' is not valid JSON`);
      }
      return content;
    }

    case "save_project": {
      const filename = sanitizeFilename(args?.filename);
      const content = String(args?.jsonContent ?? "");
      try {
        const parsed: unknown = JSON.parse(content);
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
          throw new Error("project root must be a JSON object");
        }
      } catch (e) {
        throw err("MALFORMED_JSON", `content is not valid JSON: ${e instanceof Error ? e.message : String(e)}`);
      }
      tauriMockState.projects.set(filename, content);
      return metadataFor(filename, content);
    }

    case "duplicate_project": {
      const filename = sanitizeFilename(args?.filename);
      const content = tauriMockState.projects.get(filename);
      if (content === undefined) throw err("NOT_FOUND", `project '${filename}' not found`);
      const parsed = JSON.parse(content) as Record<string, unknown>;
      const meta = (parsed.meta ?? {}) as Record<string, unknown>;
      const now = new Date().toISOString();
      const newMeta = {
        ...meta,
        id: newId(),
        name: `${String(meta.name ?? "copy")} (copy)`,
        createdAt: now,
        modifiedAt: now,
      };
      const stem = filename.replace(/\.mech\.json$/, "").replace(/[<>:"/\\|?*]+/g, "-");
      const newFilename = uniqueCopyFilename(stem);
      tauriMockState.projects.set(newFilename, JSON.stringify({ ...parsed, meta: newMeta }, null, 2));
      return metadataFor(newFilename, tauriMockState.projects.get(newFilename) as string);
    }

    case "delete_project": {
      const filename = sanitizeFilename(args?.filename);
      if (!tauriMockState.projects.delete(filename)) {
        throw err("NOT_FOUND", `project '${filename}' not found`);
      }
      return true;
    }

    default:
      throw err("UNKNOWN_COMMAND", `unknown command '${command}'`);
  }
});
