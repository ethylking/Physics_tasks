// ui/projectManager/NewProjectDialog.tsx — name + mode prompt for new projects.

import { useState } from "react";
import { X } from "lucide-react";
import type { ProjectMode } from "../../core/types";
import { useProjectStore } from "../../stores/projectStore";

interface NewProjectDialogProps {
  mode: ProjectMode;
  onClose: () => void;
}

export function NewProjectDialog({ mode, onClose }: NewProjectDialogProps) {
  const [name, setName] = useState("");
  const createProject = useProjectStore((s) => s.createProject);
  const busy = useProjectStore((s) => s.busy);

  const submit = async () => {
    const ok = await createProject(name, mode);
    if (ok) onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`New ${mode} project`}
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60"
    >
      <div className="w-96 rounded-xl border border-zinc-800 bg-zinc-950 p-4 shadow-2xl shadow-black/60">
        <header className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
            New {mode} Project
          </h2>
          <button type="button" aria-label="Cancel" onClick={onClose} className="btn-icon-sm">
            <X className="h-4 w-4" />
          </button>
        </header>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <label htmlFor="new-project-name" className="field-label">
            Project name
          </label>
          <input
            id="new-project-name"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={`e.g. Atwood machine (${mode})`}
            className="input-dark"
          />
          <footer className="mt-4 flex justify-end gap-2">
            <button type="button" className="btn-ghost" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={busy}>
              Create project
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}
