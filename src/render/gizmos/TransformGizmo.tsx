// render/gizmos/TransformGizmo.tsx — translate/rotate handles attached to the
// selected entity. 2D mode restricts translation to X–Z and rotation to the Y
// ring (§4.5). Live transforms are written back into the scene store on every
// `objectChange`.

import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { TransformControls } from "three-stdlib";
import * as THREE from "three";
import type { Object3D } from "three";
import type { Quat, Vec3 } from "../../core/types";
import { useSceneStore } from "../../stores/sceneStore";
import { entityObjectRegistry } from "../registry";
import { gizmoHandleAxis } from "./gizmoHandleAxis";

interface TransformGizmoProps {
  entityId: string;
  is2d: boolean;
  mode: "translate" | "rotate";
  /** Axes offered by the 3D translate gizmo (only affects translate mode). */
  translateAxes?: "xy" | "xz" | "xyz";
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
  setRotationSnap: (rotationSnap: number) => void;
  update: () => void;
  addEventListener: (type: string, listener: (event: unknown) => void) => void;
  removeEventListener: (type: string, listener: (event: unknown) => void) => void;
}

/** The subset of OrbitControls / MapControls that the gizmo needs to pause. */
interface CameraControls {
  enabled: boolean;
}

/** Rotate-mode angle snapping: 15° by default, 1° while Shift is held. */
const ROTATE_SNAP_DEFAULT = Math.PI / 12;
const ROTATE_SNAP_FINE = Math.PI / 180;

export function TransformGizmo({ entityId, is2d, mode, translateAxes = "xyz" }: TransformGizmoProps) {
  const { camera, gl } = useThree();
  // `makeDefault` cameras (OrbitControls in 3D, MapControls in 2D) register
  // themselves here. A gizmo drag must not also pan/orbit the camera.
  const defaultControls = useThree((s) => s.controls) as unknown as CameraControls | null;
  const writeTransform = useSceneStore((s) => s.writeTransform);
  const shiftRef = useRef(false);

  const controls = useMemo(() => {
    const c = new TransformControls(camera, gl.domElement) as unknown as GizmoControls;
    c.setSpace("world");
    c.setMode(mode);
    // `showX/Y/Z` gate both translation handles and rotation rings, so select
    // the set that matches the current mode. 2D rotation happens only about
    // the out-of-plane Y axis; 2D translation is confined to the X–Z plane.
    if (mode === "rotate") {
      if (is2d) {
        c.showX = false;
        c.showY = true;
        c.showZ = false;
      } else {
        c.showX = true;
        c.showY = true;
        c.showZ = true;
      }
    } else if (is2d) {
      c.showX = true;
      c.showY = false;
      c.showZ = true;
    } else if (translateAxes === "xy") {
      // Horizontal X–Y drag incl. the XY-plane handle; Z via the axis arrows.
      c.showX = true;
      c.showY = true;
      c.showZ = false;
    } else if (translateAxes === "xz") {
      c.showX = true;
      c.showY = false;
      c.showZ = true;
    } else {
      c.showX = true;
      c.showY = true;
      c.showZ = true;
    }
    return c;
  }, [camera, gl, is2d, mode, translateAxes]);

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

  // Render the gizmo handles LAST within the transparent pass so the ground grid
  // (renderOrder -100) never blends over them. Push the whole handle tree to
  // renderOrder 100 and disable depth testing/writing on every material so the
  // handles stay visible through scene geometry.
  useEffect(() => {
    (controls as unknown as THREE.Object3D).traverse((obj) => {
      obj.renderOrder = 100;
      const material = (obj as unknown as { material?: THREE.Material | THREE.Material[] }).material;
      if (!material) return;
      for (const m of Array.isArray(material) ? material : [material]) {
        m.depthTest = false;
        m.depthWrite = false;
        m.transparent = true;
        m.needsUpdate = true;
      }
    });
  }, [controls]);

  // Rotate-mode snapping: 15° normally, 1° while Shift is held. The snap only
  // applies to the rotate gizmo; translate mode disables it entirely.
  useEffect(() => {
    if (mode !== "rotate") {
      controls.setRotationSnap(0);
      return;
    }
    const applySnap = () => {
      controls.setRotationSnap(shiftRef.current ? ROTATE_SNAP_FINE : ROTATE_SNAP_DEFAULT);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Shift") return;
      shiftRef.current = true;
      applySnap();
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key !== "Shift") return;
      shiftRef.current = false;
      applySnap();
    };
    applySnap();
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      controls.setRotationSnap(0);
    };
  }, [controls, mode]);

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

  // Publish the hovered/dragged handle axis for the body-drag guard in
  // EntityGroup (a handle drag and a body drag must not start together).
  useFrame(() => {
    controls.update();
    gizmoHandleAxis.axis = controls.axis;
  });

  // Never leave a stale handle axis behind after the gizmo unmounts.
  useEffect(() => () => {
    gizmoHandleAxis.axis = null;
  }, []);

  return <primitive object={controls as unknown as Object3D} />;
}
