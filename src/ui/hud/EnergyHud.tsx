// ui/hud/EnergyHud.tsx — compact live Energy & Time bar (§4.2).
// Subscribes to the ~10 Hz-throttled HUD state; never re-renders per frame.

import { Activity } from "lucide-react";
import { useTelemetryStore } from "../../stores/telemetryStore";

function fmt(v: number, digits = 2): string {
  if (!Number.isFinite(v)) return "—";
  return v.toFixed(digits);
}

export default function EnergyHud() {
  const hud = useTelemetryStore((s) => s.hud);
  const status = useTelemetryStore((s) => s.status);
  if (!hud) return null;

  const driftAbs = Math.abs(hud.drift);
  const driftColor =
    driftAbs < 0.005 ? "text-emerald-300" : driftAbs < 0.02 ? "text-amber-300" : "text-red-300";

  return (
    <div className="pointer-events-none absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-4 rounded-lg border border-zinc-800 bg-zinc-950/85 px-4 py-1.5 font-mono text-[11px] text-zinc-300 shadow-lg shadow-black/40 backdrop-blur">
      <span className="flex items-center gap-1.5 text-cyan-300">
        <Activity className={`h-3.5 w-3.5 ${status === "running" ? "animate-pulse" : ""}`} />
        t = {fmt(hud.t)} s
      </span>
      <span className="text-zinc-600">|</span>
      <span>
        E<sub>k</sub> = {fmt(hud.Ek)} J
      </span>
      <span>
        E<sub>p</sub> = {fmt(hud.Ep)} J
      </span>
      <span className="font-semibold text-zinc-100">
        ΣE = {fmt(hud.Etotal)} J
      </span>
      <span className="text-zinc-600">|</span>
      <span className={driftColor}>ΔE = {(hud.drift * 100).toFixed(2)} %</span>
    </div>
  );
}
