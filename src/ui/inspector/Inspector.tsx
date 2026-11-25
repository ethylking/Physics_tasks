// ui/inspector/Inspector.tsx — properties panel for the selected entity.
//
// Covers: name, transform (position / rotation in Euler degrees), initial
// velocity & angular velocity, mass, restitution, friction, per-kind geometry,
// per-face friction (box), CoM offset (§2.3 invariant: mass pivot moves, the
// mesh stays), plus category-specific extras.

import { MousePointer2, RefreshCcw, Trash2 } from "lucide-react";
import { useSceneStore, findEntityInProject } from "../../stores/sceneStore";
import { useTelemetryStore } from "../../stores/telemetryStore";
import { eulerDegToQuat, quatToEulerDeg } from "../../math/rotation";
import type {
  ForceEntity,
  JointEntity,
  MeterEntity,
  RigidBodyEntity,
  RopeEntity,
  StaticEntity,
} from "../../core/types";
import {
  CheckboxField,
  ColorField,
  ExprField,
  Hint,
  NumberField,
  Section,
  SelectField,
  Vec3Field,
} from "./fields";

const FACE_LABELS: [string, string, string, string, string, string] = [
  "+X (right)",
  "-X (left)",
  "+Y (back)",
  "-Y (front)",
  "+Z (top)",
  "-Z (bottom)",
];

const CATEGORY_LABELS: Record<string, string> = {
  bodies: "Body",
  statics: "Static",
  joints: "Joint",
  forces: "Force",
  ropes: "Rope",
  meters: "Meter",
};

export default function Inspector() {
  const project = useSceneStore((s) => s.project);
  const selectedId = useSceneStore((s) => s.selectedId);
  const running = useTelemetryStore((s) => s.status === "running");
  const found = findEntityInProject(project, selectedId);

  if (!found) {
    return (
      <aside className="flex w-72 shrink-0 flex-col items-center justify-center border-l border-zinc-800 bg-zinc-950 p-6 text-center text-zinc-600">
        <MousePointer2 className="mb-3 h-6 w-6" />
        <p className="text-xs leading-relaxed">
          Select an entity in the viewport to edit its properties.
        </p>
      </aside>
    );
  }

  return (
    <aside className="relative flex w-72 shrink-0 flex-col border-l border-zinc-800 bg-zinc-950">
      <InspectorHeader category={found.category} />
      <div className={`min-h-0 flex-1 space-y-3 overflow-y-auto p-3 ${running ? "pointer-events-none opacity-40" : ""}`}>
        {found.category === "bodies" && <BodyInspector body={found.entity as RigidBodyEntity} />}
        {found.category === "statics" && <StaticInspector stat={found.entity as StaticEntity} />}
        {found.category === "joints" && <JointInspector joint={found.entity as JointEntity} />}
        {found.category === "forces" && <ForceInspector force={found.entity as ForceEntity} />}
        {found.category === "ropes" && <RopeInspector rope={found.entity as RopeEntity} />}
        {found.category === "meters" && <MeterInspector meter={found.entity as MeterEntity} />}
      </div>
      {running && (
        <div className="border-t border-emerald-900/60 bg-emerald-950/40 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-300">
          Simulation running — pause to edit
        </div>
      )}
    </aside>
  );
}

