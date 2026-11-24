// render/overlays/VectorOverlays.tsx — live vector arrows and the trajectory
// tracer (Milestone 4).
//
// Everything here reads the latest worker snapshot inside useFrame and mutates
// imperatively-owned THREE objects — React never re-renders per physics frame
// (§5.2). Visibility toggles + the global vector scale live in overlayStore.
//
// Per body: velocity v, total acceleration a, tangential a_τ = (a·v̂)v̂, normal
// a_n = a − a_τ, gravity mg, normal reaction N, friction F_f. Per force entity:
// the live applied external/thruster vector at its anchor point.

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import type {
  ForceEntity as ForceEntityType,
  Quat,
  RigidBodyEntity,
  RopeEntity as RopeEntityType,
  Vec3,
} from "../../core/types";
import { useSceneStore } from "../../stores/sceneStore";
import { useTelemetryStore } from "../../stores/telemetryStore";
import { useOverlayStore, type VectorKind } from "../../stores/overlayStore";
import { SNAPSHOT_FLOATS_PER_BODY, SNAPSHOT_HEADER, SNAPSHOT_INDEX, snapshotRopesOffset } from "../../physics/snapshot";
import { computeBodyMassProperties } from "../../math/inertia";
import { localToWorld } from "../../math/rotation";
import { compileForceEntity, evaluateForceApplication } from "../../physics/forces";
import { computePulleyWrapGeometry } from "../../physics/ropes";
import { resolveJointAxis } from "../../physics/joints";

const MAX_ARROW_LENGTH = 15;
const TRAIL_CAPACITY = 2000;
const TRAIL_COLOR = "#22d3ee";

const VECTOR_COLORS: Record<VectorKind, string> = {
  velocity: "#22d3ee",
  accel: "#facc15",
  tangential: "#fb923c",
  normal: "#a78bfa",
  gravity: "#e4e4e7",
  reaction: "#34d399",
  friction: "#f87171",
  external: "#ef4444",
  tension: "#f59e0b",
};

