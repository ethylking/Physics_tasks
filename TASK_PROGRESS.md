# TASK_PROGRESS.md — User task list tracking (Lead Orchestrator)

Session started: 2026-11-25. Protocol: AGENTS.md.txt + ARCHITECTURE.md (v2.0). All work delegated
to domain subagents ([Core-Rust], [Render-3D], [Physics-Math], [QA-Verifier]); every step
verified with builds, physics unit tests (vitest) and Playwright UI tests.

## User task list

- [x] **T1** — In 3D mode, drag&drop (translate gizmo) moves objects ONLY in the horizontal
  X–Y plane; the Z coordinate is changed with the axis-arrow controls; every coordinate of
  every object's center is editable as numeric inputs in the right inspector panel.
- [x] **T2** — Bug fix: axis arrows must be visible EVERY time an object is selected
  (today they only show right after creation; deselect + reselect loses them forever).
- [x] **T3** — Rename static "Ground plane" → "Horizontal plane"; default ground is
  horizontal (X–Y), the wall is vertical (X–Z); all planes easily rotated with rotation
  controls, and all rotation controls have numeric inputs for the angle RELATIVE to the
  initial location/direction.
- [x] **T4** — New Playwright UI tests: create a new object via the UI, move it to a
  height, click "run simulation" (Play) and verify it drops down under default gravity.

## Regression round 2 (user report, 2026-11-25 evening)

- [x] **R1** — "Not possible to move object just with drag&drop": implement DIRECT
  object dragging — press on the object body and drag it in the horizontal X–Y plane
  (2D: X–Z plane). Z only via arrows / inspector.
- [x] **R2** — "Object renders are not moving with the object coordinates" after a
  simulation: the editor must own the scene whenever the sim is not actively showing
  frames (pause/reset/step view), and any edit ends the simulation session so Play
  always runs the CURRENT edit state. Root cause (confirmed by diagnostic): PhysicsDriver
  re-applied the last worker snapshot every frame while status ≠ idle, pinning meshes to
  the simulated pose while the store held the edit pose.
- [x] **R3** — Verify drag&drop + axis arrows work AFTER Play → Pause and after Reset,
  and that the rendered mesh follows store coordinates in every non-running state.
- [x] **R4** — Regression tests: Playwright body-drag test (store + render follow, z
  unchanged), post-Pause/Reset editing tests, arrows after sim; all gates green.

### Round-2 architectural decisions (authoritative)

1. **`telemetryStore.viewPose: boolean`** — true only while the meshes must be driven by
   the worker snapshot: `play()` → true, `stepOnce()` → true, `pause()` → false (and it
   clears the transient `latestSnapshot` so overlays/PhysicsDriver cannot use a stale
   pose), `start/restart/stop` → false.
2. **Ownership predicate** used by PhysicsDriver, EntityGroup, Canvas3D/Canvas2D and the
   gizmo/arrow visibility: `simulated = status === "running" || viewPose`. When
   `simulated` is false the edit state is authoritative (props applied, positions written
   by gizmo/arrows/body drag are rendered immediately).
3. **Auto-stop on edit**: in the existing `useSceneStore.subscribe` inside
   telemetryStore, any NEW project object (`state.project !== prev.project`) while
   `status !== "idle"` calls `stop()` — so the first edit of any kind exits the sim
   session, the mesh snaps to the edit pose, and a later Play rebuilds the world from the
   current edit state (no stale-world runs).
4. **Reset** (`App.handleReset`): `sceneStore.resetToInitial()` then
   `telemetryStore.stop()` (no eager `restart`), leaving status `idle` and full edit
   ownership.
5. **Direct body drag** (`EntityGroup`): left-press on an entity mesh when
   `status !== "running"`, no spawn tool active, and `gizmoHandleAxis.axis === null`;
   allowed when the entity is selected OR it is a rigid body (statics need selection
   first to avoid accidentally moving the ground while panning). Drag plane: 3D = normal
   +Z through the entity's world anchor; 2D = normal +Y (X–Z workspace). Movement is a
   cursor delta on that plane; `writeTransform` keeps the entity's current rotation
   (bodies `initial.rotation`, statics `staticWorldQuat(stat)`, else identity). Orbit/
   MapControls are disabled for the duration of the drag. A press without movement is
   only a selection (no write, no dirty, no session exit).