function InspectorHeader({ category }: { category: string }) {
  const entity = useSceneStore((s) => findEntityInProject(s.project, s.selectedId)?.entity ?? null);
  const updateEntity = useSceneStore((s) => s.updateEntity);
  const deleteEntity = useSceneStore((s) => s.deleteEntity);
  const gizmoMode = useSceneStore((s) => s.gizmoMode);
  const setGizmoMode = useSceneStore((s) => s.setGizmoMode);

  if (!entity) return null;

  return (
    <header className="border-b border-zinc-800 px-3 py-2.5">
      <div className="flex items-center gap-2">
        <span className="rounded border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
          {CATEGORY_LABELS[category] ?? category}
        </span>
        <input
          type="text"
          aria-label="Entity name"
          value={entity.name}
          onChange={(e) => updateEntity(entity.id, { name: e.target.value })}
          className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1.5 py-1 text-sm font-medium text-zinc-100 outline-none transition-colors hover:border-zinc-700 focus:border-cyan-600"
        />
        <button
          type="button"
          aria-label="Delete entity"
          title="Delete entity"
          onClick={() => deleteEntity(entity.id)}
          className="btn-icon-sm hover:bg-red-950/40 hover:text-red-400"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
      {(category === "bodies" || category === "statics") && (
        <div className="mt-2 flex gap-1">
          <button
            type="button"
            aria-pressed={gizmoMode === "translate"}
            onClick={() => setGizmoMode("translate")}
            className={`flex flex-1 items-center justify-center gap-1 rounded-md border px-1 py-1 text-[10px] font-medium ${
              gizmoMode === "translate"
                ? "border-cyan-700 bg-cyan-950/50 text-cyan-300"
                : "border-zinc-800 text-zinc-500 hover:text-zinc-300"
            }`}
          >
            <MousePointer2 className="h-3 w-3" /> Move
          </button>
          <button
            type="button"
            aria-pressed={gizmoMode === "rotate"}
            onClick={() => setGizmoMode("rotate")}
            className={`flex flex-1 items-center justify-center gap-1 rounded-md border px-1 py-1 text-[10px] font-medium ${
              gizmoMode === "rotate"
                ? "border-cyan-700 bg-cyan-950/50 text-cyan-300"
                : "border-zinc-800 text-zinc-500 hover:text-zinc-300"
            }`}
          >
            <RefreshCcw className="h-3 w-3" /> Rotate
          </button>
        </div>
      )}
    </header>
  );
}

// -----------------------------------------------------------------------------
// Bodies
// -----------------------------------------------------------------------------

function BodyInspector({ body }: { body: RigidBodyEntity }) {
  const updateEntity = useSceneStore((s) => s.updateEntity);
  const patch = (p: Partial<RigidBodyEntity>) => updateEntity<RigidBodyEntity>(body.id, p);

  const setInitial = (p: Partial<RigidBodyEntity["initial"]>) =>
    patch({ initial: { ...body.initial, ...p } } as Partial<RigidBodyEntity>);

  const rotationDeg = quatToEulerDeg(body.initial.rotation);

  const setGeometryField = (key: string, value: number) => {
    const current = (body.geometry as Record<string, unknown>)[body.kind] as Record<string, unknown> | undefined;
    patch({
      geometry: {
        ...body.geometry,
        [body.kind]: { ...(current ?? {}), [key]: value },
      },
    });
  };

  return (
    <>
      <Section title="Transform">
        <Vec3Field
          groupLabel="Position"
          labels={["x", "y", "z"]}
          values={body.initial.position}
          onChange={(v) => setInitial({ position: v })}
        />
        <Vec3Field
          groupLabel="Rotation (deg)"
          labels={["rx", "ry", "rz"]}
          values={rotationDeg}
          onChange={(deg) => setInitial({ rotation: eulerDegToQuat(deg) })}
        />
      </Section>

      <Section title="Initial motion">
        <Vec3Field groupLabel="Velocity" labels={["vx", "vy", "vz"]} values={body.initial.velocity} onChange={(v) => setInitial({ velocity: v })} />
        <Vec3Field
          groupLabel="Angular velocity"
          labels={["ωx", "ωy", "ωz"]}
          values={body.initial.angularVelocity}
          onChange={(v) => setInitial({ angularVelocity: v })}
        />
      </Section>

      <Section title="Mass & material">
        <NumberField
          label="Mass (kg)"
          value={body.mass.value}
          min={0.000001}
          onChange={(v) => patch({ mass: { ...body.mass, value: v } })}
        />
        <SelectField
          label="Mass mode"
          value={body.mass.mode}
          options={[
            { value: "total", label: "Total mass" },
            { value: "density", label: "Density" },
          ]}
          onChange={(v) => patch({ mass: { ...body.mass, mode: v as "total" | "density" } })}
        />
        <NumberField label="Friction (μ)" value={body.friction} step={0.05} min={0} onChange={(v) => patch({ friction: v })} />
        <NumberField label="Restitution (e)" value={body.restitution} step={0.05} min={0} max={1} onChange={(v) => patch({ restitution: v })} />
        <NumberField label="Linear damping" value={body.linearDamping} step={0.01} min={0} onChange={(v) => patch({ linearDamping: v })} />
        <NumberField label="Angular damping" value={body.angularDamping} step={0.01} min={0} onChange={(v) => patch({ angularDamping: v })} />
        <CheckboxField label="Continuous collision detection (CCD)" checked={body.ccd} onChange={(v) => patch({ ccd: v })} />
      </Section>

      <Section title="Geometry">
        <GeometryFields body={body} setGeometryField={setGeometryField} />
        <Hint>Z is up: box W→X, D→Y (depth), H→Z; cylinders use a +Z axis; ellipsoid c is vertical.</Hint>
      </Section>

      {body.kind === "box" && (
        <Section title="Per-face friction">
          <FaceFrictionFields body={body} patch={patch} />
        </Section>
      )}

      <Section title="Center of mass (CoM) offset">
        <Vec3Field
          groupLabel="CoM offset"
          labels={["dx", "dy", "dz"]}
          values={body.centerOfMass}
          onChange={(v) => patch({ centerOfMass: v })}
          step={0.05}
        />
        <Hint>Shifts the mass pivot only — the geometric mesh stays in place (§2.3).</Hint>
      </Section>

      <Section title="Appearance">
        <ColorField
          label="Color"
          value={body.appearance?.color ?? "#38bdf8"}
          onChange={(v) => patch({ appearance: { color: v, opacity: body.appearance?.opacity ?? 1 } })}
        />
        <NumberField
          label="Opacity"
          value={body.appearance?.opacity ?? 1}
          step={0.05}
          min={0.05}
          max={1}
          onChange={(v) => patch({ appearance: { color: body.appearance?.color ?? "#38bdf8", opacity: v } })}
        />
      </Section>
    </>
  );
}

