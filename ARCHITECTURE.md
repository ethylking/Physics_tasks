# ARCHITECTURE.md — 2D/3D Classical & Theoretical Mechanics Simulator

**Version** 2.0 (post-review) · **Status** Implementation blueprint · **Audience** AI/vibe-coding agents, maintainers
**Companion** `SPEC.md` (superseded where contradicted; this document is authoritative)

### Revision 2.0 changelog (Lead-Engineer review)
1. **Scope split** — Domain Catalog & Schema are now **Tier 1 (Core MVP)** vs **Tier 2 (Modular Extensions, plug-in).**
2. **Rope desync removed** — deleted the "Tier A analytic ODE bypass"; all ropes/pulleys are Rapier-integrated (§2.1).
3. **SAB removed** — snapshot transport is `postMessage` + **Transferable `Float32Array`** (§5.2).
4. **Rolling simplified** — native friction first; ideal rolling is an optional post-step projection, not a custom solver (§2.5).
5. **5-Milestone roadmap** — every milestone compiles, runs `npm run tauri dev`, and is visually verifiable (§6).

---

## 0. Purpose & Reading Guide

| # | Layer | Question it answers |
|---|-------|---------------------|
| 1 | Domain Catalog (Tiered) | *What* physics must ship in v1.0 vs. later? |
| 2 | Formulations | *How* is each phenomenon reduced to Rapier3D? |
| 3 | Schema (Tiered + plug-in) | *What* is the serialized truth of a project? |
| 4 | Stability | *Where* does it break, and how do we catch it? |
| 5 | Architecture | *How* do processes/threads/UI cooperate at scale? |
| 6 | Roadmap | *In what order* do we build it so it always runs? |

**Hard rule for v1.0:** nothing in **Tier 2** blocks the MVP. Tier 2 entities are loadable *only* if their plugin is registered; the core never depends on them.

---

# 1. DOMAIN CATALOG (Tier 1 vs Tier 2)

## 1.1 Tier 1 — Core MVP (must ship)

| Category | Entities | Notes |
|---|---|---|
| **Bodies** | Box (per-face `μ₁…μ₆`), Sphere (solid/hollow), Ellipsoid, Cylinder/Disk/Hoop, Rod/Beam (`λ(x)` optional), Wedge (fixed/dynamic) | CoM offset + Steiner inertia on all |
| **Statics** | Wall/Plane, Ground | CCD, per-surface `μ`, `e` |
| **Joints** | Revolute, Spherical, Prismatic, Fixed/Weld | with joint friction/damping/limits |
| **Springs** | Spring–damper (`k`, `L₀`, `c`) | soft-constraint fallback for stiff `k` |
| **Ropes/Pulleys** | Pulley (fixed/movable, with `I`, axle friction), Massless rope, Massive rope/chain | §2.1 — fully Rapier-integrated |
| **Forces** | External force `F(t,x,y,z)`, External torque `M(t,x,y,z)`, Thruster | mathjs-compiled expressions |
| **Meters** | Hover telemetry, vector overlays (`v,a,a_τ,a_n,mg,N,F_f,T`), trajectory tracer, energy monitor, momentum/angular-momentum monitor | |

## 1.2 Tier 2 — Modular Extensions (post-MVP, plug-in)

Each is a self-contained **entity plugin** (§3.4): registers schema fragment, defaults, Rapier factory, inspector panel, and ghost preview. Not loaded unless enabled.

| Category | Plug-ins |
|---|---|
| **Bodies** | Convex hull, Composite (welded), Annular/thick cylinder, Thin plate, Sector, Variable-mass body (rocket), Gyroscope/rotor |
| **Joints/constraints** | Rolling (ideal), Gear, Rack & pinion, Belt/chain drive, Torsion spring, Motor/servo, Cylindrical, Universal, Planar, Point-on-plane/curve, Curvilinear prismatic |
| **Forces** | Linear drag, Quadratic drag, Coulomb friction, Central force, Point-gravity field, Inertial pseudo-forces (non-inertial frames) |
| **Ropes** | Catenary (static), Belt over pulleys (capstan/Euler–Eytelwein) |
| **Meters** | Center of percussion/oscillation, Instantaneous center of rotation, Static equilibrium solver, Normal-mode analyzer, Phase portrait, Collision impulse recorder, Constraint reaction readout |

