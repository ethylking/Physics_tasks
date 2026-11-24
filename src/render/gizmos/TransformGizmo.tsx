// render/gizmos/TransformGizmo.tsx — translate/rotate handles attached to the
// selected body. 2D mode restricts translation to XY and rotation to the Z ring
// (§4.5). Live transforms are written back into the scene store on every
// `objectChange`.

import { useEffect, useMemo } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { TransformControls } from "three-stdlib";
import type { Object3D } from "three";
import type { Quat, Vec3 } from "../../core/types";
import { useSceneStore } from "../../stores/sceneStore";
import { entityObjectRegistry } from "../registry";

interface TransformGizmoProps {
  bodyId: string;
  is2d: boolean;
  mode: "translate" | "rotate";
}

// three-stdlib's .d.ts hides `showX/showY/showZ` (they are plain public
// properties at runtime) and does not type the "objectChange" event, so we
// declare the small surface we actually use.
interface GizmoControls {
  showX: boolean;
  showY: boolean;
  showZ: boolean;
  attach: (object: Object3D) => void;
  detach: () => void;
  setSpace: (space: "world" | "local") => void;
  setMode: (mode: "translate" | "rotate") => void;
  update: () => void;
  addEventListener: (type: string, listener: EventListener) => void;
  removeEventListener: (type: string, listener: EventListener) => void;
}

export function TransformGizmo({ bodyId, is2d, mode }: TransformGizmoProps) {
  const { camera, gl } = useThree();
  const writeTransform = useSceneStore((s) => s.writeTransform);

  const controls = useMemo(() => {
    const c = new TransformControls(camera, gl.domElement) as unknown as GizmoControls;
    c.setSpace("world");
    c.setMode(mode);
    if (is2d) {
      c.showZ = false;
      if (mode === "rotate") {
        // Only the Z rotation ring remains visible in 2D.
        c.showX = false;
        c.showY = false;
      }
    } else {
      c.showX = true;
      c.showY = true;
      c.showZ = true;
    }
    return c;
  }, [camera, gl, is2d, mode]);

  useEffect(() => {
    const object = entityObjectRegistry.get(bodyId);
    if (!object) return;
    controls.attach(object);
    const onChange = () => {
      const position = object.position.toArray() as Vec3;
      const q = object.quaternion;
      const rotation: Quat = [q.x, q.y, q.z, q.w];
      writeTransform(bodyId, position, rotation);
    };
    controls.addEventListener("objectChange", onChange);
    return () => {
      controls.removeEventListener("objectChange", onChange);
      controls.detach();
    };
  }, [controls, bodyId, writeTransform]);

  useFrame(() => controls.update());

  return <primitive object={controls as unknown as Object3D} />;
}
