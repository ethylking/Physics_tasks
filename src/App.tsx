// App.tsx — application shell (Milestone 3).
// Top toolbar + spawn palette + 2D/3D viewport + properties inspector +
// physics worker orchestration + energy HUD + project manager modal.

import { useEffect, useRef } from "react";
import { Box, FolderOpen } from "lucide-react";
import TopBar from "./ui/TopBar";
import SpawnPalette from "./ui/palette/SpawnPalette";
import Inspector from "./ui/inspector/Inspector";
import ResizeHandle from "./ui/layout/ResizeHandle";
import ProjectManager from "./ui/projectManager/ProjectManager";
import EnergyHud from "./ui/hud/EnergyHud";
import HoverTelemetry from "./ui/hud/HoverTelemetry";
import OverlayPanel from "./ui/overlays/OverlayPanel";
import Canvas3D from "./render/Canvas3D";
import Canvas2D from "./render/Canvas2D";
import { useProjectStore } from "./stores/projectStore";
import { useSceneStore } from "./stores/sceneStore";
import { useTelemetryStore } from "./stores/telemetryStore";
import {
  LEFT_PANEL_MAX,
  LEFT_PANEL_MIN,
  RIGHT_PANEL_MAX,
  RIGHT_PANEL_MIN,
  useUiStore,
} from "./stores/uiStore";

export default function App() {
  const listProjects = useProjectStore((s) => s.listProjects);
  const projects = useProjectStore((s) => s.projects);
  const listLoaded = useProjectStore((s) => s.listLoaded);
  const error = useProjectStore((s) => s.error);
  const busy = useProjectStore((s) => s.busy);
  const clearError = useProjectStore((s) => s.clearError);
  const openProjectManager = useUiStore((s) => s.openProjectManager);
  const leftPanelWidth = useUiStore((s) => s.leftPanelWidth);
  const rightPanelWidth = useUiStore((s) => s.rightPanelWidth);
  const setLeftPanelWidth = useUiStore((s) => s.setLeftPanelWidth);
  const setRightPanelWidth = useUiStore((s) => s.setRightPanelWidth);
  const resetPanelWidths = useUiStore((s) => s.resetPanelWidths);

  const project = useSceneStore((s) => s.project);
  const dirty = useSceneStore((s) => s.dirty);
  const setMode = useSceneStore((s) => s.setMode);
  const setGravity = useSceneStore((s) => s.setGravity);

  const simStatus = useTelemetryStore((s) => s.status);
  const simReady = useTelemetryStore((s) => s.ready);
  const simError = useTelemetryStore((s) => s.error);

  useEffect(() => {
    void listProjects();
  }, [listProjects]);

  // Open the Project Manager on first launch when there is nothing to work on.
  const didAutoOpen = useRef(false);
  useEffect(() => {
    if (didAutoOpen.current || !listLoaded) return;
    didAutoOpen.current = true;
    if (projects.length === 0 && !project) openProjectManager();
  }, [listLoaded, projects.length, project, openProjectManager]);

  // Session restore: auto-load the most recently modified project on startup.
  const didAutoLoad = useRef(false);
  useEffect(() => {
    if (didAutoLoad.current || !listLoaded || projects.length === 0) return;
    didAutoLoad.current = true;
    if (useSceneStore.getState().project) return;
    const mostRecent = [...projects].sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt))[0];
    if (mostRecent) void useProjectStore.getState().loadProject(mostRecent.filename);
  }, [listLoaded, projects]);

  // Unload the worker when the window closes.
  useEffect(() => {
    const onUnload = () => useTelemetryStore.getState().stop();
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, []);

  const ensureWorker = (): boolean => {
    const p = useSceneStore.getState().project;
    if (!p) return false;
    const t = useTelemetryStore.getState();
    if (!(t.ready && t.projectId === p.meta.id)) t.start(p);
    return true;
  };

  const handlePlay = () => {
    if (ensureWorker()) useTelemetryStore.getState().play();
  };
  const handlePause = () => useTelemetryStore.getState().pause();
  const handleStep = () => {
    if (ensureWorker()) useTelemetryStore.getState().stepOnce();
  };
  const handleReset = () => {
    useSceneStore.getState().resetToInitial();
    useTelemetryStore.getState().stop();
  };

  const handleSave = async () => {
    const scene = useSceneStore.getState();
    scene.commitToProjectStore();
    const ok = await useProjectStore.getState().saveProject();
    if (ok) useSceneStore.getState().setDirty(false);
  };

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-zinc-950 text-zinc-200">
      <TopBar
        project={project}
        dirty={dirty}
        busy={busy}
        simStatus={simStatus}
        simReady={simReady}
        onSave={() => void handleSave()}
        onOpenProjects={openProjectManager}
        onSetMode={setMode}
        onSetGravity={setGravity}
        onPlay={handlePlay}
        onPause={handlePause}
        onStep={handleStep}
        onReset={handleReset}
      />

      {(error || simError) && (
        <div className="flex items-center justify-between gap-3 border-b border-red-900/60 bg-red-950/40 px-4 py-1.5 text-xs text-red-300">
          <span className="truncate">{simError ?? error}</span>
          <button
            type="button"
            aria-label="Dismiss error"
            onClick={() => {
              clearError();
              useTelemetryStore.getState().stop();
            }}
            className="shrink-0 text-red-400 transition-colors hover:text-red-200"
          >
            ✕
          </button>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {project ? (
          <>
            <SpawnPalette width={leftPanelWidth} />
            <ResizeHandle
              direction="left"
              value={leftPanelWidth}
              min={LEFT_PANEL_MIN}
              max={LEFT_PANEL_MAX}
              label="Resize spawn palette"
              onResize={setLeftPanelWidth}
              onReset={resetPanelWidths}
            />
            <main className="relative min-w-0 flex-1">
              {project.meta.mode === "2D" ? <Canvas2D /> : <Canvas3D />}
              <EnergyHud />
              <OverlayPanel />
            </main>
            <ResizeHandle
              direction="right"
              value={rightPanelWidth}
              min={RIGHT_PANEL_MIN}
              max={RIGHT_PANEL_MAX}
              label="Resize inspector"
              onResize={setRightPanelWidth}
              onReset={resetPanelWidths}
            />
            <Inspector width={rightPanelWidth} />
          </>
        ) : (
          <div className="workspace-grid flex flex-1 flex-col items-center justify-center gap-3 text-zinc-700">
            <Box className="h-12 w-12" />
            <p className="text-sm font-medium tracking-wide text-zinc-500">No project loaded</p>
            <p className="text-xs text-zinc-600">{projects.length} saved project(s) in ./projects/</p>
            <button type="button" onClick={openProjectManager} className="btn-primary mt-2">
              <FolderOpen className="h-4 w-4" />
              Open Project Manager
            </button>
          </div>
        )}
      </div>

      <ProjectManager />
      <HoverTelemetry />
    </div>
  );
}