> **Tier 2 rule:** the core loader preserves unknown `kind` JSON verbatim and emits a warning (forward-compatible), but never blocks load.

---

# 2. PHYSICS & MATHEMATICAL FORMULATIONS

## 2.1 Ropes & Pulleys — Unified, Rapier-Integrated (no analytic bypass)

**Non-negotiable:** every rope lives inside the Rapier world. There is no separate ODE solver. A hanging mass that collides with a wall/wedge is just a normal contact — no state desync is possible.

### 2.1.1 Massless inextensible rope
- Represent as a chain of **native Rapier distance joints** between consecutive **wrap-anchor points**.
- **Wrap-anchors are dynamic:** tangent points on the pulley rim recomputed each substep, `r_rim = r_center + R·n̂_tangent`, owned by the pulley body so they rotate/translate with it.
- **Tension** is recovered from distance-joint constraint impulses (`ImpulseJointSet` read-back), then rendered as the `T` overlay vector.
- **Pulley inertia `I`** is a real rigid body: revolute joint + `setAdditionalMassProperties(m_p, CoM, I, frame)`. The `a = αR` coupling is enforced by the solver with **increased iterations** (§4.4). Groove friction is a `friction` coefficient on a thin rim collider; capstan slip emerges from Rapier contact — no special solver.
- **Atwood / `I/R²` accuracy:** a "pulley coupling" helper adds a torsional constraint tying the pulley body's rotation to rope-anchor displacement. Still a Rapier joint, never an external ODE.

### 2.1.2 Massive rope / chain
- Discretize into **N rigid capsule/sphere segments** (`N ≈ 20–200`), each a small Rapier body with `mᵢ = λ·L/N` (or `M/N`).
- Link consecutive segments with **spherical joints** (3D) or **revolute joints** (2D); optional per-joint angular damping tunes sag.
- Solve **inside the same fixed tick**. If links go stiff, run **XPBD sub-steps on the link constraints within the same accumulator** — same world, same step, no second solver.
- Segments carry colliders, so chains dragging over pulleys/tables use native contact.

**Pulley dynamics reference (for UI defaults & telemetry, not a separate solver):**
```
(T₁ − T₂)R − τ_f = I·α ,  a = αR
⇒ a = [g(m₁−m₂) − τ_f/R] / (m₁ + m₂ + I/R²)
```
These equations validate the Rapier result in the **energy/acceleration meter**, they never drive motion.

## 2.2 Per-Face Friction on Composite Colliders
- Rapier = one `friction`/`restitution` per collider. For `μ₁…μ₆`, decompose the box into **six thin face colliders** (slabs, `ε ≈ 0.02·min dim`) on the *same* rigid body, each with its own `friction`/`restitution` and a collision group so faces don't self-collide.
- **Mass once:** set the body's mass properties from the *nominal* box; the face slabs are massless shells.
- **Seam artifacts:** overlap slightly, and enable `ccdEnabled` for extreme `μ` or fast/heavy cases. Fallback (if a Rapier version shows seams): override per-pair friction via contact-modification hooks.

