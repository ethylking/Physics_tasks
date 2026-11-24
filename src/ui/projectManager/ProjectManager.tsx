// ui/projectManager/ProjectManager.tsx — modal shell for project CRUD (§7).

import { useEffect } from "react";
import { FolderOpen, X } from "lucide-react";
import { useUiStore } from "../../stores/uiStore";
import { useProjectStore } from "../../stores/projectStore";
import { useSceneStore } from "../../stores/sceneStore";
import { ProjectList } from "./ProjectList";
import { ProjectEditor } from "./ProjectEditor";

export default function ProjectManager() {
  const open = useUiStore((s) => s.projectManagerOpen);
  const close = useUiStore((s) => s.closeProjectManager);
  const listProjects = useProjectStore((s) => s.listProjects);

  // Refresh the list and push the live scene into the persistence layer every
  // time the manager opens, so its editor reflects the current edit state.
  useEffect(() => {
    if (open) {
      useSceneStore.getState().commitToProjectStore();
      void listProjects();
    }
  }, [open, listProjects]);

  // Escape closes the modal.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Project Manager"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
    >
      <div className="flex h-[85vh] max-h-[780px] w-full max-w-6xl flex-col overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950 shadow-2xl shadow-black/60">
        <header className="flex items-center justify-between border-b border-zinc-800 bg-zinc-900/60 px-4 py-3">
          <div className="flex items-center gap-3">
            <FolderOpen className="h-5 w-5 text-cyan-400" />
            <h1 className="text-sm font-semibold tracking-wide text-zinc-100">Project Manager</h1>
            <span className="rounded border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wider text-zinc-400">
              .mech.json
            </span>
          </div>
          <button type="button" aria-label="Close project manager" onClick={close} className="btn-icon">
            <X className="h-4 w-4" />
          </button>
        </header>
        <div className="flex min-h-0 flex-1">
          <aside className="flex w-80 shrink-0 flex-col border-r border-zinc-800">
            <ProjectList />
          </aside>
          <section className="flex min-w-0 flex-1 flex-col">
            <ProjectEditor />
          </section>
        </div>
      </div>
    </div>
  );
}
