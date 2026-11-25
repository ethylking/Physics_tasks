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

## Blocked / Needs Input

(none)
