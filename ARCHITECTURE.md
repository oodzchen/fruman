# fruman Game Architecture

## Project Overview

A high-performance 2D side-scrolling fighting game built on an **ECS (Entity-Component-System)** architecture with **Web Worker multithreading**, targeting 60 FPS with 100+ characters on screen.

**Technology Stack**

| Category           | Technology                                                      |
| ------------------ | --------------------------------------------------------------- |
| Rendering          | Pixi.js v8 (WebGL by default, Canvas fallback, optional WebGPU) |
| Physics            | Box2D3-WASM v5.1                                                |
| Skeletal animation | Spine Pixi v4.2                                                 |
| Particle system    | @pixi/particle-emitter                                          |
| Geometry           | d3-delaunay, clipper2-wasm, poly-decomp-es                      |
| Editor canvas      | fabric.js v7                                                    |
| Build tools        | Vite v8 + TypeScript 5 strict                                   |
| Code quality       | ESLint v10 + Prettier                                           |

---

## Overall Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                      Browser Main Thread                         │
│                                                                  │
│ main.ts                                                          │
│ ├── GameClient                                                   │
│ │   ├── Pixi Application / Ticker                                │
│ │   ├── ClientRenderer (state decoding, HUD, and effect data)    │
│ │   ├── PixiWorldRenderer (world scene)                          │
│ │   ├── WorldLightingController / DayNightCycle                  │
│ │   └── AudioManager / MenuManager / LevelUpManager              │
│ ├── EditorManager                                                │
│ └── DisplayManager / InitializationManager                       │
└───────────────────────────────┬──────────────────────────────────┘
                                │ postMessage
                                │ SharedArrayBuffer / ArrayBuffer
┌───────────────────────────────▼──────────────────────────────────┐
│                         Worker Thread                            │
│                                                                  │
│ gameWorker.ts                                                    │
│ ├── Fixed-step loop (60 Hz)                                      │
│ ├── ECS World / EntityManager / ComponentRegistry               │
│ ├── Box2D WASM / SpatialHash / collision and map runtime         │
│ └── Input, camera, state export, loot, and breakable runtime     │
└──────────────────────────────────────────────────────────────────┘
```

---

## Thread Communication Protocol

```
Main Thread                                      Worker Thread
   │                                                 │
   │ ── MainToWorkerMessage ──────────────────────► │  Initialization, input, control, maps, saves
   │                                                 │
   │ ◄── WorkerStateMessage ────────────────────────  │  Entities, effects, rope points, and camera
   │ ◄── Event messages ────────────────────────────  │  Maps, debugging, performance, saves, level state
```

`WorkerStateMessage` uses a single partitioned `Float32Array` to carry state:

```
Entity region: 96 float32 values per entity (identity/position/state, weapon, grapple, skills, skeletal motion)
Effect region: 6 float32 values per event, up to 256 events
Rope region:   2 float32 values per point, up to 384 points
```

For exact offsets, see `src/worker/binaryProtocol.ts` and `src/worker/effectsProtocol.ts`. When cross-origin isolation is available, a `SharedArrayBuffer` is reused; otherwise, ownership of double-buffered `ArrayBuffer` instances is transferred.

---

## ECS Architecture

### Core Class Relationships

```
ComponentRegistry
   │ Maintains Component name ↔ bitmask (2^n) mappings
   │
EntityManager ─── manages ──► Entity[]
   │                            │
   │                 ┌──────────┼──────────────────────┐
   │                 │          │                      │
   │            signature    components          cached fields
   │            (bitmask)  Map<string,           .transform
   │                       Component>            .physics
   │                                             .stats
   │                                             .weapon ...
   │
World ─── schedules ──► System[]
   │                       │
   │                  requiredSignature (bitmask)
   │                  matches(entity) → entity.signature & required
   │
EntityComponentPool ── object pool ── Component reuse (avoids GC)
```

### Component Inventory

```
Core components:
  TransformComponent      Position (x, y) and rotation
  PhysicsComponent        Box2D body and velocity cache
  MovementComponent       Movement speed, jump parameters, grounded state, and wall-jump count
  InputComponent          Key state, mouse direction, and InputBuffer (combo detection)
  RenderComponent         Render type, color, and visibility

Character attributes:
  StatsComponent          Health, posture, toughness, death state, and level
  FactionComponent        Faction enum (player/enemy/neutral)
  LevelComponent          Experience, level, and level-up threshold

Weapon system:
  WeaponComponent         Current equipment, attack state machine, and combo count
  WeaponSlotsComponent    Primary/secondary weapon slots and switching logic
  AttackSlotsComponent    Attack-slot data (multi-stage charging)
  ArrowComponent          Arrow properties, flight speed, and lifetime

