// stores/projectStore.ts — project CRUD state, backed by the Rust `./projects/`
// file system through Tauri commands (`invoke` from @tauri-apps/api/core).

import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import type { Diagnostic, MechProject, ProjectMode } from "../core/types";
import { createDefaultProject } from "../core/defaults";
import { parseErrorDiagnostic, validateProject } from "../core/validator";

/** Mirrors the Rust `ProjectMeta` (serde camelCase). */
export interface ProjectMetadata {
  filename: string;
  id: string | null;
  name: string;
  mode: ProjectMode;
  createdAt: string;
  modifiedAt: string;
  sizeBytes: number;
}

interface ProjectStoreState {
  projects: ProjectMetadata[];
  /** true once the initial `list_projects` round-trip completed. */
  listLoaded: boolean;
  busy: boolean;
  error: string | null;

  currentProject: MechProject | null;
  currentFilename: string | null;
  dirty: boolean;
  /** Diagnostics for the currently loaded / applied project. */
  diagnostics: Diagnostic[];

  listProjects: () => Promise<void>;
  createProject: (name: string, mode: ProjectMode) => Promise<boolean>;
  loadProject: (filename: string) => Promise<void>;
  saveProject: () => Promise<boolean>;
  duplicateProject: (filename: string) => Promise<void>;
  deleteProject: (filename: string) => Promise<void>;
  patchCurrentProject: (patch: (project: MechProject) => MechProject) => void;
  /** Replace the working project (scene-store commit hook). */
  replaceCurrentProject: (
    project: MechProject | null,
    filename?: string | null,
    dirty?: boolean,
  ) => void;
  /** Parse + validate raw JSON text into the current project. */
  applyJsonText: (text: string) => { parsed: boolean; diagnostics: Diagnostic[] };
  clearError: () => void;
}

function errorMessage(e: unknown): string {
  if (typeof e === "string") return e;
  if (e && typeof e === "object") {
    const o = e as Record<string, unknown>;
    if (typeof o.message === "string") return o.message;
    try {
      return JSON.stringify(e);
    } catch {
      /* ignore */
    }
  }
  return String(e);
}

function toMode(mode: unknown): ProjectMode {
  return mode === "2D" ? "2D" : "3D";
}

function mapMetadata(raw: unknown): ProjectMetadata {
  const m = raw as Partial<Record<keyof ProjectMetadata, unknown>>;
  return {
    filename: typeof m.filename === "string" ? m.filename : "",
    id: typeof m.id === "string" ? m.id : null,
    name: typeof m.name === "string" && m.name.length > 0 ? m.name : String(m.filename ?? "untitled"),
    mode: toMode(m.mode),
    createdAt: typeof m.createdAt === "string" ? m.createdAt : "",
    modifiedAt: typeof m.modifiedAt === "string" ? m.modifiedAt : "",
    sizeBytes: typeof m.sizeBytes === "number" ? m.sizeBytes : 0,
  };
}

function slugify(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "untitled";
}

export const useProjectStore = create<ProjectStoreState>()((set, get) => ({
  projects: [],
  listLoaded: false,
  busy: false,
  error: null,
  currentProject: null,
  currentFilename: null,
  dirty: false,
  diagnostics: [],

  listProjects: async () => {
    try {
      const raw = await invoke<unknown[]>("list_projects");
      set({ projects: raw.map(mapMetadata), listLoaded: true, error: null });
    } catch (e) {
      set({ error: errorMessage(e), listLoaded: true });
    }
  },

  createProject: async (name, mode) => {
    set({ busy: true, error: null });
    try {
      const project = createDefaultProject(name, mode);
      const base = slugify(project.meta.name);
      const taken = new Set(get().projects.map((p) => p.filename));
      let filename = `${base}.mech.json`;
      for (let i = 2; taken.has(filename); i++) {
        filename = `${base}-${i}.mech.json`;
      }
      const jsonContent = JSON.stringify(project, null, 2);
      await invoke("save_project", { filename, jsonContent });
      await get().listProjects();
      set({ currentProject: project, currentFilename: filename, dirty: false, diagnostics: [] });
      return true;
    } catch (e) {
      set({ error: errorMessage(e) });
      return false;
    } finally {
      set({ busy: false });
    }
  },

  loadProject: async (filename) => {
    set({ busy: true, error: null });
    try {
      const text = await invoke<string>("load_project", { filename });
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch (e) {
        set({
          diagnostics: [parseErrorDiagnostic(e, text)],
          error: `Cannot open "${filename}": malformed JSON`,
          currentProject: null,
          currentFilename: filename,
          dirty: false,
        });
        return;
      }
      const result = validateProject(parsed, text);
      const errorCount = result.diagnostics.filter((d) => d.severity === "error").length;
      set({
        currentProject: result.project,
        currentFilename: filename,
        dirty: false,
        diagnostics: result.diagnostics,
        error: errorCount > 0 ? `${errorCount} validation error(s) in ${filename}` : null,
      });
    } catch (e) {
      set({ error: errorMessage(e) });
    } finally {
      set({ busy: false });
    }
  },

  saveProject: async () => {
    const { currentProject, currentFilename } = get();
    if (!currentProject || !currentFilename) {
      set({ error: "No project to save." });
      return false;
    }
    set({ busy: true, error: null });
    try {
      const stamped: MechProject = {
        ...currentProject,
        meta: { ...currentProject.meta, modifiedAt: new Date().toISOString() },
      };
      const jsonContent = JSON.stringify(stamped, null, 2);
      await invoke("save_project", { filename: currentFilename, jsonContent });
      set({ currentProject: stamped, dirty: false });
      await get().listProjects();
      return true;
    } catch (e) {
      set({ error: errorMessage(e) });
      return false;
    } finally {
      set({ busy: false });
    }
  },

  duplicateProject: async (filename) => {
    set({ busy: true, error: null });
    try {
      await invoke("duplicate_project", { filename });
      await get().listProjects();
    } catch (e) {
      set({ error: errorMessage(e) });
    } finally {
      set({ busy: false });
    }
  },

  deleteProject: async (filename) => {
    set({ busy: true, error: null });
    try {
      await invoke("delete_project", { filename });
      if (get().currentFilename === filename) {
        set({ currentProject: null, currentFilename: null, dirty: false, diagnostics: [] });
      }
      await get().listProjects();
    } catch (e) {
      set({ error: errorMessage(e) });
    } finally {
      set({ busy: false });
    }
  },

  patchCurrentProject: (patch) => {
    const { currentProject } = get();
    if (!currentProject) return;
    set({ currentProject: patch(currentProject), dirty: true });
  },

  /**
   * Replace the working project (used by the scene store when committing the
   * authoritative edit-mode state back into the persistence layer).
   */
  replaceCurrentProject: (project, filename, dirty) => {
    set({
      currentProject: project,
      currentFilename: filename !== undefined ? filename : get().currentFilename,
      dirty: dirty ?? true,
    });
  },

  applyJsonText: (text) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      const diagnostics = [parseErrorDiagnostic(e, text)];
      set({ diagnostics, error: "Raw JSON could not be applied — the text is not valid JSON." });
      return { parsed: false, diagnostics };
    }
    const result = validateProject(parsed, text);
    if (result.project) {
      set({
        currentProject: result.project,
        diagnostics: result.diagnostics,
        dirty: true,
        error: result.ok ? null : "JSON applied, but validation reported problems — see the Validation tab.",
      });
    }
    return { parsed: true, diagnostics: result.diagnostics };
  },

  clearError: () => set({ error: null }),
}));
