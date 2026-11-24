// ui/TopBar.tsx — top toolbar: project identity, save, mode switcher, live
// transport controls (Play/Pause/Step/Reset → physics worker), world gravity.

import { Atom, FolderOpen, Pause, Play, RotateCcw, Save, SkipForward } from "lucide-react";
import type { MechProject, ProjectMode } from "../core/types";
import type { TelemetryStatus } from "../stores/telemetryStore";
import MathWarnings from "./MathWarnings";

interface TopBarProps {
  project: MechProject | null;
  dirty: boolean;
  busy: boolean;
  simStatus: TelemetryStatus;
  simReady: boolean;
  onSave: () => void;
  onOpenProjects: () => void;
  onSetMode: (mode: ProjectMode) => void;
  onSetGravity: (axis: 0 | 1 | 2, value: number) => void;
  onPlay: () => void;
  onPause: () => void;
  onStep: () => void;
  onReset: () => void;
}

export default function TopBar({
  project,
  dirty,
  busy,
  simStatus,
  simReady,
  onSave,
  onOpenProjects,
  onSetMode,
  onSetGravity,
  onPlay,
  onPause,
  onStep,
  onReset,
}: TopBarProps) {
  const mode = project?.meta.mode ?? "3D";
  const running = simStatus === "running";

  return (
    <header className="flex items-center justify-between gap-4 border-b border-zinc-800 bg-zinc-900/50 px-4 py-2">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-cyan-500 to-blue-600 shadow-lg shadow-cyan-500/20">
          <Atom className="h-5 w-5 text-white" />
        </div>
        <div className="min-w-0">
          <h1 className="truncate text-sm font-bold tracking-tight text-zinc-100">
            {project ? project.meta.name : "MechLab"}
          </h1>
          <p className="text-[10px] uppercase tracking-widest text-zinc-500">
            Classical Mechanics Simulator · Milestone 4
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        {/* 2D / 3D mode switcher */}
        <div role="tablist" aria-label="Project mode" className="flex rounded-lg border border-zinc-700 bg-zinc-900 p-0.5">
          {(["2D", "3D"] as ProjectMode[]).map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              disabled={!project || running}
              onClick={() => onSetMode(m)}
              className={`rounded-md px-3 py-1 text-xs font-semibold transition-colors disabled:opacity-40 ${
                mode === m ? "bg-cyan-600 text-white" : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              {m}
            </button>
          ))}
        </div>

        {/* Transport — drives the physics worker */}
        <div className="flex items-center gap-1 rounded-lg border border-zinc-700 bg-zinc-900 p-0.5">
          <button
            type="button"
            aria-label="Play"
            title="Run simulation"
            disabled={!project || running}
            onClick={onPlay}
            className={`rounded-md p-1.5 transition-colors disabled:opacity-40 ${
              running ? "bg-emerald-700/60 text-emerald-300" : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            <Play className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            aria-label="Pause"
            title="Pause simulation"
            disabled={!project || !running}
            onClick={onPause}
            className={`rounded-md p-1.5 transition-colors disabled:opacity-40 ${
              simStatus === "paused" ? "text-amber-300" : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            <Pause className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            aria-label="Step"
            title="Advance one fixed timestep"
            disabled={!project || running}
            onClick={onStep}
            className="rounded-md p-1.5 text-zinc-400 transition-colors hover:text-zinc-200 disabled:opacity-40"
          >
            <SkipForward className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            aria-label="Reset"
            title="Reset to the last loaded / saved state"
            disabled={!project}
            onClick={onReset}
            className="rounded-md p-1.5 text-zinc-400 transition-colors hover:text-zinc-200 disabled:opacity-40"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
        </div>

        {running && (
          <span className="flex items-center gap-1.5 rounded-md bg-emerald-950/60 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-emerald-300">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
            Simulating
          </span>
        )}
        {!simReady && project && !running && (
          <span className="text-[10px] uppercase tracking-wider text-zinc-600">Worker idle</span>
        )}

        {/* World gravity */}
        <label className="flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">g</span>
          {(["gx", "gy", "gz"] as const).map((axis, i) => (
            <input
              key={axis}
              type="number"
              step="any"
              aria-label={`Gravity ${axis}`}
              title={`Gravity ${axis} (m/s²)`}
              disabled={!project}
              value={Number.isFinite(project?.world.gravity[i] ?? 0) ? Number((project?.world.gravity[i] ?? 0).toFixed(2)) : 0}
              onChange={(e) => {
                const n = e.target.valueAsNumber;
                if (Number.isFinite(n)) onSetGravity(i as 0 | 1 | 2, n);
              }}
              className="w-14 rounded border border-zinc-800 bg-zinc-950 px-1 py-0.5 text-center font-mono text-[11px] text-zinc-200 outline-none focus:border-cyan-600 disabled:opacity-40"
            />
          ))}
        </label>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <MathWarnings />
        <button
          type="button"
          onClick={onSave}
          disabled={!project || !dirty || busy}
          className="btn-ghost"
          title="Save to ./projects/"
        >
          <Save className="h-4 w-4" />
          Save
          {dirty && <span className="ml-1 h-1.5 w-1.5 rounded-full bg-amber-400" />}
        </button>
        <button type="button" onClick={onOpenProjects} className="btn-primary">
          <FolderOpen className="h-4 w-4" />
          Projects
        </button>
      </div>
    </header>
  );
}