function GeometryFields({
  body,
  setGeometryField,
}: {
  body: RigidBodyEntity;
  setGeometryField: (key: string, value: number) => void;
}) {
  const g = body.geometry;
  const num = (v: unknown, fallback: number) => (typeof v === "number" ? v : fallback);

  switch (body.kind) {
    case "box":
      return (
        <>
          <NumberField label="Width (W)" value={num(g.box?.W, 1)} min={0.001} onChange={(v) => setGeometryField("W", v)} />
          <NumberField label="Height (H)" value={num(g.box?.H, 1)} min={0.001} onChange={(v) => setGeometryField("H", v)} />
          <NumberField label="Depth (D)" value={num(g.box?.D, 1)} min={0.001} onChange={(v) => setGeometryField("D", v)} />
        </>
      );
    case "sphere":
      return (
        <>
          <NumberField label="Radius (R)" value={num(g.sphere?.R, 0.5)} min={0.001} onChange={(v) => setGeometryField("R", v)} />
          <CheckboxField label="Hollow shell" checked={g.sphere?.shell ?? false} onChange={(v) => setGeometryField("shell", v ? 1 : 0)} />
        </>
      );
    case "ellipsoid":
      return (
        <>
          <NumberField label="Semi-axis a" value={num(g.ellipsoid?.a, 0.5)} min={0.001} onChange={(v) => setGeometryField("a", v)} />
          <NumberField label="Semi-axis b" value={num(g.ellipsoid?.b, 0.5)} min={0.001} onChange={(v) => setGeometryField("b", v)} />
          <NumberField label="Semi-axis c" value={num(g.ellipsoid?.c, 0.5)} min={0.001} onChange={(v) => setGeometryField("c", v)} />
        </>
      );
    case "cylinder":
      return (
        <>
          <NumberField label="Radius (R)" value={num(g.cylinder?.R, 0.5)} min={0.001} onChange={(v) => setGeometryField("R", v)} />
          <NumberField label="Height (H)" value={num(g.cylinder?.H, 1)} min={0.001} onChange={(v) => setGeometryField("H", v)} />
          <CheckboxField label="Hollow (hoop)" checked={g.cylinder?.hollow ?? false} onChange={(v) => setGeometryField("hollow", v ? 1 : 0)} />
        </>
      );
    case "rod":
      return (
        <>
          <NumberField label="Length (L)" value={num(g.rod?.L, 1)} min={0.001} onChange={(v) => setGeometryField("L", v)} />
          <NumberField label="Thickness" value={num(g.rod?.thickness, 0.05)} min={0.001} onChange={(v) => setGeometryField("thickness", v)} />
        </>
      );
    case "wedge":
      return (
        <>
          <NumberField label="Angle θ (deg)" value={num(g.wedge?.thetaDeg, 30)} min={0.1} max={89} onChange={(v) => setGeometryField("thetaDeg", v)} />
          <NumberField label="Width (W)" value={num(g.wedge?.W, 1)} min={0.001} onChange={(v) => setGeometryField("W", v)} />
          <NumberField label="Height (H)" value={num(g.wedge?.H, 0.5)} min={0.001} onChange={(v) => setGeometryField("H", v)} />
          <NumberField label="Depth (D)" value={num(g.wedge?.D, 1)} min={0.001} onChange={(v) => setGeometryField("D", v)} />
          <CheckboxField label="Dynamic (movable)" checked={g.wedge?.dynamic ?? false} onChange={(v) => setGeometryField("dynamic", v ? 1 : 0)} />
        </>
      );
    default:
      return <Hint>Tier 2 / plugin geometry — no built-in editor yet.</Hint>;
  }
}