## 2.3 Arbitrary Center of Mass & Inertia (Steiner / Parallel-Axis)
```
I_O = I_CM + m(|d|²E − d⊗d) ,   d = r_CM − r_ref
I_CM = I_O − m(|d|²E − d⊗d)
```
Pipeline: (1) analytic `I_geo` at geometric center → (2) shift to actual CoM → (3) rotate `I_world = R I_CM Rᵀ` → (4) **diagonalize** to principal moments/axes for Rapier's `setAdditionalMassProperties(mass, CoM, principalAngularInertia, angularInertiaLocalFrame)`.
- Composites: sum member inertias, each parallel-axis-shifted to the composite CoM.
- Rod `λ(x)`: numeric `M = ∫λ dx`, `r_CM = (1/M)∫λx dx`, `I_CM = ∫λ(x−x_CM)² dx` (Gauss–Kronrod).
- **UX invariant:** dragging the CoM offset moves only the mass-properties pivot, never the collider geometry. Render geometric-center and mass-center as distinct markers.

## 2.4 Tunneling (CCD) & High Mass Ratios
- `ccdEnabled` on: fast bodies (`|v|Δt > 0.5·min dim`), small bodies (`min dim < 0.1 m`), all walls/planes. CCD on the *moving* body.
- **Mass ratio:** clamp dynamic ratio to `1e4` (warn); `>1e6` → use `Static`/`Kinematic` status (or `lockTranslations/lockRotations`), never a huge mass number. Increase solver iterations for heavy stacks (§4.4).

## 2.5 Rolling Without Slipping
- **Default (ship this):** Rapier native **friction** + **high solver iterations** (+ `additionalFrictionIterations`). With `μ ≳ 1` and enough iterations, disks/cylinders/spheres roll with negligible slip for demos. No custom solver.
- **Optional "ideal analytical rolling" toggle (Tier 2):** a minimal **post-step velocity projection** applied *after* Rapier's solver in the same substep — project the contact-point velocity `v_contact = v_CM + ω×r_contact` to zero along the **tangent plane only** (never the normal). This is a single linear projection gated by `|v_contact| < ε` and `F_friction ≤ μ_s N`, so it doesn't fight PGS or inject energy. Off by default; enable only for cycloid-tracing accuracy.

## 2.6 Collisions, Restitution & Impulse Recording (Tier 2 for recording)
- Rapier handles response; expose `restitution` per collider/face. For impulse recording, subscribe to `CollisionEvent`/`ContactForceEvent` and push `(J, normal, point, Δv)` to a ring buffer. Perfectly-inelastic `e=0`; optional weld-on-impact (ballistic pendulum) via post-contact callback.

## 2.7 Statics — solid floors vs. two-sided surfaces
A static plane is one of two physical objects, selected by `solid`:
- **Solid floor (`solid: true`)** — Rapier `HalfSpace(n̂)`: the `−normal` side is filled, so no body can exist under the plane. This is the project's solid bottom (the seeded ground); its plane passes through `position`.
- **Surface (`solid: false`)** — a thin, two-sided `cuboid` slab of `plane.extent` (`STATIC_SURFACE_THICKNESS = 0.04 m`) and shifted half a thickness to the `−normal` side so the slab's `+normal` face is **flush with the visible plane**. Bodies rest on it, may exist on **both** sides, and the slab still blocks crossing from either side. Walls, ceilings, platforms and every palette-placed plane are surfaces.
- **One collider frame.** The collider is oriented by the *rendered* world quaternion (`baseQuat(normal) · rotation`; 2D: the base orientation of the projected normal) and **both** the half-space normal and the flush offset are derived from that frame's local `+Z`. Composing the normal separately would diverge from the drawing whenever the relative rotation does not commute with the base orientation (e.g. a spin about the plane's own normal). In 2D the slab's in-plane length follows the drawn line (`FlatBodies`): `extent[1]` for a wall's vertical line, `extent[0]` for a ground's horizontal line.
- **Legacy rule** — when `solid` is absent: `kind === "ground"` ⇒ solid, `"wall"` ⇒ surface; on load the value is baked into the project (`applyStaticSolidityDefaults`: the FIRST ground is the seeded floor, any later ground plane becomes a surface).
- **CCD:** because a 4 cm slab can be tunnelled (a half-space cannot), every moving body — including chain-rope segments — gets CCD whenever the scene contains a surface static.

---