function hypot(v: Vec3): number {
  return Math.hypot(v[0], v[1], v[2]);
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/** Update an ArrowHelper from a world vector + origin (honours toggle & scale). */
function applyArrow(
  helper: THREE.ArrowHelper,
  enabled: boolean,
  vector: Vec3,
  origin: Vec3,
  scale: number,
): void {
  if (!enabled) {
    helper.visible = false;
    return;
  }
  const magnitude = hypot(vector);
  if (magnitude < 1e-6) {
    helper.visible = false;
    return;
  }
  const length = Math.min(MAX_ARROW_LENGTH, magnitude * scale);
  helper.visible = true;
  helper.position.set(origin[0], origin[1], origin[2]);
  helper.setDirection(new THREE.Vector3(vector[0], vector[1], vector[2]).normalize());
  helper.setLength(length, Math.min(0.3, length * 0.3), Math.min(0.14, length * 0.12));
}

export function VectorOverlays() {
  const project = useSceneStore((s) => s.project);
  if (!project) return null;
  return (
    <>
      {project.bodies.map((b) => (
        <BodyVectors key={b.id} body={b} />
      ))}
      {project.forces.map((f) => (
        <ForceVectorOverlay key={f.id} force={f} />
      ))}
      {project.ropes.map((r) => (
        <RopeTensionOverlay key={r.id} rope={r} />
      ))}
      <TrailTracers />
    </>
  );
}

// -----------------------------------------------------------------------------
// Per-body kinematic & contact vectors
// -----------------------------------------------------------------------------

function BodyVectors({ body }: { body: RigidBodyEntity }) {
  const groupRef = useRef<THREE.Group>(null);
  const helpers = useRef<Partial<Record<VectorKind, THREE.ArrowHelper>>>({});
  const mass = useMemo(() => computeBodyMassProperties(body).mass, [body]);

  useEffect(() => {
    const group = groupRef.current;
    if (!group) return;
    (Object.keys(VECTOR_COLORS) as VectorKind[]).forEach((kind) => {
      const helper = new THREE.ArrowHelper(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 0), 1, VECTOR_COLORS[kind]);
      helper.visible = false;
      group.add(helper);
      helpers.current[kind] = helper;
    });
    return () => {
      group.clear();
      helpers.current = {};
    };
  }, []);

  useFrame(() => {
    const settings = useOverlayStore.getState();
    const snapshot = useTelemetryStore.getState().getSnapshot();
    const order = useTelemetryStore.getState().getBodyOrder();
    const project = useSceneStore.getState().project;
    const index = order.indexOf(body.id);

    const hideAll = () => {
      for (const helper of Object.values(helpers.current)) helper.visible = false;
    };
    if (!snapshot || !project || index < 0) {
      hideAll();
      return;
    }
    const o = SNAPSHOT_HEADER + index * SNAPSHOT_FLOATS_PER_BODY;
    if (o + SNAPSHOT_FLOATS_PER_BODY > snapshot.length) {
      hideAll();
      return;
    }

    const position: Vec3 = [snapshot[o + SNAPSHOT_INDEX.POS] ?? 0, snapshot[o + SNAPSHOT_INDEX.POS + 1] ?? 0, snapshot[o + SNAPSHOT_INDEX.POS + 2] ?? 0];
    const rotation: Quat = [
      snapshot[o + SNAPSHOT_INDEX.QUAT] ?? 0,
      snapshot[o + SNAPSHOT_INDEX.QUAT + 1] ?? 0,
      snapshot[o + SNAPSHOT_INDEX.QUAT + 2] ?? 0,
      snapshot[o + SNAPSHOT_INDEX.QUAT + 3] ?? 1,
    ];
    const com = localToWorld(body.centerOfMass, position, rotation);
    const linvel: Vec3 = [snapshot[o + SNAPSHOT_INDEX.LINVEL] ?? 0, snapshot[o + SNAPSHOT_INDEX.LINVEL + 1] ?? 0, snapshot[o + SNAPSHOT_INDEX.LINVEL + 2] ?? 0];
    const accel: Vec3 = [snapshot[o + SNAPSHOT_INDEX.ACCEL] ?? 0, snapshot[o + SNAPSHOT_INDEX.ACCEL + 1] ?? 0, snapshot[o + SNAPSHOT_INDEX.ACCEL + 2] ?? 0];
    const normal: Vec3 = [snapshot[o + SNAPSHOT_INDEX.NORMAL] ?? 0, snapshot[o + SNAPSHOT_INDEX.NORMAL + 1] ?? 0, snapshot[o + SNAPSHOT_INDEX.NORMAL + 2] ?? 0];
    const friction: Vec3 = [snapshot[o + SNAPSHOT_INDEX.FRICTION] ?? 0, snapshot[o + SNAPSHOT_INDEX.FRICTION + 1] ?? 0, snapshot[o + SNAPSHOT_INDEX.FRICTION + 2] ?? 0];
    const gravity: Vec3 = project.world.gravity;

    // Tangential / normal decomposition of the total acceleration.
    const speed = hypot(linvel);
    const vHat: Vec3 = speed > 1e-6 ? [linvel[0] / speed, linvel[1] / speed, linvel[2] / speed] : [0, 0, 0];
    const aTauScalar = dot(accel, vHat);
    const tangential: Vec3 = [vHat[0] * aTauScalar, vHat[1] * aTauScalar, vHat[2] * aTauScalar];
    const normalA: Vec3 = [accel[0] - tangential[0], accel[1] - tangential[1], accel[2] - tangential[2]];
    const mg: Vec3 = [gravity[0] * mass, gravity[1] * mass, gravity[2] * mass];

    const set = (kind: VectorKind, vector: Vec3) => {
      const helper = helpers.current[kind];
      if (helper) applyArrow(helper, settings.vectors[kind], vector, com, settings.scale);
    };

    set("velocity", linvel);
    set("accel", accel);
    set("tangential", tangential);
    set("normal", normalA);
    set("gravity", mg);
    set("reaction", normal);
    set("friction", friction);
    // External applied forces are drawn per-entity by ForceVectorOverlay.
    if (helpers.current.external) helpers.current.external.visible = false;
  });

  return <group ref={groupRef} />;
}

// -----------------------------------------------------------------------------
// Applied external / thruster force arrows at their anchor points
// -----------------------------------------------------------------------------

