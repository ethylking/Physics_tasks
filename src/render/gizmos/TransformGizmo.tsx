// render/gizmos/TransformGizmo.tsx — translate/rotate handles attached to the
// selected entity. 2D mode restricts translation to X–Z and rotation to the Y
// ring (§4.5). Live transforms are written back into the scene store on every
// `objectChange`.

import { useEffect, useMemo } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { TransformControls } from "three-stdlib";
import type { Object3D } from "three";
import type { Quat, Vec3 } from "../../core/types";
import { useSceneStore } from "../../stores/sceneStore";
import { entityObjectRegistry } from "../registry";

interface TransformGizmoProps {
  entityId: string;
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
  enabled: boolean;
  axis: string | null;
  dragging: boolean;
  attach: (object: Object3D) => void;
  detach: () => void;
  setSpace: (space: "world" | "local") => void;
  setMode: (mode: "translate" | "rotate") => void;
  update: () => void;
  addEventListener: (type: string, listener: (event: unknown) => void) => void;
  removeEventListener: (type: string, listener: (event: unknown) => void) => void;
}

/** The subset of OrbitControls / MapControls that the gizmo needs to pause. */
interface CameraControls {
  enabled: boolean;
}

export function TransformGizmo({ entityId, is2d, mode }: TransformGizmoProps) {
  const { camera, gl } = useThree();
  // `makeDefault` cameras (OrbitControls in 3D, MapControls in 2D) register
  // themselves here. A gizmo drag must not also pan/orbit the camera.
  const defaultControls = useThree((s) => s.controls) as unknown as CameraControls | null;
  const writeTransform = useSceneStore((s) => s.writeTransform);

  const controls = useMemo(() => {
    const c = new TransformControls(camera, gl.domElement) as unknown as GizmoControls;
    c.setSpace("world");
    c.setMode(mode);
    if (is2d) {
      // 2D workspace = X–Z plane. `showX/Y/Z` gate both translation handles
      // and rotation rings, so select the set that matches the current mode.
      if (mode === "rotate") {
        c.showX = false;
        c.showY = true;
        c.showZ = false;
      } else {
        c.showX = true;
        c.showY = false;
        c.showZ = true;
      }
    } else {
      c.showX = true;
      c.showY = true;
      c.showZ = true;
    }
    return c;
  }, [camera, gl, is2d, mode]);

  // Pause the default camera controls for the duration of a gizmo drag. This is
  // the same contract drei's <TransformControls> uses (`dragging-changed`).
  useEffect(() => {
    if (!defaultControls) return;
    const onDraggingChanged = (event: unknown) => {
      defaultControls.enabled = !(event as { value?: boolean }).value;
    };
    controls.addEventListener("dragging-changed", onDraggingChanged);
    return () => {
      controls.removeEventListener("dragging-changed", onDraggingChanged);
      defaultControls.enabled = true;
    };
  }, [controls, defaultControls]);

  // OrbitControls listens to the same canvas pointerdown and may start a pan
  // before TransformControls dispatches `dragging-changed`. Lock it in the
  // capture phase as soon as a gizmo handle is under the pointer.
  useEffect(() => {
    if (!defaultControls) return;
    const dom = gl.domElement;
    const doc = dom.ownerDocument;
    const onPointerDownCapture = (event: PointerEvent) => {
      if (event.button !== 0) return;
      if (controls.axis !== null) defaultControls.enabled = false;
    };
    const onPointerUp = () => {
      // Keep the lock until the gizmo has actually finished its drag.
      if (!controls.dragging) defaultControls.enabled = true;
    };
    dom.addEventListener("pointerdown", onPointerDownCapture, true);
    doc.addEventListener("pointerup", onPointerUp);
    return () => {
      dom.removeEventListener("pointerdown", onPointerDownCapture, true);
      doc.removeEventListener("pointerup", onPointerUp);
    };
  }, [controls, defaultControls, gl]);

  useEffect(() => {
    const object = entityObjectRegistry.get(entityId);
    if (!object) return;
    controls.attach(object);
    const onChange = () => {
      const position = object.position.toArray() as Vec3;
      const q = object.quaternion;
      const rotation: Quat = [q.x, q.y, q.z, q.w];
      writeTransform(entityId, position, rotation);
    };
    controls.addEventListener("objectChange", onChange);
    return () => {
      controls.removeEventListener("objectChange", onChange);
      controls.detach();
    };
  }, [controls, entityId, writeTransform]);

  useFrame(() => controls.update());

  return <primitive object={controls as unknown as Object3D} />;
}
