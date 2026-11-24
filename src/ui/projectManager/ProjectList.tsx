// ui/projectManager/ProjectList.tsx — list of saved `.mech.json` files with
// create / duplicate / delete actions.

import { useMemo, useState } from "react";
import { Copy, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useProjectStore } from "../../stores/projectStore";
import { NewProjectDialog } from "./NewProjectDialog";
import type { ProjectMode } from "../../core/types";

export function ModeBadge({ mode }: { mode: ProjectMode }) {
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
        mode === "2D" ? "bg-cyan-900/60 text-cyan-300" : "bg-violet-900/60 text-violet-300"
      }`}
    >
      {mode}
    </span>
  );
}

function formatDate(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

export function ProjectList() {
  const projects = useProjectStore((s) => s.projects);
  const busy = useProjectStore((s) => s.busy);
  const currentFilename = useProjectStore((s) => s.currentFilename);
  const loadProject = useProjectStore((s) => s.loadProject);
  const duplicateProject = useProjectStore((s) => s.duplicateProject);
  const deleteProject = useProjectStore((s) => s.deleteProject);
  const listProjects = useProjectStore((s) => s.listProjects);

  const [dialogMode, setDialogMode] = useState<ProjectMode | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);

  const sorted = useMemo(
    () => [...projects].sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt)),
    [projects],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-zinc-800 p-3">
        <button type="button" className="btn-primary flex-1" disabled={busy} onClick={() => setDialogMode("2D")}>
          <Plus className="h-3.5 w-3.5" /> New 2D
        </button>
        <button type="button" className="btn-primary flex-1" disabled={busy} onClick={() => setDialogMode("3D")}>
          <Plus className="h-3.5 w-3.5" /> New 3D
        </button>
        <button
          type="button"
          aria-label="Refresh project list"
          className="btn-icon"
          disabled={busy}
          onClick={() => void listProjects()}
        >
          <RefreshCw className="h-4 w-4" />
        </button>
      </div>

      <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
        {sorted.length === 0 && (
          <li className="rounded-lg border border-dashed border-zinc-800 p-6 text-center text-xs leading-relaxed text-zinc-600">
            No projects yet.
            <br />
            Create a new 2D or 3D project to begin.
          </li>
        )}
        {sorted.map((p) => (
          <li
            key={p.filename}
            className={`group rounded-lg border p-2 transition-colors ${
              p.filename === currentFilename
                ? "border-cyan-700/60 bg-cyan-950/30"
                : "border-zinc-800 bg-zinc-900/40 hover:border-zinc-700"
            }`}
          >
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => void loadProject(p.filename)}
                className="min-w-0 flex-1 rounded px-1 py-0.5 text-left"
              >
                <span className="block truncate text-sm font-medium text-zinc-100">{p.name}</span>
                <span className="mt-0.5 flex items-center gap-2 text-[11px] text-zinc-500">
                  <ModeBadge mode={p.mode} />
                  <span>{formatDate(p.modifiedAt)}</span>
                  <span aria-hidden="true">·</span>
                  <span>{formatSize(p.sizeBytes)}</span>
                </span>
              </button>
              <div className="flex shrink-0 items-center gap-0.5 opacity-50 transition-opacity group-hover:opacity-100">
                <button
                  type="button"
                  aria-label={`Duplicate ${p.name}`}
                  title="Duplicate"
                  disabled={busy}
                  onClick={() => void duplicateProject(p.filename)}
                  className="btn-icon-sm"
                >
                  <Copy className="h-3.5 w-3.5" />
                </button>
                {confirmingDelete === p.filename ? (
                  <button
                    type="button"
                    aria-label={`Confirm delete ${p.name}`}
                    onClick={() => {
                      setConfirmingDelete(null);
                      void deleteProject(p.filename);
                    }}
                    className="confirm-delete-btn"
                  >
                    Sure?
                  </button>
                ) : (
                  <button
                    type="button"
                    aria-label={`Delete ${p.name}`}
                    title="Delete"
                    disabled={busy}
                    onClick={() => setConfirmingDelete(p.filename)}
                    className="btn-icon-sm hover:bg-red-950/40 hover:text-red-400"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>

      <div className="border-t border-zinc-800 px-3 py-2 text-[11px] text-zinc-600">
        {projects.length} project(s) · stored next to the executable
      </div>

      {dialogMode !== null && (
        <NewProjectDialog mode={dialogMode} onClose={() => setDialogMode(null)} />
      )}
    </div>
  );
}
