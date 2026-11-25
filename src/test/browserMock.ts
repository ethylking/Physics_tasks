// test/browserMock.ts — in-memory BROWSER stand-in for the Tauri v2 backend.
//
// Mirrors the semantics of src-tauri/src/{commands,project,fs}.rs (and of the
// vitest twin in src/test/mocks/tauriCoreMock.ts: filename sanitization,
// metadata shapes, duplicate naming, structured errors) — but as a PLAIN
// browser module with NO vitest imports, so Vite can compile it straight into
// the E2E bundle when the `MECHLAB_E2E=1` alias in vite.config.ts rewrites
// `@tauri-apps/api/core` to this file.
//
// The virtual FS is seeded with a single `demo.mech.json` project. The app
// auto-loads the most recently modified project on startup, so the demo scene
// must appear without any clicks.

import { createDefaultProject } from "../core/defaults";

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

/** The virtual `./projects/` folder (filename -> JSON content). */
const projects = new Map<string, string>();

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
  for (let i = 2; projects.has(candidate); i++) {
    candidate = `${stem} (copy ${i}).mech.json`;
  }
  return candidate;
}

/** The mocked `invoke` — mirrors commands.rs command for command. */
// (The real @tauri-apps/api/core signature carries the <T> generic; the app
// typechecks against that d.ts, and this alias only replaces the runtime module.)
export async function invoke(command: string, args?: Record<string, unknown>): Promise<unknown> {
  switch (command) {
    case "list_projects":
      return [...projects.entries()]
        .map(([filename, content]) => metadataFor(filename, content))
        .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));

    case "load_project": {
      const filename = sanitizeFilename(args?.filename);
      const content = projects.get(filename);
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
      projects.set(filename, content);
      return metadataFor(filename, content);
    }

    case "duplicate_project": {
      const filename = sanitizeFilename(args?.filename);
      const content = projects.get(filename);
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
      projects.set(newFilename, JSON.stringify({ ...parsed, meta: newMeta }, null, 2));
      return metadataFor(newFilename, projects.get(newFilename) as string);
    }

    case "delete_project": {
      const filename = sanitizeFilename(args?.filename);
      if (!projects.delete(filename)) {
        throw err("NOT_FOUND", `project '${filename}' not found`);
      }
      return true;
    }

    default:
      throw err("UNKNOWN_COMMAND", `unknown command '${command}'`);
  }
}

// Seed the virtual ./projects/ folder with one demo project at startup.
// (The app's session-restore effect auto-loads the most recent project.)
projects.set("demo.mech.json", JSON.stringify(createDefaultProject("Demo", "3D"), null, 2));
