// ui/projectManager/ProjectEditor.tsx — inspector for the selected project:
// Overview (world settings), Raw JSON editing, and Validation.

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Box,
  Braces,
  Save,
  ShieldCheck,
  SlidersHorizontal,
} from "lucide-react";
import { useProjectStore } from "../../stores/projectStore";
import { DiagnosticsPanel } from "./DiagnosticsPanel";
import { ModeBadge } from "./ProjectList";
import type { Diagnostic, MechProject, WorldSettings } from "../../core/types";

type EditorTab = "overview" | "json" | "validation";

const pretty = (project: MechProject): string => JSON.stringify(project, null, 2);

interface TabButtonProps {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
  badge?: number;
}

function TabButton({ active, onClick, icon, children, badge }: TabButtonProps) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-t-lg border border-b-0 px-3 py-2 text-xs font-medium transition-colors ${
        active
          ? "border-zinc-800 bg-zinc-950 text-cyan-300"
          : "border-transparent text-zinc-500 hover:text-zinc-300"
      }`}
    >
      {icon}
      {children}
      {badge !== undefined && badge > 0 && (
        <span className="ml-0.5 rounded-full bg-red-900/70 px-1.5 text-[10px] font-bold text-red-300">
          {badge}
        </span>
      )}
    </button>
  );
}

export function ProjectEditor() {
  const currentProject = useProjectStore((s) => s.currentProject);
  const currentFilename = useProjectStore((s) => s.currentFilename);
  const dirty = useProjectStore((s) => s.dirty);
  const busy = useProjectStore((s) => s.busy);
  const error = useProjectStore((s) => s.error);
  const diagnostics = useProjectStore((s) => s.diagnostics);
  const patchCurrentProject = useProjectStore((s) => s.patchCurrentProject);
  const applyJsonText = useProjectStore((s) => s.applyJsonText);
  const saveProject = useProjectStore((s) => s.saveProject);

  const [tab, setTab] = useState<EditorTab>("overview");
  const [jsonText, setJsonText] = useState("");
  const [jsonIssue, setJsonIssue] = useState<string | null>(null);
  const [applySummary, setApplySummary] = useState<{ errors: number; warnings: number } | null>(null);

  // Re-sync the raw text whenever the project object changes (load/apply/save).
  useEffect(() => {
    if (currentProject) {
      setJsonText(pretty(currentProject));
    } else {
      setJsonText("");
    }
  }, [currentProject]);

  const errors = useMemo(() => diagnostics.filter((d) => d.severity === "error"), [diagnostics]);

  // Surface problems immediately: open the Validation tab whenever a newly
  // loaded project reports reference/schema errors.
  useEffect(() => {
    if (errors.length > 0) setTab("validation");
  }, [currentFilename, errors.length]);

  if (!currentProject) {
    return (
      <div className="flex flex-1 items-center justify-center text-zinc-600">
        <div className="text-center">
          <Box className="mx-auto h-10 w-10 text-zinc-700" />
          <p className="mt-3 text-sm">Select a project on the left — or create a new 2D / 3D project.</p>
        </div>
      </div>
    );
  }

  const applyJson = () => {
    const result = applyJsonText(jsonText);
    if (!result.parsed) {
      const d = result.diagnostics[0];
      setJsonIssue(d ? d.message : "Malformed JSON");
      setApplySummary(null);
      return;
    }
    setJsonIssue(null);
    const errs = result.diagnostics.filter((d: Diagnostic) => d.severity === "error").length;
    setApplySummary({ errors: errs, warnings: result.diagnostics.length - errs });
    if (errs > 0) setTab("validation");
  };

  return (
    <>
      {/* Header */}
      <div className="flex items-center justify-between gap-3 border-b border-zinc-800 bg-zinc-900/40 px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-sm font-semibold text-zinc-100">{currentProject.meta.name}</h2>
            <ModeBadge mode={currentProject.meta.mode} />
            {dirty && (
              <span className="rounded bg-amber-900/60 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-300">
                Unsaved
              </span>
            )}
          </div>
          <p className="mt-0.5 truncate font-mono text-[11px] text-zinc-500">{currentFilename}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {errors.length > 0 && (
            <span className="flex items-center gap-1 text-xs font-medium text-red-400">
              <AlertTriangle className="h-3.5 w-3.5" />
              {errors.length} error{errors.length === 1 ? "" : "s"}
            </span>
          )}
          <button
            type="button"
            onClick={() => void saveProject()}
            disabled={!dirty || busy}
            className="btn-primary"
          >
            <Save className="h-4 w-4" />
            Save
          </button>
        </div>
      </div>

      {/* Error banner (backend / validation errors) */}
      {error && (
        <div className="border-b border-red-900/60 bg-red-950/40 px-4 py-2 text-xs text-red-300">{error}</div>
      )}

      {/* Tabs */}
      <div role="tablist" aria-label="Project editor" className="flex gap-1 border-b border-zinc-800 px-4 pt-2">
        <TabButton active={tab === "overview"} onClick={() => setTab("overview")} icon={<SlidersHorizontal className="h-3.5 w-3.5" />}>
          Overview
        </TabButton>
        <TabButton active={tab === "json"} onClick={() => setTab("json")} icon={<Braces className="h-3.5 w-3.5" />}>
          Raw JSON
        </TabButton>
        <TabButton
          active={tab === "validation"}
          onClick={() => setTab("validation")}
          icon={<ShieldCheck className="h-3.5 w-3.5" />}
          badge={errors.length}
        >
          Validation
        </TabButton>
      </div>

      {/* Tab content */}
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {tab === "overview" && <WorldSettingsPanel project={currentProject} patch={patchCurrentProject} />}
        {tab === "json" && (
          <div className="flex h-full min-h-[320px] flex-col">
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-[11px] text-zinc-500">
                Edit the raw <code className="font-mono">.mech.json</code> document, then Apply to parse and
                validate it.
              </p>
              <button type="button" onClick={applyJson} className="btn-ghost">
                Apply
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900/60">
              <textarea
                aria-label="Raw project JSON"
                spellCheck={false}
                value={jsonText}
                onChange={(e) => {
                  setJsonText(e.target.value);
                  setJsonIssue(null);
                  setApplySummary(null);
                }}
                className="h-full w-full resize-none bg-transparent p-3 font-mono text-xs leading-relaxed text-zinc-300 outline-none"
              />
            </div>
            {jsonIssue && (
              <div className="mt-2 rounded-lg border border-red-900/60 bg-red-950/30 px-3 py-2 text-xs text-red-300">
                {jsonIssue}
              </div>
            )}
            {applySummary && (
              <div className="mt-2 rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2 text-xs text-zinc-400">
                Applied —{" "}
                <span className={applySummary.errors > 0 ? "font-semibold text-red-300" : "font-semibold text-emerald-300"}>
                  {applySummary.errors} error{applySummary.errors === 1 ? "" : "s"}
                </span>
                , {applySummary.warnings} warning{applySummary.warnings === 1 ? "" : "s"} — see the Validation tab.
              </div>
            )}
          </div>
        )}
        {tab === "validation" && <DiagnosticsPanel diagnostics={diagnostics} />}
      </div>
    </>
  );
}

// -----------------------------------------------------------------------------
// Overview tab — world settings form + entity inventory
// -----------------------------------------------------------------------------

const FIXED_DT_PRESETS: Array<{ label: string; value: number }> = [
  { label: "1/120 s (120 Hz)", value: 1 / 120 },
  { label: "1/240 s (240 Hz)", value: 1 / 240 },
];

function WorldSettingsPanel({
  project,
  patch,
}: {
  project: MechProject;
  patch: (fn: (p: MechProject) => MechProject) => void;
}) {
  const w = project.world;

  const setNum = (key: keyof WorldSettings, value: string) => {
    const num = Number(value);
    if (!Number.isFinite(num)) return;
    patch((p) => ({ ...p, world: { ...p.world, [key]: num } as WorldSettings }));
  };

  const setGravityAxis = (index: number, value: string) => {
    const num = Number(value);
    if (!Number.isFinite(num)) return;
    patch((p) => {
      const gravity = [...p.world.gravity] as [number, number, number];
      gravity[index] = num;
      return { ...p, world: { ...p.world, gravity } };
    });
  };

  const numberField = (label: string, value: number, onChange: (v: string) => void, step?: number) => (
    <label className="block">
      <span className="field-label">{label}</span>
      <input
        type="number"
        step={step ?? "any"}
        value={Number.isInteger(value) ? value : Number(value.toFixed(6))}
        onChange={(e) => onChange(e.target.value)}
        className="input-dark font-mono text-xs"
      />
    </label>
  );

  const counts: Array<[string, number]> = [
    ["Bodies", project.bodies.length],
    ["Statics", project.statics.length],
    ["Joints", project.joints.length],
    ["Forces", project.forces.length],
    ["Ropes", project.ropes.length],
    ["Meters", project.meters.length],
  ];

  return (
    <div className="space-y-6">
      <section>
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-400">World</h3>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <div className="col-span-2 md:col-span-3">
            <span className="field-label">Gravity (x, y, z) — m/s²</span>
            <div className="grid grid-cols-3 gap-2">
              {(["gx", "gy", "gz"] as const).map((axis, i) => (
                <input
                  key={axis}
                  type="number"
                  step="any"
                  aria-label={`Gravity ${axis}`}
                  value={w.gravity[i] ?? 0}
                  onChange={(e) => setGravityAxis(i, e.target.value)}
                  className="input-dark font-mono text-xs"
                />
              ))}
            </div>
          </div>
          {numberField("Time scale", w.timeScale, (v) => setNum("timeScale", v), 0.1)}
          <label className="block">
            <span className="field-label">Fixed Δt</span>
            <select
              aria-label="Fixed timestep"
              value={String(w.fixedDt)}
              onChange={(e) => setNum("fixedDt", e.target.value)}
              className="input-dark font-mono text-xs"
            >
              {FIXED_DT_PRESETS.map((preset) => (
                <option key={preset.label} value={String(preset.value)}>
                  {preset.label}
                </option>
              ))}
            </select>
          </label>
          {numberField("Solver iterations", w.solverIterations, (v) => setNum("solverIterations", v), 1)}
          {numberField("Friction iterations", w.additionalFrictionIterations, (v) => setNum("additionalFrictionIterations", v), 1)}
          {numberField("Internal PGS iterations", w.internalPgsIterations, (v) => setNum("internalPgsIterations", v), 1)}
          {numberField("Max mass ratio", w.maxMassRatio, (v) => setNum("maxMassRatio", v))}
          {numberField("Contact tolerance", w.contactTolerance, (v) => setNum("contactTolerance", v))}
        </div>
      </section>

      <section>
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-400">Entity inventory</h3>
        <div className="grid grid-cols-3 gap-2 md:grid-cols-6">
          {counts.map(([label, count]) => (
            <div key={label} className="rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 py-2 text-center">
              <div className="text-lg font-semibold text-zinc-200">{count}</div>
              <div className="text-[10px] uppercase tracking-wider text-zinc-500">{label}</div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
