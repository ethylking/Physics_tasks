// render/Canvas3D.tsx — perspective viewport (OrbitControls, grid, axes).

import { Canvas } from "@react-three/fiber";
import { Grid, OrbitControls } from "@react-three/drei";
import { useSceneStore, findEntityInProject } from "../stores/sceneStore";
import { useTelemetryStore } from "../stores/telemetryStore";
import type { RigidBodyEntity } from "../core/types";
import { useCanvasKeyboard } from "./hooks";
import { BodyEntity } from "./entities/BodyEntity";
import { StaticEntity } from "./entities/StaticEntity";
import { JointEntity, ForceEntity, RopeEntity, MeterEntity } from "./entities/Connectors";
import { TransformGizmo } from "./gizmos/TransformGizmo";
import { CoMMarkers } from "./gizmos/CoMMarkers";
import { SpawnController } from "./SpawnController";
import { PhysicsDriver } from "./PhysicsDriver";
import { VectorOverlays } from "./overlays/VectorOverlays";

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
  const selectedBody = useSceneStore((s) => {
    const found = findEntityInProject(s.project, s.selectedId);
    return found && found.category === "bodies" ? (found.entity as RigidBodyEntity) : null;
  });

  return (
    <Canvas
      shadows
      dpr={[1, 2]}
      camera={{ position: [8, 6, 10], fov: 50, near: 0.1, far: 500 }}
      gl={{ antialias: true }}
    >
      <color attach="background" args={["#0b0b10"]} />
      <ambientLight intensity={0.7} />
      <directionalLight
        position={[12, 18, 8]}
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
        target={[0, 1, 0]}
        maxPolarAngle={Math.PI / 2 - 0.03}
      />
      <Grid
        position={[0, 0, 0]}
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
      {selectedBody && !simRunning && <TransformGizmo bodyId={selectedBody.id} is2d={false} mode={gizmoMode} />}
      {selectedBody && <CoMMarkers body={selectedBody} />}
      {tool && !simRunning && <SpawnController tool={tool} flat={false} />}
      <PhysicsDriver />
    </Canvas>
  );
}
