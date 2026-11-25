// render/Canvas2D.tsx — orthographic X–Z viewport (MapControls, rotation locked)
// enforcing §4.5 planar mechanics with Z up.

import { Canvas } from "@react-three/fiber";
import { Grid, MapControls } from "@react-three/drei";
import * as THREE from "three";
import { useSceneStore, findEntityInProject } from "../stores/sceneStore";
import { useTelemetryStore } from "../stores/telemetryStore";
import type { RigidBodyEntity } from "../core/types";
import { useCanvasKeyboard } from "./hooks";
import { BodyEntity2D, StaticEntity2D } from "./entities/2d/FlatBodies";
import { JointEntity, ForceEntity, RopeEntity, MeterEntity } from "./entities/Connectors";
import { TransformGizmo } from "./gizmos/TransformGizmo";
import { AxisArrows } from "./gizmos/AxisArrows";
import { CoMMarkers } from "./gizmos/CoMMarkers";
import { SpawnController } from "./SpawnController";
import { PhysicsDriver } from "./PhysicsDriver";
import { VectorOverlays } from "./overlays/VectorOverlays";

// Sentinel understood by MapControls as "no camera action for this button".
const CAMERA_BUTTON_NONE = -1 as unknown as THREE.MOUSE;

function SceneContents2D() {
  const project = useSceneStore((s) => s.project);
  if (!project) return null;
  return (
    <>
      {project.statics.map((s) => (
        <StaticEntity2D key={s.id} stat={s} />
      ))}
      {project.bodies.map((b) => (
        <BodyEntity2D key={b.id} body={b} />
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

export default function Canvas2D() {
  useCanvasKeyboard();

  const tool = useSceneStore((s) => s.tool);
  const gizmoMode = useSceneStore((s) => s.gizmoMode);
  const simRunning = useTelemetryStore((s) => s.status === "running");
  // Select stable store slices and resolve the entity in render (see Canvas3D).
  const project = useSceneStore((s) => s.project);
  const selectedId = useSceneStore((s) => s.selectedId);
  const selected = findEntityInProject(project, selectedId);
  const selectedBody = selected && selected.category === "bodies" ? (selected.entity as RigidBodyEntity) : null;
  // In translate mode the axis arrows (vertical Z repositioning) and the
  // X–Z transform gizmo coexist around the selected entity. The arrows show
  // on every selection while translate mode is active.
  const axisArrowsId = useSceneStore((s) => s.axisArrowsId);
  const axisArrowRef = findEntityInProject(project, axisArrowsId);
  // Left-drag is reserved for the object gizmo while it is shown; pan moves to
  // the middle button. Right-drag never moves the camera in 2D (rotation is
  // locked by design), so the gizmo drag can never shift the view.
  const gizmoActive = selected !== null && !simRunning;

  return (
    <Canvas
      orthographic
      dpr={[1, 2]}
      camera={{ position: [0, -20, 0], up: [0, 0, 1], zoom: 60, near: -100, far: 200 }}
      gl={{ antialias: true }}
      onPointerMissed={() => {
        const scene = useSceneStore.getState();
        if (!scene.tool) scene.setSelected(null);
      }}
    >
      <color attach="background" args={["#0b0b10"]} />
      {/* MapControls: pan & zoom only — rotation strictly locked (§4.5). */}
      <MapControls
        makeDefault
        enableRotate={false}
        screenSpacePanning
        mouseButtons={
          gizmoActive
            ? { LEFT: CAMERA_BUTTON_NONE, MIDDLE: THREE.MOUSE.PAN, RIGHT: CAMERA_BUTTON_NONE }
            : { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: CAMERA_BUTTON_NONE }
        }
      />
      <Grid
        position={[0, 0.02, 0]}
        args={[40, 40]}
        cellSize={0.5}
        cellThickness={0.6}
        cellColor="#3f3f46"
        sectionSize={2.5}
        sectionThickness={1}
        sectionColor="#52525b"
        fadeDistance={70}
        fadeStrength={1}
        side={THREE.DoubleSide}
        infiniteGrid
      />
      <axesHelper args={[1]} />
      <SceneContents2D />
      <VectorOverlays />
      {axisArrowRef && !simRunning && gizmoMode === "translate" && (
        <AxisArrows entity={axisArrowRef.entity} category={axisArrowRef.category} flat />
      )}
      {selected && !simRunning && (
        <TransformGizmo
          entityId={selected.entity.id}
          is2d
          mode={selected.category === "bodies" || selected.category === "statics" ? gizmoMode : "translate"}
          translateAxes="xz"
        />
      )}
      {selectedBody && <CoMMarkers body={selectedBody} flat />}
      {tool && !simRunning && <SpawnController tool={tool} flat />}
      <PhysicsDriver />
    </Canvas>
  );
}