# 3. COMPLETE JSON SCHEMA (`.mech.json`)

## 3.1 Project root
```ts
type Vec3 = [number, number, number];
type Quat = [number, number, number, number];   // x,y,z,w
type Expr = string;                              // mathjs string, "" = constant
type UUID = string;
interface Scalar3 { x: Expr; y: Expr; z: Expr; }

interface MechProject {
  schemaVersion: 2;
  meta: { id: UUID; name: string; mode: "2D"|"3D"; createdAt: string; modifiedAt: string; description?: string };
  world: WorldSettings;
  enabledPlugins: string[];            // Tier 2 kinds the user enabled
  bodies:  RigidBodyEntity[];
  statics: StaticEntity[];
  joints:  JointEntity[];
  forces:  ForceEntity[];
  ropes:   RopeEntity[];
  meters:  MeterEntity[];
  cameras: CameraState;
  _raw:    Record<string, unknown>;    // preserved unknown/forward-compat entities
}

interface WorldSettings {
  gravity: Vec3;                     // right-handed Z-up; default [0,0,-9.81]
  timeScale: number;                 // 1
  fixedDt: number;                   // 1/120 | 1/240
  solverIterations: number;          // 4
  additionalFrictionIterations: number; // 4
  internalPgsIterations: number;     // 1
  maxMassRatio: number;              // 1e4
  contactTolerance: number;          // 0.005
}
```

## 3.2 Tier 1 entities (Core — full spec)

```ts
// Bodies
type Tier1BodyKind = "box"|"sphere"|"ellipsoid"|"cylinder"|"rod"|"wedge";
interface RigidBodyEntity {
  id: UUID; name: string; kind: Tier1BodyKind | string;   // string = Tier2 plugin kind
  tier: 1 | 2;
  geometry: {
    box:      { W:number; H:number; D:number };
    sphere:   { R:number; shell:boolean };
    ellipsoid:{ a:number; b:number; c:number };
    cylinder: { R:number; H:number; hollow:boolean };
    rod:      { L:number; thickness:number; densityExpr?:Expr };
    wedge:    { thetaDeg:number; W:number; H:number; D:number; dynamic:boolean };
  }[Tier1BodyKind] | Record<string, unknown>;   // Tier2 payload = plugin schema
  mass: { value:number; mode:"total"|"density" };
  centerOfMass: Vec3;
  inertia?: { I:[number,number,number]; principalFrame:Quat };
  friction: number; restitution: number;
  faceFriction?: number[];             // 6 values, box
  ccd: boolean;
  collisionGroups: { memberships:number[]; filters:number[] };
  linearDamping: number; angularDamping: number;
  initial: { position:Vec3; rotation:Quat; velocity:Vec3; angularVelocity:Vec3 };
  locks: { translate:[boolean,boolean,boolean]; rotate:[boolean,boolean,boolean] };
  appearance?: { color:string; opacity:number };
}

// Statics
interface StaticEntity {
  id: UUID; name: string; kind: "wall"|"ground";
  plane: { normal:Vec3; extent:[number,number] };
  /** true = infinite SOLID half-space (floor, nothing under it); false = thin two-sided surface of `extent`. */
  solid?: boolean;
  position?: Vec3;
  rotation?: Quat;
  friction: number; restitution: number; ccd: boolean;
  appearance?: { color:string; opacity:number };
}

// Joints (Tier 1)
type Tier1JointKind = "revolute"|"spherical"|"prismatic"|"fixed";
interface JointEntity {
  id: UUID; name: string; kind: Tier1JointKind | string; tier: 1|2;
  bodyA: UUID|null; bodyB: UUID|null;   // null = world
  anchors: { a:Vec3; b:Vec3 };
  axis?: "x"|"y"|"z"|"custom"; axisVec?: Vec3;
  revolute?:  { friction:number; damping:number; limits?:[number,number] };
  prismatic?: { friction:number; limits?:[number,number] };
  // Tier 2 payloads (gear, rolling, motor, …) live in `_raw`/plugin schema
}

// Forces (Tier 1)
type Tier1ForceKind = "external"|"torque"|"thruster"|"spring";
interface ForceEntity {
  id: UUID; name: string; kind: Tier1ForceKind | string; tier: 1|2;
  body: UUID|null;
  anchor?: Vec3; localFrame?: boolean;
  components?: Scalar3;                 // external/torque, Expr per axis
  spring?: { k:number; restLength:number; damping:number; anchorB:UUID; anchorBPoint:Vec3 };
  enabled: boolean;
  appearance?: { color:string; scale:number };
}

// Ropes (Tier 1)
type Tier1RopeModel = "massless"|"chain";
interface RopeEntity {
  id: UUID; name: string; model: Tier1RopeModel | string; tier: 1|2;
  path: { anchorId:UUID; point:Vec3 }[];
  pulleys?: UUID[];
  massless?: { inextensible:boolean };
  chain?: { mass:number; segments:number; stiffness:number; damping:number };
  appearance?: { color:string; thickness:number };
}

// Meters (Tier 1)
type Tier1MeterKind = "telemetry"|"vectors"|"trajectory"|"energy"|"momentum";
interface MeterEntity { id:UUID; name:string; kind:Tier1MeterKind|string; tier:1|2; target?:UUID; output?:"hud"|"plot"|"export"; }

// Camera
interface CameraState {
  mode:"perspective"|"orthographic"; position:Vec3; target:Vec3; up:Vec3; fov:number; zoom:number;
}
```