function FaceFrictionFields({ body, patch }: { body: RigidBodyEntity; patch: (p: Partial<RigidBodyEntity>) => void }) {
  const current = body.faceFriction ?? [];
  return (
    <>
      {FACE_LABELS.map((label, i) => (
        <NumberField
          key={label}
          label={`${label} friction`}
          value={current[i] ?? body.friction}
          step={0.05}
          min={0}
          onChange={(v) => {
            const next = [...current];
            while (next.length < 6) next.push(body.friction);
            next[i] = v;
            patch({ faceFriction: next });
          }}
        />
      ))}
      <Hint>μ₁…μ₆ per face (§2.2) — box decomposed into six face colliders at simulation time.</Hint>
    </>
  );
}

// -----------------------------------------------------------------------------
// Statics
// -----------------------------------------------------------------------------

function StaticInspector({ stat }: { stat: StaticEntity }) {
  const updateEntity = useSceneStore((s) => s.updateEntity);
  const patch = (p: Partial<StaticEntity>) => updateEntity<StaticEntity>(stat.id, p);

  return (
    <>
      <Section title="Transform">
        <Vec3Field
          groupLabel="Position"
          labels={["x", "y", "z"]}
          values={stat.position ?? [0, 0, 0]}
          onChange={(v) => patch({ position: v })}
        />
        <Vec3Field
          groupLabel="Rotation (deg)"
          labels={["rx", "ry", "rz"]}
          values={quatToEulerDeg(stat.rotation ?? [0, 0, 0, 1])}
          onChange={(deg) => patch({ rotation: eulerDegToQuat(deg) })}
        />
        <Hint>
          Angles are relative to the plane&apos;s initial orientation (normal {stat.plane.normal[0]},{" "}
          {stat.plane.normal[1]}, {stat.plane.normal[2]}); use the Rotate gizmo in the viewport or enter degrees here.
        </Hint>
      </Section>
      <Section title="Surface">
        <NumberField label="Friction (μ)" value={stat.friction} step={0.05} min={0} onChange={(v) => patch({ friction: v })} />
        <NumberField label="Restitution (e)" value={stat.restitution} step={0.05} min={0} max={1} onChange={(v) => patch({ restitution: v })} />
        <CheckboxField label="CCD" checked={stat.ccd} onChange={(v) => patch({ ccd: v })} />
      </Section>
      <Section title="Plane">
        <Vec3Field
          groupLabel="Normal"
          labels={["nx", "ny", "nz"]}
          values={stat.plane.normal}
          onChange={(v) => patch({ plane: { ...stat.plane, normal: v } })}
          step={0.1}
        />
        <Vec3Field
          groupLabel="Extent"
          labels={["e1", "e2", "—"]}
          values={[stat.plane.extent[0], stat.plane.extent[1], 0]}
          onChange={(v) => patch({ plane: { ...stat.plane, extent: [v[0], v[1]] } })}
        />
      </Section>
      <Section title="Appearance">
        <ColorField
          label="Color"
          value={stat.appearance?.color ?? "#3f3f46"}
          onChange={(v) => patch({ appearance: { color: v, opacity: stat.appearance?.opacity ?? 0.85 } })}
        />
      </Section>
      <Hint>Statics are infinite planes; drag the move gizmo in the viewport to reposition them (their plane offset is stored in `position`).</Hint>
    </>
  );
}

