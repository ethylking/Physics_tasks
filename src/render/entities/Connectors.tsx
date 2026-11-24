// render/entities/Connectors.tsx — Milestone 5: live joints, springs and ropes.
//
// These primitives render identically in the 2D and 3D viewports. While a
// simulation session is live (running OR paused), every anchor is resolved
// against the latest worker snapshot inside `useFrame` — the meshes are owned
// imperatively and never re-render per physics frame (§5.2).
//
//   Joints    pin/hinge/slider/weld gizmos at the live anchor positions.
//   Springs   procedural helical coil stretching dynamically between r_A, r_B.
//   Ropes     dynamic tube tracking live wrap-anchors over pulley rims
//             (massless) or chain segment transforms (chain).

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import type {
  ForceEntity as ForceEntityType,
  JointEntity as JointEntityType,
  MechProject,
  MeterEntity as MeterEntityType,
  Quat,
  RigidBodyEntity,
  RopeEntity as RopeEntityType,
  Vec3,
} from "../../core/types";
import { useSceneStore } from "../../stores/sceneStore";
import { useTelemetryStore, type TelemetryStatus } from "../../stores/telemetryStore";
import { localToWorld } from "../../math/rotation";
import { SNAPSHOT_FLOATS_PER_BODY, SNAPSHOT_HEADER, SNAPSHOT_INDEX } from "../../physics/snapshot";
import { resolveJointAxis } from "../../physics/joints";
import {
  chainSegmentCount,
  chainRopeBuildsSegments,
  computePulleyWrapGeometry,
  samplePulleyArc,
} from "../../physics/ropes";
import { ArrowMesh } from "./shared";
import { EntityAnchor, SelectionProxy } from "./EntityGroup";
import { entityWorldPosition } from "./positions";

const FALLBACK: Vec3 = [0, 0, 0];

function useBodies(): RigidBodyEntity[] {
  return useSceneStore((s) => s.project?.bodies ?? []);
}

// -----------------------------------------------------------------------------
// Live transform plumbing
// -----------------------------------------------------------------------------

/** Resolve a body's current world transform (snapshot while simulated). */
function liveTransform(
  bodyId: string | null | undefined,
  project: MechProject,
  snapshot: Float32Array | null,
  order: string[],
  status: TelemetryStatus,
): { position: Vec3; rotation: Quat } | null {
  const body = bodyId ? project.bodies.find((b) => b.id === bodyId) : null;
  if (!body) return null;
  if (status !== "idle" && snapshot) {
    const i = order.indexOf(body.id);
    if (i >= 0) {
      const o = SNAPSHOT_HEADER + i * SNAPSHOT_FLOATS_PER_BODY;
      if (o + SNAPSHOT_FLOATS_PER_BODY <= snapshot.length) {
        return {
          position: [snapshot[o + SNAPSHOT_INDEX.POS] ?? 0, snapshot[o + 1] ?? 0, snapshot[o + 2] ?? 0],
          rotation: [snapshot[o + SNAPSHOT_INDEX.QUAT] ?? 0, snapshot[o + SNAPSHOT_INDEX.QUAT + 1] ?? 0, snapshot[o + SNAPSHOT_INDEX.QUAT + 2] ?? 0, snapshot[o + SNAPSHOT_INDEX.QUAT + 3] ?? 1],
        };
      }
    }
  }
  return { position: body.initial.position, rotation: body.initial.rotation };
}

/** World position of an anchor (local coords when owned by a body). */
function anchorWorldLive(
  anchor: Vec3 | undefined,
  bodyId: string | null | undefined,
  project: MechProject,
  snapshot: Float32Array | null,
  order: string[],
  status: TelemetryStatus,
): Vec3 | null {
  if (!anchor) return null;
  if (!bodyId) return [...anchor] as Vec3;
  const t = liveTransform(bodyId, project, snapshot, order, status);
  if (!t) return null;
  return localToWorld(anchor, t.position, t.rotation);
}

// -----------------------------------------------------------------------------
// Dynamic tube helper (rope/spring coil polyline)
// -----------------------------------------------------------------------------

const TUBE_RADIAL = 8;