## 3.3 Tier 2 as plug-in entity types
Tier 2 kinds are **not** hard-coded in the core schema. They are declared by an `EntityPlugin`:

```ts
interface EntityPlugin<K extends string = string> {
  kind: K;
  tier: 2;
  schema: JSONSchema;             // validates the payload in `_raw[kind]` / `geometry`
  defaults: Record<string, unknown>;
  factory: "rapier" | "custom";   // how the entity is built at load
  inspector: string;              // React inspector panel id
  ghost: string;                  // ghost-preview component id
}
```
- Loader lookup: `plugins[kind] ?? preserve-in-_raw`. Unknown kinds never fail the load; they round-trip untouched and show a "plugin missing" badge.
- Examples that ship as plugins later: `rolling`, `gear`, `rackPinion`, `belt`, `torsionSpring`, `motor`, `convexHull`, `variableMass`, `gyroscope`, `linearDrag`, `quadraticDrag`, `coulombFriction`, `central`, `pseudoForces`, `catenary`, `cop`, `icr`, `normalMode`, `phase`.

## 3.4 Validation rules
- All `body`/`anchor`/`pulley` references resolve or load fails with a **line-numbered diagnostic**.
- `expr` strings: parse + dry-run at load; unparsable → default `"0"` + warning (never silent).
- Unknown `kind` → preserve + warn (forward-compat), **except** unknown Tier-1 built-ins which are a hard error.

---

# 4. NUMERICAL STABILITY & EDGE CASES

## 4.1 Math-string failures (div-by-zero, NaN, Inf)
- Compile once, evaluate per-substep via cached mathjs closure. Any throw/`NaN`/`±Inf` → return `0`, log once (rate-limited).
- Static validation: reject `eval`, `Function`, `import`, assignments; whitelist `sin,cos,tan,asin,acos,atan,atan2,sinh,cosh,tanh,exp,log,log10,sqrt,abs,pow,sign,pi,e` + vars `t,x,y,z,vx,vy,vz,ωx,ωy,ωz`.
- Guard `1/0, 0/0, log(−x), sqrt(−x), asin(|·|>1), atan2(0,0), pow(neg,frac)`. Clamp `|F| ≤ 1e6 N`.