6. **`gizmoHandleAxis`** — tiny shared module (`src/render/gizmos/gizmoHandleAxis.ts`)
   holding `{ axis: string | null }`, updated from TransformGizmo's `useFrame`, so the body
   drag never competes with a gizmo handle drag.

## Architectural decisions (authoritative for all subagents)

1. **`StaticEntity.rotation?: Quat`** (new optional serialized field, `.mech.json` schema):
   RELATIVE rotation applied AFTER the base orientation defined by `plane.normal`.
   World quaternion = `baseQuat(normal) × rotation`; identity `[0,0,0,1]` = initial
   direction. Inspector shows/edits it as Euler degrees (ZYX intrinsic) via
   `quatToEulerDeg` / `eulerDegToQuat` from `src/math/rotation.ts`.
2. **Defaults** (`src/core/defaults.ts`): ground name → `"Horizontal plane"`,
   wall name stays `"Wall"`; ground normal stays `[0,0,1]`; wall default normal →
   `[0,1,0]` (vertical wall spanning X–Z). In 2D mode `spawnFromTool` must set a
   spawned wall's normal to `[1,0,0]` (a wall is a vertical line in the X–Z workspace).
3. **Selection bug fix** (`src/stores/sceneStore.ts`): `axisArrowsId` now mirrors
   `selectedId` in `setSelected` (select → arrows, deselect → none, select another →
   arrows follow). `resetToInitial` keeps arrows for a preserved selection.
   Keep: picking a palette tool or deleting clears arrows (existing behavior).
4. **Gizmo/arrows wiring** (`Canvas3D.tsx`, `Canvas2D.tsx`): arrows render when
   `axisArrowRef && !simRunning && gizmoMode === "translate"`; `TransformGizmo` renders
   when `selected && !simRunning`, with `mode = gizmoMode` for bodies AND statics
   (translate for other categories). 3D translate mode shows ONLY the X and Y handles
   (`showZ=false`) — this also yields the XY-plane handle = free horizontal drag&drop.
   2D translate keeps X+Z. Rotate mode: 3D = all three rings, 2D = Y ring only.
5. **Physics** (`src/physics/engine.ts` `buildStatic`): rotate the half-space normal by
   `stat.rotation ?? [0,0,0,1]` (`rotateVec3ByQuat`); in 2D mode project the rotated
   normal into the X–Z plane and renormalize (fallback `[1,0,0]` when degenerate).
6. **Shared helper** (implemented by [Render-3D] in `src/render/entities/positions.ts`,
   pure math via `src/math/rotation.ts`, NO three.js imports):
   - `staticBaseQuat(normal: Vec3): Quat` — quaternion rotating +Z onto `normal`
     (180° about X when normal ≈ −Z).
   - `staticWorldQuat(stat: StaticEntity): Quat` — `quatMultiply(staticBaseQuat(stat.plane.normal), stat.rotation ?? IDENTITY)`.
   `sceneStore.writeTransform` (statics branch) stores `relQuat =
   quatMultiply(quatInvert(staticBaseQuat(normal)), worldQuatFromGizmo)` and clamps the
   position as today (2D: Y=0; 2D rotation: Y-component only, like bodies).
7. **Inspector** (`src/ui/inspector/Inspector.tsx`): StaticInspector gains a
   "Transform" section with Position (x/y/z, `stat.position ?? [0,0,0]`) and
   "Rotation (deg)" (rx/ry/rz, from `stat.rotation ?? identity`, relative to initial
   orientation) + a Hint. MeterInspector gains Position fields (`meter.position`).
   InspectorHeader Move/Rotate buttons shown for bodies AND statics.
8. **Palette** (`src/ui/palette/SpawnPalette.tsx`): ground tool label
   `"Ground"` → `"Horizontal plane"`.
