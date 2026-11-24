# MechLab — 2D/3D Classical & Theoretical Mechanics Simulator

Tauri v2 + React 18 + TypeScript + Tailwind CSS + Lucide React + three.js (R3F) + Rapier3D (WASM, in a Web Worker). See [`ARCHITECTURE.md`](./ARCHITECTURE.md).

## Milestone 3 (current)

**Deterministic rigid-body physics running in a Web Worker, driving the R3F meshes at 60 FPS.**

- **Math layer** (`src/math/`)
  - `inertia.ts` — §2.3 pipeline: analytic `I_geo` for all Tier 1 bodies (box / solid & hollow sphere / ellipsoid / solid & hoop cylinder / rod / wedge), rod `λ(x)` via Gauss-Simpson integration (exact M, r_CM, I_CM), wedge trapezoidal-prism centroid + inertia, **Parallel-Axis (Steiner) shift** `I_CM = I_geo − m(|d|²E − d⊗d)`, **Jacobi diagonalization** → principal moments (clamped ≥ 1e-9) + principal-frame quaternion.
  - `expr.ts` — §4.1 safe mathjs evaluator: static token rejection + **AST whitelist traversal** (20 functions, `pi/e`, 10 variables — anything else fails at compile time), runtime NaN/±Inf → 0 with rate-limited warnings, magnitude clamp ±1e6.
- **Physics engine** (`src/physics/engine.ts`, `snapshot.ts`) — worker-agnostic Rapier3D wrapper with **verified API pins** (rapier3d-compat 0.14): `setAdditionalMassProperties` + `ColliderDesc.setMass(0)/setDensity(0)` (no double mass), `world.integrationParameters.{dt,numSolverIterations,…}`. Implements §2.2 **per-face friction** (6 massless face slabs with distinct collision groups), §2.4 CCD auto-tune + mass-ratio clamp 1e4, §4.4 solver auto-tune capped (16,16,4), §4.5 2D locking, §4.2 energy meters (E_k linear+rotational, E_p, total, drift).
- **Worker** (`src/workers/physics.worker.ts`) — fixed-timestep accumulator (frameDt clamp 0.05 s spiral guard), commands `initWorld/play/pause/stepOnce/reset/setTimeScale/updateGravity`, 60 Hz snapshots via **Transferable Float32Array** (no SharedArrayBuffer), message queue serialized against async WASM init.
- **Transient telemetry** (`src/stores/telemetryStore.ts`) — latest snapshot lives OUTSIDE reactive state (read inside `useFrame`); only the HUD re-renders (~10 Hz). `render/PhysicsDriver.tsx` writes mesh transforms directly from the registry.
- **UX** — Play / Pause / Step / Reset in the top bar; edit gizmos, palette and inspector lock while running; Reset restores the exact edit state; compact **Energy & Time HUD** (t, E_k, E_p, ΣE, ΔE %).

## Milestones 1–2 (done)

Tauri scaffold + Rust FS + core schema + validator · R3F CAD workspace (spawn palette, anchor snapping, transform gizmos, CoM markers, per-face friction editor, inspector) — see git history / README structure below.

## Commands

```bash
npm install           # frontend dependencies
npm run tauri dev     # run the desktop app (Rust + Vite dev server)
npm test              # npx vitest run — 81 tests, no Rust binary needed
npm run build         # typecheck + production bundle (incl. the physics worker)
cargo check           # inside src-tauri/ — verify the Rust backend compiles
cargo test            # inside src-tauri/ — Rust fs/project unit tests
```

### Runtime smoke test (CDP)

```powershell
# Launches the app with WebView2 remote debugging, drives it via the Chrome
# DevTools Protocol: DOM checks, canvas clicks (selection chain), 2D/3D
# screenshots, Play → energy HUD readout, console-error report.
powershell -File scripts/smoke-m2-cdp.ps1
```

## Layout

```
src-tauri/            Rust backend: main.rs, lib.rs, fs.rs, project.rs, commands.rs
src/
  core/               types.ts, schema.json, defaults.ts, plugins.ts, id.ts, validator.ts
  math/               rotation.ts, inertia.ts (Steiner + Jacobi), expr.ts (mathjs sandbox)
  physics/            engine.ts (Rapier factory + fixed step + meters), snapshot.ts
  workers/            physics.worker.ts (accumulator loop, Transferable snapshots)
  stores/             uiStore, projectStore, sceneStore (edit authority), telemetryStore (transient)
  render/             Canvas3D, Canvas2D, entities/, gizmos/, PhysicsDriver.tsx
  ui/                 TopBar, palette/, inspector/, projectManager/, hud/EnergyHud.tsx
  test/               vitest setup + Tauri backend mock
scripts/              smoke-m2-cdp.ps1 + cdp-smoke.mjs (CDP smoke harness)
projects/             user data, auto-created next to the executable (dev: workspace root)
```