/** A THREE tube mesh whose polyline is updated imperatively (rebuilt on change). */
function useDynamicTube(radius: number, color: string) {
  const lastKey = useRef<string>("");

  const mesh = useMemo(() => {
    const geo = new THREE.TubeGeometry(
      new THREE.LineCurve3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0.01, 0)),
      2,
      radius,
      TUBE_RADIAL,
    );
    const material = new THREE.MeshBasicMaterial({ color });
    const m = new THREE.Mesh(geo, material);
    m.visible = false;
    m.frustumCulled = false;
    return m;
  }, [radius, color]);

  const setPoints = (points: Vec3[]): void => {
    if (points.length < 2) {
      mesh.visible = false;
      return;
    }
    const key = points.map((p) => `${p[0].toFixed(4)},${p[1].toFixed(4)},${p[2].toFixed(4)}`).join(";");
    if (key === lastKey.current) return;
    lastKey.current = key;
    mesh.geometry.dispose();
    const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(p[0], p[1], p[2])));
    mesh.geometry = new THREE.TubeGeometry(curve, Math.max(16, points.length * 12), radius, TUBE_RADIAL);
    mesh.visible = true;
  };

  useEffect(() => {
    return () => {
      mesh.geometry.dispose();
      lastKey.current = "";
    };
  }, [mesh]);

  const element = useMemo(() => <primitive object={mesh} />, [mesh]);
  return { element, setPoints };
}
// -----------------------------------------------------------------------------
// Joints
// -----------------------------------------------------------------------------

const JOINT_COLOR = "#f59e0b";

function useJointAnchors(joint: JointEntityType): () => { a: Vec3; b: Vec3; axis: Vec3 } {
  return () => {
    const project = useSceneStore.getState().project;
    if (!project) return { a: FALLBACK, b: FALLBACK, axis: [0, 0, 1] };
    const state = useTelemetryStore.getState();
    const snapshot = state.getSnapshot();
    const order = state.getBodyOrder();
    const a = anchorWorldLive(joint.anchors.a, joint.bodyA, project, snapshot, order, state.status) ?? FALLBACK;
    const b = anchorWorldLive(joint.anchors.b, joint.bodyB, project, snapshot, order, state.status) ?? a;
    return { a, b, axis: resolveJointAxis(joint, project.meta.mode) };
  };
}

export function JointEntity({ joint }: { joint: JointEntityType }) {
  const groupRef = useRef<THREE.Group>(null);
  const partsRef = useRef<{
    pinA?: THREE.Mesh;
    pinB?: THREE.Mesh;
    link?: THREE.Mesh;
    axisCyl?: THREE.Mesh;
    ring?: THREE.Mesh;
    slider?: THREE.Mesh;
    headA?: THREE.Mesh;
    headB?: THREE.Mesh;
  }>({});
  const getAnchors = useJointAnchors(joint);
  const project = useSceneStore((s) => s.project);
  const anchorPosition = useMemo(
    () => (project ? entityWorldPosition(project, "joints", joint) : FALLBACK),
    [project, joint],
  );

  useEffect(() => {
    const group = groupRef.current;
    if (!group) return;
    const mat = new THREE.MeshBasicMaterial({ color: JOINT_COLOR });
    const pin = (r: number) => {
      const m = new THREE.Mesh(new THREE.SphereGeometry(r, 14, 10), mat);
      group.add(m);
      return m;
    };
    const mk = (geo: THREE.BufferGeometry, r = 0.015) => {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: JOINT_COLOR }));
      group.add(m);
      void r;
      return m;
    };
    partsRef.current = {
      pinA: pin(0.055),
      pinB: pin(0.055),
    };
    if (joint.kind === "revolute") {
      partsRef.current.ring = mk(new THREE.TorusGeometry(0.09, 0.012, 8, 28));
      partsRef.current.axisCyl = mk(new THREE.CylinderGeometry(0.015, 0.015, 0.6, 10));
    } else if (joint.kind === "prismatic") {
      partsRef.current.slider = mk(new THREE.BoxGeometry(0.16, 0.16, 0.16));
      partsRef.current.headA = mk(new THREE.ConeGeometry(0.045, 0.12, 12));
      partsRef.current.headB = mk(new THREE.ConeGeometry(0.045, 0.12, 12));
    } else if (joint.kind === "fixed") {
      partsRef.current.slider = mk(new THREE.OctahedronGeometry(0.07));
    } else {
      // spherical: ball-socket ring.
      partsRef.current.ring = mk(new THREE.TorusGeometry(0.09, 0.012, 8, 28));
    }
    partsRef.current.link = mk(new THREE.CylinderGeometry(0.012, 0.012, 1, 8));
    return () => {
      group.clear();
      partsRef.current = {};
    };
  }, [joint.id, joint.kind]);

  useFrame(() => {
    const group = groupRef.current;
    const parts = partsRef.current;
    if (!group || !parts.pinA) return;
    const { a, b, axis } = getAnchors();
    parts.pinA.position.set(a[0], a[1], a[2]);
    parts.pinB?.position.set(b[0], b[1], b[2]);

    // Link between the two anchors when they differ.
    const dist = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    if (parts.link) {
      if (dist > 1e-4) {
        parts.link.visible = true;
        parts.link.position.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
        parts.link.scale.set(1, Math.max(0.2, dist), 1);
        parts.link.quaternion.setFromUnitVectors(
          new THREE.Vector3(0, 1, 0),
          new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize(),
        );
      } else {
        parts.link.visible = false;
      }
    }

    const quatFromAxis = (ax: Vec3): THREE.Quaternion =>
      new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(ax[0], ax[1], ax[2]).normalize());

    if (joint.kind === "revolute") {
      if (parts.ring) {
        parts.ring.position.set(a[0], a[1], a[2]);
        parts.ring.quaternion.copy(quatFromAxis(axis));
      }
      if (parts.axisCyl) {
        parts.axisCyl.position.set(a[0] + axis[0] * 0.28, a[1] + axis[1] * 0.28, a[2] + axis[2] * 0.28);
        parts.axisCyl.quaternion.copy(quatFromAxis(axis));
      }
    } else if (joint.kind === "prismatic") {
      if (parts.slider) {
        parts.slider.position.set(b[0], b[1], b[2]);
        parts.slider.quaternion.copy(quatFromAxis(axis));
      }
      const placeHead = (head: THREE.Mesh | undefined, base: Vec3, dir: Vec3) => {
        if (!head) return;
        head.position.set(base[0] + dir[0] * 0.16, base[1] + dir[1] * 0.16, base[2] + dir[2] * 0.16);
        head.quaternion.copy(new THREE.Quaternion().setFromUnitVectors(
          new THREE.Vector3(0, 1, 0),
          new THREE.Vector3(dir[0], dir[1], dir[2]).normalize(),
        ));
      };
      placeHead(parts.headA, a, axis);
      placeHead(parts.headB, b, [-axis[0], -axis[1], -axis[2]]);
    } else if (joint.kind === "fixed") {
      parts.slider?.position.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
    } else if (parts.ring) {
      // spherical: ring around the socket.
      parts.ring.position.set(a[0], a[1], a[2]);
      parts.ring.quaternion.copy(quatFromAxis(axis));
    }
  });

  return (
    <>
      <group ref={groupRef} />
      <SelectionProxy id={joint.id} position={anchorPosition} />
      <EntityAnchor id={joint.id} position={anchorPosition} />
    </>
  );
}

