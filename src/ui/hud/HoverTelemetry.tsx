// ui/hud/HoverTelemetry.tsx — floating telemetry card for the hovered body
// (Milestone 4). The card follows the cursor; it only appears while the
// pointer is actually over a body (selection alone does not show it).
//
// Works while Editing/Paused and while Running: it polls the latest worker
// snapshot at ~10 Hz (never re-rendering per physics frame) and falls back to
// the entity's initial state before the first snapshot arrives. The card
// follows the mouse cursor; without pointer activity it docks to the corner.

import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { useSceneStore } from "../../stores/sceneStore";
import { useTelemetryStore } from "../../stores/telemetryStore";
import { buildBodyTelemetry, formatTelemetry, readBodySlice, type BodyTelemetry } from "./hudTelemetry";

const POLL_MS = 100;
const CARD_WIDTH = 240;
const CARD_HEIGHT = 340;

export default function HoverTelemetry() {
  const project = useSceneStore((s) => s.project);
  const hoveredId = useSceneStore((s) => s.hoveredId);
  const [telemetry, setTelemetry] = useState<BodyTelemetry | null>(null);
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null);

  const targetId = hoveredId;

  useEffect(() => {
    const onMove = (e: MouseEvent) => setPointer({ x: e.clientX, y: e.clientY });
    window.addEventListener("mousemove", onMove);
    return () => window.removeEventListener("mousemove", onMove);
  }, []);

  useEffect(() => {
    if (!project || !targetId) {
      setTelemetry(null);
      return;
    }
    const index = project.bodies.findIndex((b) => b.id === targetId);
    if (index < 0) {
      setTelemetry(null);
      return;
    }
    const update = () => {
      const body = project.bodies[index];
      if (!body) return;
      const snapshot = useTelemetryStore.getState().getSnapshot();
      setTelemetry(buildBodyTelemetry(body, project, readBodySlice(snapshot, index)));
    };
    update();
    const timer = window.setInterval(update, POLL_MS);
    return () => window.clearInterval(timer);
  }, [project, targetId]);

  if (!telemetry) return null;

  const style: CSSProperties = pointer
    ? {
        left: Math.max(8, Math.min(pointer.x + 16, window.innerWidth - CARD_WIDTH - 8)),
        top: Math.max(8, Math.min(pointer.y + 16, window.innerHeight - CARD_HEIGHT - 8)),
      }
    : { right: 16, top: 56 };

  return (
    <div
      data-testid="hover-telemetry"
      style={style}
      className="pointer-events-none fixed z-30 w-60 rounded-lg border border-zinc-700/80 bg-zinc-950/90 p-3 font-mono text-[11px] shadow-xl shadow-black/50 backdrop-blur"
    >
      <header className="mb-2 flex items-baseline justify-between gap-2 border-b border-zinc-800 pb-1.5">
        <span className="truncate text-xs font-bold text-cyan-300">{telemetry.name}</span>
        <span className="shrink-0 rounded border border-zinc-700 bg-zinc-800 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-zinc-400">
          {telemetry.kind}
        </span>
      </header>
      <dl className="space-y-0.5">
        {formatTelemetry(telemetry).map((row) => (
          <div key={row.label} className="flex items-baseline justify-between gap-2">
            <dt className="shrink-0 text-zinc-500">{row.label}</dt>
            <dd className="truncate text-right text-zinc-100" title={row.value}>
              {row.value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