function ForceVectorOverlay({ force }: { force: ForceEntityType }) {
  const groupRef = useRef<THREE.Group>(null);
  const helperRef = useRef<THREE.ArrowHelper | null>(null);
  const compiled = useMemo(() => compileForceEntity(force), [force]);

  useEffect(() => {
    const group = groupRef.current;
    if (!group) return;
    const helper = new THREE.ArrowHelper(
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(0, 0, 0),
      1,
      force.appearance?.color ?? VECTOR_COLORS.external,
    );
    helper.visible = false;
    group.add(helper);
    helperRef.current = helper;
    return () => {
      group.clear();
      helperRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [force.id]);

  useFrame(() => {
    const helper = helperRef.current;
    if (!helper) return;
    const settings = useOverlayStore.getState();
    const snapshot = useTelemetryStore.getState().getSnapshot();
    const project = useSceneStore.getState().project;

    const hide = () => {
      helper.visible = false;
    };
    if (
      !settings.vectors.external ||
      force.kind !== "external" && force.kind !== "thruster" ||
      !force.enabled ||
      !force.body ||
      !snapshot ||
      !project
    ) {
      hide();
      return;
    }
    const order = useTelemetryStore.getState().getBodyOrder();
    const index = order.indexOf(force.body);
    const bodyEntity = project.bodies.find((b) => b.id === force.body);
    if (index < 0 || !bodyEntity) {
      hide();
      return;
    }
    const o = SNAPSHOT_HEADER + index * SNAPSHOT_FLOATS_PER_BODY;
    if (o + SNAPSHOT_FLOATS_PER_BODY > snapshot.length) {
      hide();
      return;
    }

    const application = evaluateForceApplication(
      compiled,
      {
        position: [snapshot[o + SNAPSHOT_INDEX.POS] ?? 0, snapshot[o + SNAPSHOT_INDEX.POS + 1] ?? 0, snapshot[o + SNAPSHOT_INDEX.POS + 2] ?? 0],
        rotation: [
          snapshot[o + SNAPSHOT_INDEX.QUAT] ?? 0,
          snapshot[o + SNAPSHOT_INDEX.QUAT + 1] ?? 0,
          snapshot[o + SNAPSHOT_INDEX.QUAT + 2] ?? 0,
          snapshot[o + SNAPSHOT_INDEX.QUAT + 3] ?? 1,
        ],
        linvel: [snapshot[o + SNAPSHOT_INDEX.LINVEL] ?? 0, snapshot[o + SNAPSHOT_INDEX.LINVEL + 1] ?? 0, snapshot[o + SNAPSHOT_INDEX.LINVEL + 2] ?? 0],
        angvel: [snapshot[o + SNAPSHOT_INDEX.ANGVEL] ?? 0, snapshot[o + SNAPSHOT_INDEX.ANGVEL + 1] ?? 0, snapshot[o + SNAPSHOT_INDEX.ANGVEL + 2] ?? 0],
        centerOfMass: bodyEntity.centerOfMass,
      },
      snapshot[SNAPSHOT_INDEX.T] ?? 0,
      project.meta.mode,
    );
    if (!application) {
      hide();
      return;
    }
    helper.setColor(force.appearance?.color ?? VECTOR_COLORS.external);
    applyArrow(helper, true, application.force, application.anchor, settings.scale);
  });

  return <group ref={groupRef} />;
}

// -----------------------------------------------------------------------------
// Trajectory tracer — smooth polyline ring buffer following bodies / anchors
// -----------------------------------------------------------------------------

interface RingBuffer {
  data: Float32Array;
  head: number;
  count: number;
  lastT: number;
}

function appendRing(ring: RingBuffer, p: Vec3, t: number): void {
  if (!Number.isFinite(ring.lastT) || t < ring.lastT) {
    // Reset / rewind — start a fresh trail.
    ring.head = -1;
    ring.count = 0;
  }
  if (ring.count > 0 && t === ring.lastT) return;
  ring.head = (ring.head + 1) % TRAIL_CAPACITY;
  ring.data[ring.head * 3] = p[0];
  ring.data[ring.head * 3 + 1] = p[1];
  ring.data[ring.head * 3 + 2] = p[2];
  ring.count = Math.min(ring.count + 1, TRAIL_CAPACITY);
  ring.lastT = t;
}

function writeGeometry(geometry: THREE.BufferGeometry, ring: RingBuffer): void {
  const positions = geometry.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < ring.count; i++) {
    const src = (ring.head - (ring.count - 1 - i) + TRAIL_CAPACITY) % TRAIL_CAPACITY;
    positions.setXYZ(i, ring.data[src * 3] ?? 0, ring.data[src * 3 + 1] ?? 0, ring.data[src * 3 + 2] ?? 0);
  }
  positions.needsUpdate = true;
  geometry.setDrawRange(0, ring.count);
}

function TrailTracers() {
  const bodies = useSceneStore((s) => s.project?.bodies ?? []);
  const meters = useSceneStore((s) => s.project?.meters ?? []);
  const trails = useOverlayStore((s) => s.trails);

  // MeterEntity kind "trajectory" with a target body also draws a trail.
  const meterTrails = meters
    .filter((m) => m.kind === "trajectory" && m.target)
    .map((m) => ({ id: m.target as string, anchor: [0, 0, 0] as Vec3, enabled: true }));

  return (
    <>
      {bodies.map((body) => {
        const config = trails[body.id] ?? meterTrails.find((t) => t.id === body.id);
        if (!config || !config.enabled) return null;
        return (
          <BodyTrail
            key={body.id}
            bodyId={body.id}
            anchor={config.anchor}
            color={body.appearance?.color ?? TRAIL_COLOR}
          />
        );
      })}
    </>
  );
}

function BodyTrail({ bodyId, anchor, color }: { bodyId: string; anchor: Vec3; color: string }) {
  // r3f v8 has no `<line>` JSX intrinsic — build the THREE.Line imperatively.
  const line = useMemo(() => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(TRAIL_CAPACITY * 3), 3));
    geometry.setDrawRange(0, 0);
    const material = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9, depthTest: false });
    const l = new THREE.Line(geometry, material);
    l.frustumCulled = false;
    return l;
  }, [color]);
  const ring = useRef<RingBuffer>({ data: new Float32Array(TRAIL_CAPACITY * 3), head: -1, count: 0, lastT: NaN });

  useFrame(() => {
    const snapshot = useTelemetryStore.getState().getSnapshot();
    const order = useTelemetryStore.getState().getBodyOrder();
    const index = order.indexOf(bodyId);
    if (!snapshot || index < 0) return;
    const o = SNAPSHOT_HEADER + index * SNAPSHOT_FLOATS_PER_BODY;
    if (o + SNAPSHOT_FLOATS_PER_BODY > snapshot.length) return;
    const t = snapshot[SNAPSHOT_INDEX.T] ?? 0;
    const position: Vec3 = [snapshot[o + SNAPSHOT_INDEX.POS] ?? 0, snapshot[o + SNAPSHOT_INDEX.POS + 1] ?? 0, snapshot[o + SNAPSHOT_INDEX.POS + 2] ?? 0];
    const rotation: Quat = [
      snapshot[o + SNAPSHOT_INDEX.QUAT] ?? 0,
      snapshot[o + SNAPSHOT_INDEX.QUAT + 1] ?? 0,
      snapshot[o + SNAPSHOT_INDEX.QUAT + 2] ?? 0,
      snapshot[o + SNAPSHOT_INDEX.QUAT + 3] ?? 1,
    ];
    const point = localToWorld(anchor, position, rotation);
    appendRing(ring.current, point, t);
    writeGeometry(line.geometry, ring.current);
  });

  return <primitive object={line} />;
}