// -----------------------------------------------------------------------------
// Forces (arrows & live springs)
// -----------------------------------------------------------------------------

function HelixCurve(start: THREE.Vector3, dir: THREE.Vector3, length: number): THREE.Curve<THREE.Vector3> {
  const COILS = 8;
  const RADIUS = 0.08;
  class SpringCurve extends THREE.Curve<THREE.Vector3> {
    constructor(
      private readonly s: THREE.Vector3,
      private readonly d: THREE.Vector3,
      private readonly len: number,
    ) {
      super();
    }
    getPoint(t: number, target: THREE.Vector3 = new THREE.Vector3()): THREE.Vector3 {
      const angle = t * Math.PI * 2 * COILS;
      // Z-up: use +Z as the stable reference unless the helix is vertical.
      const up = Math.abs(this.d.z) < 0.99 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
      const u = new THREE.Vector3().crossVectors(this.d, up).normalize();
      const v = new THREE.Vector3().crossVectors(u, this.d).normalize();
      return target
        .copy(this.s)
        .addScaledVector(this.d, t * this.len)
        .addScaledVector(u, Math.cos(angle) * RADIUS)
        .addScaledVector(v, Math.sin(angle) * RADIUS);
    }
  }
  return new SpringCurve(start, dir, length);
}

export function ForceEntity({ force }: { force: ForceEntityType }) {
  const bodies = useBodies();
  const project = useSceneStore((s) => s.project);
  const color = force.appearance?.color ?? "#ef4444";
  const anchorPosition = useMemo(
    () => (project ? entityWorldPosition(project, "forces", force) : FALLBACK),
    [project, force],
  );

  if (force.kind === "spring" && force.spring) {
    return <LiveSpring force={force} color={color} />;
  }

  // Static arrow preview (the live applied vector is drawn by the overlay).
  const base: Vec3 = (() => {
    if (!force.body) return force.anchor ?? FALLBACK;
    const body = bodies.find((b) => b.id === force.body);
    return body && force.anchor ? localToWorld(force.anchor, body.initial.position, body.initial.rotation) : force.anchor ?? FALLBACK;
  })();
  const scale = force.appearance?.scale ?? 1;
  return (
    <>
      <group>
        <ArrowMesh position={base} color={color} length={1 * scale} />
        <mesh position={base}>
          <sphereGeometry args={[0.04, 12, 8]} />
          <meshBasicMaterial color={color} />
        </mesh>
      </group>
      <SelectionProxy id={force.id} position={anchorPosition} />
      <EntityAnchor id={force.id} position={anchorPosition} />
    </>
  );
}

