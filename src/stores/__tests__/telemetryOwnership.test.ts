// stores/__tests__/telemetryOwnership.test.ts — pose ownership (`viewPose`)
// and the "any edit ends the simulation session" auto-stop rule.
//
// The physics worker is stubbed: these tests only exercise the store's
// lifecycle transitions, never Rapier.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSceneStore } from "../sceneStore";
import { useTelemetryStore } from "../telemetryStore";
import { createDefaultProject } from "../../core/defaults";

/** Captured stub workers so tests can inspect postMessage / inject snapshots. */
let workers: WorkerStub[] = [];

class WorkerStub {
  onmessage: ((ev: MessageEvent) => void) | null = null;
  posted: unknown[] = [];
  terminated = false;

  constructor() {
    workers.push(this);
  }

  postMessage(message: unknown): void {
    this.posted.push(message);
  }

  terminate(): void {
    this.terminated = true;
  }
}

function currentWorker(): WorkerStub {
  const worker = workers[workers.length - 1];
  if (!worker) throw new Error("no Worker was created");
  return worker;
}

/** Push a fake snapshot through the worker's onmessage handler. */
function emitSnapshot(worker: WorkerStub, t: number): void {
  const frame = new Float32Array(16);
  frame[0] = t;
  worker.onmessage?.({ data: { type: "snapshot", buffer: frame.buffer } } as MessageEvent);
}

beforeEach(() => {
  workers = [];
  vi.stubGlobal("Worker", WorkerStub);
  useTelemetryStore.getState().stop();
  useSceneStore.getState().loadFromProject(createDefaultProject("Ownership", "3D"));
});

afterEach(() => {
  useTelemetryStore.getState().stop();
  vi.unstubAllGlobals();
});

describe("telemetryStore — pose ownership", () => {
  it("starts with the editor owning the pose (viewPose false)", () => {
    expect(useTelemetryStore.getState().viewPose).toBe(false);
    expect(useTelemetryStore.getState().status).toBe("idle");
  });

  it("start -> paused editor-owned, play -> running worker-owned, pause -> editor-owned", () => {
    const project = createDefaultProject("Play Pause", "3D");

    useTelemetryStore.getState().start(project);
    expect(useTelemetryStore.getState().status).toBe("paused");
    expect(useTelemetryStore.getState().viewPose).toBe(false);

    useTelemetryStore.getState().play();
    expect(useTelemetryStore.getState().status).toBe("running");
    expect(useTelemetryStore.getState().viewPose).toBe(true);

    useTelemetryStore.getState().pause();
    expect(useTelemetryStore.getState().status).toBe("paused");
    expect(useTelemetryStore.getState().viewPose).toBe(false);
  });

  it("pause clears the transient snapshot so no stale pose is rendered", () => {
    useTelemetryStore.getState().start(createDefaultProject("Snapshot", "3D"));
    useTelemetryStore.getState().play();
    emitSnapshot(currentWorker(), 1.25);
    expect(useTelemetryStore.getState().getSnapshot()).not.toBeNull();

    useTelemetryStore.getState().pause();
    expect(useTelemetryStore.getState().getSnapshot()).toBeNull();
  });

  it("stepOnce keeps the stepped frame visible (viewPose true, snapshot kept)", () => {
    useTelemetryStore.getState().start(createDefaultProject("Step", "3D"));
    emitSnapshot(currentWorker(), 2.5);

    useTelemetryStore.getState().stepOnce();
    expect(useTelemetryStore.getState().status).toBe("paused");
    expect(useTelemetryStore.getState().viewPose).toBe(true);
    expect(useTelemetryStore.getState().getSnapshot()).not.toBeNull();

    useTelemetryStore.getState().pause();
    expect(useTelemetryStore.getState().viewPose).toBe(false);
  });

  it("stop and restart leave the editor in control", () => {
    const project = createDefaultProject("Restart", "3D");
    useTelemetryStore.getState().start(project);
    useTelemetryStore.getState().play();
    expect(useTelemetryStore.getState().viewPose).toBe(true);

    useTelemetryStore.getState().restart(project);
    expect(useTelemetryStore.getState().status).toBe("paused");
    expect(useTelemetryStore.getState().viewPose).toBe(false);

    useTelemetryStore.getState().play();
    useTelemetryStore.getState().stop();
    expect(useTelemetryStore.getState().status).toBe("idle");
    expect(useTelemetryStore.getState().viewPose).toBe(false);
  });

  it("auto-stops a paused session when an edit replaces the project (updateEntity)", () => {
    const project = createDefaultProject("Auto stop", "3D");
    useSceneStore.getState().loadFromProject(project);
    useTelemetryStore.getState().start(project);
    expect(useTelemetryStore.getState().status).toBe("paused");

    useSceneStore.getState().updateEntity(project.bodies[0]!.id, { friction: 0.9 });

    expect(useTelemetryStore.getState().status).toBe("idle");
    expect(useTelemetryStore.getState().viewPose).toBe(false);
  });

  it("auto-stops a running session when an edit replaces the project (loadFromProject)", () => {
    const project = createDefaultProject("Auto stop load", "3D");
    useSceneStore.getState().loadFromProject(project);
    useTelemetryStore.getState().start(project);
    useTelemetryStore.getState().play();
    expect(useTelemetryStore.getState().status).toBe("running");

    useSceneStore.getState().loadFromProject(createDefaultProject("Other", "3D"));

    expect(useTelemetryStore.getState().status).toBe("idle");
    expect(useTelemetryStore.getState().viewPose).toBe(false);
  });

  it("selecting an entity is UI-only and does not end the session", () => {
    const project = createDefaultProject("Selection", "3D");
    useSceneStore.getState().loadFromProject(project);
    useTelemetryStore.getState().start(project);

    useSceneStore.getState().setSelected(project.bodies[0]!.id);

    expect(useSceneStore.getState().selectedId).toBe(project.bodies[0]!.id);
    expect(useTelemetryStore.getState().status).toBe("paused");
    expect(useTelemetryStore.getState().projectId).toBe(project.meta.id);

    // Still can step the existing session after a pure selection change.
    useTelemetryStore.getState().stepOnce();
    expect(useTelemetryStore.getState().viewPose).toBe(true);
  });
});