// -----------------------------------------------------------------------------
// Joints
// -----------------------------------------------------------------------------

function JointInspector({ joint }: { joint: JointEntity }) {
  const updateEntity = useSceneStore((s) => s.updateEntity);
  const patch = (p: Partial<JointEntity>) => updateEntity<JointEntity>(joint.id, p);
  const bodies = useSceneStore((s) => s.project?.bodies ?? []);

  const bodyOptions = (allowWorld: boolean) => [
    ...(allowWorld ? [{ value: "", label: "World" }] : []),
    ...bodies.map((b) => ({ value: b.id, label: b.name || b.id })),
  ];

  return (
    <>
      <Section title="Bodies">
        <SelectField
          label="Body A"
          value={joint.bodyA ?? ""}
          options={bodyOptions(true)}
          onChange={(v) => patch({ bodyA: v || null })}
        />
        <SelectField
          label="Body B"
          value={joint.bodyB ?? ""}
          options={bodyOptions(true)}
          onChange={(v) => patch({ bodyB: v || null })}
        />
      </Section>
      <Section title="Anchors (local)">
        <Vec3Field groupLabel="Anchor A" labels={["x", "y", "z"]} values={joint.anchors.a} onChange={(v) => patch({ anchors: { ...joint.anchors, a: v } })} />
        <Vec3Field groupLabel="Anchor B" labels={["x", "y", "z"]} values={joint.anchors.b} onChange={(v) => patch({ anchors: { ...joint.anchors, b: v } })} />
      </Section>
      <Section title="Axis">
        <SelectField
          label="Axis"
          value={joint.axis ?? "custom"}
          options={[
            { value: "x", label: "X" },
            { value: "y", label: "Y" },
            { value: "z", label: "Z" },
            { value: "custom", label: "Custom" },
          ]}
          onChange={(v) => patch({ axis: v as JointEntity["axis"] })}
        />
        {joint.axis === "custom" && (
          <Vec3Field groupLabel="Axis vector" labels={["x", "y", "z"]} values={joint.axisVec ?? [0, 0, 1]} onChange={(v) => patch({ axisVec: v })} />
        )}
      </Section>
      {joint.kind === "revolute" && (
        <Section title="Revolute">
          <NumberField label="Axle friction (N·m)" value={joint.revolute?.friction ?? 0} step={0.05} min={0} onChange={(v) => patch({ revolute: { ...joint.revolute, friction: v, damping: joint.revolute?.damping ?? 0 } })} />
          <NumberField label="Damping (N·m·s/rad)" value={joint.revolute?.damping ?? 0} step={0.05} min={0} onChange={(v) => patch({ revolute: { ...joint.revolute, damping: v, friction: joint.revolute?.friction ?? 0 } })} />
          <Vec3Field
            groupLabel="Limits (deg)"
            labels={["min", "max", "—"]}
            values={[
              ((joint.revolute?.limits?.[0] ?? -Math.PI) * 180) / Math.PI,
              ((joint.revolute?.limits?.[1] ?? Math.PI) * 180) / Math.PI,
              0,
            ]}
            onChange={(v) =>
              patch({
                revolute: {
                  ...joint.revolute,
                  friction: joint.revolute?.friction ?? 0,
                  damping: joint.revolute?.damping ?? 0,
                  limits: [(v[0] * Math.PI) / 180, (v[1] * Math.PI) / 180],
                },
              })
            }
          />
          <Hint>Angular limits are stored in radians in the project file.</Hint>
        </Section>
      )}
      {joint.kind === "prismatic" && (
        <Section title="Prismatic">
          <NumberField label="Sliding friction (N)" value={joint.prismatic?.friction ?? 0} step={0.05} min={0} onChange={(v) => patch({ prismatic: { ...joint.prismatic, friction: v } })} />
          <Vec3Field
            groupLabel="Limits (m)"
            labels={["min", "max", "—"]}
            values={[joint.prismatic?.limits?.[0] ?? -1, joint.prismatic?.limits?.[1] ?? 1, 0]}
            onChange={(v) =>
              patch({
                prismatic: { ...joint.prismatic, friction: joint.prismatic?.friction ?? 0, limits: [v[0], v[1]] },
              })
            }
          />
        </Section>
      )}
    </>
  );
}

