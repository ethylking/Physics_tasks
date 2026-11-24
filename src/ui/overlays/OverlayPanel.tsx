// ui/overlays/OverlayPanel.tsx — floating toolbar button + popover controlling
// the live vector overlays and the trajectory tracer (Milestone 4).

import { Move3d, X } from "lucide-react";
import { useSceneStore } from "../../stores/sceneStore";
import { VECTOR_KINDS, useOverlayStore } from "../../stores/overlayStore";

export default function OverlayPanel() {
  const panelOpen = useOverlayStore((s) => s.panelOpen);
  const togglePanel = useOverlayStore((s) => s.togglePanel);
  const scale = useOverlayStore((s) => s.scale);
  const setScale = useOverlayStore((s) => s.setScale);
  const vectors = useOverlayStore((s) => s.vectors);
  const toggleVector = useOverlayStore((s) => s.toggleVector);
  const trails = useOverlayStore((s) => s.trails);
  const setTrailEnabled = useOverlayStore((s) => s.setTrailEnabled);
  const setTrailAnchor = useOverlayStore((s) => s.setTrailAnchor);
  const bodies = useSceneStore((s) => s.project?.bodies ?? []);

  return (
    <div className="absolute right-3 top-3 z-20 flex flex-col items-end gap-2">
      <button
        type="button"
        aria-pressed={panelOpen}
        onClick={togglePanel}
        className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold shadow-lg shadow-black/40 backdrop-blur transition-colors ${
          panelOpen
            ? "border-cyan-600 bg-cyan-950/70 text-cyan-300"
            : "border-zinc-700 bg-zinc-950/85 text-zinc-300 hover:border-zinc-600 hover:text-zinc-100"
        }`}
      >
        <Move3d className="h-3.5 w-3.5" />
        Vectors
      </button>

      {panelOpen && (
        <div className="w-72 rounded-lg border border-zinc-800 bg-zinc-950/95 p-3 shadow-xl shadow-black/50 backdrop-blur">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
              Vector overlays
            </h3>
            <button
              type="button"
              aria-label="Close overlays panel"
              onClick={togglePanel}
              className="btn-icon-sm hover:bg-zinc-800 hover:text-zinc-200"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          <label className="mb-3 block">
            <span className="field-label">
              Vector scale · {scale.toFixed(2)} m/unit
            </span>
            <input
              type="range"
              aria-label="Vector scale"
              min={0.05}
              max={3}
              step={0.05}
              value={scale}
              onChange={(e) => setScale(Number(e.target.value))}
              className="w-full accent-cyan-500"
            />
          </label>

          <div className="mb-3 grid grid-cols-1 gap-0.5">
            {VECTOR_KINDS.map(({ kind, label }) => (
              <label
                key={kind}
                className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-xs text-zinc-300 hover:bg-zinc-900"
              >
                <input
                  type="checkbox"
                  aria-label={label}
                  checked={vectors[kind]}
                  onChange={() => toggleVector(kind)}
                  className="h-3.5 w-3.5 accent-cyan-500"
                />
                {label}
              </label>
            ))}
          </div>

          <h4 className="mb-1.5 mt-3 border-t border-zinc-800 pt-2 text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
            Trajectory trails
          </h4>
          {bodies.length === 0 && (
            <p className="text-[10px] text-zinc-600">No bodies to trace.</p>
          )}
          {bodies.map((body) => {
            const config = trails[body.id];
            const enabled = config?.enabled ?? false;
            const anchor = config?.anchor ?? [0, 0, 0];
            return (
              <div key={body.id} className="mb-1.5 rounded-md bg-zinc-900/50 px-2 py-1.5">
                <label className="flex cursor-pointer items-center gap-2 text-xs text-zinc-300">
                  <input
                    type="checkbox"
                    aria-label={`${body.name} trail`}
                    checked={enabled}
                    onChange={(e) => setTrailEnabled(body.id, e.target.checked)}
                    className="h-3.5 w-3.5 accent-cyan-500"
                  />
                  <span className="truncate">{body.name}</span>
                </label>
                {enabled && (
                  <div className="mt-1 grid grid-cols-3 gap-1">
                    {(["x", "y", "z"] as const).map((axis, i) => (
                      <input
                        key={axis}
                        type="number"
                        step={0.05}
                        aria-label={`${body.name} trail anchor ${axis}`}
                        title={`Trail anchor ${axis} (body-local)`}
                        value={Number.isFinite(anchor[i]) ? Number((anchor[i] ?? 0).toFixed(3)) : 0}
                        onChange={(e) => {
                          const n = e.target.valueAsNumber;
                          if (!Number.isFinite(n)) return;
                          const next = [...anchor] as [number, number, number];
                          next[i] = n;
                          setTrailAnchor(body.id, next);
                        }}
                        className="w-full rounded border border-zinc-800 bg-zinc-950 px-1 py-0.5 text-center font-mono text-[10px] text-zinc-200 outline-none focus:border-cyan-600"
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          <p className="mt-1 text-[10px] leading-relaxed text-zinc-600">
            Trace a rim/edge anchor to draw cycloids on rolling cylinders &amp; spheres.
          </p>
        </div>
      )}
    </div>
  );
}