## 4.2 Energy drift in oscillators
- Keep Rapier's **semi-implicit (symplectic) Euler**; do not swap to RK4 for body integration.
- Ladder: smaller `fixedDt` for high-frequency oscillators → surface energy monitor (`δE/E₀`) → optional **energy clamp** (off by default, non-physical, educational only).

## 4.3 Stiff springs
- Explicit spring stable only for `Δt < 2/ω`, `ω=√(k/m_eff)`. Warn when `ω·Δt > 0.5`.
- For large `k`: **soft-constraint** `C = 1/k` in the PGS pass (implicitly stable); hard-cap `k`; chains/ropes use **XPBD sub-steps** instead of stiff springs.

## 4.4 Solver iterations (auto-tune)
- Default `(4,4,1)`. `+2` per extra body in a resting stack, per closed loop, or per mass ratio > `1e3`. Cap `(16,16,4)`. **Warm-starting stays ON.**

## 4.5 Coordinate convention & 2D-in-3D locking
- **World axes:** right-handed `+X` right, `+Y` depth, `+Z` up. The default horizontal ground plane is `X–Y`.
- **2D workspace:** the vertical `X–Z` plane; `locks.translate=[false,true,false]`, `locks.rotate=[true,false,true]`; zero `F_y`; `gravity.y=0`. Revolute axis auto-snapped to `y`; disallow 2D body + spherical joint.
- **Body geometry:** box `W→X, D→Y, H→Z`; cylinder/disk axis `+Z`; ellipsoid semi-axes `a→X, b→Y, c→Z`; wedge profile in `X–Z` extruded along `Y`.