// -----------------------------------------------------------------------------
// Forces
// -----------------------------------------------------------------------------

function ForceInspector({ force }: { force: ForceEntity }) {
  const updateEntity = useSceneStore((s) => s.updateEntity);
  const patch = (p: Partial<ForceEntity>) => updateEntity<ForceEntity>(force.id, p);
  const bodies = useSceneStore((s) => s.project?.bodies ?? []);

  const bodyOptions = [
    { value: "", label: "None (world space)" },
    ...bodies.map((b) => ({ value: b.id, label: b.name || b.id })),
  ];

  const setComponent = (axis: "x" | "y" | "z", value: string) => {
    const components = force.components ?? { x: "0", y: "0", z: "0" };
    patch({ components: { ...components, [axis]: value } });
  };

  if (force.kind === "spring" && force.spring) {
    return (
      <>
        <Section title="Attachment">
          <SelectField label="Body" value={force.body ?? ""} options={bodyOptions} onChange={(v) => patch({ body: v || null })} />
          <CheckboxField label="Enabled" checked={force.enabled} onChange={(v) => patch({ enabled: v })} />
        </Section>
        <Section title="Spring–damper">
          <NumberField label="Stiffness k (N/m)" value={force.spring.k} min={0} onChange={(v) => patch({ spring: { ...force.spring!, k: v } })} />
          <NumberField label="Rest length L₀" value={force.spring.restLength} min={0} onChange={(v) => patch({ spring: { ...force.spring!, restLength: v } })} />
          <NumberField label="Damping c" value={force.spring.damping} min={0} onChange={(v) => patch({ spring: { ...force.spring!, damping: v } })} />
          <SelectField label="Anchor B body" value={force.spring.anchorB ?? ""} options={bodyOptions} onChange={(v) => patch({ spring: { ...force.spring!, anchorB: v } })} />
          <Vec3Field groupLabel="Anchor B point" labels={["x", "y", "z"]} values={force.spring.anchorBPoint} onChange={(v) => patch({ spring: { ...force.spring!, anchorBPoint: v } })} />
        </Section>
        <Section title="Appearance">
          <ColorField
            label="Color"
            value={force.appearance?.color ?? "#ef4444"}
            onChange={(v) => patch({ appearance: { color: v, scale: force.appearance?.scale ?? 1 } })}
          />
        </Section>
        <Hint>Hooke&apos;s law F = k·(L − L₀) + c·Δv along the line of action, applied at the world anchors (§4.3).</Hint>
      </>
    );
  }

  const isTorque = force.kind === "torque";
  const isThruster = force.kind === "thruster";
  const axisLetter = isTorque ? "M" : "F";
  const anchorGroup = isTorque ? "Moment anchor" : "Anchor";
  const anchorHint = force.body
    ? "Stored in the body's local frame — it rotates with the body."
    : "Stored in world coordinates.";

  return (
    <>
      <Section title="Attachment">
        <SelectField label="Body" value={force.body ?? ""} options={bodyOptions} onChange={(v) => patch({ body: v || null })} />
        <CheckboxField label="Enabled" checked={force.enabled} onChange={(v) => patch({ enabled: v })} />
        <Vec3Field
          groupLabel={anchorGroup}
          labels={["x", "y", "z"]}
          values={force.anchor ?? [0, 0, 0]}
          onChange={(v) => patch({ anchor: v })}
        />
        <Hint>
          {anchorHint} Without an anchor the {isTorque ? "moment" : "force"} acts at the body's center of mass.
        </Hint>
      </Section>

      <Section title={`${isTorque ? "Torque" : "Force"} components (mathjs expressions)`}>
        <ExprField
          label={`${axisLetter}x(t,x,y,z,v,ω)`}
          value={force.components?.x ?? "0"}
          onChange={(v) => setComponent("x", v)}
        />
        <ExprField
          label={`${axisLetter}y(t,x,y,z,v,ω)`}
          value={force.components?.y ?? "0"}
          onChange={(v) => setComponent("y", v)}
        />
        <ExprField
          label={`${axisLetter}z(t,x,y,z,v,ω)`}
          value={force.components?.z ?? "0"}
          onChange={(v) => setComponent("z", v)}
        />
        {isThruster ? (
          <Hint>Thrust is always applied in the body's local frame at the local anchor — it rotates with the rigid body.</Hint>
        ) : (
          <CheckboxField
            label="Local frame (rotates with body)"
            checked={force.localFrame ?? false}
            onChange={(v) => patch({ localFrame: v })}
          />
        )}
        <Hint>Variables: t, x, y, z (anchor position), vx, vy, vz (anchor velocity), wx, wy, wz (angular velocity).</Hint>
      </Section>

      <Section title="Appearance">
        <ColorField
          label="Color"
          value={force.appearance?.color ?? "#ef4444"}
          onChange={(v) => patch({ appearance: { color: v, scale: force.appearance?.scale ?? 1 } })}
        />
        <NumberField
          label="Arrow scale"
          value={force.appearance?.scale ?? 1}
          step={0.1}
          min={0.05}
          onChange={(v) => patch({ appearance: { color: force.appearance?.color ?? "#ef4444", scale: v } })}
        />
      </Section>
    </>
  );
}