function LiveSpring({ force, color }: { force: ForceEntityType; color: string }) {
  const meshRef = useRef<THREE.Mesh | null>(null);
  const lastKey = useRef<string>("");
  const pinARef = useRef<THREE.Mesh | null>(null);
  const pinBRef = useRef<THREE.Mesh | null>(null);
  const project = useSceneStore((s) => s.project);
  const anchorPosition = useMemo(
    () => (project ? entityWorldPosition(project, "forces", force) : FALLBACK),
    [project, force],
  );

  const spring = force.spring!;

  const geometry = useMemo(
    () => new THREE.TubeGeometry(HelixCurve(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1, 0), 1), 160, 0.015, 8),
    [],
  );

  useEffect(() => {
    const mesh = meshRef.current;
    return () => {
      mesh?.geometry.dispose();
    };
  }, []);

  useFrame(() => {
    const mesh = meshRef.current;
    const pinA = pinARef.current;
    const pinB = pinBRef.current;
    const project = useSceneStore.getState().project;
    if (!mesh || !project) return;
    const state = useTelemetryStore.getState();
    const snapshot = state.getSnapshot();
    const order = state.getBodyOrder();
    const a = anchorWorldLive(force.anchor, force.body, project, snapshot, order, state.status);
    const b = anchorWorldLive(spring.anchorBPoint, spring.anchorB || null, project, snapshot, order, state.status);
    if (!a || !b) {
      mesh.visible = false;
      return;
    }
    const start = new THREE.Vector3(a[0], a[1], a[2]);
    const end = new THREE.Vector3(b[0], b[1], b[2]);
    const len = start.distanceTo(end);
    const key = `${len.toFixed(4)}:${a[0].toFixed(4)},${a[1].toFixed(4)},${a[2].toFixed(4)}:${b[0].toFixed(4)},${b[1].toFixed(4)},${b[2].toFixed(4)}`;
    if (key === lastKey.current && mesh.visible) return;
    lastKey.current = key;
    mesh.visible = true;
    if (len > 1e-4) {
      const dir = end.clone().sub(start).normalize();
      mesh.geometry.dispose();
      mesh.geometry = new THREE.TubeGeometry(HelixCurve(start, dir, len), 160, 0.015, 8);
      pinA?.position.copy(start);
      pinB?.position.copy(end);
    }
  });

  return (
    <>
      <group>
        <mesh ref={meshRef} geometry={geometry} visible={false}>
          <meshBasicMaterial color={color} />
        </mesh>
        <mesh ref={pinARef}>
          <sphereGeometry args={[0.05, 14, 10]} />
          <meshBasicMaterial color={color} />
        </mesh>
        <mesh ref={pinBRef}>
          <sphereGeometry args={[0.05, 14, 10]} />
          <meshBasicMaterial color={color} />
        </mesh>
      </group>
      <SelectionProxy id={force.id} position={anchorPosition} />
      <EntityAnchor id={force.id} position={anchorPosition} />
    </>
  );
}

// -----------------------------------------------------------------------------
// Ropes (massless + chain)
// -----------------------------------------------------------------------------

/** Segment snapshot base index of a chain rope (deterministic with the engine). */
function chainBaseIndex(ropeId: string, project: MechProject): number {
  let base = project.bodies.length;
  for (const r of project.ropes) {
    if (r.id === ropeId) break;
    if (chainRopeBuildsSegments(r, project)) base += chainSegmentCount(r);
  }
  return base;
}

