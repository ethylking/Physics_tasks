// stores/__tests__/collisionStore.test.ts — collision flag store: checkNow,
// debounced refresh, clear, scene-entity filtering, and the useCollisionFlag
// selector hook.
//
// `findInitialCollisions` is mocked so these tests exercise only the store's
// lifecycle (sorting/dedup, checking toggle, debounce, scene-entity filter,
// error swallow), never Rapier or the (separately owned) collisionCheck module.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useCollisionFlag, useCollisionStore } from "../collisionStore";
import { findInitialCollisions } from "../../physics/collisionCheck";
import { createDefaultProject } from "../../core/defaults";
import type { MechProject } from "../../core/types";

vi.mock("../../physics/collisionCheck", () => ({
  findInitialCollisions: vi.fn(),
  COLLISION_MARGIN: 0.02,
}));

const mockedFind = vi.mocked(findInitialCollisions);

function createDefaultProjectFixture(): MechProject {
  return createDefaultProject("Collision", "3D");
}

/** Real scene-entity ids from the seeded project (ground + box). */
function sceneIds(project: MechProject): { bodyId: string; staticId: string } {
  return { bodyId: project.bodies[0]!.id, staticId: project.statics[0]!.id };
}

beforeEach(() => {
  mockedFind.mockReset();
  useCollisionStore.getState().clear();
});

afterEach(() => {
  vi.useRealTimers();
  mockedFind.mockReset();
});

describe("collisionStore — checkNow", () => {
  it("sets collidingIds from the resolved value (sorted + unique) and toggles checking", async () => {
    const project = createDefaultProjectFixture();
    const { bodyId, staticId } = sceneIds(project);
    mockedFind.mockResolvedValue([staticId, bodyId, staticId]);

    const promise = useCollisionStore.getState().checkNow(project);
    expect(useCollisionStore.getState().checking).toBe(true);

    const ids = await promise;
    expect(ids).toEqual([bodyId, staticId].sort());
    expect(useCollisionStore.getState().checking).toBe(false);
    expect(useCollisionStore.getState().collidingIds).toEqual([bodyId, staticId].sort());
    expect(mockedFind).toHaveBeenCalledWith(project);
  });

  it("drops detector ids that are not scene entities (e.g. rope chain segments)", async () => {
    const project = createDefaultProjectFixture();
    const { bodyId } = sceneIds(project);
    mockedFind.mockResolvedValue([bodyId, "rope-seg-99", "foreign"]);

    const ids = await useCollisionStore.getState().checkNow(project);
    expect(ids).toEqual([bodyId]);
    expect(useCollisionStore.getState().collidingIds).toEqual([bodyId]);
  });

  it("swallows errors and clears state (best-effort, never throws)", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockedFind.mockRejectedValue(new Error("boom"));
    const project = createDefaultProjectFixture();

    const ids = await useCollisionStore.getState().checkNow(project);
    expect(ids).toEqual([]);
    expect(useCollisionStore.getState().collidingIds).toEqual([]);
    expect(useCollisionStore.getState().checking).toBe(false);
    errorSpy.mockRestore();
  });
});

describe("collisionStore — requestRefresh", () => {
  it("debounces and runs checkNow once after ~200 ms", async () => {
    vi.useFakeTimers();
    const project = createDefaultProjectFixture();
    const { bodyId, staticId } = sceneIds(project);
    mockedFind.mockResolvedValue([bodyId, staticId]);

    useCollisionStore.getState().requestRefresh(project);
    useCollisionStore.getState().requestRefresh(project);
    useCollisionStore.getState().requestRefresh(project);
    expect(mockedFind).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(200);

    expect(mockedFind).toHaveBeenCalledTimes(1);
    expect(mockedFind).toHaveBeenCalledWith(project);
    expect(useCollisionStore.getState().collidingIds).toEqual([bodyId, staticId].sort());
    vi.useRealTimers();
  });
});

describe("collisionStore — clear & useCollisionFlag", () => {
  it("clear empties collidingIds and checking", async () => {
    const project = createDefaultProjectFixture();
    const { bodyId } = sceneIds(project);
    mockedFind.mockResolvedValue([bodyId]);
    await useCollisionStore.getState().checkNow(project);
    expect(useCollisionStore.getState().collidingIds).toEqual([bodyId]);

    useCollisionStore.getState().clear();
    expect(useCollisionStore.getState().collidingIds).toEqual([]);
    expect(useCollisionStore.getState().checking).toBe(false);
  });

  it("useCollisionFlag reflects membership", async () => {
    const project = createDefaultProjectFixture();
    const { bodyId, staticId } = sceneIds(project);
    mockedFind.mockResolvedValue([bodyId, staticId]);
    await useCollisionStore.getState().checkNow(project);

    const { result: inResult } = renderHook(() => useCollisionFlag(bodyId));
    const { result: staticResult } = renderHook(() => useCollisionFlag(staticId));
    const { result: outResult } = renderHook(() => useCollisionFlag("missing"));

    expect(inResult.current).toBe(true);
    expect(staticResult.current).toBe(true);
    expect(outResult.current).toBe(false);
  });
});