// -----------------------------------------------------------------------------
// Ropes & meters
// -----------------------------------------------------------------------------

function RopeInspector({ rope }: { rope: RopeEntity }) {
  const updateEntity = useSceneStore((s) => s.updateEntity);
  const patch = (p: Partial<RopeEntity>) => updateEntity<RopeEntity>(rope.id, p);

  return (
    <>
      <Section title="Model">
        <SelectField
          label="Model"
          value={rope.model}
          options={[
            { value: "massless", label: "Massless (inextensible)" },
            { value: "chain", label: "Massive chain" },
          ]}
          onChange={(v) => patch({ model: v as RopeEntity["model"] })}
        />
      </Section>
      {rope.model === "massless" && (
        <Section title="Massless">
          <CheckboxField label="Inextensible" checked={rope.massless?.inextensible ?? true} onChange={(v) => patch({ massless: { inextensible: v } })} />
        </Section>
      )}
      {rope.model === "chain" && (
        <Section title="Chain">
          <NumberField label="Total mass (kg)" value={rope.chain?.mass ?? 1} min={0.0001} onChange={(v) => patch({ chain: { ...rope.chain, mass: v, segments: rope.chain?.segments ?? 30, stiffness: rope.chain?.stiffness ?? 1000, damping: rope.chain?.damping ?? 10 } })} />
          <NumberField label="Linear density λ (kg/m)" value={rope.chain?.linearDensity ?? 0} min={0} step={0.01} onChange={(v) => patch({ chain: { mass: rope.chain?.mass ?? 1, linearDensity: v, segments: rope.chain?.segments ?? 30, stiffness: rope.chain?.stiffness ?? 1000, damping: rope.chain?.damping ?? 10 } })} />
          <NumberField label="Segments (N)" value={rope.chain?.segments ?? 30} min={2} max={200} step={1} onChange={(v) => patch({ chain: { ...rope.chain, segments: Math.round(v), mass: rope.chain?.mass ?? 1, stiffness: rope.chain?.stiffness ?? 1000, damping: rope.chain?.damping ?? 10 } })} />
          <NumberField label="Stiffness" value={rope.chain?.stiffness ?? 1000} min={0} step={10} onChange={(v) => patch({ chain: { ...rope.chain, stiffness: v, mass: rope.chain?.mass ?? 1, segments: rope.chain?.segments ?? 30, damping: rope.chain?.damping ?? 10 } })} />
          <NumberField label="Link damping rate (1/s)" value={rope.chain?.damping ?? 10} min={0} step={0.5} onChange={(v) => patch({ chain: { ...rope.chain, damping: v, mass: rope.chain?.mass ?? 1, segments: rope.chain?.segments ?? 30, stiffness: rope.chain?.stiffness ?? 1000 } })} />
          <Hint>λ &gt; 0 overrides the total mass: mᵢ = λ·L/N. Stiffness is reserved for future XPBD link softening.</Hint>
        </Section>
      )}
      <RopePulleysEditor rope={rope} />
      <Section title="Appearance">
        <ColorField
          label="Color"
          value={rope.appearance?.color ?? "#e4e4e7"}
          onChange={(v) => patch({ appearance: { color: v, thickness: rope.appearance?.thickness ?? 0.02 } })}
        />
        <NumberField
          label="Thickness (m)"
          value={rope.appearance?.thickness ?? 0.02}
          min={0.002}
          step={0.002}
          onChange={(v) => patch({ appearance: { color: rope.appearance?.color ?? "#e4e4e7", thickness: v } })}
        />
      </Section>
      <Section title="Path">
        <Hint>{rope.path.length} anchor point(s). Anchor the rope by placing it snapped to bodies; path editing arrives with the render overlay tools.</Hint>
      </Section>
    </>
  );
}