AI and perception:
  NpcAIComponent          Combat decision state, patrol configuration, target, and perception cache
  SensorComponent         Vision range, hearing range, and perception radius
  FollowComponent         Follow-target configuration

Special mechanics:
  GrappleComponent        Grapple state, anchor point, and rope tension
  GrappleAnchorComponent  Grapple-anchor entity marker
  CheckpointComponent     Checkpoint data and activation state
  SolarEnergyComponent    Solar energy resources
  SunPickupComponent      Pickup marker
  ExpOrbComponent         Experience-orb value and attraction radius
  NpcDropTableComponent   NPC loot table configuration
```

### System Execution Order

```
Worker 60 Hz update loop:

 1. StatsSystem
 2. CheckpointSystem
 3. SoundSystem
 4. NpcAISystem
 5. FollowSystem
 6. MovementSystem
 7. GrappleSystem
 8. SpineSegmentManager
 9. SkeletalSegmentManager
10. PhysicsSystem
11. WeaponSystem
12. ArrowSystem
13. TargetingSystem
14. InteractionSystem

After the World update:
  SunPickupSystem → ExpOrbSystem → AttackPickupSystem → cleanup → CameraDirector
```

`MovementSystem` runs before `PhysicsSystem` so forces applied during the current fixed step are included in the Box2D step. `SkillHandler` and `UltimateHandler` are internal collaborators of `WeaponSystem`, not standalone ECS systems.

---

## Rendering Architecture

```
Main-thread Pixi Ticker
│
▼
GameClient
│
├── ClientRenderer
│   ├── Read state buffer → entity/effect/rope state
│   ├── ParticleSystem (particle data pool, capacity 600)
│   └── HudWeaponSlotRenderer / input feedback
│
├── PixiWorldRenderer (Pixi.js Application)
│   ├── Camera transforms (translation/scaling)
│   ├── Frustum culling (visible entities only, MAX_ENTITY_VIEW_CACHE=512)
│   ├── BodyRenderer / SpineBodyManager / SkeletalPoseDriver
│   ├── WeaponRenderer (texture cache limit: 192)
│   └── Particle display and emitter pools
│
├── TerrainRenderer / ProceduralEnvironmentFactory
│   └── Chunked static-scene building and caching
│
├── WorldLightingController / DayNightCycle
│
└── AudioManager (Web Audio API)
    ├── Preload and cache audio assets
    ├── Spatial audio (distance attenuation)
    └── Simultaneous multichannel playback
```

---

## Terrain System

```
EditorManager (fabric.js editor)
│
├── EditorTerrainLayerManager ── Layer management
│   ├── EditorTerrainBrushController ── Brush drawing
│   └── TerrainBrushCursor ── Cursor preview
│
├── Terrain data (TerrainTypes.ts)
│   ├── Polygon vertex lists
│   ├── Material ID
│   └── Layer (foreground/background)
│
├── Collision building (during Worker loading)
│   ├── TerrainCollisionBuilder ── Base polygon → Box2D PolygonShape
│   ├── VoronoiBuilder ── d3-delaunay Voronoi cell decomposition
│   ├── VoronoiCollisionBuilder ── Voronoi → Box2D collider
│   └── TerrainPolygonUtils ── clipper2-wasm polygon clipping/merging
│
└── Rendering (main thread)
    ├── TerrainRenderer (Pixi.js Graphics)
    ├── TerrainMaterialRegistry ── Material texture registry
    ├── TerrainChunkGrid ── Chunk-culling optimization
    └── TerrainGeometry ── Geometry calculations
```

---

## Editor Architecture

```
EditorManager (main controller)
│
├── Object management
│   ├── EditorObjectManager ── Object CRUD
│   ├── EditorObjectFactory ── Object factory
│   ├── EditorObjectTreeManager ── Hierarchy tree view
│   ├── EditorMarkerManager ── NPC/Player markers
│   └── EditorShapeManager ── Collision-shape management
│
├── Terrain editing
│   ├── EditorTerrainLayerManager ── Layer management
│   ├── EditorTerrainBrushController ── Brush tool
│   └── EditorPolygonEditor ── Polygon vertex editing
│
├── UI system
│   ├── EditorMenuSystem ── Menu bar
│   ├── EditorMenuNavigator ── Menu navigation
│   ├── EditorPropertiesPanel ── Properties panel
│   ├── EditorToolbarManager ── Toolbar
│   └── EditorContextMenu ── Context menu
│
├── Canvas interaction
│   ├── EditorCanvasEventHandler ── Event handling
│   ├── EditorCameraManager ── Camera controls
│   ├── EditorSnapManager ── Grid snapping
│   └── EditorCoordinateUtils ── Coordinate transforms
│
├── Data management
│   ├── EditorMapSerializer ── Map serialization/deserialization (JSON)
│   ├── EditorMapListManager ── Map list (localStorage)
│   ├── EditorHistoryManager ── Undo/redo
│   ├── EditorClipboardManager ── Clipboard
│   └── EditorThumbnailCapture ── Thumbnail capture
│
└── Utilities
    ├── EditorCharacterBodyDrawer ── Character preview drawing
    ├── EditorRenderUtils ── Rendering helpers
    ├── EditorUIHelper ── UI helpers
    └── MapImportExportPanel ── Import/export