## 4.6 Degenerate geometry
- Clamp dims to `ε_geo=1e-4 m`, `m_min=1e-6 kg`; reject zero principal moment. Warn (don't crash) on zero pivot offset.

## 4.7 Tunneling
- If `|v|Δt > 5·contactTolerance`, force `ccd` and/or reduce that body's effective `Δt`.

---

# 5. DIRECTORY STRUCTURE & STATE ARCHITECTURE

## 5.1 Directory layout (Tauri v2 + React + R3F + Zustand + Rapier3D)
```
physics_tasks/
├─ src-tauri/                       # Rust: native FS only, no physics
│  └─ src/{ main.rs, fs.rs, project.rs, csv.rs, commands.rs }
├─ src/
│  ├─ core/    { types.ts, schema.json, defaults.ts, plugins.ts, id.ts }
│  ├─ math/    { expr.ts, inertia.ts, centroid.ts }
│  ├─ physics/ { world.ts, factory.ts, ropes.ts, forces.ts, step.ts, snapshot.ts }
│  ├─ stores/  { sceneStore.ts, uiStore.ts, telemetryStore.ts, projectStore.ts }
│  ├─ render/  { Canvas3D.tsx, Canvas2D.tsx, entities/, gizmos/, overlays/ }
│  ├─ ui/      { palette/, inspector/, telemetry/, projectManager/, plots/, hud/ }
│  └─ workers/ { physics.worker.ts }
└─ projects/                        # next to the executable
```

## 5.2 Decoupled loop — `postMessage` + Transferable `Float32Array` (NO SharedArrayBuffer)
SAB requires COOP/COEP headers that break local asset loading in Tauri WebViews. **Do not use SAB.** Use standard `postMessage` with **Transferable buffers** (zero-copy ownership transfer).

```
MAIN THREAD (React, 60 Hz)                    PHYSICS WORKER (owns Rapier World)
R3F reads telemetryStore via refs        ←──  postMessage(Float32Array, [buf]) @60Hz
Controls dispatch commands               ──→  {type,payload} messages
```
- **Worker → UI snapshot:** the worker writes per-body `{pos[3], quat[4], linvel[3], angvel[3]}` + meter scalars into a reusable `Float32Array`, then `postMessage(buf, [buf.buffer])` — ownership transfers, the UI never copies. The worker allocates the next buffer from a small pool.
- **Transient store:** `telemetryStore` holds the *latest* buffer reference; R3F components read it via `useRef` inside `useFrame`. React does **not** re-render per physics frame — only `useStore(selector)` subscribers re-render.
- **Edit vs simulate:** edit = sceneStore authoritative, worker dormant, lazy `syncEdit` on change; simulate = sceneStore frozen, only telemetryStore churns. Pause just stops the accumulator; reset restores serialized initial state.

## 5.3 Determinism & replay
- Fixed `fixedDt` + fixed iterations + warm-start + no randomness → bit-reproducible per platform. Optional `.replay` sidecar stores the command log.

## 5.4 File I/O (Tauri v2)
- Rust commands: `listProjects, loadProject, saveProject` (atomic tmp→rename), `duplicateProject, deleteProject, exportCsv`. `projects/` next to the executable. Load validated against schema + semantic validator; errors → structured report, never a partial scene.

---

# 6. 5-MILESTONE IMPLEMENTATION PLAN

Each milestone **compiles, runs in `npm run tauri dev`, and is visually testable** before the next begins.

### Milestone 1 — Tauri v2 scaffold + Rust FS + Core schema
- `npm create tauri-app` (React+TS), confirm `npm run tauri dev` opens a window.
- Rust `fs.rs`/`project.rs`/`commands.rs`: `./projects/` CRUD (create/save/load/duplicate/delete), atomic writes.
- `core/types.ts` + `core/schema.json` + `core/defaults.ts` (Tier 1 only).
- **Verify:** save/load a hand-written `.mech.json`; invalid reference → line-numbered error dialog.

### Milestone 2 — R3F workspace + spawn palette + inspector
- R3F canvas, Perspective (3D) + Orthographic (2D) modes, Orbit/Map controls.
- Spawn palette with **ghost preview**, **anchor snapping** (CoM/face/vertex/rim), selection + `TransformControls`.
- Inspector panel incl. **per-face friction (6 fields)** and **CoM offset gizmo**.
- **Verify:** place bodies, drag CoM (geometry stays, marker moves), edit `μ` per face, save/load round-trip.

### Milestone 3 — Web Worker + Rapier3D fixed-step + inertia + mathjs
- `physics.worker.ts`: accumulator loop at `fixedDt`, `postMessage(Float32Array, [buf])` snapshots.
- `factory.ts`: Tier-1 bodies → Rapier (colliders, locks, CCD), `setAdditionalMassProperties` with `inertia.ts` (Steiner + diagonalize).
- `math/expr.ts`: compile/cache/guard mathjs (§4.1).
- **Verify:** spheres/boxes/cylinders fall & stack under gravity at stable 60fps; energy monitor reads ~constant for a dropped ball.

### Milestone 4 — Parametric forces + vector overlays + HUD
- Force arrows `F(t,x,y,z)` (mathjs) + torque + thruster.
- Live overlays `v, a, a_τ, a_n, mg, N, F_f`; hover telemetry HUD.
- **Verify:** `F(t)=5*sin(2*pi*t)` drives a mass; vectors track; `log(-1)`/`1/0` produce a warning, not a crash.

### Milestone 5 — Pulleys, ropes, springs, joints
- Revolute/spherical/prismatic/weld + spring-damper.
- Pulleys (rigid body + revolute, `I`) and ropes: massless (distance joints + dynamic rim wrap-anchors) and chain (N capsules + spherical joints). Groove friction via rim collider.
- **Verify:** Atwood acceleration matches `g(m₁−m₂)/(m₁+m₂+I/R²)` within tolerance (read via meter); chain sags and drags over a pulley without jitter; pendulum swings with correct period.

**Post-MVP:** begin Tier 2 plugins one at a time, each as a standalone `EntityPlugin` (§3.3), gated behind `enabledPlugins`.

---

**Version pins to verify before coding** (API drift only): Rapier mass-properties method name (`setAdditionalMassProperties` vs `setAdditionalMass`), CCD flag, solver-iteration field names; Tauri v2 `path`/`fs` command signatures.