function RopePulleysEditor({ rope }: { rope: RopeEntity }) {
  const updateEntity = useSceneStore((s) => s.updateEntity);
  const patch = (p: Partial<RopeEntity>) => updateEntity<RopeEntity>(rope.id, p);
  const bodies = useSceneStore((s) => s.project?.bodies ?? []);
  const pulleys = rope.pulleys ?? [];
  const unused = bodies.filter((b) => !pulleys.includes(b.id));

  return (
    <Section title="Pulleys">
      {pulleys.length === 0 && (
        <Hint>None — this rope runs straight between its anchors.</Hint>
      )}
      {pulleys.map((id, i) => {
        const body = bodies.find((b) => b.id === id);
        return (
          <div key={id} className="flex items-center gap-1.5">
            <span className="min-w-0 flex-1 truncate text-xs text-zinc-300">
              {i + 1}. {body?.name ?? id}
            </span>
            <button
              type="button"
              aria-label={`Remove pulley ${i + 1}`}
              onClick={() => patch({ pulleys: pulleys.filter((p) => p !== id) })}
              className="btn-icon-sm hover:bg-red-950/40 hover:text-red-400"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        );
      })}
      {unused.length > 0 && pulleys.length < rope.path.length - 1 && (
        <div className="flex items-center gap-1.5">
          <select
            aria-label="Add pulley"
            className="input-dark min-w-0 flex-1 text-xs"
            value=""
            onChange={(e) => {
              if (!e.target.value) return;
              patch({ pulleys: [...pulleys, e.target.value] });
            }}
          >
            <option value="">Add pulley…</option>
            {unused.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name || b.id}
              </option>
            ))}
          </select>
        </div>
      )}
      <Hint>
        Pulley i sits between path[i] and path[i+1]. Mount a pulley with a Revolute joint (its axle friction &
        damping live there); the pulley&apos;s radius/mass come from its cylinder body.
      </Hint>
    </Section>
  );
}

function MeterInspector({ meter }: { meter: MeterEntity }) {
  const updateEntity = useSceneStore((s) => s.updateEntity);
  const patch = (p: Partial<MeterEntity>) => updateEntity<MeterEntity>(meter.id, p);
  const bodies = useSceneStore((s) => s.project?.bodies ?? []);

  return (
    <Section title="Meter">
      <Vec3Field
        groupLabel="Position"
        labels={["x", "y", "z"]}
        values={meter.position ?? [0, 0, 0]}
        onChange={(v) => patch({ position: v })}
      />
      <SelectField
        label="Target body"
        value={meter.target ?? ""}
        options={[{ value: "", label: "None" }, ...bodies.map((b) => ({ value: b.id, label: b.name || b.id }))]}
        onChange={(v) => patch({ target: v || undefined })}
      />
      <SelectField
        label="Output"
        value={meter.output ?? "hud"}
        options={[
          { value: "hud", label: "HUD" },
          { value: "plot", label: "Plot" },
          { value: "export", label: "Export" },
        ]}
        onChange={(v) => patch({ output: v as MeterEntity["output"] })}
      />
    </Section>
  );
}
