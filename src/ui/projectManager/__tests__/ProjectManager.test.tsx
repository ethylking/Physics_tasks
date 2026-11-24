// ui/projectManager/__tests__/ProjectManager.test.tsx — Project Manager UI
// tests against the mocked Tauri backend (src/test/mocks/tauriCoreMock.ts).

import { beforeEach, describe, expect, it } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ProjectManager from "../ProjectManager";
import { useUiStore } from "../../../stores/uiStore";
import { useProjectStore } from "../../../stores/projectStore";
import { resetTauriMock, seedProjectFile, tauriMockState } from "../../../test/mocks/tauriCoreMock";
import { createDefaultJoint, createDefaultProject } from "../../../core/defaults";
import type { JointEntity } from "../../../core/types";

function resetStores() {
  useUiStore.setState({ projectManagerOpen: true });
  useProjectStore.setState({
    projects: [],
    listLoaded: false,
    busy: false,
    error: null,
    currentProject: null,
    currentFilename: null,
    dirty: false,
    diagnostics: [],
  });
}

beforeEach(() => {
  resetTauriMock();
  resetStores();
});

describe("ProjectManager", () => {
  it("lists saved projects from the backend", async () => {
    seedProjectFile("atwood.mech.json", createDefaultProject("Atwood Machine", "3D"));
    seedProjectFile("pendulum.mech.json", createDefaultProject("Pendulum", "2D"));

    render(<ProjectManager />);

    expect(await screen.findByText("Atwood Machine")).toBeInTheDocument();
    expect(screen.getByText("Pendulum")).toBeInTheDocument();
    expect(await screen.findByText(/2 project\(s\)/)).toBeInTheDocument();
  });

  it("creates a new 2D project and persists it through the mocked save_project command", async () => {
    const user = userEvent.setup();
    render(<ProjectManager />);

    await user.click(screen.getByRole("button", { name: /New 2D/i }));
    const dialog = screen.getByRole("dialog", { name: /New 2D project/i });
    await user.type(within(dialog).getByLabelText(/project name/i), "Inclined plane");
    await user.click(within(dialog).getByRole("button", { name: /create/i }));

    await waitFor(() => expect(tauriMockState.projects.size).toBe(1));
    expect(tauriMockState.calls.some((c) => c.command === "save_project")).toBe(true);

    const [filename, content] = [...tauriMockState.projects.entries()][0] as [string, string];
    expect(filename).toMatch(/^inclined-plane.*\.mech\.json$/);

    const saved = JSON.parse(content) as {
      schemaVersion: number;
      meta: { mode: string };
      world: { gravity: number[] };
      bodies: Array<{ locks: { translate: boolean[]; rotate: boolean[] } }>;
    };
    expect(saved.schemaVersion).toBe(2);
    expect(saved.meta.mode).toBe("2D");
    expect(saved.world.gravity).toEqual([0, 0, -9.81]);
    // §4.5 — 2D-in-3D locking applied to seeded bodies (X–Z workspace)
    expect(saved.bodies[0]?.locks.translate).toEqual([false, true, false]);
    expect(saved.bodies[0]?.locks.rotate).toEqual([true, false, true]);

    // The new project appears in the list and is opened in the editor.
    expect(await screen.findByRole("heading", { name: "Inclined plane" })).toBeInTheDocument();
  });

  it("creates a new 3D project with free body locks", async () => {
    const user = userEvent.setup();
    render(<ProjectManager />);

    await user.click(screen.getByRole("button", { name: /New 3D/i }));
    const dialog = screen.getByRole("dialog", { name: /New 3D project/i });
    await user.type(within(dialog).getByLabelText(/project name/i), "Falling spheres");
    await user.click(within(dialog).getByRole("button", { name: /create/i }));

    await waitFor(() => expect(tauriMockState.projects.size).toBe(1));
    const [, content] = [...tauriMockState.projects.entries()][0] as [string, string];
    const saved = JSON.parse(content) as {
      meta: { mode: string };
      bodies: Array<{ locks: { translate: boolean[]; rotate: boolean[] } }>;
    };
    expect(saved.meta.mode).toBe("3D");
    expect(saved.bodies[0]?.locks.translate).toEqual([false, false, false]);
    expect(saved.bodies[0]?.locks.rotate).toEqual([false, false, false]);
  });

  it("loads a project and shows structured diagnostics for a broken id reference", async () => {
    const broken = createDefaultProject("Broken joint", "3D");
    const joint = createDefaultJoint("revolute");
    joint.bodyA = "missing-body-abc";
    broken.joints.push(joint as JointEntity);
    seedProjectFile("broken.mech.json", broken);

    const user = userEvent.setup();
    render(<ProjectManager />);

    await user.click(await screen.findByRole("button", { name: /^Broken joint/ }));

    // The editor auto-opens the Validation tab with the structured error.
    expect(await screen.findByText("E_UNRESOLVED_REFERENCE")).toBeInTheDocument();
    expect(screen.getByText(/missing-body-abc/)).toBeInTheDocument();
    expect(screen.getByText(/line \d+/)).toBeInTheDocument();
    expect(screen.getByText(/joints\[0\]\.bodyA/)).toBeInTheDocument();
  });

  it("shows a clear error when the raw JSON editor contains malformed JSON", async () => {
    seedProjectFile("good.mech.json", createDefaultProject("Good project", "3D"));
    const user = userEvent.setup();
    render(<ProjectManager />);

    await user.click(await screen.findByRole("button", { name: /^Good project/ }));
    await user.click(screen.getByRole("tab", { name: /Raw JSON/i }));

    const textarea = screen.getByLabelText(/raw project json/i);
    await user.clear(textarea);
    // user-event treats { and } as keyboard descriptors — escape by doubling.
    await user.type(textarea, '{{"schemaVersion": 2, "meta": }}');
    await user.click(screen.getByRole("button", { name: /Apply/i }));

    expect(await screen.findByText(/Malformed JSON/i)).toBeInTheDocument();
  });

  it("duplicates a project through the backend", async () => {
    seedProjectFile("proj.mech.json", createDefaultProject("Project A", "3D"));
    const user = userEvent.setup();
    render(<ProjectManager />);

    await screen.findByText("Project A");
    await user.click(screen.getByRole("button", { name: "Duplicate Project A" }));

    await waitFor(() => expect(tauriMockState.projects.size).toBe(2));
    expect(tauriMockState.calls.some((c) => c.command === "duplicate_project")).toBe(true);
    expect(await screen.findByText("Project A (copy)")).toBeInTheDocument();
  });

  it("deletes a project after confirmation", async () => {
    seedProjectFile("proj.mech.json", createDefaultProject("Project A", "3D"));
    const user = userEvent.setup();
    render(<ProjectManager />);

    await screen.findByText("Project A");
    await user.click(screen.getByRole("button", { name: "Delete Project A" }));
    await user.click(screen.getByRole("button", { name: "Confirm delete Project A" }));

    await waitFor(() => expect(tauriMockState.projects.size).toBe(0));
    expect(tauriMockState.calls.some((c) => c.command === "delete_project")).toBe(true);
    expect(screen.queryByText("Project A")).not.toBeInTheDocument();
  });
});
