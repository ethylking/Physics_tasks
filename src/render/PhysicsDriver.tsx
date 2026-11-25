// render/PhysicsDriver.tsx — drives entity Object3Ds straight from the latest
// worker snapshot inside useFrame while the simulation shows frames
// (`status === "running"` or `viewPose` after a single step). React never
// re-renders per physics frame (§5.2); this component is a null-rendering
// subscription. When the editor owns the pose (paused / idle) the snapshot must
// NOT be re-applied, or the meshes would stay pinned to a stale simulated pose
// instead of following edit coordinates and direct drags.

import { useFrame } from "@react-three/fiber";
import { useTelemetryStore } from "../stores/telemetryStore";
import { SNAPSHOT_FLOATS_PER_BODY, SNAPSHOT_HEADER, SNAPSHOT_INDEX } from "../physics/snapshot";
import { entityObjectRegistry } from "./registry";

export function PhysicsDriver() {
  useFrame(() => {
    const state = useTelemetryStore.getState();
    // Snapshot pose ownership: only while the sim is showing frames. Paused
    // (without a stepped frame) hands the meshes back to the edit state.
    if (!(state.status === "running" || state.viewPose)) return;
    const snapshot = state.getSnapshot();
    if (!snapshot) return;
    const order = state.getBodyOrder();
    const count = Math.min(Math.round(snapshot[SNAPSHOT_INDEX.COUNT] ?? 0), order.length);
    for (let i = 0; i < count; i++) {
      const id = order[i];
      if (!id) continue;
      const obj = entityObjectRegistry.get(id);
      if (!obj) continue;
      const o = SNAPSHOT_HEADER + i * SNAPSHOT_FLOATS_PER_BODY;
      obj.position.set(snapshot[o] ?? 0, snapshot[o + 1] ?? 0, snapshot[o + 2] ?? 0);
      obj.quaternion.set(snapshot[o + 3] ?? 0, snapshot[o + 4] ?? 0, snapshot[o + 5] ?? 0, snapshot[o + 6] ?? 1);
    }
  });
  return null;
}