9. **E2E observability** (implemented by [Render-3D] in `src/main.tsx`): dev/test-only
   hook — when `import.meta.env.DEV || import.meta.env.MODE === "test"`, expose
   `window.__mechlab = { scene: useSceneStore, telemetry: useTelemetryStore }`
   (never in production builds).
10. **Toolchain (this machine)**: system `node` is v15 (Emscripten) — too old for
    Vite 6. Use Node 24 bundled with the harness:
    `C:\Users\rogoveshko\AppData\Local\Programs\DeepSeek Harness\resources\runtime\primary-runtime\dependencies\node\bin\node.exe`
    — run vite/tsc/vitest/playwright via `& $env:NODE24 <cli-js>`. No cargo on this
    machine and no Rust files change in this task → `cargo check` N/A.
11. **E2E infra** ([QA-Verifier]): `@playwright/test` + chromium. Vite alias
    `@tauri-apps/api/core` → `src/test/browserMock.ts` (plain JS in-memory invoke,
    NO vitest imports) gated behind env var `MECHLAB_E2E=1` in `vite.config.ts`
    (production path untouched). Playwright `webServer` runs
    `E2E env vite dev --port 5199 --strictPort`. Browser mock pre-seeds a
    `demo.mech.json` default 3D project so the app auto-loads a scene.

## Subtasks & progress

### A. [Core-Rust] — schema/defaults/sceneStore + store tests
- [x] A1 `StaticEntity.rotation?: Quat` in `src/core/types.ts` + `#/definitions/quat` ref in `src/core/schema.json` static definition.
- [x] A2 defaults: names ("Horizontal plane", "Wall"), wall normal `[0,1,0]`.
- [x] A3 `spawnFromTool`: 2D wall normal `[1,0,0]`.
- [x] A4 `setSelected` arrows-follow-selection + `resetToInitial` arrows preserve.
- [x] A5 `writeTransform` statics: position + relative rotation (contract §6).
- [x] A6 Update `src/stores/__tests__/sceneStore.test.ts` (arrows behavior + statics rotation write).

### B. [Render-3D] — viewport gizmos, entities, inspector, palette, dev hook
- [x] B1 `positions.ts`: `staticBaseQuat`, `staticWorldQuat` (contract §6).
- [x] B2 `TransformGizmo`: axis-restriction prop for translate (3D → X/Y only), statics rotate support.
- [x] B3 `Canvas3D.tsx` + `Canvas2D.tsx`: arrows/gizmo wiring (contract §4).
- [x] B4 `StaticEntity.tsx` (3D) + `FlatBodies.tsx` StaticEntity2D: apply relative rotation (3D: base×rel; 2D: Y-only rel).
- [x] B5 `Inspector.tsx`: StaticInspector Transform section, MeterInspector position, header Move/Rotate for statics.
- [x] B6 `SpawnPalette.tsx`: "Horizontal plane" label.
- [x] B7 `main.tsx`: `window.__mechlab` dev hook (contract §9).

### C. [Physics-Math] — rotated-static colliders + physics tests
- [x] C1 `engine.ts` `buildStatic`: rotated half-space normal + 2D projection (contract §5).
- [x] C2 Physics test: default wall normal `[0,1,0]`; rotated static = inclined plane,
      sliding acceleration matches analytic `a = g·sinθ` (μ=0) within tolerance.
- [x] C3 Physics test: ground stays passable at z=0 (seeded project drop settles ≥ 0).

### D. [QA-Verifier] — build gates + Playwright E2E (task T4)
- [x] D1 `npm install` complete (background job), deps usable under Node 24.
- [x] D2 `tsc --noEmit` + `vite build` (Node 24).
- [x] D3 `vitest run` — all unit/physics tests green (incl. updated store tests).
- [x] D4 Playwright setup: install `@playwright/test` + chromium; `e2e/playwright.config.ts`
      with `webServer` (vite dev, port 5199, `MECHLAB_E2E=1`), `src/test/browserMock.ts`,
      vite alias (contract §11).
