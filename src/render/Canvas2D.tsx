// render/Canvas2D.tsx — orthographic XY viewport (MapControls, rotation locked)
// enforcing §4.5 planar mechanics.

import { Canvas } from "@react-three/fiber";
import { Grid, MapControls } from "@react-three/drei";
import { useSceneStore, findEntityInProject } from "../stores/sceneStore";
import { useTelemetryStore } from "../stores/telemetryStore";
import type { RigidBodyEntity } from "../core/types";
import { useCanvasKeyboard } from "./hooks";
import { BodyEntity2D, StaticEntity2D } from "./entities/2d/FlatBodies";
import { JointEntity, ForceEntity, RopeEntity, MeterEntity } from "./entities/Connectors";
import { TransformGizmo } from "./gizmos/TransformGizmo";
import { CoMMarkers } from "./gizmos/CoMMarkers";
import { SpawnController } from "./SpawnController";
import { PhysicsDriver } from "./PhysicsDriver";
import { VectorOverlays } from "./overlays/VectorOverlays";

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
  const selectedBody = useSceneStore((s) => {
    const found = findEntityInProject(s.project, s.selectedId);
    return found && found.category === "bodies" ? (found.entity as RigidBodyEntity) : null;
  });

  return (
    <Canvas
      orthographic
      dpr={[1, 2]}
      camera={{ position: [0, 0, 20], zoom: 60, near: -100, far: 200 }}
      gl={{ antialias: true }}
    >
      <color attach="background" args={["#0b0b10"]} />
      {/* MapControls: pan & zoom only — rotation strictly locked (§4.5). */}
      <MapControls makeDefault enableRotate={false} screenSpacePanning />
      <Grid
        position={[0, 0, -0.02]}
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
      <axesHelper args={[1]} />
      <SceneContents2D />
      <VectorOverlays />
      {selectedBody && !simRunning && <TransformGizmo bodyId={selectedBody.id} is2d mode={gizmoMode} />}
      {selectedBody && <CoMMarkers body={selectedBody} flat />}
      {tool && !simRunning && <SpawnController tool={tool} flat />}
      <PhysicsDriver />
    </Canvas>
  );
}
