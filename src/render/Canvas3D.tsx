// render/Canvas3D.tsx — perspective viewport (OrbitControls, grid, axes).

import { Canvas } from "@react-three/fiber";
import { Grid, OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { useSceneStore, findEntityInProject } from "../stores/sceneStore";
import { useTelemetryStore } from "../stores/telemetryStore";
import type { RigidBodyEntity } from "../core/types";
import { useCanvasKeyboard } from "./hooks";
import { BodyEntity } from "./entities/BodyEntity";
import { StaticEntity } from "./entities/StaticEntity";
import { JointEntity, ForceEntity, RopeEntity, MeterEntity } from "./entities/Connectors";
import { TransformGizmo } from "./gizmos/TransformGizmo";
import { AxisArrows } from "./gizmos/AxisArrows";
import { CoMMarkers } from "./gizmos/CoMMarkers";
import { SpawnController } from "./SpawnController";
import { PhysicsDriver } from "./PhysicsDriver";
import { VectorOverlays } from "./overlays/VectorOverlays";

// Sentinel understood by OrbitControls as "no camera action for this button".
const CAMERA_BUTTON_NONE = -1 as unknown as THREE.MOUSE;

function SceneContents() {
  const project = useSceneStore((s) => s.project);
  if (!project) return null;
  return (
    <>
      {project.statics.map((s) => (
        <StaticEntity key={s.id} stat={s} />
      ))}
      {project.bodies.map((b) => (
        <BodyEntity key={b.id} body={b} />
      ))}
      {project.joints.map((j) => (
        <JointEntity key={j.id} joint={j} />
      ))}
      {project.forces.map((f) => (
        <ForceEntity key={f.id} force={f} />
      ))}
      {project.ropes.map((r) => (
        <RopeEntity key={r.id} rope={r} />
      ))}
      {project.meters.map((m) => (
        <MeterEntity key={m.id} meter={m} />
      ))}
    </>
  );
}

export default function Canvas3D() {
  useCanvasKeyboard();

  const tool = useSceneStore((s) => s.tool);
  const gizmoMode = useSceneStore((s) => s.gizmoMode);
  const simRunning = useTelemetryStore((s) => s.status === "running");
  const simIdle = useTelemetryStore((s) => s.status === "idle");
  // Select stable store slices and resolve the entity in render — returning a
  // fresh `{ category, entity, index }` object from a Zustand v5 selector makes
  // `useSyncExternalStore` loop forever (blank app) as soon as anything is selected.
  const project = useSceneStore((s) => s.project);
  const selectedId = useSceneStore((s) => s.selectedId);
  const selected = findEntityInProject(project, selectedId);
  const selectedBody = selected && selected.category === "bodies" ? (selected.entity as RigidBodyEntity) : null;
  // The freshly spawned entity shows the post-creation axis arrows instead of
  // the regular transform gizmo.
  const axisArrowsId = useSceneStore((s) => s.axisArrowsId);
  const axisArrowRef = findEntityInProject(project, axisArrowsId);
  // While the transform gizmo is visible, left-drag belongs to the selected
  // object. Camera orbit is available on the right button only; panning moves
  // to the middle button so a right-drag can never translate the camera.
  const gizmoActive = selected !== null && !simRunning;

  return (
    <Canvas
      shadows
      dpr={[1, 2]}
      camera={{ position: [9, -9, 7], up: [0, 0, 1], fov: 50, near: 0.1, far: 500 }}
      gl={{ antialias: true }}
      onPointerMissed={() => {
        // Clicking empty space clears the selection (but not while placing).
        const scene = useSceneStore.getState();
        if (!scene.tool) scene.setSelected(null);
      }}
    >
      <color attach="background" args={["#0b0b10"]} />
      <ambientLight intensity={0.7} />
      <directionalLight
        position={[12, -8, 18]}
        intensity={1.1}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-left={-30}
        shadow-camera-right={30}
        shadow-camera-top={30}
        shadow-camera-bottom={-30}
      />
      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.08}
        target={[0, 0, 0.5]}
        maxPolarAngle={Math.PI / 2 - 0.03}
        mouseButtons={
          gizmoActive
            ? { LEFT: CAMERA_BUTTON_NONE, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE }
            : { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE }
        }
      />
      <Grid
        position={[0, 0, 0]}
        rotation={[Math.PI / 2, 0, 0]}
        args={[40, 40]}
        cellSize={0.5}
        cellThickness={0.6}
        cellColor="#3f3f46"
        sectionSize={2.5}
        sectionThickness={1}
        sectionColor="#52525b"
        fadeDistance={70}
        fadeStrength={1}
        infiniteGrid
      />
      <axesHelper args={[1.4]} />
      <SceneContents />
      <VectorOverlays />
      {axisArrowRef && simIdle && (
        <AxisArrows entity={axisArrowRef.entity} category={axisArrowRef.category} flat={false} />
      )}
      {selected && !axisArrowRef && !simRunning && (
        <TransformGizmo
          entityId={selected.entity.id}
          is2d={false}
          mode={selected.category === "bodies" ? gizmoMode : "translate"}
        />
      )}
      {selectedBody && <CoMMarkers body={selectedBody} />}
      {tool && !simRunning && <SpawnController tool={tool} flat={false} />}
      <PhysicsDriver />
    </Canvas>
  );
}