- [x] D5 E2E-1: app loads, canvas mounts, zero console/page errors.
- [x] D6 E2E-2: create object via palette + canvas click → selected, inspector shows name,
      axis arrows id set (T2); deselect (click empty) → arrows cleared; reselect → arrows
      back (bug fixed).
- [x] D7 E2E-3: set Position z = 5 in inspector (T1 right-panel coordinates) → store reads z=5.
- [x] D8 E2E-4: click Play → object drops (telemetry z decreases, rests ≈ ground level),
      energy HUD visible; Pause/Reset works.
- [x] D9 E2E-5: palette shows "Horizontal plane"; spawned ground name/normal; spawned wall
      normal `[0,1,0]`; static rotation input (e.g. ry=30°) stored as quaternion (T3).
- [x] D10 `npm run build` final + full test report; screenshots as artifacts.

## Execution log

- 2026-11-25 — Lead: repo inspected; contracts defined above; `npm install` started as
  background job (pwsh-ea6f23ed08224ca3) with `--package-lock=false` (system npm 7 cannot
  write lockfile v3; Node 15 cannot run Vite 6 → Node 24 from harness runtime used for
  all runs).
- 2026-11-25 — npm install: 313 packages; 3 packages (agent-base, http-proxy-agent,
  https-proxy-agent, needed by jsdom) had broken dist/index.js from EPERM unlink churn;
  repaired deterministically via `npm pack` + `tar -xzf --strip-components=1`. Toolchain
  sanity: vite 6.4.6 + vitest 3.2.7 run fine under Node 24 (`tsc` 5.7.3 OK).
- 2026-11-25 — core-agent [Core-Rust] DONE: types/schema (position+rotation on
  statics), defaults (names "Horizontal plane"/"Wall", wall normal [0,1,0]), sceneStore
  (arrows follow selection, reset preserves, 2D wall normal [1,0,0], writeTransform
  statics relative rotation), store tests updated + 3 new. tsc clean; sceneStore tests
  18/18, validator 12/12. Note for QA: inspector rotation inputs edit the RELATIVE quat
  directly; gizmo path stores rel = base⁻¹×world (base = staticBaseQuat(normal)).
- 2026-11-25 — physics-agent [Physics-Math] DONE: engine.ts `effectiveStaticNormal`
  (rotate half-space normal by relative quat; 2D X–Z projection + fallback) wired into
  buildStatic; new staticsRotation.test.ts (5 tests): default contracts, 20°-tilted wall
  slide matches a = g·cos20° within 0.02% (control run free-falls), 2D projection +
  fallback + supported-drop, default-ground rest. Full physics+math suites 54/54, tsc clean.
- 2026-11-25 — Lead integrated review: tsc --noEmit clean across all three agents' work;
  diffs reviewed (sceneStore arrows-follow-selection, TransformGizmo translateAxes,
  Canvas3D/Canvas2D wiring, static render rotation, inspector, palette, engine). QA agent
  launched: build gates + browser Tauri mock + Playwright suite; robustness notes sent
  (spawn off-center to avoid seeded Box 1 overlap; deselect via sky-corner click).
- 2026-11-25 — Three implementation subagents launched in parallel: core-agent
  [Core-Rust], render-agent [Render-3D], physics-agent [Physics-Math]. Playwright
  (@playwright/test + chromium) installing in background job pwsh-7614566f8fce4916.

- 2026-11-25 — qa-agent [QA-Verifier] DONE — ALL GATES GREEN (two consecutive e2e runs):
  tsc 0 errors; vitest 116/116 (12 files incl. new staticsRotation 5); vite build clean
  (worker chunk emitted); Playwright e2e 7/7 (~17–19 s) with browser Tauri mock
  (src/test/browserMock.ts + MECHLAB_E2E-gated vite alias + e2e/playwright.config.ts +
  e2e/dev-server.cmd + e2e/tests/{app.spec.ts,helpers.ts}); artifacts
  e2e/artifacts/{spawn-arrows,drop-resting,statics-rotated}.png; zero console/page errors;
  package-lock.json byte-identical. QA observations (no prod changes made): (1) Reset
  restores the load-time snapshot — unsaved edits are discarded by design (tooltip says
  "last loaded / saved state"); e2e saves before Play to pin the reset check. (2) Fresh
  dev cache triggers one vite page reload on first Play (rapier3d-compat lazy dep
  discovery) — mitigated for the e2e server via MECHLAB_E2E-gated optimizeDeps.include;
  follow-up candidate for normal dev. (3) TransformControls "update() deprecated"
  console WARNINGS only (pre-existing three-stdlib noise).
