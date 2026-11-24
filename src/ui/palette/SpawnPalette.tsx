// ui/palette/SpawnPalette.tsx — left sidebar with Tier 1 creation tools.
//
// Bodies: box, sphere, ellipsoid, cylinder, rod, wedge
// Statics: wall, ground
// Connectors (anchor placement preview): pulley, spring, rope,
//            revolute, spherical, prismatic, fixed, external force arrow

import {
  ArrowUp,
  Box,
  Circle,
  CircleDot,
  Cylinder,
  Disc3,
  Link,
  Minus,
  MoveHorizontal,
  Orbit,
  PanelLeft,
  RectangleHorizontal,
  RefreshCw,
  Rocket,
  Spline,
  Triangle,
  Waves,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { SpawnTool } from "../../stores/sceneStore";
import { useSceneStore } from "../../stores/sceneStore";
import { useTelemetryStore } from "../../stores/telemetryStore";

interface ToolDef extends SpawnTool {
  icon: LucideIcon;
  hint?: string;
}

const TOOL_GROUPS: Array<{ label: string; tools: ToolDef[] }> = [
  {
    label: "Bodies",
    tools: [
      { category: "bodies", kind: "box", label: "Box", icon: Box },
      { category: "bodies", kind: "sphere", label: "Sphere", icon: Circle },
      { category: "bodies", kind: "ellipsoid", label: "Ellipsoid", icon: CircleDot },
      { category: "bodies", kind: "cylinder", label: "Cylinder", icon: Cylinder },
      { category: "bodies", kind: "rod", label: "Rod", icon: Minus },
      { category: "bodies", kind: "wedge", label: "Wedge", icon: Triangle },
    ],
  },
  {
    label: "Statics",
    tools: [
      { category: "statics", kind: "wall", label: "Wall", icon: PanelLeft },
      { category: "statics", kind: "ground", label: "Ground", icon: RectangleHorizontal },
    ],
  },
  {
    label: "Connectors",
    tools: [
      { category: "bodies", kind: "pulley", label: "Pulley", icon: Disc3 },
      { category: "forces", kind: "spring", label: "Spring", icon: Waves },
      { category: "ropes", kind: "massless", label: "Rope", icon: Spline },
      { category: "joints", kind: "revolute", label: "Revolute", icon: RefreshCw },
      { category: "joints", kind: "spherical", label: "Spherical", icon: Orbit },
      { category: "joints", kind: "prismatic", label: "Prismatic", icon: MoveHorizontal },
      { category: "joints", kind: "fixed", label: "Fixed", icon: Link },
      { category: "forces", kind: "external", label: "Force", icon: ArrowUp },
      { category: "forces", kind: "torque", label: "Torque", icon: RefreshCw },
      { category: "forces", kind: "thruster", label: "Thruster", icon: Rocket },
    ],
  },
];

export default function SpawnPalette() {
  const tool = useSceneStore((s) => s.tool);
  const setTool = useSceneStore((s) => s.setTool);
  const running = useTelemetryStore((s) => s.status === "running");

  const isActive = (t: ToolDef) => tool?.category === t.category && tool?.kind === t.kind;

  const toggle = (t: ToolDef) => {
    if (isActive(t)) setTool(null);
    else setTool({ category: t.category, kind: t.kind, label: t.label });
  };

  return (
    <aside className="relative flex w-48 shrink-0 flex-col border-r border-zinc-800 bg-zinc-950">
      <header className="border-b border-zinc-800 px-3 py-2.5">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Spawn Palette</h2>
      </header>
      <div className={`min-h-0 flex-1 overflow-y-auto p-2 ${running ? "pointer-events-none opacity-40" : ""}`}>
        {TOOL_GROUPS.map((group) => (
          <section key={group.label} className="mb-3">
            <h3 className="mb-1.5 px-1 text-[10px] font-medium uppercase tracking-widest text-zinc-600">
              {group.label}
            </h3>
            <div className="grid grid-cols-2 gap-1">
              {group.tools.map((t) => {
                const Icon = t.icon;
                const active = isActive(t);
                return (
                  <button
                    key={`${t.category}-${t.kind}`}
                    type="button"
                    title={t.hint ?? t.label}
                    aria-pressed={active}
                    onClick={() => toggle(t)}
                    className={`flex flex-col items-center gap-1 rounded-lg border px-1 py-2 text-[10px] font-medium transition-colors ${
                      active
                        ? "border-cyan-600 bg-cyan-950/50 text-cyan-300"
                        : "border-zinc-800 bg-zinc-900/40 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200"
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                    {t.label}
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </div>
      <footer className="border-t border-zinc-800 px-3 py-2 text-[10px] leading-relaxed text-zinc-600">
        {running ? (
          <span className="font-semibold text-emerald-400">Simulation running — pause to edit.</span>
        ) : (
          <>
            Click tool → ghost preview.
            <br />
            LMB place · RMB / Esc cancel.
            <br />
            Snaps to anchors automatically.
          </>
        )}
      </footer>
    </aside>
  );
}