// -----------------------------------------------------------------------------
// Rope tension T — recovered constraint impulses packed into the snapshot
// -----------------------------------------------------------------------------

function RopeTensionOverlay({ rope }: { rope: RopeEntityType }) {
  const groupRef = useRef<THREE.Group>(null);
  const helpersRef = useRef<THREE.ArrowHelper[]>([]);

  const segCount = useMemo(() => {
    const project = useSceneStore.getState().project;
    let n = Math.max(0, rope.path.length - 1);
    const pulleyCount = Math.min(rope.pulleys?.length ?? 0, rope.path.length - 1);
    for (let i = 0; i < pulleyCount; i++) {
      const id = rope.pulleys?.[i];
      if (id && project?.bodies.some((b) => b.id === id)) n += 1;
    }
    return n;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rope.id]);

  useEffect(() => {
    const group = groupRef.current;
    if (!group) return;
    const helpers: THREE.ArrowHelper[] = [];
    for (let i = 0; i < segCount; i++) {
      const h = new THREE.ArrowHelper(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 0), 1, VECTOR_COLORS.tension);
      h.visible = false;
      group.add(h);
      helpers.push(h);
    }
    helpersRef.current = helpers;
    return () => {
      group.clear();
      helpersRef.current = [];
    };
  }, [segCount]);

  useFrame(() => {
    const helpers = helpersRef.current;
    if (helpers.length === 0) return;
    const settings = useOverlayStore.getState();
    const hideAll = () => {
      for (const h of helpers) h.visible = false;
    };
    if (!settings.vectors.tension || rope.model !== "massless") {
      hideAll();
      return;
    }
    const state = useTelemetryStore.getState();
    const snapshot = state.getSnapshot();
    const project = useSceneStore.getState().project;
    if (!snapshot || !project) {
      hideAll();
      return;
    }
    const ropeIndex = project.ropes.findIndex((r) => r.id === rope.id);
    if (ropeIndex < 0) {
      hideAll();
      return;
    }
    const ro = snapshotRopesOffset(Math.min(Math.round(snapshot[SNAPSHOT_INDEX.COUNT] ?? 0), snapshot.length));
    const T = snapshot[ro + ropeIndex] ?? 0;
    if (!(T > 1e-6)) {
      hideAll();
      return;
    }

    const order = state.getBodyOrder();
    const nodeWorld = (node: { anchorId: string; point: Vec3 }): Vec3 | null => {
      if (!node.anchorId) return [...node.point] as Vec3;
      const index = order.indexOf(node.anchorId);
      if (index < 0) return null;
      const o = SNAPSHOT_HEADER + index * SNAPSHOT_FLOATS_PER_BODY;
      if (o + SNAPSHOT_FLOATS_PER_BODY > snapshot.length) return null;
      const t: Vec3 = [snapshot[o + SNAPSHOT_INDEX.POS] ?? 0, snapshot[o + 1] ?? 0, snapshot[o + 2] ?? 0];
      const q: Quat = [
        snapshot[o + SNAPSHOT_INDEX.QUAT] ?? 0,
        snapshot[o + SNAPSHOT_INDEX.QUAT + 1] ?? 0,
        snapshot[o + SNAPSHOT_INDEX.QUAT + 2] ?? 0,
        snapshot[o + SNAPSHOT_INDEX.QUAT + 3] ?? 1,
      ];
      return localToWorld(node.point, t, q);
    };
    const pulleyWorld = (id: string): { center: Vec3; radius: number; axis: Vec3 } | null => {
      const index = order.indexOf(id);
      if (index < 0) return null;
      const o = SNAPSHOT_HEADER + index * SNAPSHOT_FLOATS_PER_BODY;
      if (o + SNAPSHOT_FLOATS_PER_BODY > snapshot.length) return null;
      const body = project.bodies.find((b) => b.id === id);
      const radius = (body?.geometry as { cylinder?: { R?: number } })?.cylinder?.R ?? 0.25;
      const mount = project.joints.find((j) => j.kind === "revolute" && (j.bodyA === id || j.bodyB === id));
      const axis = mount ? resolveJointAxis(mount, project.meta.mode) : ([0, 0, 1] as Vec3);
      return {
        center: [snapshot[o + SNAPSHOT_INDEX.POS] ?? 0, snapshot[o + 1] ?? 0, snapshot[o + 2] ?? 0] as Vec3,
        radius,
        axis,
      };
    };

    // Straight segments: node_i → T_in, T_out → node_{i+1} (or direct node→node).
    interface Seg { a: Vec3; b: Vec3 }
    const segs: Seg[] = [];
    const gaps = rope.path.length - 1;
    for (let i = 0; i < gaps; i++) {
      const nA = nodeWorld(rope.path[i]!);
      const nB = nodeWorld(rope.path[i + 1]!);
      if (!nA || !nB) continue;
      const pulleyId = rope.pulleys?.[i];
      const p = pulleyId ? pulleyWorld(pulleyId) : null;
      if (!p) {
        segs.push({ a: nA, b: nB });
        continue;
      }
      const geo = computePulleyWrapGeometry(nA, nB, p.center, p.radius, p.axis);
      if (!geo) {
        segs.push({ a: nA, b: nB });
        continue;
      }
      segs.push({ a: nA, b: geo.tIn });
      segs.push({ a: geo.tOut, b: nB });
    }

    segs.forEach((seg, i) => {
      const h = helpers[i];
      if (!h) return;
      const d: Vec3 = [seg.b[0] - seg.a[0], seg.b[1] - seg.a[1], seg.b[2] - seg.a[2]];
      const len = Math.hypot(d[0], d[1], d[2]);
      if (len < 1e-6) {
        h.visible = false;
        return;
      }
      const arrowLen = Math.min(MAX_ARROW_LENGTH, T * settings.scale);
      h.visible = true;
      h.position.set(seg.a[0], seg.a[1], seg.a[2]);
      h.setDirection(new THREE.Vector3(d[0] / len, d[1] / len, d[2] / len));
      h.setLength(arrowLen, Math.min(0.3, arrowLen * 0.3), Math.min(0.14, arrowLen * 0.12));
    });
    for (let i = segs.length; i < helpers.length; i++) helpers[i]!.visible = false;
  });

  return <group ref={groupRef} />;
}
