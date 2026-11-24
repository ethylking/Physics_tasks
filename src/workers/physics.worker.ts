// workers/physics.worker.ts — owns the Rapier world (§5.2).
//
// Main thread → worker commands: initWorld, play, pause, stepOnce, reset,
// setTimeScale, updateGravity.
// Worker → main: ready, snapshot (Transferable Float32Array @60 Hz), warning,
// error. NO SharedArrayBuffer anywhere.

/// <reference lib="webworker" />

import * as RAPIER from "@dimforge/rapier3d-compat";
import type { MechProject, Vec3 } from "../core/types";
import { PhysicsEngine } from "../physics/engine";
import { setExprWarningSink } from "../math/expr";

const ctx = self as unknown as DedicatedWorkerGlobalScope;

interface WorkerMessage {
  type: string;
  project?: MechProject;
  timeScale?: number;
  gravity?: Vec3;
}

let engine: PhysicsEngine | null = null;
let initialProject: MechProject | null = null;
let status: "idle" | "running" | "paused" = "idle";
let timeScale = 1;
let accumulator = 0;
let lastTick = 0;
let lastSnapshotAt = 0;
let buffer: Float32Array | null = null;
let queue: Promise<void> = Promise.resolve();

const MAX_FRAME_STEP = 0.05; // §5.2 spiral-of-death guard

// Kick off the WASM init at module boot; initWorld awaits this promise.
const rapierInitPromise: Promise<boolean> = RAPIER.init()
  .then(() => {
    post("ready");
    return true;
  })
  .catch((e: unknown) => {
    post("error", { message: `Rapier WASM init failed: ${e instanceof Error ? e.message : String(e)}` });
    return false;
  });

function post(type: string, payload: Record<string, unknown> = {}): void {
  ctx.postMessage({ type, ...payload });
}

function warn(message: string): void {
  post("warning", { message });
}

function initWorld(project: MechProject): void {
  engine = new PhysicsEngine(project, RAPIER);
  initialProject = project;
  buffer = new Float32Array(engine.snapshotSize);
  accumulator = 0;
  status = "paused";
  post("ready");
  // Publish the t = 0 state immediately so overlays/HUD have data while paused.
  sendSnapshot(false);
}

function sendSnapshot(transfer: boolean): void {
  if (!engine || !buffer) return;
  engine.writeSnapshot(buffer);
  if (transfer) {
    ctx.postMessage({ type: "snapshot", buffer: buffer.buffer }, [buffer.buffer]);
  } else {
    ctx.postMessage({ type: "snapshot", buffer: buffer.buffer });
  }
  buffer = new Float32Array(engine.snapshotSize);
}

function handle(msg: WorkerMessage): void {
  switch (msg.type) {
    case "initWorld":
      if (msg.project) initWorld(msg.project);
      break;
    case "play":
      if (engine) {
        status = "running";
        lastTick = performance.now();
      }
      break;
    case "pause":
      status = "paused";
      break;
    case "stepOnce":
      if (engine) {
        engine.step();
        sendSnapshot(false);
        status = "paused";
      }
      break;
    case "reset":
      if (initialProject) {
        initWorld(initialProject);
        sendSnapshot(false);
      }
      break;
    case "setTimeScale":
      if (typeof msg.timeScale === "number" && Number.isFinite(msg.timeScale)) {
        timeScale = Math.max(0, msg.timeScale);
      }
      break;
    case "updateGravity":
      if (engine && msg.gravity) engine.setGravity(msg.gravity);
      break;
    default:
      warn(`unknown worker command: ${msg.type}`);
  }
}

async function handleGuarded(msg: WorkerMessage): Promise<void> {
  // initWorld races the async RAPIER.init() at module boot — wait for it first.
  if (msg.type === "initWorld") {
    const ok = await rapierInitPromise;
    if (!ok || !msg.project) return;
    try {
      initWorld(msg.project);
    } catch (e) {
      post("error", { message: `failed to build the physics world: ${e instanceof Error ? e.message : String(e)}` });
    }
    return;
  }
  handle(msg);
}

function tick(): void {
  const now = performance.now();
  if (status === "running" && engine) {
    let frameDt = Math.min((now - lastTick) / 1000, MAX_FRAME_STEP);
    accumulator += frameDt * timeScale;
    const dt = engine.dt;
    let stepped = false;
    while (accumulator >= dt) {
      engine.step();
      accumulator -= dt;
      stepped = true;
    }
    if (stepped && now - lastSnapshotAt >= 1000 / 60) {
      lastSnapshotAt = now;
      sendSnapshot(true);
    }
  }
  lastTick = now;
}

ctx.onmessage = (ev: MessageEvent<WorkerMessage>) => {
  // Serialize handling so initWorld always completes before play/stepOnce.
  queue = queue.then(() => handleGuarded(ev.data));
};

setExprWarningSink(warn);
setInterval(tick, 16);