- 2026-11-25 — Lead final verification (first-hand, Node 24): tsc exit 0 · vitest
  116/116 · vite build clean (physics.worker chunk 2.78 MB) · Playwright 7/7 (16.8 s).
  All four user tasks complete; TASK_PROGRESS.md checkboxes closed.

### Round-2 execution log (regressions found by the user after round 1)

- 2026-11-25 — Environment: user committed round 1; a dependency re-sync had removed the
  `--no-save` Playwright install. Re-added `@playwright/test@^1.65.1` properly with
  npm 10.9.2 running under Node 24 (lockfileVersion 3 preserved, package.json + lock now
  consistent; chromium cache intact).
- 2026-11-25 — Live browser diagnostic (headless Playwright + projected-camera drags)
  reproduced both user reports: (a) only TransformControls handles/arrows moved objects —
  pressing the object BODY did nothing; (b) after Play → Pause the rendered mesh stayed
  pinned to the simulated pose (measured store [2.13, 0.33, 0.5] vs render
  [1.62, -0.03, 4.50]) because PhysicsDriver re-applied the last snapshot every frame.
- 2026-11-25 — core-fix [Core-Rust]: `telemetryStore.viewPose` (true only for play/step),
  `pause()` drops the transient snapshot, auto-stop-on-edit subscription, Reset =
  `resetToInitial()` + `stop()` (App.tsx); 8 new ownership tests
  (`telemetryOwnership.test.ts`). tsc clean; store tests 26/26.
- 2026-11-25 — render-fix [Render-3D]: direct BODY drag&drop in EntityGroup (3D horizontal
  X–Y plane, 2D X–Z plane, grab-offset delta, camera controls locked, click≠drag epsilon,
  bodies grab-first / statics select-first), `gizmoHandleAxis` guard,
  `pointerPlane.ts` helper, PhysicsDriver/Canvas3D/Canvas2D gated on
  `simulated = running || viewPose`. Live browser checks: 3D drag store==render with Z
  unchanged; Play→Pause releases the pose back to the edit state; 2D X/Z drag correct.
- 2026-11-25 — qa-fix [QA-Verifier]: updated `app.spec.ts` test 5 (Pause releases pose,
  Reset → idle/ready false, render==store) and added `regressions.spec.ts` (5 tests:
  body drag + mesh follows; click-only no write; Play→Pause→drag→inspector edit;
  +Z arrow after sim raises Z; Reset returns to the editor) + `getRenderTransform`/
  `projectWorld` helpers. Reported a pre-existing defect: the click synthesised at the
  end of an arrow/gizmo drag re-selected the ground behind the pointer.
- 2026-11-25 — Lead fix: `EntityGroup.handleClick` / `useSelectionHandlers.onClick`
  ignore R3F click events with `e.delta > 4`, so drag releases never steal the selection.
  QA strengthened regressions tests 1 & 4 to assert `selectedId`/`axisArrowsId` stay on
  the box after the drags; artifact `arrows-after-sim.png` now shows BODY → Box 1 selected.
- 2026-11-25 — Final gates (first-hand, Node 24): tsc exit 0 · vitest **124/124** (13 files)
  · vite build clean (3315 modules) · Playwright **12/12** (47.9 s); QA ran the full suite
  twice more, 12/12 both times. R1–R4 closed.

## Round 3 (user request, 2026-11-25 night)