```

---

## Data Flow

```
User input (WASD / attack)
       │
       ▼
GameClient viewport keyboard events
       │ Update inputState
       ▼
worker.postMessage(WorkerInputMessage)
       │
       ▼
gameWorker receives message
       │ WorkerInputController.handleInput(...)
       │ Update InputComponent
       ▼
ECS World.update(deltaTime)
       │
       ├─ MovementSystem: InputComponent → linear velocity (Box2D)
       ├─ NpcAISystem: perceive player → generate enemy InputComponent
       ├─ WeaponSystem: InputComponent.attack → weapon state transition
       └─ WeaponSystem / ArrowSystem: SpatialHash query → StatsSystem resolution
              │
              ├─ Update StatsComponent (health and posture)
              └─ WorkerFrameStateExporter writes state, effect, and rope regions
                        │
                        ▼ SharedArrayBuffer / ArrayBuffer
               Main-thread ClientRenderer
                        │
                        ├─ Decode entity, effect, and rope state
                        ├─ PixiWorldRenderer renders the world
                        ├─ Play particle effects
                        └─ AudioManager plays audio
```

---

## Performance Optimizations

### Strategy Summary

| Optimization         | Implementation                                                   |
| -------------------- | ---------------------------------------------------------------- |
| Spatial partitioning | SpatialHash grid limits range-query candidates                   |
| Object reuse         | ArrowPools, EntityComponentPool, particle and render cache pools |
| Visibility culling   | PixiWorldRenderer updates visible entities only                  |
| Fixed time step      | Worker accumulates delta time and advances game state at 60 Hz   |
| Component caching    | Common Entity component fields avoid repeated Map lookups        |
| State transfer       | SharedArrayBuffer, with reusable ArrayBuffer fallback            |
| Bitmask filtering    | ComponentRegistry + World system entity cache                    |
| Resource caching     | Weapon, body, Spine, and procedural environment texture caches   |

Both the main thread and Worker include performance sampling. Use `?perf=1` to display the data and emit logs based on thresholds. Performance conclusions should be based on these samples rather than hard-coded timing estimates in this document.

---

## Directory Structure

```
src/
├── ecs/          ECS core, components, systems, object pools, and collision algorithms
├── worker/       Worker entry point, runtime controllers, and communication protocols
├── renderer/     Pixi world rendering, lighting, particles, body, and weapon drawing
├── terrain/      Terrain data, geometry, collision, chunking, and rendering
├── editor/       Editor controllers and the bodyDrawer/ and terrain/ submodules
├── main.ts       Page entry point and game/editor orchestration
├── GameClient.ts Main-thread game lifecycle, input, and render loop
└── ClientRenderer.ts State decoding, HUD, effects, and shared drawing logic

public/
├── animations/   Spine assets
├── audios/       Audio assets
├── images/       Images and presets
├── lang/         Chinese and English text
└── map_data/     Default map
```

---

## Key Technical Details

### Box2D Memory Management

Box2D WASM objects require manual `delete()` calls and must be destroyed immediately after use within a System:

```typescript
const vel = b2Body_GetLinearVelocity(bodyId)
// ... use vel
vel.delete()
```

### SharedArrayBuffer Cross-Origin Isolation

`vite.config.ts` injects the required response headers for development and preview servers:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

Production deployments must provide the same headers. When cross-origin isolation is unavailable, state synchronization automatically falls back to reusable `ArrayBuffer` instances transferred via `postMessage`.

### Weapon State Machine

```
idle ──(attack key)──► windup ──► swing ──► pause ──(attack key, ≤5-hit combo)──► windup
                                              │
                                              └──(timeout)──► recover ──► idle
```

### AI State Machine

```
idle / alert ──► approach ──► pacing / probe ──► combo
                    ▲                                │
                    └──────── retreat ◄──────────────┘
                    │
                    └──────── leapAttack ────────────┘
```