function useRopePathState(rope: RopeEntityType): () => { points: Vec3[] } {
  return () => {
    const project = useSceneStore.getState().project;
    if (!project) return { points: [] };
    const state = useTelemetryStore.getState();
    const snapshot = state.getSnapshot();
    const order = state.getBodyOrder();

    if (rope.model === "chain") {
      const base = chainBaseIndex(rope.id, project);
      const n = chainSegmentCount(rope);
      const pts: Vec3[] = [];
      if (!snapshot) return { points: [] };
      for (let i = 0; i < n; i++) {
        const o = SNAPSHOT_HEADER + (base + i) * SNAPSHOT_FLOATS_PER_BODY;
        if (o + 3 > snapshot.length) break;
        pts.push([snapshot[o + SNAPSHOT_INDEX.POS] ?? 0, snapshot[o + 1] ?? 0, snapshot[o + 2] ?? 0] as Vec3);
      }
      return { points: pts };
    }

    // Massless: live nodes + wrap tangents + arcs.
    const pts: Vec3[] = [];
    const gaps = rope.path.length - 1;
    for (let i = 0; i < rope.path.length; i++) {
      const node = rope.path[i]!;
      const w = anchorWorldLive(node.point, node.anchorId || null, project, snapshot, order, state.status);
      if (!w) continue;
      if (i > 0) {
        const pulleyId = rope.pulleys?.[i - 1];
        if (pulleyId) {
          const pulley = project.bodies.find((b) => b.id === pulleyId);
          const prev = pts.length > 0 ? pts[pts.length - 1]! : w;
          const pulleyState = liveTransform(pulleyId, project, snapshot, order, state.status);
          const radius = (pulley?.geometry as { cylinder?: { R?: number } })?.cylinder?.R ?? 0.25;
          if (pulleyState) {
            const center = pulleyState.position;
            const mount = project.joints.find(
              (j) => j.kind === "revolute" && (j.bodyA === pulleyId || j.bodyB === pulleyId),
            );
            const axis = mount
              ? resolveJointAxis(mount, project.meta.mode)
              : project.meta.mode === "2D"
                ? ([0, 1, 0] as Vec3)
                : ([0, 0, 1] as Vec3);
            const geo = computePulleyWrapGeometry(prev, w, center, radius, axis);
            if (geo) {
              pts.push(geo.tIn);
              pts.push(...samplePulleyArc(geo.tIn, center, axis, geo.arcAngle, 14).slice(1, -1));
              pts.push(geo.tOut);
            }
          }
        }
      }
      if (i === 0 || pts[pts.length - 1]![0] !== w[0] || pts[pts.length - 1]![1] !== w[1] || pts[pts.length - 1]![2] !== w[2]) {
        pts.push(w);
      }
    }
    void gaps;
    return { points: pts };
  };
}

export function RopeEntity({ rope }: { rope: RopeEntityType }) {
  const radius = rope.appearance?.thickness ?? 0.02;
  const color = rope.appearance?.color ?? "#e4e4e7";
  const { element, setPoints } = useDynamicTube(Math.max(0.004, radius * 0.8), color);
  const getPath = useRopePathState(rope);
  const project = useSceneStore((s) => s.project);
  const anchorPosition = useMemo(
    () => (project ? entityWorldPosition(project, "ropes", rope) : FALLBACK),
    [project, rope],
  );

  // Edit-time fallback (idle): static path from initial poses.
  const bodies = useBodies();
  const editPoints = useMemo(() => {
    const pts: Vec3[] = [];
    for (const entry of rope.path) {
      if (entry.anchorId) {
        const body = bodies.find((b) => b.id === entry.anchorId);
        if (body) pts.push(localToWorld(entry.point, body.initial.position, body.initial.rotation));
        else pts.push(entry.point);
      } else {
        pts.push(entry.point);
      }
    }
    return pts;
  }, [rope.path, bodies]);

  useFrame(() => {
    const state = useTelemetryStore.getState();
    if (state.status === "idle") {
      setPoints(editPoints);
      return;
    }
    const { points } = getPath();
    setPoints(points.length >= 2 ? points : editPoints);
  });

  return (
    <>
      <group>{element}</group>
      <SelectionProxy id={rope.id} position={anchorPosition} />
      <EntityAnchor id={rope.id} position={anchorPosition} />
    </>
  );
}

// -----------------------------------------------------------------------------
// Meters
// -----------------------------------------------------------------------------

export function MeterEntity({ meter }: { meter: MeterEntityType }) {
  const bodies = useBodies();
  const project = useSceneStore((s) => s.project);
  const anchorPosition = useMemo(
    () => (project ? entityWorldPosition(project, "meters", meter) : FALLBACK),
    [project, meter],
  );
  const target = meter.target ? bodies.find((b) => b.id === meter.target) : undefined;
  const position: Vec3 = meter.position ?? (target ? target.initial.position : [0, 0, 0]);
  return (
    <>
      <group>
        <mesh position={position}>
          <octahedronGeometry args={[0.12, 0]} />
          <meshBasicMaterial color="#34d399" />
        </mesh>
      </group>
      <SelectionProxy id={meter.id} position={anchorPosition} />
      <EntityAnchor id={meter.id} position={anchorPosition} />
    </>
  );
}