- [x] **P1** — Make the left (Spawn Palette) and right (Inspector) panels RESIZABLE by
  dragging a vertical divider; sensible min/max widths, double-click reset, keyboard
  support; canvas must reflow while dragging. Session-only widths (uiStore), no schema
  change. Add Playwright coverage (drag, clamp, reset, keyboard, palette/inspector still
  usable) + a vitest clamp test; all existing gates must stay green.

### Round-3 decisions

1. Widths live in `useUiStore` (`leftPanelWidth` default 192, `rightPanelWidth` default
   288) with clamping setters and `resetPanelWidths()`; exported constants
   `LEFT_PANEL_MIN/MAX` (160/420), `RIGHT_PANEL_MIN/MAX` (240/560) and defaults.
2. New `src/ui/layout/ResizeHandle.tsx`: `role="separator"`, `aria-orientation="vertical"`,
   `aria-valuemin/max/now`, `tabIndex=0`, pointer-capture drag (direction-aware delta),
   `Double-click` resets both widths, ArrowLeft/ArrowRight ±16 px, Home resets. During a
   drag a `resizing-panels` class on `<body>` sets `cursor: col-resize; user-select: none`.
3. `SpawnPalette` / `Inspector` accept a `width: number` prop and use
   `style={{ width }}` (replacing the fixed `w-48` / `w-72`); `App.tsx` owns the handles.

### Round-3 execution log

- 2026-11-25 — render-panels [Render-3D] DONE: uiStore constants + clampPanelWidth + width
  state/actions; new ResizeHandle (pointer capture, body drag class, keyboard, double-click
  reset, aria separator); `.resize-handle` styles in index.css; SpawnPalette/Inspector width
  props; App wiring (palette → left handle → main → right handle → inspector);
  Inspector.test renders updated with `width={288}`. Verified: tsc 0 errors, vitest 124/124,
  vite build ok; headless browser: 192/288 → left +100 = 292, right −80 = 368, keyboard
  ±16, Home/dbl-click reset, clamps 420/560, canvas reflows exactly by the same delta,
  body/data-dragging affordances on and off, no console errors.
- 2026-11-25 — Environment: recurring node_modules corruption (EPERM `.DELETE` remnants from
  the early npm-7 install) surfaced again; repaired permanently with a clean `npm ci` using
  npm 10.9.2 under Node 24 → 319 packages, zero `.DELETE` remnants, @playwright/test 1.65.1
  + chromium intact, lockfile untouched (v3).
- 2026-11-25 — qa-panels [QA-Verifier] launched: uiStore clamp unit tests + panels e2e spec
  (initial widths, both drag directions, canvas reflow, clamps, reset, keyboard,
  pointercancel cleanup, panels still usable, zero console errors) + full gates ×2.
- 2026-11-25 — qa-panels DONE: `uiStore.test.ts` (11 tests: defaults, clamp matrix incl.
  NaN/±Infinity/rounding, both setters, reset, project-manager flag untouched) and
  `e2e/tests/panels.spec.ts` (9 tests: initial 192/288 with canvas 1108, left drag +100 →
  palette 292, right drag −80 → inspector 368, clamps 160/240 with further drags bounded,
  double-click resets both, keyboard 192→208→224→208→Home→192/288 with aria-valuenow,
  mid-drag `resizing-panels` + `data-dragging` cleared by a real pointercancel with a
  working follow-up drag, 350/350 usability, zero console errors); artifact
  `panels-resized.png`. Also found: `preventDefault()` on pointerdown suppressed focus.
- 2026-11-25 — Lead a11y polish: `ResizeHandle.handlePointerDown` now calls
  `event.currentTarget.focus({ preventScroll: true })` so click-then-arrow-keys works;
  QA re-tested with a real click + `document.activeElement` assertion (no programmatic
  focus fallback).
- 2026-11-25 — Final gates (first-hand, Node 24): tsc exit 0 · vitest **135/135** (14 files)
  · vite build clean (3316 modules) · Playwright **21/21** (2.0 m); QA ran the full suite
  twice more (21/21 both). P1 closed; node_modules repaired via clean npm ci (319 pkgs).

## Blocked / Needs Input

(none)
