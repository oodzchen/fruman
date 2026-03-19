import Box2DFactory from 'box2d3-wasm'
import {
  isSimple,
  makeCCW,
  quickDecomp,
  removeCollinearPoints,
  removeDuplicatePoints,
} from 'poly-decomp-es'

import {
  CATEGORY_GROUND,
  CATEGORY_OBSTACLE,
  CATEGORY_WEAPON,
  CHECKPOINT_TREE_TOP_COLOR_INACTIVE,
  CHECKPOINT_TREE_TRUNK_COLOR_INACTIVE,
  DEBUG_DRAW_CAMERA,
  DEBUG_DRAW_SENSORS,
  DEBUG_DRAW_SOUND,
  DEFAULT_BOW_AMMO_PLAYER,
  DEFAULT_CAMERA_ZOOM,
  DEFAULT_CHECKPOINT_RENDER_RADIUS,
  DEFAULT_GRAPPLE_ANCHOR_RENDER_RADIUS,
  DEFAULT_GRAPPLE_RANGE,
  DEFAULT_GRAVITY,
  DEFAULT_GROUND_FRICTION,
  DEFAULT_OBSTACLE_FRICTION,
  DEFAULT_PLAYER_FOV_RAD,
  DEFAULT_PLAYER_MAX_HEALTH,
  DEFAULT_PLAYER_MAX_POSTURE,
  DEFAULT_PLAYER_MAX_TOUGHNESS,
  DEFAULT_PLAYER_RADIUS,
  DEFAULT_WEAPON_CORNER_RADIUS,
  ENEMY_HEARING_RANGE_MULTIPLIER,
  GRAPPLE_ANCHOR_BORDER_COLOR,
  GRAPPLE_ANCHOR_COLOR,
  GRAPPLE_ANCHOR_HIGHLIGHT_BORDER_COLOR,
  GRAPPLE_ANCHOR_HIGHLIGHT_COLOR,
  GRAPPLE_LONG_PRESS_MS,
  MASK_WEAPON,
  WEAPON_DEFAULT_DATA,
} from '../constants'
import { ArrowPools } from '../ecs/ArrowPools'
import {
  getDefaultNormalAttackMovesetId,
  getMovesetForWeaponTypeAndOwner,
  isNormalAttackMovesetId,
} from '../ecs/AttackMoveRegistry'
import {
  CheckpointComponent,
  Faction,
  GrappleAnchorComponent,
  RenderComponent,
  TransformComponent,
} from '../ecs/Component'
import { componentRegistry } from '../ecs/ComponentRegistry'
import type { Entity } from '../ecs/Entity'
import { SpatialHash } from '../ecs/SpatialHash'
import { World } from '../ecs/World'
import {
  applyWeaponSizeLevel,
  createEnemy,
  createPlayer,
  createWeapon,
} from '../ecs/factories/PlayerFactory'
import { ArrowSystem } from '../ecs/systems/ArrowSystem'
import { CheckpointSystem } from '../ecs/systems/CheckpointSystem'
import { EnemyAISystem } from '../ecs/systems/EnemyAISystem'
import { GrappleSystem } from '../ecs/systems/GrappleSystem'
import { InteractionSystem } from '../ecs/systems/InteractionSystem'
import { MovementSystem } from '../ecs/systems/MovementSystem'
import { PhysicsSystem } from '../ecs/systems/PhysicsSystem'
import { SoundSystem } from '../ecs/systems/SoundSystem'
import { type EffectsEmitter, StatsSystem } from '../ecs/systems/StatsSystem'
import { TargetingSystem } from '../ecs/systems/TargetingSystem'
import { WeaponSystem } from '../ecs/systems/WeaponSystem'
import type {
  EditorMapData,
  MapEnemyWeapon,
  MapPlacedShape,
} from '../editorMapTypes'
import type {
  SaveCheckpointState,
  SaveData,
  SaveEnemyState,
  SaveGroundWeaponState,
  SavePlayerState,
  SaveWeaponSlotState,
} from '../saveTypes'
import { ensureDefaultMap } from '../storage'
import type {
  MainModule,
  WeaponType,
  WeaponVisualType,
  b2BodyId,
  b2Hull,
  b2Polygon,
  b2Rot,
  b2ShapeId,
} from '../types'
import {
  ENTITY_STRIDE,
  FLAGS,
  MAX_ENTITIES,
  OFFSETS,
  WEAPON_TYPES,
} from './binaryProtocol'
import {
  EFFECTS_BASE_OFFSET,
  EFFECT_OFFSETS,
  EFFECT_STRIDE,
  EFFECT_TYPES,
  MAX_EFFECTS,
  MAX_ROPE_POINTS,
  ROPE_POINTS_BASE_OFFSET,
  STATE_BUFFER_FLOATS,
} from './effectsProtocol'
import type {
  CameraDebugData,
  MainToWorkerMessage,
  SensorDebugData,
  SoundListenerDebugData,
  SoundWaveDebugData,
  WorkerDebugMessage,
  WorkerSaveResponseMessage,
  WorkerStateMessage,
} from './protocol'

// Worker global scope
const ctx: Worker = self as unknown as Worker

const activeCheckpointSavePosition: SaveCheckpointState = { x: 0, y: 0 }

let box2d: MainModule
let worldId: ReturnType<MainModule['b2CreateWorld']>
let world: World
let spatialHash: SpatialHash
let playerEntity: Entity
let enemyEntity: Entity | null = null

let physicsSystem: PhysicsSystem
let movementSystem: MovementSystem
let statsSystem: StatsSystem
let weaponSystem: WeaponSystem
let arrowSystem: ArrowSystem
let enemyAISystem: EnemyAISystem
let soundSystem: SoundSystem
let targetingSystem: TargetingSystem
let interactionSystem: InteractionSystem
let checkpointSystem: CheckpointSystem
let grappleSystem: GrappleSystem
let arrowPools: ArrowPools

const checkpointActivatedMessage = { type: 'checkpoint_activated' } as const
const playerDeadMessage = { type: 'player_dead' } as const

let groundShapeIds: b2ShapeId[] = []
let activeMapData: EditorMapData | null = null
let defaultMapData: EditorMapData | null = null
let isMapPreview = false
let obstacles: {
  bodyId: b2BodyId
  mainShapeId: b2ShapeId
  capBodyId: b2BodyId
  capShapeId: b2ShapeId
  centerX: number
  centerY: number
  width: number
  height: number
  radius?: number
  vertices?: { x: number; y: number }[]
  worldVertices?: { x: number; y: number }[]
}[] = []

let isPaused = false
let loopInterval: ReturnType<typeof setInterval>

let tempSetTransformVec: InstanceType<MainModule['b2Vec2']> | null = null
let tempZeroVec: InstanceType<MainModule['b2Vec2']> | null = null
let tempSetTransformRot: b2Rot | null = null

const PLAYER_PERSISTENT_ID = 'player'
let nextPersistentEnemyId = 1
const TARGET_FPS = 60
const TIME_STEP = 1 / TARGET_FPS
const FIXED_STEP_MS = Math.floor(TIME_STEP * 1000)
let playTimeMs = 0

const STATE_BUFFER_BYTES = STATE_BUFFER_FLOATS * Float32Array.BYTES_PER_ELEMENT
const supportsSharedArrayBuffer =
  typeof SharedArrayBuffer !== 'undefined' && self.crossOriginIsolated

let sharedStateBuffer: SharedArrayBuffer | null = null
let stateBuffer: Float32Array<ArrayBufferLike> = new Float32Array(
  STATE_BUFFER_FLOATS
)
const stateBufferViews: Float32Array[] = []
let effectsCount = 0
const SPARK_COLOR_INT = 0xfff4a8

type DecompPoint = [number, number]
type DecompPolygon = DecompPoint[]
const decompPointPool: DecompPoint[] = []
const decompScratchPolygon: DecompPolygon = []

function acquireDecompPoint(x: number, y: number): DecompPoint {
  const point = decompPointPool.pop() ?? [0, 0]
  point[0] = x
  point[1] = y
  return point
}

function resetDecompScratchPolygon(): void {
  for (let i = 0; i < decompScratchPolygon.length; i++) {
    decompPointPool.push(decompScratchPolygon[i])
  }
  decompScratchPolygon.length = 0
}

// Helper for color parsing (simple cache)
const colorCache = new Map<string, number>()
function parseColor(color: string): number {
  if (colorCache.has(color)) return colorCache.get(color)!
  if (color.startsWith('#')) {
    const hex = color.slice(1)
    const val = parseInt(hex, 16)
    colorCache.set(color, val)
    return val
  }
  return 0
}

function getWeaponTypeId(weaponType: WeaponVisualType | undefined): number {
  switch (weaponType) {
    case 'shortSword':
      return WEAPON_TYPES.SHORT_SWORD
    case 'longSword':
      return WEAPON_TYPES.LONG_SWORD
    case 'spear':
      return WEAPON_TYPES.SPEAR
    case 'hammer':
      return WEAPON_TYPES.HAMMER
    case 'bow':
      return WEAPON_TYPES.BOW
    case 'hook':
      return WEAPON_TYPES.HOOK
    case 'arrow':
      return WEAPON_TYPES.ARROW
    case 'sword':
    default:
      return WEAPON_TYPES.SWORD
  }
}

function queueEffect(
  type: number,
  x: number,
  y: number,
  color: number,
  radius: number
): void {
  if (effectsCount >= MAX_EFFECTS) {
    if (type !== EFFECT_TYPES.SOUND) return
    const base = EFFECTS_BASE_OFFSET + (MAX_EFFECTS - 1) * EFFECT_STRIDE
    stateBuffer[base + EFFECT_OFFSETS.TYPE] = type
    stateBuffer[base + EFFECT_OFFSETS.X] = x
    stateBuffer[base + EFFECT_OFFSETS.Y] = y
    stateBuffer[base + EFFECT_OFFSETS.COLOR] = color
    stateBuffer[base + EFFECT_OFFSETS.RADIUS] = radius
    return
  }
  const base = EFFECTS_BASE_OFFSET + effectsCount * EFFECT_STRIDE
  stateBuffer[base + EFFECT_OFFSETS.TYPE] = type
  stateBuffer[base + EFFECT_OFFSETS.X] = x
  stateBuffer[base + EFFECT_OFFSETS.Y] = y
  stateBuffer[base + EFFECT_OFFSETS.COLOR] = color
  stateBuffer[base + EFFECT_OFFSETS.RADIUS] = radius
  effectsCount += 1
}

const effectsEmitter: EffectsEmitter = {
  emitSpark: (x, y) => {
    queueEffect(EFFECT_TYPES.SPARK, x, y, SPARK_COLOR_INT, 0)
  },
  emitBlood: (x, y, color) => {
    queueEffect(EFFECT_TYPES.BLOOD, x, y, color, 0)
  },
  emitDeath: (x, y, color, radius) => {
    queueEffect(EFFECT_TYPES.DEATH, x, y, color, radius)
  },
  playSound: (soundId, playbackRate = 1.0) => {
    queueEffect(EFFECT_TYPES.SOUND, 0, 0, soundId, playbackRate)
  },
}

// Game State needed for logic
let prevKeys = new Set<string>()
let currKeys = new Set<string>()
let prevMouseButtons = new Set<number>()
let currMouseButtons = new Set<number>()
let rHoldMs = 0
let rHoldActive = false
let rHoldTriggered = false
let canvasHeight = 0
let pixelsPerMeter = 50
let groundFriction = DEFAULT_GROUND_FRICTION
let obstacleFriction = DEFAULT_OBSTACLE_FRICTION
let groundTopY = 0

// Parameter buffer for async init
const pendingParams: Record<string, number> = {}

// Camera tracking logic (moved from Main to here to send correct camera pos)
const camera = { x: 0, y: 0 }
let zoom = DEFAULT_CAMERA_ZOOM
let targetZoom = DEFAULT_CAMERA_ZOOM
let canvasWidth = 0
let isCameraLocked = false
let isTransitioning = false
let transitionStartTime = 0
let transitionStartCameraX = 0
let lastVelocityDirection = 0
let needsReturnToCenter = false
let lastUnlockTime = 0
let currentTime = 0
let outOfCenterTime = 0
let horizontalForceCenterAfterEmergency = false

// Vertical Camera State
let isVerticalCameraLocked = false
let isVerticalTransitioning = false
let verticalTransitionStartTime = 0
let verticalTransitionStartCameraY = 0
let verticalOutOfCenterTime = 0
let lastVerticalUnlockTime = 0
let initialPlayerScreenRatioY = 0.8
let verticalLookAheadOffsetY = 0
let verticalForceCenterAfterEmergency = false

const TRANSITION_DURATION = 3
const VERTICAL_TRANSITION_DURATION = 6
const UNLOCK_COOLDOWN = 0.2
const OUTSIDE_THIRD_RELOCK_DELAY = 0.15
const CAMERA_FORWARD_OFFSET = 0.67 // 2/3 角色宽度前向偏移
const HORIZONTAL_CENTER_UNLOCK_EPSILON_RATIO = 0.02
const VERTICAL_LOCK_SCREEN_RATIO = 0.5
const VERTICAL_FOLLOW_LERP = 0.08
const VERTICAL_CENTER_UNLOCK_EPSILON_RATIO = 0.02
const VERTICAL_LOOK_AHEAD_TIME = 0.18
const VERTICAL_LOOK_AHEAD_MAX = 1.2
const VERTICAL_LOOK_AHEAD_LERP = 0.2

// Reusable message object for sendState
const stateMessage: WorkerStateMessage = {
  type: 'state',
  entitiesBuffer: null as unknown as ArrayBuffer | SharedArrayBuffer,
  entityCount: 0,
  effectsCount: 0,
  ropePointCount: 0,
  camera: { x: 0, y: 0 },
  zoom: DEFAULT_CAMERA_ZOOM,
}

const debugMessage: WorkerDebugMessage = {
  type: 'debug',
  sensors: [],
  soundWaves: [],
  soundListeners: [],
  camera: null,
}
const debugSensors: SensorDebugData[] = []
const debugSoundWaves: SoundWaveDebugData[] = []
const debugSoundListeners: SoundListenerDebugData[] = []
const debugCameraData: CameraDebugData = {
  topLimitRatio: 1 - initialPlayerScreenRatioY,
  bottomLimitRatio: initialPlayerScreenRatioY,
  playerScreenY: 0,
  playerFeetY: 0,
  cameraY: 0,
  zoom: DEFAULT_CAMERA_ZOOM,
  isOutsideVerticalZone: false,
}
const emptySoundWaves: SoundWaveDebugData[] = []
const emptySoundListeners: SoundListenerDebugData[] = []
const emptySensors: SensorDebugData[] = []

// Loop Logic
let lastTime = performance.now()
let accumulator = 0

async function init(width: number, height: number, ppm: number) {
  canvasWidth = width
  canvasHeight = height
  pixelsPerMeter = ppm

  const defaultMapResult = await ensureDefaultMap(width, height, ppm)
  defaultMapData = defaultMapResult.data
  activeMapData = defaultMapData
  isMapPreview = false

  ctx.postMessage({
    type: 'map_data',
    map: activeMapData,
  })

  initStateBuffers()

  box2d = await Box2DFactory()
  const { b2DefaultWorldDef, b2CreateWorld, b2Vec2 } = box2d

  const worldDef = b2DefaultWorldDef()
  worldDef.gravity = new b2Vec2(0, DEFAULT_GRAVITY)
  worldId = b2CreateWorld(worldDef)
  worldDef.delete()

  world = new World()
  spatialHash = new SpatialHash(5)

  registerComponents()

  // Setup Environment
  const groundHeight = 0.5
  const groundY = canvasHeight / pixelsPerMeter - groundHeight
  groundTopY = groundY - groundHeight
  createEnvironment()

  initializeSystems()
  enemyEntity = null
  createPlayerAndWeapon(groundTopY, activeMapData)

  // Initialize camera to center on player
  if (activeMapData) {
    applyMapCamera(activeMapData)
  } else if (playerEntity && playerEntity.transform) {
    const centerX = canvasWidth / 2
    camera.x = playerEntity.transform.x - centerX / pixelsPerMeter

    // Vertical initialization: Camera at top (0), Player near bottom
    const canvasHeightInMeters = canvasHeight / pixelsPerMeter
    camera.y = canvasHeightInMeters - canvasHeightInMeters // Effectively 0

    initialPlayerScreenRatioY = 0.8

    isCameraLocked = true
  }
  Object.entries(pendingParams).forEach(([id, value]) => {
    updateParam(id, value)
  })

  // Start Loop
  lastTime = performance.now()
  accumulator = 0
  currentTime = 0
  clearInterval(loopInterval)
  loopInterval = setInterval(update, 1000 / TARGET_FPS)
}

async function reloadDefaultMap() {
  if (canvasWidth <= 0 || canvasHeight <= 0 || pixelsPerMeter <= 0) {
    return
  }
  const defaultMapResult = await ensureDefaultMap(
    canvasWidth,
    canvasHeight,
    pixelsPerMeter
  )
  defaultMapData = defaultMapResult.data
  if (!isMapPreview) {
    activeMapData = defaultMapData
  }
}

function initStateBuffers(): void {
  effectsCount = 0
  if (supportsSharedArrayBuffer) {
    sharedStateBuffer = new SharedArrayBuffer(STATE_BUFFER_BYTES)
    stateBuffer = new Float32Array(sharedStateBuffer)
    stateBufferViews.length = 0
    return
  }

  sharedStateBuffer = null
  stateBufferViews.length = 0
  for (let i = 0; i < 2; i++) {
    const buffer = new ArrayBuffer(STATE_BUFFER_BYTES)
    stateBufferViews.push(new Float32Array(buffer))
  }
  const initialView = stateBufferViews.pop()
  if (initialView) {
    stateBuffer = initialView
  }
}

function releaseStateBuffer(buffer: ArrayBuffer): void {
  if (sharedStateBuffer) return
  if (buffer.byteLength !== STATE_BUFFER_BYTES) return
  stateBufferViews.push(new Float32Array(buffer))
}

function registerComponents() {
  componentRegistry.registerComponent('Transform')
  componentRegistry.registerComponent('Physics')
  componentRegistry.registerComponent('Movement')
  componentRegistry.registerComponent('Input')
  componentRegistry.registerComponent('Render')
  componentRegistry.registerComponent('Stats')
  componentRegistry.registerComponent('Weapon')
  componentRegistry.registerComponent('WeaponSlots')
  componentRegistry.registerComponent('AttackSlots')
  componentRegistry.registerComponent('Arrow')
  componentRegistry.registerComponent('Faction')
  componentRegistry.registerComponent('EnemyAI')
  componentRegistry.registerComponent('Checkpoint')
  componentRegistry.registerComponent('Grapple')
  componentRegistry.registerComponent('GrappleAnchor')
}

function initializeSystems() {
  statsSystem = new StatsSystem(box2d, worldId)
  statsSystem.setEffectsEmitter(effectsEmitter)
  statsSystem.setBloodEffectsEnabled(false)
  checkpointSystem = new CheckpointSystem()
  checkpointSystem.setCheckpointActivatedHandler(() => {
    if (isMapPreview) {
      return
    }
    ctx.postMessage(checkpointActivatedMessage)
  })
  checkpointSystem.setPlayerDeadHandler(() => {
    ctx.postMessage(playerDeadMessage)
  })
  soundSystem = new SoundSystem()
  enemyAISystem = new EnemyAISystem(box2d, worldId)
  physicsSystem = new PhysicsSystem(box2d, worldId)
  movementSystem = new MovementSystem(box2d)
  grappleSystem = new GrappleSystem(world, box2d, worldId)
  weaponSystem = new WeaponSystem(box2d, statsSystem)
  arrowSystem = new ArrowSystem(box2d, statsSystem)
  arrowPools = new ArrowPools()
  interactionSystem = new InteractionSystem()
  statsSystem.setWeaponSystem(weaponSystem)
  statsSystem.setSoundSystem(soundSystem)
  enemyAISystem.setWeaponSystem(weaponSystem)
  movementSystem.setSoundSystem(soundSystem)
  movementSystem.setStatsSystem(statsSystem)
  grappleSystem.setStatsSystem(statsSystem)
  weaponSystem.setSoundSystem(soundSystem)
  arrowSystem.setSoundSystem(soundSystem)
  interactionSystem.setWeaponSystem(weaponSystem)
  targetingSystem = new TargetingSystem(box2d, worldId)

  const entityLookup = world.getEntityById.bind(world)
  movementSystem.setEntityLookup(entityLookup)
  targetingSystem.setEntityLookup(entityLookup)
  weaponSystem.setEntityLookup(entityLookup)

  // 关键：MovementSystem必须在PhysicsSystem之前执行
  // 这样施加的力才能在当前帧的b2World_Step中被处理
  world.addSystem(statsSystem)
  world.addSystem(checkpointSystem)
  world.addSystem(soundSystem)
  world.addSystem(enemyAISystem)
  world.addSystem(movementSystem)
  world.addSystem(grappleSystem)
  world.addSystem(physicsSystem)
  world.addSystem(weaponSystem)
  world.addSystem(arrowSystem)
  world.addSystem(targetingSystem)
  world.addSystem(interactionSystem) // 交互系统在weaponSystem之后执行

  world.setComponentPool(arrowPools)
  weaponSystem.setObstacles(obstacles)
  weaponSystem.setWorld(world, worldId, groundTopY)
  weaponSystem.setArrowPools(arrowPools)
  weaponSystem.setViewportSize(
    canvasWidth / pixelsPerMeter,
    canvasHeight / pixelsPerMeter
  )
  arrowSystem.setSpatialHash(spatialHash)
  arrowSystem.setWorld(world)
  arrowSystem.setArrowPools(arrowPools)
}

function createGround(): b2BodyId {
  const {
    b2DefaultBodyDef,
    b2CreateBody,
    b2MakeBox,
    b2DefaultShapeDef,
    b2CreatePolygonShape,
  } = box2d

  const groundHeight = 0.5
  const canvasHeightInMeters = canvasHeight / pixelsPerMeter
  const groundY = canvasHeightInMeters - groundHeight

  const groundDef = b2DefaultBodyDef()
  groundDef.position.Set(0, groundY)
  const bodyId = b2CreateBody(worldId, groundDef)

  const groundBox = b2MakeBox(50, groundHeight)
  const shapeDef = b2DefaultShapeDef()
  shapeDef.material.friction = groundFriction
  shapeDef.material.restitution = 0
  shapeDef.filter.categoryBits = CATEGORY_GROUND
  const shapeId = b2CreatePolygonShape(bodyId, shapeDef, groundBox)
  groundShapeIds.push(shapeId)

  groundDef.delete()
  groundBox.delete()
  shapeDef.delete()

  return bodyId
}

interface BoxObstacleConfig {
  type: 'box'
  x: number
  width: number
  height: number
}

interface PolygonObstacleConfig {
  type: 'polygon'
  x: number
  vertices: { x: number; y: number }[]
}

type ObstacleConfig = BoxObstacleConfig | PolygonObstacleConfig

function createObstacles() {
  const {
    b2DefaultBodyDef,
    b2CreateBody,
    b2MakeBox,
    b2DefaultShapeDef,
    b2CreatePolygonShape,
    b2ComputeHull,
    b2MakePolygon,
    b2Vec2,
  } = box2d

  const canvasHeightInMeters = canvasHeight / pixelsPerMeter
  const groundY = canvasHeightInMeters - 0.5
  obstacles = []

  const obstacleConfigs: ObstacleConfig[] = []

  // Cap parameters
  const CAP_TOTAL_HEIGHT = 0.1
  const CAP_HALF_HEIGHT = CAP_TOTAL_HEIGHT / 2

  obstacleConfigs.forEach((obs: ObstacleConfig) => {
    if (obs.type === 'polygon') {
      const bodyDef = b2DefaultBodyDef()
      // Place at ground level (groundY - 0.5 is the top surface of the ground box)
      bodyDef.position.Set(obs.x, groundY - 0.5)
      const bodyId = b2CreateBody(worldId, bodyDef)

      // Convert vertices to b2Vec2 array
      // Note: b2ComputeHull typically expects a pointer or typed array in WASM.
      // If we can't easily pass JS objects, we might need to alloc.
      // Trying the most likely working method for box2d-wasm (passing array of {x,y} or b2Vec2 objects).
      const points = obs.vertices.map((v) => new b2Vec2(v.x, v.y))
      const hull: b2Hull = b2ComputeHull(points)
      const polygon: b2Polygon = b2MakePolygon(hull, 0)

      const shapeDef = b2DefaultShapeDef()
      shapeDef.material.friction = obstacleFriction
      shapeDef.material.restitution = 0
      shapeDef.filter.categoryBits = CATEGORY_OBSTACLE
      const shapeId = b2CreatePolygonShape(bodyId, shapeDef, polygon)

      // Clean up
      points.forEach((p) => p.delete())
      // hull and polygon are structs returned by value or pointer?
      // In box2d-wasm, usually if created via `new`, we delete.
      // b2ComputeHull returns a value struct in C++, so WASM likely returns a JS object wrapper.
      // Attempting delete to be safe, if it exists.

      interface MaybeDisposable {
        delete?: () => void
      }

      const disposableHull = hull as unknown as MaybeDisposable
      if (disposableHull.delete) disposableHull.delete()

      const disposablePolygon = polygon as unknown as MaybeDisposable
      if (disposablePolygon.delete) disposablePolygon.delete()

      // Calculate AABB for WeaponSystem
      let minX = 0,
        maxX = 0,
        minY = 0,
        maxY = 0
      obs.vertices.forEach((v) => {
        if (v.x < minX) minX = v.x
        if (v.x > maxX) maxX = v.x
        if (v.y < minY) minY = v.y
        if (v.y > maxY) maxY = v.y
      })

      const centerX = obs.x
      const centerY = groundY - 0.5
      const worldVertices = obs.vertices.map((vertex) => ({
        x: centerX + vertex.x,
        y: centerY + vertex.y,
      }))

      obstacles.push({
        bodyId,
        mainShapeId: shapeId,
        capBodyId: bodyId, // Use same body for cap for now (simplified for polygons)
        capShapeId: shapeId,
        centerX,
        centerY,
        width: Math.max(Math.abs(minX), Math.abs(maxX)),
        height: Math.abs(minY), // Height approx
        vertices: obs.vertices,
        worldVertices,
      })

      bodyDef.delete()
      shapeDef.delete()
      return
    }

    // Box logic (existing)
    const originalHalfH = obs.height
    // Ensure obstacle is tall enough for the cap
    if (originalHalfH * 2 <= CAP_TOTAL_HEIGHT) {
      return
    }

    // Calculate split dimensions
    const baseTotalHeight = originalHalfH * 2 - CAP_TOTAL_HEIGHT
    const baseHalfHeight = baseTotalHeight / 2

    // Calculate positions
    const originalCenterY = groundY - originalHalfH
    const topY = originalCenterY - originalHalfH
    const bottomY = originalCenterY + originalHalfH

    // New Cap Center: Top + CapHalf
    const capY = topY + CAP_HALF_HEIGHT
    // New Base Center: Bottom - BaseHalf
    const baseY = bottomY - baseHalfHeight

    // 1. Create Cap (Top Surface with Friction)
    const capBodyDef = b2DefaultBodyDef()
    capBodyDef.position.Set(obs.x, capY)
    const capBodyId = b2CreateBody(worldId, capBodyDef)

    const capBox = b2MakeBox(obs.width, CAP_HALF_HEIGHT)
    const capShapeDef = b2DefaultShapeDef()
    capShapeDef.material.friction = obstacleFriction
    capShapeDef.material.restitution = 0
    capShapeDef.filter.categoryBits = CATEGORY_OBSTACLE
    const capShapeId = b2CreatePolygonShape(capBodyId, capShapeDef, capBox)

    // 2. Create Base (Sides with 0 Friction)
    const baseBodyDef = b2DefaultBodyDef()
    baseBodyDef.position.Set(obs.x, baseY)
    const baseBodyId = b2CreateBody(worldId, baseBodyDef)

    const baseBox = b2MakeBox(obs.width, baseHalfHeight)
    const baseShapeDef = b2DefaultShapeDef()
    baseShapeDef.material.friction = 0 // Vertical/Side friction 0
    baseShapeDef.material.restitution = 0
    baseShapeDef.filter.categoryBits = CATEGORY_OBSTACLE
    const mainShapeId = b2CreatePolygonShape(baseBodyId, baseShapeDef, baseBox)

    obstacles.push({
      bodyId: baseBodyId,
      mainShapeId,
      capBodyId,
      capShapeId,
      centerX: obs.x,
      centerY: baseY,
      width: obs.width,
      height: baseHalfHeight,
    })

    capBodyDef.delete()
    capBox.delete()
    capShapeDef.delete()
    baseBodyDef.delete()
    baseBox.delete()
    baseShapeDef.delete()
  })

  // Update weapon system obstacles
  if (weaponSystem) {
    weaponSystem.setObstacles(obstacles)
  }
}

function createEnvironment(): void {
  groundShapeIds.length = 0
  obstacles = []
  if (activeMapData) {
    createEnvironmentFromMap(activeMapData)
    createCheckpointsFromMap(activeMapData)
    createGrappleAnchorsFromMap(activeMapData)
  } else {
    createGround()
    createObstacles()
  }
  if (weaponSystem) {
    weaponSystem.setObstacles(obstacles)
  }
}

function createEnvironmentFromMap(map: EditorMapData): void {
  for (let i = 0; i < map.shapes.length; i++) {
    const placed = map.shapes[i]
    if (placed.objectKind === 'ground') {
      createGroundShapeFromMap(placed)
    } else {
      createObstacleShapeFromMap(placed)
    }
  }
}

function createCheckpointsFromMap(map: EditorMapData): void {
  if (!world) return
  const checkpoints = map.checkpoints ?? []
  for (let i = 0; i < checkpoints.length; i++) {
    const checkpoint = checkpoints[i]
    createCheckpointEntity(checkpoint.x, checkpoint.y)
  }
}

function createCheckpointEntity(x: number, y: number): void {
  if (!world) return
  const entity = world.createEntity()
  const transform = new TransformComponent()
  transform.x = x
  transform.y = y
  entity.addComponent(transform)

  const render = new RenderComponent()
  render.radius = DEFAULT_CHECKPOINT_RENDER_RADIUS
  render.color = CHECKPOINT_TREE_TOP_COLOR_INACTIVE
  render.borderColor = CHECKPOINT_TREE_TRUNK_COLOR_INACTIVE
  render.visible = true
  entity.addComponent(render)

  const checkpoint = new CheckpointComponent()
  entity.addComponent(checkpoint)
}

function createGrappleAnchorsFromMap(map: EditorMapData): void {
  if (!world) return
  const anchors = map.hookAnchors ?? []
  for (let i = 0; i < anchors.length; i++) {
    const anchor = anchors[i]
    createGrappleAnchorEntity(anchor.x, anchor.y)
  }
  if (grappleSystem) {
    grappleSystem.markAnchorsDirty()
  }
}

function createGrappleAnchorEntity(x: number, y: number): void {
  if (!world) return
  const entity = world.createEntity()
  const transform = new TransformComponent()
  transform.x = x
  transform.y = y
  entity.addComponent(transform)

  const render = new RenderComponent()
  render.radius = DEFAULT_GRAPPLE_ANCHOR_RENDER_RADIUS
  render.color = GRAPPLE_ANCHOR_COLOR
  render.borderColor = GRAPPLE_ANCHOR_BORDER_COLOR
  render.visible = true
  entity.addComponent(render)

  const anchor = new GrappleAnchorComponent()
  entity.addComponent(anchor)
}

function createGroundShapeFromMap(placed: MapPlacedShape): void {
  createStaticShapeFromMap(placed, CATEGORY_GROUND, groundFriction, false)
}

function createObstacleShapeFromMap(placed: MapPlacedShape): void {
  createStaticShapeFromMap(placed, CATEGORY_OBSTACLE, obstacleFriction, true)
}

function createStaticShapeFromMap(
  placed: MapPlacedShape,
  categoryBits: number,
  friction: number,
  shouldRegisterObstacle: boolean
): void {
  const shape = placed.shape
  if (shape.kind === 'rect') {
    const rectResult = createStaticRectBody(
      shape.center.x,
      shape.center.y,
      shape.halfWidth,
      shape.halfHeight,
      shape.rotationRad,
      categoryBits,
      friction
    )
    if (shouldRegisterObstacle) {
      registerObstacleFromRect(shape, rectResult)
    }
    return
  }
  if (shape.kind === 'circle') {
    const circleResult = createStaticCircleBody(
      shape.center.x,
      shape.center.y,
      shape.radius,
      categoryBits,
      friction
    )
    if (shouldRegisterObstacle) {
      registerObstacleFromCircle(shape, circleResult)
    }
    return
  }
  if (shape.kind === 'polygon') {
    registerPolygonShape(shape, categoryBits, friction, shouldRegisterObstacle)
  }
}

function createStaticRectBody(
  centerX: number,
  centerY: number,
  halfWidth: number,
  halfHeight: number,
  rotationRad: number,
  categoryBits: number,
  friction: number
): { bodyId: b2BodyId; shapeId: b2ShapeId } {
  const {
    b2DefaultBodyDef,
    b2CreateBody,
    b2MakeBox,
    b2DefaultShapeDef,
    b2CreatePolygonShape,
  } = box2d

  const bodyDef = b2DefaultBodyDef()
  bodyDef.position.Set(centerX, centerY)
  ;(
    bodyDef as ReturnType<MainModule['b2DefaultBodyDef']> & { angle: number }
  ).angle = rotationRad
  const bodyId = b2CreateBody(worldId, bodyDef)

  const box = b2MakeBox(halfWidth, halfHeight)
  const shapeDef = b2DefaultShapeDef()
  shapeDef.material.friction = friction
  shapeDef.material.restitution = 0
  shapeDef.filter.categoryBits = categoryBits
  const shapeId = b2CreatePolygonShape(bodyId, shapeDef, box)
  if (categoryBits === CATEGORY_GROUND) {
    groundShapeIds.push(shapeId)
  }

  bodyDef.delete()
  box.delete()
  shapeDef.delete()

  return { bodyId, shapeId }
}

function createStaticCircleBody(
  centerX: number,
  centerY: number,
  radius: number,
  categoryBits: number,
  friction: number
): { bodyId: b2BodyId; shapeId: b2ShapeId } {
  const {
    b2DefaultBodyDef,
    b2CreateBody,
    b2Circle,
    b2DefaultShapeDef,
    b2CreateCircleShape,
  } = box2d

  const bodyDef = b2DefaultBodyDef()
  bodyDef.position.Set(centerX, centerY)
  const bodyId = b2CreateBody(worldId, bodyDef)

  const circle = new b2Circle()
  circle.center.Set(0, 0)
  circle.radius = radius
  const shapeDef = b2DefaultShapeDef()
  shapeDef.material.friction = friction
  shapeDef.material.restitution = 0
  shapeDef.filter.categoryBits = categoryBits
  const shapeId = b2CreateCircleShape(bodyId, shapeDef, circle)
  if (categoryBits === CATEGORY_GROUND) {
    groundShapeIds.push(shapeId)
  }

  circle.delete()
  bodyDef.delete()
  shapeDef.delete()

  return { bodyId, shapeId }
}

function registerObstacleFromRect(
  shape: Extract<MapPlacedShape['shape'], { kind: 'rect' }>,
  result: { bodyId: b2BodyId; shapeId: b2ShapeId }
): void {
  const halfWidth = shape.halfWidth
  const halfHeight = shape.halfHeight
  const centerX = shape.center.x
  const centerY = shape.center.y
  const rotationRad = shape.rotationRad
  const cap = createObstacleCapRect(
    centerX,
    centerY,
    halfWidth,
    halfHeight,
    rotationRad
  )
  const worldVertices =
    Math.abs(rotationRad) > 0.0001
      ? computeRectWorldVertices(
          centerX,
          centerY,
          halfWidth,
          halfHeight,
          rotationRad
        )
      : undefined
  obstacles.push({
    bodyId: result.bodyId,
    mainShapeId: result.shapeId,
    capBodyId: cap.capBodyId,
    capShapeId: cap.capShapeId,
    centerX,
    centerY,
    width: halfWidth,
    height: halfHeight,
    worldVertices,
  })
}

function registerObstacleFromCircle(
  shape: Extract<MapPlacedShape['shape'], { kind: 'circle' }>,
  result: { bodyId: b2BodyId; shapeId: b2ShapeId }
): void {
  const radius = shape.radius
  const centerX = shape.center.x
  const centerY = shape.center.y
  const cap = createObstacleCapRect(centerX, centerY, radius, radius, 0)
  obstacles.push({
    bodyId: result.bodyId,
    mainShapeId: result.shapeId,
    capBodyId: cap.capBodyId,
    capShapeId: cap.capShapeId,
    centerX,
    centerY,
    width: radius,
    height: radius,
    radius,
  })
}

function registerPolygonShape(
  shape: Extract<MapPlacedShape['shape'], { kind: 'polygon' }>,
  categoryBits: number,
  friction: number,
  shouldRegisterObstacle: boolean
): void {
  if (shape.points.length < 6) {
    return
  }
  const {
    b2DefaultBodyDef,
    b2CreateBody,
    b2DefaultShapeDef,
    b2CreatePolygonShape,
    b2ComputeHull,
    b2MakePolygon,
    b2Vec2,
  } = box2d

  const centerX = shape.center.x
  const centerY = shape.center.y
  const bodyDef = b2DefaultBodyDef()
  bodyDef.position.Set(centerX, centerY)
  const bodyId = b2CreateBody(worldId, bodyDef)

  const shapeDef = b2DefaultShapeDef()
  shapeDef.material.friction = friction
  shapeDef.material.restitution = 0
  shapeDef.filter.categoryBits = categoryBits
  resetDecompScratchPolygon()
  for (let i = 0; i < shape.points.length; i += 2) {
    const worldX = shape.points[i]
    const worldY = shape.points[i + 1]
    decompScratchPolygon.push(
      acquireDecompPoint(worldX - centerX, worldY - centerY)
    )
  }
  removeDuplicatePoints(decompScratchPolygon, 0.0001)
  removeCollinearPoints(decompScratchPolygon, 0.0001)

  if (decompScratchPolygon.length < 3) {
    bodyDef.delete()
    shapeDef.delete()
    resetDecompScratchPolygon()
    return
  }

  let convexPolygons: DecompPolygon[] | null = null
  if (isSimple(decompScratchPolygon)) {
    makeCCW(decompScratchPolygon)
    convexPolygons = quickDecomp(decompScratchPolygon)
  }

  if (!convexPolygons || convexPolygons.length === 0) {
    const localPoints: InstanceType<MainModule['b2Vec2']>[] = []
    let minX = Number.POSITIVE_INFINITY
    let maxX = Number.NEGATIVE_INFINITY
    let minY = Number.POSITIVE_INFINITY
    let maxY = Number.NEGATIVE_INFINITY
    for (let i = 0; i < decompScratchPolygon.length; i++) {
      const point = decompScratchPolygon[i]
      const localX = point[0]
      const localY = point[1]
      if (localX < minX) minX = localX
      if (localX > maxX) maxX = localX
      if (localY < minY) minY = localY
      if (localY > maxY) maxY = localY
      localPoints.push(new b2Vec2(localX, localY))
    }

    const hull: b2Hull = b2ComputeHull(localPoints)
    const polygon: b2Polygon = b2MakePolygon(hull, 0)
    const shapeId = b2CreatePolygonShape(bodyId, shapeDef, polygon)
    if (categoryBits === CATEGORY_GROUND) {
      groundShapeIds.push(shapeId)
    }

    bodyDef.delete()
    shapeDef.delete()
    hull.delete()
    polygon.delete()
    for (let i = 0; i < localPoints.length; i++) {
      localPoints[i].delete()
    }

    if (shouldRegisterObstacle) {
      const vertices: { x: number; y: number }[] = []
      const worldVertices: { x: number; y: number }[] = []
      for (let i = 0; i < decompScratchPolygon.length; i++) {
        const point = decompScratchPolygon[i]
        const localX = point[0]
        const localY = point[1]
        vertices.push({ x: localX, y: localY })
        worldVertices.push({ x: centerX + localX, y: centerY + localY })
      }
      const halfWidth = Math.max(Math.abs(minX), Math.abs(maxX))
      const halfHeight = Math.max(Math.abs(minY), Math.abs(maxY))
      obstacles.push({
        bodyId,
        mainShapeId: shapeId,
        capBodyId: bodyId,
        capShapeId: shapeId,
        centerX,
        centerY,
        width: halfWidth,
        height: halfHeight,
        vertices,
        worldVertices,
      })
    }

    resetDecompScratchPolygon()
    return
  }

  for (let i = 0; i < convexPolygons.length; i++) {
    const convex = convexPolygons[i]
    if (convex.length < 3) {
      continue
    }
    const localPoints: InstanceType<MainModule['b2Vec2']>[] = []
    let minX = Number.POSITIVE_INFINITY
    let maxX = Number.NEGATIVE_INFINITY
    let minY = Number.POSITIVE_INFINITY
    let maxY = Number.NEGATIVE_INFINITY
    const vertices: { x: number; y: number }[] | null = shouldRegisterObstacle
      ? []
      : null
    const worldVertices: { x: number; y: number }[] | null =
      shouldRegisterObstacle ? [] : null
    for (let j = 0; j < convex.length; j++) {
      const point = convex[j]
      const localX = point[0]
      const localY = point[1]
      if (localX < minX) minX = localX
      if (localX > maxX) maxX = localX
      if (localY < minY) minY = localY
      if (localY > maxY) maxY = localY
      localPoints.push(new b2Vec2(localX, localY))
      if (vertices && worldVertices) {
        vertices.push({ x: localX, y: localY })
        worldVertices.push({ x: centerX + localX, y: centerY + localY })
      }
    }

    const hull: b2Hull = b2ComputeHull(localPoints)
    const polygon: b2Polygon = b2MakePolygon(hull, 0)
    const shapeId = b2CreatePolygonShape(bodyId, shapeDef, polygon)
    if (categoryBits === CATEGORY_GROUND) {
      groundShapeIds.push(shapeId)
    }

    hull.delete()
    polygon.delete()
    for (let j = 0; j < localPoints.length; j++) {
      localPoints[j].delete()
    }

    if (!shouldRegisterObstacle || !vertices || !worldVertices) {
      continue
    }
    const halfWidth = Math.max(Math.abs(minX), Math.abs(maxX))
    const halfHeight = Math.max(Math.abs(minY), Math.abs(maxY))
    obstacles.push({
      bodyId,
      mainShapeId: shapeId,
      capBodyId: bodyId,
      capShapeId: shapeId,
      centerX,
      centerY,
      width: halfWidth,
      height: halfHeight,
      vertices,
      worldVertices,
    })
  }

  bodyDef.delete()
  shapeDef.delete()
  resetDecompScratchPolygon()
}

function createObstacleCapRect(
  centerX: number,
  centerY: number,
  halfWidth: number,
  halfHeight: number,
  rotationRad: number
): { capBodyId: b2BodyId; capShapeId: b2ShapeId } {
  const {
    b2DefaultBodyDef,
    b2CreateBody,
    b2MakeBox,
    b2DefaultShapeDef,
    b2CreatePolygonShape,
  } = box2d
  const CAP_TOTAL_HEIGHT = 0.1
  const capHalfHeight = CAP_TOTAL_HEIGHT * 0.5
  const offsetY = -halfHeight + capHalfHeight
  const cos = Math.cos(rotationRad)
  const sin = Math.sin(rotationRad)
  const capCenterX = centerX - offsetY * sin
  const capCenterY = centerY + offsetY * cos
  const bodyDef = b2DefaultBodyDef()
  bodyDef.position.Set(capCenterX, capCenterY)
  ;(
    bodyDef as ReturnType<MainModule['b2DefaultBodyDef']> & { angle: number }
  ).angle = rotationRad
  const bodyId = b2CreateBody(worldId, bodyDef)
  const capBox = b2MakeBox(halfWidth, capHalfHeight)
  const shapeDef = b2DefaultShapeDef()
  shapeDef.material.friction = obstacleFriction
  shapeDef.material.restitution = 0
  shapeDef.filter.categoryBits = CATEGORY_OBSTACLE
  const capShapeId = b2CreatePolygonShape(bodyId, shapeDef, capBox)

  bodyDef.delete()
  capBox.delete()
  shapeDef.delete()

  return { capBodyId: bodyId, capShapeId }
}

function computeRectWorldVertices(
  centerX: number,
  centerY: number,
  halfWidth: number,
  halfHeight: number,
  rotationRad: number
): { x: number; y: number }[] {
  const cos = Math.cos(rotationRad)
  const sin = Math.sin(rotationRad)
  const corners = [
    { x: -halfWidth, y: -halfHeight },
    { x: halfWidth, y: -halfHeight },
    { x: halfWidth, y: halfHeight },
    { x: -halfWidth, y: halfHeight },
  ]
  const world: { x: number; y: number }[] = []
  for (let i = 0; i < corners.length; i++) {
    const localX = corners[i].x
    const localY = corners[i].y
    const worldX = centerX + localX * cos - localY * sin
    const worldY = centerY + localX * sin + localY * cos
    world.push({ x: worldX, y: worldY })
  }
  return world
}

function applyWeaponSlotConfig(
  slot: {
    hasWeapon: boolean
    weaponType: string
    width: number
    height: number
    baseWidth: number
    sizeLevel: number
    sizeMaxLevel: number
    cornerRadius: number
    weight: number
    attackDamage: number
    postureDamage: number
    toughnessDamage: number
    bowAmmo: number
    bowAmmoMax: number
  },
  config: MapEnemyWeapon | undefined,
  defaultBowAmmo: number
) {
  if (!config) {
    slot.hasWeapon = false
    return
  }

  const template = WEAPON_DEFAULT_DATA[config.weaponType]
  const baseLevel = template.sizeLevel > 0 ? template.sizeLevel : 1
  const sizeLevel =
    Number.isFinite(config.sizeLevel) && config.sizeLevel > 0
      ? config.sizeLevel
      : baseLevel
  const scaleFactor = sizeLevel / baseLevel
  slot.hasWeapon = true
  slot.weaponType = config.weaponType
  slot.width = template.width * scaleFactor
  slot.height = template.height * scaleFactor
  slot.baseWidth = template.width * scaleFactor
  slot.sizeLevel = sizeLevel
  slot.sizeMaxLevel = template.sizeMaxLevel
  slot.cornerRadius = DEFAULT_WEAPON_CORNER_RADIUS
  slot.weight = template.weight
  slot.attackDamage = config.attackDamage
  slot.postureDamage = config.postureDamage
  slot.toughnessDamage = config.toughnessDamage
  if (config.weaponType === 'bow') {
    const ammo = config.bowAmmo ?? defaultBowAmmo
    slot.bowAmmoMax = ammo
    slot.bowAmmo = ammo
  } else {
    slot.bowAmmoMax = 0
    slot.bowAmmo = 0
  }
}

function createPlayerAndWeapon(groundY: number, map: EditorMapData | null) {
  const playerProps = map?.player
  const playerRadius =
    typeof playerProps?.radius === 'number' &&
    Number.isFinite(playerProps.radius) &&
    playerProps.radius > 0
      ? playerProps.radius
      : DEFAULT_PLAYER_RADIUS
  playerEntity = createPlayer(
    world,
    box2d,
    worldId,
    map ? map.playerSpawn.x : -12,
    map ? map.playerSpawn.y : groundY - 0.6,
    groundY,
    playerRadius
  )

  if (playerEntity.stats && playerProps) {
    const nextMaxHealth =
      typeof playerProps.maxHealth === 'number' &&
      Number.isFinite(playerProps.maxHealth) &&
      playerProps.maxHealth > 0
        ? playerProps.maxHealth
        : DEFAULT_PLAYER_MAX_HEALTH
    const nextMaxPosture =
      typeof playerProps.maxPosture === 'number' &&
      Number.isFinite(playerProps.maxPosture) &&
      playerProps.maxPosture >= 0
        ? playerProps.maxPosture
        : DEFAULT_PLAYER_MAX_POSTURE
    const nextMaxToughness =
      typeof playerProps.maxToughness === 'number' &&
      Number.isFinite(playerProps.maxToughness) &&
      playerProps.maxToughness >= 0
        ? playerProps.maxToughness
        : DEFAULT_PLAYER_MAX_TOUGHNESS

    playerEntity.stats.maxHealth = nextMaxHealth
    playerEntity.stats.health = nextMaxHealth
    playerEntity.stats.maxPosture = nextMaxPosture
    playerEntity.stats.posture = nextMaxPosture
    playerEntity.stats.maxToughness = nextMaxToughness
    playerEntity.stats.toughness = nextMaxToughness
    playerEntity.stats.debugNoDamage = playerProps.debugNoDamage === true
    playerEntity.stats.debugNoDeath = playerProps.debugNoDeath === true
    if (!playerEntity.stats.persistentId) {
      playerEntity.stats.persistentId = PLAYER_PERSISTENT_ID
    }
  }

  if (playerEntity.movement && playerProps) {
    const nextMoveSpeed =
      typeof playerProps.moveSpeed === 'number' &&
      Number.isFinite(playerProps.moveSpeed) &&
      playerProps.moveSpeed >= 0
        ? playerProps.moveSpeed
        : playerEntity.movement.moveSpeed
    playerEntity.movement.moveSpeed = nextMoveSpeed
  }

  if (playerEntity.attackSlots && playerProps) {
    const defaultWeaponType =
      playerProps.mainWeapon?.weaponType ??
      playerProps.secondaryWeapon?.weaponType ??
      'sword'
    const nextMovesetId = isNormalAttackMovesetId(
      playerProps.initialNormalMovesetId
    )
      ? playerProps.initialNormalMovesetId
      : getMovesetForWeaponTypeAndOwner(defaultWeaponType, 'player')?.id ||
        getDefaultNormalAttackMovesetId('player')
    playerEntity.attackSlots.normal.hasMoveset = true
    playerEntity.attackSlots.normal.movesetId = nextMovesetId
    if (playerEntity.weapon) {
      playerEntity.weapon.movesetId = nextMovesetId
    }
  }

  if (playerEntity.weapon && playerEntity.weaponSlots && playerProps) {
    const weaponSlots = playerEntity.weaponSlots
    applyWeaponSlotConfig(
      weaponSlots.main,
      playerProps.mainWeapon,
      DEFAULT_BOW_AMMO_PLAYER
    )
    applyWeaponSlotConfig(
      weaponSlots.secondary,
      playerProps.secondaryWeapon,
      DEFAULT_BOW_AMMO_PLAYER
    )

    if (weaponSlots.main.hasWeapon) {
      weaponSlots.activeSlot = 'main'
    } else if (weaponSlots.secondary.hasWeapon) {
      weaponSlots.activeSlot = 'secondary'
    }

    const activeSlot =
      weaponSlots.activeSlot === 'main'
        ? weaponSlots.main
        : weaponSlots.secondary

    if (activeSlot.hasWeapon) {
      const weaponType = activeSlot.weaponType as WeaponType
      const template = WEAPON_DEFAULT_DATA[weaponType]
      applyWeaponSizeLevel(playerEntity.weapon, template, activeSlot.sizeLevel)
      playerEntity.weapon.sizeMaxLevel = activeSlot.sizeMaxLevel
      playerEntity.weapon.cornerRadius = activeSlot.cornerRadius
      playerEntity.weapon.weaponType = weaponType
      playerEntity.weapon.attackDamage = activeSlot.attackDamage
      playerEntity.weapon.postureDamage = activeSlot.postureDamage
      playerEntity.weapon.toughnessDamage = activeSlot.toughnessDamage
      playerEntity.weapon.bowAmmo = activeSlot.bowAmmo
      playerEntity.weapon.bowAmmoMax = activeSlot.bowAmmoMax
      playerEntity.weapon.isEquipped = true
    } else {
      playerEntity.weapon.isEquipped = false
    }
  }

  if (map?.weapons) {
    for (let i = 0; i < map.weapons.length; i++) {
      const weaponData = map.weapons[i]
      const weaponEntity = createWeapon(
        world,
        box2d,
        worldId,
        weaponData.x,
        weaponData.y,
        groundY,
        weaponData.weaponType
      )
      const weapon = weaponEntity.weapon
      if (!weapon) {
        continue
      }

      const sizeLevel = weaponData.sizeLevel
      if (Number.isFinite(sizeLevel) && sizeLevel > 0) {
        const weaponType = weapon.weaponType
        if (!isTemplateWeaponType(weaponType)) {
          continue
        }
        const template = WEAPON_DEFAULT_DATA[weaponType]
        applyWeaponSizeLevel(weapon, template, sizeLevel)
        resetWeaponPhysicsCircle(weaponEntity)
      }

      const attackDamage = weaponData.attackDamage
      if (attackDamage !== undefined && Number.isFinite(attackDamage)) {
        weapon.attackDamage = attackDamage
      }

      const postureDamage = weaponData.postureDamage
      if (postureDamage !== undefined && Number.isFinite(postureDamage)) {
        weapon.postureDamage = postureDamage
      }

      const toughnessDamage = weaponData.toughnessDamage
      if (toughnessDamage !== undefined && Number.isFinite(toughnessDamage)) {
        weapon.toughnessDamage = toughnessDamage
      }

      if (weapon.weaponType === 'bow') {
        const bowAmmo = weaponData.bowAmmo
        if (bowAmmo !== undefined && Number.isFinite(bowAmmo)) {
          const ammo = Math.max(0, bowAmmo)
          weapon.bowAmmo = ammo
          weapon.bowAmmoMax = Math.max(weapon.bowAmmoMax, ammo)
        }
      }
    }
  }

  // Obstacles are at -9.5, 9.5, 19.5

  // 暂时注释掉敌人以便测试跌落伤害
  /*
  // Default enemy in the middle area
  enemyEntity = createEnemy(
    world,
    box2d,
    worldId,
    ENEMY_SPAWNS.default.x,
    groundY + ENEMY_SPAWNS.default.yOffset,
    groundY,
    ENEMY_SPAWNS.default.type
  )

  // Leftmost default enemy outside alert range
  createEnemy(
    world,
    box2d,
    worldId,
    ENEMY_SPAWNS.left.x,
    groundY + ENEMY_SPAWNS.left.yOffset,
    groundY,
    ENEMY_SPAWNS.left.type
  )

  // Archer enemy on top of the tallest obstacle near player spawn
  const archerTopY = groundY - ARCHER_SPAWN_CONFIG.obstacleHalfHeight * 2
  const archerSpawnX =
    ARCHER_SPAWN_CONFIG.obstacleX -
    ARCHER_SPAWN_CONFIG.obstacleHalfWidth +
    ARCHER_SPAWN_CONFIG.edgeOffset
  const archerSpawnY = archerTopY + ARCHER_SPAWN_CONFIG.yOffsetFromTop
  createEnemy(
    world,
    box2d,
    worldId,
    archerSpawnX,
    archerSpawnY,
    groundY,
    ARCHER_SPAWN_CONFIG.type
  )

  // Large enemy between 2nd and 3rd obstacle
  createEnemy(
    world,
    box2d,
    worldId,
    ENEMY_SPAWNS.large.x,
    groundY + ENEMY_SPAWNS.large.yOffset,
    groundY,
    ENEMY_SPAWNS.large.type
  )

  // Fast (Small) enemy after the last obstacle
  createEnemy(
    world,
    box2d,
    worldId,
    ENEMY_SPAWNS.fast.x,
    groundY + ENEMY_SPAWNS.fast.yOffset,
    groundY,
    ENEMY_SPAWNS.fast.type
  )
  */

  if (map && map.enemies.length > 0) {
    enemyEntity = null
    for (let i = 0; i < map.enemies.length; i++) {
      const enemy = map.enemies[i]
      const created = createEnemy(
        world,
        box2d,
        worldId,
        enemy.x,
        enemy.y,
        groundY,
        enemy.enemyType,
        enemy
      )
      if (created.attackSlots) {
        const nextMovesetId = isNormalAttackMovesetId(
          enemy.initialNormalMovesetId
        )
          ? enemy.initialNormalMovesetId
          : getDefaultNormalAttackMovesetId('enemy')
        created.attackSlots.normal.hasMoveset = true
        created.attackSlots.normal.movesetId = nextMovesetId
        if (created.weapon) {
          created.weapon.movesetId = nextMovesetId
        }
        if (created.enemyAI) {
          created.enemyAI.movesetId = nextMovesetId
        }
      }
      if (created.enemyAI) {
        created.enemyAI.mapSpawnIndex = i
      }
      if (created.stats && !created.stats.persistentId) {
        const nextId = `enemy-${i + 1}`
        created.stats.persistentId = nextId
        syncEnemyIdCounter(nextId)
      }
      if (!enemyEntity) {
        enemyEntity = created
      }
    }
  }

  enemyAISystem.setPlayer(playerEntity)
  soundSystem.setPlayer(playerEntity)
  targetingSystem.setPlayer(playerEntity)
  checkpointSystem.setPlayer(playerEntity)
  syncCheckpointDefaults(activeMapData)
  checkpointSystem.setPlayer(playerEntity)
  syncCheckpointDefaults(map)
}

function syncCheckpointDefaults(map: EditorMapData | null): void {
  if (!world) return
  if (map) {
    checkpointSystem.setDefaultSpawn(map.playerSpawn.x, map.playerSpawn.y)
  } else if (playerEntity?.transform) {
    checkpointSystem.setDefaultSpawn(
      playerEntity.transform.x,
      playerEntity.transform.y
    )
  }

  checkpointSystem.setActiveCheckpoint(null)
}

function applyMapCamera(map: EditorMapData): void {
  const zoomValue =
    map.camera.zoom > 0 && Number.isFinite(map.camera.zoom)
      ? map.camera.zoom
      : DEFAULT_CAMERA_ZOOM

  camera.x = map.camera.x
  camera.y = map.camera.y
  zoom = zoomValue
  targetZoom = zoomValue

  const isDefaultCamera =
    Math.abs(map.camera.x) < 0.01 &&
    Math.abs(map.camera.y) < 0.01 &&
    Math.abs(map.camera.zoom - 1) < 0.01

  if (isDefaultCamera && playerEntity && playerEntity.transform) {
    const centerX = canvasWidth / 2
    camera.x = playerEntity.transform.x - centerX / pixelsPerMeter

    initialPlayerScreenRatioY = 0.8

    isCameraLocked = true
    isVerticalCameraLocked = false
    verticalLookAheadOffsetY = 0
    verticalForceCenterAfterEmergency = false
  } else {
    isCameraLocked = false
    isVerticalCameraLocked = false
    verticalLookAheadOffsetY = 0
    verticalForceCenterAfterEmergency = false
  }
}

function resetWeaponPhysicsCircle(entity: Entity): void {
  if (!entity.physics || !entity.weapon || !entity.transform) {
    return
  }
  if (!box2d || !worldId) {
    return
  }

  const {
    b2DestroyBody,
    b2DefaultBodyDef,
    b2CreateBody,
    b2BodyType,
    b2DefaultShapeDef,
    b2CreateCircleShape,
    b2Circle,
  } = box2d

  b2DestroyBody(entity.physics.bodyId)

  const bodyDef = b2DefaultBodyDef()
  bodyDef.type = b2BodyType.b2_dynamicBody
  bodyDef.position.Set(entity.transform.x, entity.transform.y)
  bodyDef.linearDamping = 2.0
  bodyDef.motionLocks.angularZ = true
  entity.physics.bodyId = b2CreateBody(worldId, bodyDef)

  const shapeDef = b2DefaultShapeDef()
  shapeDef.density = 0.5
  shapeDef.material.friction = 0.3
  shapeDef.material.restitution = 0.2
  shapeDef.filter.categoryBits = CATEGORY_WEAPON
  shapeDef.filter.maskBits = MASK_WEAPON

  const circle = new b2Circle()
  circle.center.Set(0, 0)
  circle.radius = entity.weapon.height * 0.5
  entity.physics.shapeId = b2CreateCircleShape(
    entity.physics.bodyId,
    shapeDef,
    circle
  )

  bodyDef.delete()
  shapeDef.delete()
  circle.delete()
}

function isTemplateWeaponType(
  weaponType: string
): weaponType is keyof typeof WEAPON_DEFAULT_DATA {
  return weaponType in WEAPON_DEFAULT_DATA
}

function handleInput(
  activeKeys: string[],
  activeMouseButtons: number[],
  mouseZoomTarget: number,
  mouseX: number,
  mouseY: number,
  mouseCaptured: boolean
) {
  const temp = prevKeys
  prevKeys = currKeys
  currKeys = temp
  currKeys.clear()
  for (let i = 0; i < activeKeys.length; i++) {
    currKeys.add(activeKeys[i])
  }

  const tempMouse = prevMouseButtons
  prevMouseButtons = currMouseButtons
  currMouseButtons = tempMouse
  currMouseButtons.clear()
  for (let i = 0; i < activeMouseButtons.length; i++) {
    currMouseButtons.add(activeMouseButtons[i])
  }

  const isPlayerDead = playerEntity.stats?.isDead ?? false

  if (playerEntity.input) {
    let moveDirection = 0
    if (currKeys.has('a') || currKeys.has('arrowleft')) moveDirection -= 1
    if (currKeys.has('d') || currKeys.has('arrowright')) moveDirection += 1

    const isBowEquipped = playerEntity.weapon?.weaponType === 'bow'

    playerEntity.input.moveDirection = isPlayerDead ? 0 : moveDirection

    if (currKeys.has(' ') && !prevKeys.has(' ') && !isPlayerDead) {
      if (playerEntity.isStunned()) {
        playerEntity.input.inputBuffer.clearAll()
      }
      playerEntity.input.inputBuffer.bufferAction('jump')
      playerEntity.input.jumpRequested = true
    } else if (!currKeys.has(' ')) {
      playerEntity.input.jumpRequested = false
    }

    // Left click or J for attack
    const attackJustPressed =
      (currKeys.has('j') && !prevKeys.has('j')) ||
      (currMouseButtons.has(0) && !prevMouseButtons.has(0))
    const attackHeld = currKeys.has('j') || currMouseButtons.has(0)

    playerEntity.input.attackRequested = attackHeld && !isPlayerDead

    if (
      attackJustPressed &&
      !isPlayerDead &&
      playerEntity.weapon?.weaponType !== 'bow'
    ) {
      weaponSystem.startAttack(playerEntity)
    }

    const rightClickJustPressed =
      currMouseButtons.has(2) && !prevMouseButtons.has(2)
    const freeAimToggleJustPressed = currKeys.has('k') && !prevKeys.has('k')
    playerEntity.input.freeAimToggleRequested = false
    if (
      !isPlayerDead &&
      isBowEquipped &&
      (rightClickJustPressed || freeAimToggleJustPressed)
    ) {
      playerEntity.input.freeAimToggleRequested = true
    }

    const blockPressed =
      (currMouseButtons.has(2) && !isBowEquipped) ||
      (currKeys.has('k') && !isBowEquipped)
    if (blockPressed && !isPlayerDead) {
      playerEntity.input.blockRequested = true
    } else {
      playerEntity.input.blockRequested = false
    }

    // Q for lock toggle
    const lockToggleJustPressed = currKeys.has('q') && !prevKeys.has('q')

    if (lockToggleJustPressed && !isPlayerDead) {
      const dir = playerEntity.input.moveDirection
      const isLocked = playerEntity.input.lockedTargetId !== null
      if (dir !== 0 && isLocked) {
        playerEntity.input.lockSwitchIntent = dir
      } else {
        playerEntity.input.lockToggleRequested = true
      }
    }

    if (currKeys.has('control') && !prevKeys.has('control') && !isPlayerDead) {
      if (playerEntity.isStunned()) {
        playerEntity.input.inputBuffer.clearAll()
      }
      playerEntity.input.inputBuffer.bufferAction('roll')
    }

    const shiftHeld = currKeys.has('shift')
    if (shiftHeld && !isPlayerDead) {
      playerEntity.input.sprintRequested = !playerEntity.weapon?.bowFreeAim
    } else {
      playerEntity.input.sprintRequested = false
    }
    playerEntity.input.grappleHoldRequested = shiftHeld && !isPlayerDead
    playerEntity.input.grapplePersistentRequested = false

    const rPressed = currKeys.has('r')
    const rJustPressed = rPressed && !prevKeys.has('r')
    const rJustReleased = !rPressed && prevKeys.has('r')

    if (rJustPressed) {
      if (!isPlayerDead) {
        rHoldActive = true
        rHoldTriggered = false
        rHoldMs = 0
      } else {
        rHoldActive = false
        rHoldTriggered = false
        rHoldMs = 0
      }
    }

    if (rJustReleased) {
      if (rHoldActive && !rHoldTriggered && !isPlayerDead) {
        playerEntity.input.inputBuffer.bufferAction('grapple')
      }
      rHoldActive = false
      rHoldTriggered = false
      rHoldMs = 0
    }

    if (currKeys.has('e') && !prevKeys.has('e') && !isPlayerDead) {
      playerEntity.input.inputBuffer.bufferAction('interact')
    }

    const grappleJustPressed =
      currMouseButtons.has(1) && !prevMouseButtons.has(1) && !isPlayerDead
    if (grappleJustPressed) {
      playerEntity.input.inputBuffer.bufferAction('grapple')
    }

    if (currKeys.has('1') && !prevKeys.has('1') && !isPlayerDead) {
      weaponSystem.switchWeaponSlot(playerEntity, 'main')
    }

    if (currKeys.has('2') && !prevKeys.has('2') && !isPlayerDead) {
      weaponSystem.switchWeaponSlot(playerEntity, 'secondary')
    }

    let aimAdjust = 0
    const upHeld =
      currKeys.has('w') || currKeys.has('arrowup') || currKeys.has('ArrowUp')
    const downHeld =
      currKeys.has('s') ||
      currKeys.has('arrowdown') ||
      currKeys.has('ArrowDown')
    if (upHeld) {
      aimAdjust -= 1
    }
    if (downHeld) {
      aimAdjust += 1
    }
    playerEntity.input.grappleClimbHeld = upHeld ? -1 : downHeld ? 1 : 0
    playerEntity.input.freeAimAdjust = aimAdjust

    playerEntity.input.moveSpeedScale = playerEntity.weapon?.bowFreeAim
      ? 0.5
      : 1

    playerEntity.input.mouseAimActive = mouseCaptured
    if (mouseCaptured) {
      const prevMouseX = playerEntity.input.mouseScreenX
      const prevMouseY = playerEntity.input.mouseScreenY
      playerEntity.input.mouseAimMoved =
        mouseX !== prevMouseX || mouseY !== prevMouseY
      playerEntity.input.mouseScreenX = mouseX
      playerEntity.input.mouseScreenY = mouseY
      const anchorX = canvasWidth * 0.5
      const anchorY = canvasHeight
      const invZoom = 1 / zoom
      const camPxX = camera.x * pixelsPerMeter
      const camPxY = camera.y * pixelsPerMeter
      const worldPxX = (mouseX - anchorX) * invZoom + anchorX + camPxX
      const worldPxY = (mouseY - anchorY) * invZoom + anchorY + camPxY
      const invPixelsPerMeter = 1 / pixelsPerMeter
      playerEntity.input.mouseAimX = worldPxX * invPixelsPerMeter
      playerEntity.input.mouseAimY = worldPxY * invPixelsPerMeter
    } else {
      playerEntity.input.mouseAimMoved = false
    }
  }

  targetZoom = mouseZoomTarget
}

function fixedUpdate() {
  // Accumulate time using delta time
  currentTime += TIME_STEP
  playTimeMs += FIXED_STEP_MS

  if (rHoldActive && !rHoldTriggered) {
    if (!currKeys.has('r')) {
      rHoldActive = false
      rHoldTriggered = false
      rHoldMs = 0
    } else if (playerEntity?.input) {
      const isPlayerDead = playerEntity.stats?.isDead ?? false
      if (isPlayerDead) {
        rHoldActive = false
        rHoldTriggered = false
        rHoldMs = 0
      } else {
        rHoldMs += FIXED_STEP_MS
        if (rHoldMs >= GRAPPLE_LONG_PRESS_MS) {
          rHoldTriggered = true
          playerEntity.input.grapplePersistentRequested = true
          playerEntity.input.inputBuffer.bufferAction('grapple')
        }
      }
    }
  }

  // Update Zoom logic (smooth transition)
  const zoomDiff = targetZoom - zoom
  if (Math.abs(zoomDiff) > 0.001) {
    zoom += zoomDiff * 0.15
  } else {
    zoom = targetZoom
  }

  const entities = world.getEntities()
  spatialHash.update(entities)

  weaponSystem.setEntities(entities)
  weaponSystem.setSpatialHash(spatialHash)
  movementSystem.setEntities(entities)
  movementSystem.setSpatialHash(spatialHash)

  world.update(TIME_STEP)

  cleanupDestroyedEntities()

  updateCamera(playerEntity.transform ? playerEntity.transform.x : 0)
}

function update() {
  if (isPaused || !world) return

  const now = performance.now()
  let frameTime = (now - lastTime) / 1000
  lastTime = now

  // Spiral of death protection: Cap frame time
  if (frameTime > 0.25) frameTime = 0.25

  accumulator += frameTime

  while (accumulator >= TIME_STEP) {
    fixedUpdate()
    accumulator -= TIME_STEP
  }

  sendState()
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3)
}

function updateCamera(playerX: number) {
  // --- Horizontal Logic ---
  const canvasWidthInMeters = canvasWidth / (pixelsPerMeter * zoom)
  let isEnemyLocked = false
  let targetEntityX = 0

  if (
    playerEntity &&
    playerEntity.input &&
    playerEntity.input.lockedTargetId !== null
  ) {
    const targetEntity = world.getEntityById(playerEntity.input.lockedTargetId)
    if (targetEntity && targetEntity.transform) {
      const dist = Math.abs(targetEntity.transform.x - playerX)
      if (dist > canvasWidthInMeters * 0.9) {
        playerEntity.input.lockedTargetId = null
      } else {
        targetEntityX = targetEntity.transform.x
        isEnemyLocked = true
      }
    }
  }

  const centerX = canvasWidth / 2
  let desiredCameraX = camera.x

  if (isEnemyLocked) {
    const midPointX = (playerX + targetEntityX) * 0.5
    desiredCameraX = midPointX - centerX / pixelsPerMeter
  } else {
    const currentCameraX = camera.x
    const playerScreenX =
      centerX + ((playerX - currentCameraX) * pixelsPerMeter - centerX) * zoom

    const leftThird = canvasWidth / 3
    const rightThird = (2 * canvasWidth) / 3
    const isOutsideCenterZone =
      playerScreenX < leftThird || playerScreenX > rightThird

    // Safety check: player is too close to screen edge
    const edgeMargin = canvasWidth * 0.1
    const isNearEdge =
      playerScreenX < edgeMargin || playerScreenX > canvasWidth - edgeMargin

    // Check if player is in center zone
    const isInCenterZone = !isOutsideCenterZone

    if (isCameraLocked) {
      outOfCenterTime = 0
    } else if (isOutsideCenterZone) {
      outOfCenterTime += TIME_STEP
    } else {
      outOfCenterTime = 0
    }

    // Clear the return-to-center flag if player is back in center
    if (needsReturnToCenter && isInCenterZone) {
      needsReturnToCenter = false
    }

    // Check if we need to lock
    if (!isCameraLocked) {
      const timeSinceUnlock = currentTime - lastUnlockTime
      const canRelockWhileReturning =
        !needsReturnToCenter || outOfCenterTime >= OUTSIDE_THIRD_RELOCK_DELAY
      const normalLockCondition =
        canRelockWhileReturning && timeSinceUnlock > UNLOCK_COOLDOWN
      const emergencyLock = isNearEdge

      // Lock if in left/right third (with normal conditions) OR emergency
      if (isOutsideCenterZone) {
        if (normalLockCondition || emergencyLock) {
          isCameraLocked = true
          isTransitioning = true
          transitionStartTime = currentTime
          transitionStartCameraX = camera.x

          // Clear flags on emergency lock
          if (emergencyLock) {
            needsReturnToCenter = false
          }

          // Initialize velocity direction for turn detection
          if (playerEntity && playerEntity.physics) {
            const vel = box2d.b2Body_GetLinearVelocity(
              playerEntity.physics.bodyId
            )
            lastVelocityDirection = vel.x > 0.05 ? 1 : vel.x < -0.05 ? -1 : 0
            vel.delete()
          }
        }
      }
    }

    // Check if we need to unlock (player stopped or turned around)
    if (isCameraLocked) {
      if (playerEntity && playerEntity.physics) {
        const vel = box2d.b2Body_GetLinearVelocity(playerEntity.physics.bodyId)
        const speed = Math.abs(vel.x)
        const currentDirection = vel.x > 0.05 ? 1 : vel.x < -0.05 ? -1 : 0
        vel.delete()

        if (!horizontalForceCenterAfterEmergency) {
          // Unlock if player stopped (and not transitioning)
          if (speed < 0.1 && !isTransitioning) {
            isCameraLocked = false
            lastVelocityDirection = 0
            needsReturnToCenter = true
            lastUnlockTime = currentTime
          }
          // Unlock if player turned around (more sensitive detection)
          else if (lastVelocityDirection !== 0 && currentDirection !== 0) {
            if (lastVelocityDirection !== currentDirection) {
              isCameraLocked = false
              isTransitioning = false
              lastVelocityDirection = 0
              needsReturnToCenter = true
              lastUnlockTime = currentTime
            } else {
              // Only update direction if still moving in same direction
              lastVelocityDirection = currentDirection
            }
          } else if (currentDirection !== 0 && lastVelocityDirection === 0) {
            // Initialize direction if starting to move
            lastVelocityDirection = currentDirection
          }
        } else if (speed < 0.1) {
          lastVelocityDirection = 0
        } else if (currentDirection !== 0) {
          lastVelocityDirection = currentDirection
        }
      }
    }

    // Set desired camera position with time-based easing transition
    if (isCameraLocked) {
      const forwardOffset = lastVelocityDirection * CAMERA_FORWARD_OFFSET
      if (isTransitioning) {
        const elapsed = currentTime - transitionStartTime
        const progress = Math.min(elapsed / TRANSITION_DURATION, 1)

        if (progress >= 1) {
          isTransitioning = false
          desiredCameraX = playerX + forwardOffset - centerX / pixelsPerMeter
        } else {
          const targetX = playerX + forwardOffset - centerX / pixelsPerMeter
          const easedProgress = easeOutCubic(progress)
          desiredCameraX =
            transitionStartCameraX +
            (targetX - transitionStartCameraX) * easedProgress
        }
      } else {
        desiredCameraX = playerX + forwardOffset - centerX / pixelsPerMeter
      }
    } else {
      desiredCameraX = currentCameraX
    }
  }

  // Horizontal Interpolation
  const diffX = desiredCameraX - camera.x
  if (Math.abs(diffX) > 0.001) {
    camera.x += diffX * 0.15
  } else {
    camera.x = desiredCameraX
  }

  // Emergency Clamp: Prevent player from escaping viewport at high speed.
  if (playerEntity && playerEntity.transform) {
    const currentCameraX = camera.x
    const playerScreenX =
      centerX + ((playerX - currentCameraX) * pixelsPerMeter - centerX) * zoom
    const leftLimit = canvasWidth / 3
    const rightLimit = (2 * canvasWidth) / 3
    let didEmergencyClamp = false

    if (playerScreenX < leftLimit) {
      const targetScreenX = leftLimit
      camera.x =
        playerX - ((targetScreenX - centerX) / zoom + centerX) / pixelsPerMeter
      didEmergencyClamp = true
    } else if (playerScreenX > rightLimit) {
      const targetScreenX = rightLimit
      camera.x =
        playerX - ((targetScreenX - centerX) / zoom + centerX) / pixelsPerMeter
      didEmergencyClamp = true
    }

    if (didEmergencyClamp) {
      // After emergency catch-up, immediately hand off to slow center tracking.
      isCameraLocked = true
      isTransitioning = true
      transitionStartTime = currentTime
      transitionStartCameraX = camera.x
      outOfCenterTime = 0
      horizontalForceCenterAfterEmergency = true
      needsReturnToCenter = false
    }

    if (
      isCameraLocked &&
      !isTransitioning &&
      horizontalForceCenterAfterEmergency
    ) {
      const centerScreenX = 0.5 * canvasWidth
      const centerDelta = Math.abs(playerScreenX - centerScreenX)
      const centerEpsilon = HORIZONTAL_CENTER_UNLOCK_EPSILON_RATIO * canvasWidth
      if (centerDelta <= centerEpsilon) {
        isCameraLocked = false
        lastUnlockTime = currentTime
        outOfCenterTime = 0
        horizontalForceCenterAfterEmergency = false
        needsReturnToCenter = false
        lastVelocityDirection = 0
      }
    }
  }

  // --- Vertical Logic ---
  const canvasHeightInMeters = canvasHeight / pixelsPerMeter
  let desiredCameraY = camera.y
  const bottomLimitRatio = initialPlayerScreenRatioY
  const topLimitRatio = 1 - bottomLimitRatio
  const topLimit = topLimitRatio * canvasHeight
  const bottomLimit = bottomLimitRatio * canvasHeight

  if (playerEntity && playerEntity.transform) {
    const playerY = playerEntity.transform.y
    const playerFeetY = playerY + DEFAULT_PLAYER_RADIUS
    const currentCameraY = camera.y
    let playerVelocityY = 0
    if (playerEntity.physics) {
      const vel = box2d.b2Body_GetLinearVelocity(playerEntity.physics.bodyId)
      playerVelocityY = vel.y
      vel.delete()
    }

    // Screen-space position calculation (matching GameClient render transform)
    const playerScreenY =
      canvasHeight +
      ((playerFeetY - currentCameraY) * pixelsPerMeter - canvasHeight) * zoom

    const isOutsideVerticalZone =
      playerScreenY < topLimit || playerScreenY > bottomLimit

    if (DEBUG_DRAW_CAMERA) {
      debugCameraData.topLimitRatio = topLimitRatio
      debugCameraData.bottomLimitRatio = bottomLimitRatio
      debugCameraData.playerScreenY = playerScreenY
      debugCameraData.playerFeetY = playerFeetY
      debugCameraData.cameraY = currentCameraY
      debugCameraData.zoom = zoom
      debugCameraData.isOutsideVerticalZone = isOutsideVerticalZone
    }

    // Time tracking
    if (isVerticalCameraLocked) {
      verticalOutOfCenterTime = 0
    } else if (isOutsideVerticalZone) {
      verticalOutOfCenterTime += TIME_STEP
    } else {
      verticalOutOfCenterTime = 0
    }

    // Lock Logic
    if (!isVerticalCameraLocked) {
      const timeSinceUnlock = currentTime - lastVerticalUnlockTime

      if (
        isOutsideVerticalZone &&
        verticalOutOfCenterTime >= OUTSIDE_THIRD_RELOCK_DELAY &&
        timeSinceUnlock > UNLOCK_COOLDOWN
      ) {
        isVerticalCameraLocked = true
        isVerticalTransitioning = true
        verticalTransitionStartTime = currentTime
        verticalTransitionStartCameraY = camera.y
        verticalForceCenterAfterEmergency = false
      }
    }

    const lookAheadTarget = Math.max(
      -VERTICAL_LOOK_AHEAD_MAX,
      Math.min(
        VERTICAL_LOOK_AHEAD_MAX,
        playerVelocityY * VERTICAL_LOOK_AHEAD_TIME
      )
    )
    verticalLookAheadOffsetY +=
      (lookAheadTarget - verticalLookAheadOffsetY) * VERTICAL_LOOK_AHEAD_LERP

    // Target Calculation
    if (isVerticalCameraLocked || isVerticalTransitioning) {
      // Formula to find CameraY for a specific ScreenRatio:
      // camY = worldY - canvasHeightInMeters * ((ratio - 1) / zoom + 1)
      const trackedFeetY = playerFeetY + verticalLookAheadOffsetY
      const targetY =
        trackedFeetY -
        canvasHeightInMeters * ((VERTICAL_LOCK_SCREEN_RATIO - 1) / zoom + 1)

      if (isVerticalTransitioning) {
        const elapsed = currentTime - verticalTransitionStartTime
        const progress = Math.min(elapsed / VERTICAL_TRANSITION_DURATION, 1)

        if (progress >= 1) {
          isVerticalTransitioning = false
          desiredCameraY = targetY
        } else {
          const eased = easeOutCubic(progress)
          desiredCameraY =
            verticalTransitionStartCameraY +
            (targetY - verticalTransitionStartCameraY) * eased
        }
      } else {
        desiredCameraY = targetY
      }
    } else {
      desiredCameraY = currentCameraY
    }
  }

  // Vertical Interpolation (Time-based smoothing)
  const diffY = desiredCameraY - camera.y
  if (Math.abs(diffY) > 0.001) {
    camera.y += diffY * VERTICAL_FOLLOW_LERP
  } else {
    camera.y = desiredCameraY
  }

  // Emergency Clamp: Prevent player from escaping viewport at high speed.
  let didEmergencyClamp = false
  if (playerEntity && playerEntity.transform) {
    const playerFeetY = playerEntity.transform.y + DEFAULT_PLAYER_RADIUS
    const currentCameraY = camera.y
    const playerScreenY =
      canvasHeight +
      ((playerFeetY - currentCameraY) * pixelsPerMeter - canvasHeight) * zoom

    if (playerScreenY < topLimit) {
      const ratio = topLimitRatio
      camera.y = playerFeetY - canvasHeightInMeters * ((ratio - 1) / zoom + 1)
      didEmergencyClamp = true
    } else if (playerScreenY > bottomLimit) {
      const ratio = bottomLimitRatio
      camera.y = playerFeetY - canvasHeightInMeters * ((ratio - 1) / zoom + 1)
      didEmergencyClamp = true
    }

    if (didEmergencyClamp) {
      // After emergency catch-up, immediately hand off to slow center tracking.
      isVerticalCameraLocked = true
      isVerticalTransitioning = true
      verticalTransitionStartTime = currentTime
      verticalTransitionStartCameraY = camera.y
      verticalOutOfCenterTime = 0
      verticalForceCenterAfterEmergency = true
    }

    if (isVerticalCameraLocked && !isVerticalTransitioning) {
      if (!verticalForceCenterAfterEmergency) {
        const isInsideVerticalZone =
          playerScreenY >= topLimit && playerScreenY <= bottomLimit
        if (isInsideVerticalZone) {
          isVerticalCameraLocked = false
          lastVerticalUnlockTime = currentTime
          verticalOutOfCenterTime = 0
        }
      } else {
        const centerScreenY = VERTICAL_LOCK_SCREEN_RATIO * canvasHeight
        const centerDelta = Math.abs(playerScreenY - centerScreenY)
        const centerEpsilon =
          VERTICAL_CENTER_UNLOCK_EPSILON_RATIO * canvasHeight
        if (centerDelta <= centerEpsilon) {
          isVerticalCameraLocked = false
          lastVerticalUnlockTime = currentTime
          verticalOutOfCenterTime = 0
          verticalForceCenterAfterEmergency = false
        }
      }
      if (!isVerticalCameraLocked) {
        verticalForceCenterAfterEmergency = false
        isVerticalCameraLocked = false
      }
    }
  }
}

function cleanupDestroyedEntities() {
  const entities = world.getEntities()
  for (const entity of entities) {
    const isPlayer = entity.id === playerEntity.id

    // 清理被拾取的独立武器实体
    const isPickedUpWeapon =
      entity.weapon && entity.weapon.isEquipped && !entity.stats
    if (isPickedUpWeapon) {
      spatialHash.removeEntity(entity)
      world.destroyEntity(entity)
      continue
    }

    if (entity.stats?.isDead && entity.weapon) {
      entity.weapon.hitEntityIds.clear()
      entity.removeComponent('Weapon')
    }
    if (entity.stats?.isVanished && !isPlayer) {
      if (enemyEntity && enemyEntity.id === entity.id) {
        enemyEntity = null
      }
      spatialHash.removeEntity(entity)
      world.destroyEntity(entity)
    }
  }
}

function collectSensorDebugData(entities: Entity[]): SensorDebugData[] {
  let sensorCount = 0

  for (const entity of entities) {
    if (!entity.sensor || !entity.transform) continue

    let facing = 1
    if (entity.input) {
      if (
        entity.input.facingOverride !== null &&
        entity.input.facingOverride !== 0
      ) {
        facing = entity.input.facingOverride
      } else if (entity.input.lastMoveDirection !== 0) {
        facing = entity.input.lastMoveDirection
      }
    } else if (entity.weapon) {
      facing = entity.weapon.attackFacing
    }

    const scanResults = entity.sensor.scanResults
    let sensorDebug = debugSensors[sensorCount]
    if (!sensorDebug) {
      sensorDebug = {
        entityId: entity.id,
        x: 0,
        y: 0,
        radius: 0,
        facing: 1,
        rays: [],
      }
      debugSensors[sensorCount] = sensorDebug
    }

    sensorDebug.entityId = entity.id
    sensorDebug.x = entity.transform.x
    sensorDebug.y = entity.transform.y
    sensorDebug.radius = entity.sensor.radius
    sensorDebug.facing = facing

    const rays = sensorDebug.rays
    for (let i = rays.length; i < scanResults.length; i++) {
      rays.push({
        startX: 0,
        startY: 0,
        endX: 0,
        endY: 0,
        hit: false,
        hitX: 0,
        hitY: 0,
        isHostile: false,
      })
    }
    if (rays.length > scanResults.length) {
      rays.length = scanResults.length
    }

    for (let i = 0; i < scanResults.length; i++) {
      const result = scanResults[i]
      const ray = rays[i]
      ray.startX = result.start.x
      ray.startY = result.start.y
      ray.endX = result.end.x
      ray.endY = result.end.y
      ray.hit = result.hit
      ray.isHostile = result.isHostile ?? false
      if (result.hit && result.hitPoint) {
        ray.hitX = result.hitPoint.x
        ray.hitY = result.hitPoint.y
      } else {
        ray.hitX = result.end.x
        ray.hitY = result.end.y
      }
    }

    sensorCount++
  }

  if (debugSensors.length > sensorCount) {
    debugSensors.length = sensorCount
  }

  return debugSensors
}

function collectSoundWaveDebugData(): SoundWaveDebugData[] {
  const waves = soundSystem.getActiveWaves()
  for (let i = 0; i < waves.length; i++) {
    const wave = waves[i]
    let debugWave = debugSoundWaves[i]
    if (!debugWave) {
      debugWave = {
        x: 0,
        y: 0,
        radius: 0,
        maxRadius: 0,
        db: 0,
      }
      debugSoundWaves[i] = debugWave
    }
    debugWave.x = wave.x
    debugWave.y = wave.y
    debugWave.radius = wave.radius
    debugWave.maxRadius = wave.maxRadius
    debugWave.db = wave.currentDb
  }

  if (debugSoundWaves.length > waves.length) {
    debugSoundWaves.length = waves.length
  }

  return debugSoundWaves
}

function collectSoundListenerDebugData(
  entities: Entity[]
): SoundListenerDebugData[] {
  let listenerCount = 0

  for (let i = 0; i < entities.length; i++) {
    const entity = entities[i]
    if (!entity.enemyAI || !entity.transform) continue
    if (entity.faction?.faction !== Faction.Enemy) continue
    if (entity.stats?.isDead || entity.stats?.isVanished) continue

    let debugListener = debugSoundListeners[listenerCount]
    if (!debugListener) {
      debugListener = {
        entityId: entity.id,
        x: 0,
        y: 0,
        radius: 0,
      }
      debugSoundListeners[listenerCount] = debugListener
    }

    debugListener.entityId = entity.id
    debugListener.x = entity.transform.x
    debugListener.y = entity.transform.y
    debugListener.radius =
      entity.enemyAI.detectionRange * ENEMY_HEARING_RANGE_MULTIPLIER

    listenerCount += 1
  }

  if (debugSoundListeners.length > listenerCount) {
    debugSoundListeners.length = listenerCount
  }

  return debugSoundListeners
}

function sendState() {
  if (!sharedStateBuffer && stateBufferViews.length === 0) {
    return
  }

  const entities = world.getEntities()
  let highlightAnchorId = -1
  if (playerEntity?.transform && playerEntity.grapple?.hasGrapple) {
    const playerX = playerEntity.transform.x
    const playerY = playerEntity.transform.y
    const facing = playerEntity.input?.lastMoveDirection ?? 1
    const forwardX = facing >= 0 ? 1 : -1
    const forwardY = 0
    const cosHalfFov = Math.cos(DEFAULT_PLAYER_FOV_RAD * 0.5)
    const rangeSq = DEFAULT_GRAPPLE_RANGE * DEFAULT_GRAPPLE_RANGE
    const isTethering = playerEntity.grapple.isTethering
    const currentTargetX = isTethering
      ? playerEntity.grapple.targetX
      : undefined
    const currentTargetY = isTethering
      ? playerEntity.grapple.targetY
      : undefined
    let bestDistSq = rangeSq + 1
    for (let i = 0; i < entities.length; i++) {
      const entity = entities[i]
      if (!entity.grappleAnchor || !entity.transform) continue

      if (
        currentTargetX !== undefined &&
        currentTargetY !== undefined &&
        Math.abs(entity.transform.x - currentTargetX) < 0.01 &&
        Math.abs(entity.transform.y - currentTargetY) < 0.01
      ) {
        continue
      }

      const dx = entity.transform.x - playerX
      const dy = entity.transform.y - playerY
      const distSq = dx * dx + dy * dy
      if (distSq > rangeSq || distSq <= 0) continue
      const invDist = 1 / Math.sqrt(distSq)
      const dot = (dx * forwardX + dy * forwardY) * invDist
      if (dot < cosHalfFov) continue
      if (distSq < bestDistSq) {
        bestDistSq = distSq
        highlightAnchorId = entity.id
      }
    }
  }
  let count = 0

  for (const e of entities) {
    if (count >= MAX_ENTITIES) break
    if (!e.transform) continue

    // 独立武器实体不需要 render 组件
    const isStandaloneWeapon = e.weapon && !e.weapon.isEquipped && !e.stats
    if (!isStandaloneWeapon && !e.render) continue

    const offset = count * ENTITY_STRIDE

    stateBuffer[offset + OFFSETS.ID] = e.id
    stateBuffer[offset + OFFSETS.X] = e.transform.x
    stateBuffer[offset + OFFSETS.Y] = e.transform.y
    stateBuffer[offset + OFFSETS.RADIUS] = e.render?.radius ?? 0
    stateBuffer[offset + OFFSETS.COLOR] = parseColor(
      e.render?.color ?? '#000000'
    )
    stateBuffer[offset + OFFSETS.BORDER_COLOR] = parseColor(
      e.render?.borderColor ?? '#000000'
    )

    let flags = 0
    if (e.render?.visible ?? isStandaloneWeapon) flags |= FLAGS.VISIBLE
    if (e.stats?.isDead) flags |= FLAGS.DEAD
    if (e.stats?.isVanished) flags |= FLAGS.VANISHED
    if (e.movement?.isRolling) flags |= FLAGS.ROLLING
    if (e.stats?.isStaggered) flags |= FLAGS.STAGGERED

    // 武器具有伤害力的条件（与实际碰撞检测逻辑一致）
    const isWeaponAttacking =
      e.weapon?.attackPhase === 'swing' ||
      (e.weapon?.attackPhase === 'pause' && !e.movement?.isGrounded)
    if (isWeaponAttacking) flags |= FLAGS.WEAPON_ATTACKING
    if (e.id === playerEntity.id) flags |= FLAGS.IS_PLAYER
    if (e.stats?.isInCombat) flags |= FLAGS.IN_COMBAT
    const hudVisibleTimer = e.stats ? e.stats.hudVisibleTimer : 0
    if (hudVisibleTimer > 0) flags |= FLAGS.HUD_VISIBLE
    if (e.weapon?.isBlocking) flags |= FLAGS.WEAPON_BLOCKING
    if (e.checkpoint) flags |= FLAGS.CHECKPOINT
    if (e.grapple?.hasGrapple) flags |= FLAGS.GRAPPLE_READY
    if (e.grappleAnchor) flags |= FLAGS.GRAPPLE_ANCHOR
    if (e.grappleAnchor && e.id === highlightAnchorId) {
      flags |= FLAGS.GRAPPLE_ANCHOR_HIGHLIGHT
      stateBuffer[offset + OFFSETS.COLOR] = parseColor(
        GRAPPLE_ANCHOR_HIGHLIGHT_COLOR
      )
      stateBuffer[offset + OFFSETS.BORDER_COLOR] = parseColor(
        GRAPPLE_ANCHOR_HIGHLIGHT_BORDER_COLOR
      )
    }

    stateBuffer[offset + OFFSETS.FLAGS] = flags

    stateBuffer[offset + OFFSETS.MOVE_DIR] = e.input
      ? e.input.lastMoveDirection
      : 1
    stateBuffer[offset + OFFSETS.ROLL_ANGLE] = e.movement
      ? e.movement.rollAngle
      : 0
    stateBuffer[offset + OFFSETS.LOCKED_TARGET_ID] =
      e.input?.lockedTargetId ?? -1
    if (e.id === playerEntity.id && e.weapon?.bowFreeAim) {
      stateBuffer[offset + OFFSETS.FREE_AIM_ACTIVE] = 1
      stateBuffer[offset + OFFSETS.FREE_AIM_X] = e.weapon.bowFreeAimReticleX
      stateBuffer[offset + OFFSETS.FREE_AIM_Y] = e.weapon.bowFreeAimReticleY
    } else {
      stateBuffer[offset + OFFSETS.FREE_AIM_ACTIVE] = 0
      stateBuffer[offset + OFFSETS.FREE_AIM_X] = 0
      stateBuffer[offset + OFFSETS.FREE_AIM_Y] = 0
    }

    if (e.stats) {
      stateBuffer[offset + OFFSETS.STATS_HEALTH_MAX] = e.stats.maxHealth
      stateBuffer[offset + OFFSETS.STATS_HEALTH] = e.stats.health
      stateBuffer[offset + OFFSETS.STATS_POSTURE_MAX] = e.stats.maxPosture
      stateBuffer[offset + OFFSETS.STATS_POSTURE] = e.stats.posture
      stateBuffer[offset + OFFSETS.STATS_DEATH_ELAPSED] =
        e.stats.deathElapsedSec
      stateBuffer[offset + OFFSETS.STATS_SHAKE_DURATION] =
        e.stats.hitShakeDurationMs
      stateBuffer[offset + OFFSETS.STATS_SHAKE_ELAPSED] =
        e.stats.hitShakeElapsedMs
      stateBuffer[offset + OFFSETS.STATS_SHAKE_INTENSITY] =
        e.stats.hitShakeIntensity
      stateBuffer[offset + OFFSETS.STATS_SHAKE_DIR_X] =
        e.stats.hitShakeDirectionX
    } else {
      stateBuffer[offset + OFFSETS.STATS_HEALTH_MAX] = 0
    }

    if (e.grapple) {
      stateBuffer[offset + OFFSETS.GRAPPLE_ACTIVE] = e.grapple.isPulling ? 1 : 0
      stateBuffer[offset + OFFSETS.GRAPPLE_TARGET_X] = e.grapple.targetX
      stateBuffer[offset + OFFSETS.GRAPPLE_TARGET_Y] = e.grapple.targetY
      stateBuffer[offset + OFFSETS.GRAPPLE_START_X] = e.grapple.startX
      stateBuffer[offset + OFFSETS.GRAPPLE_START_Y] = e.grapple.startY
      stateBuffer[offset + OFFSETS.GRAPPLE_VX] = e.grapple.velocityX
      stateBuffer[offset + OFFSETS.GRAPPLE_VY] = e.grapple.velocityY
    } else {
      stateBuffer[offset + OFFSETS.GRAPPLE_ACTIVE] = 0
      stateBuffer[offset + OFFSETS.GRAPPLE_TARGET_X] = 0
      stateBuffer[offset + OFFSETS.GRAPPLE_TARGET_Y] = 0
      stateBuffer[offset + OFFSETS.GRAPPLE_START_X] = 0
      stateBuffer[offset + OFFSETS.GRAPPLE_START_Y] = 0
      stateBuffer[offset + OFFSETS.GRAPPLE_VX] = 0
      stateBuffer[offset + OFFSETS.GRAPPLE_VY] = 0
    }

    // 独立武器实体（地面武器）：只要有weapon组件就显示
    // 角色实体：只有装备时才显示武器
    if (e.weapon && (!e.stats || e.weapon.isEquipped)) {
      stateBuffer[offset + OFFSETS.WEAPON_ACTIVE] = 1
      stateBuffer[offset + OFFSETS.WEAPON_X] = e.weapon.visual.x
      stateBuffer[offset + OFFSETS.WEAPON_Y] = e.weapon.visual.y
      stateBuffer[offset + OFFSETS.WEAPON_ROT] = e.weapon.visual.rotation
      stateBuffer[offset + OFFSETS.WEAPON_W] = e.weapon.width
      stateBuffer[offset + OFFSETS.WEAPON_H] = e.weapon.height
      stateBuffer[offset + OFFSETS.WEAPON_R] = e.weapon.cornerRadius
      stateBuffer[offset + OFFSETS.WEAPON_DRAW] = e.weapon.bowDrawRatio
      stateBuffer[offset + OFFSETS.WEAPON_DRAW_ACTIVE] = e.weapon.bowIsDrawing
        ? 1
        : 0
      stateBuffer[offset + OFFSETS.WEAPON_HAS_ARROW] =
        e.weapon.weaponType === 'bow' && e.weapon.bowAmmo > 0 ? 1 : 0
      stateBuffer[offset + OFFSETS.WEAPON_TYPE] = getWeaponTypeId(
        e.weapon.weaponType
      )
    } else {
      stateBuffer[offset + OFFSETS.WEAPON_ACTIVE] = 0
      stateBuffer[offset + OFFSETS.WEAPON_DRAW] = 0
      stateBuffer[offset + OFFSETS.WEAPON_DRAW_ACTIVE] = 0
      stateBuffer[offset + OFFSETS.WEAPON_HAS_ARROW] = 0
      stateBuffer[offset + OFFSETS.WEAPON_TYPE] = WEAPON_TYPES.SWORD
    }

    if (e.weaponSlots) {
      const weaponSlots = e.weaponSlots
      const mainSlot = weaponSlots.main
      const secondarySlot = weaponSlots.secondary
      const activeSlotIndex = weaponSlots.activeSlot === 'main' ? 0 : 1
      let mainAmmo = mainSlot.bowAmmo
      let secondaryAmmo = secondarySlot.bowAmmo
      let mainSize = mainSlot.sizeLevel
      let secondarySize = secondarySlot.sizeLevel
      let mainMax = mainSlot.sizeMaxLevel
      let secondaryMax = secondarySlot.sizeMaxLevel

      if (e.weapon && e.weapon.isEquipped) {
        if (activeSlotIndex === 0) {
          mainAmmo = e.weapon.bowAmmo
          mainSize = e.weapon.sizeLevel
          mainMax = e.weapon.sizeMaxLevel
        } else {
          secondaryAmmo = e.weapon.bowAmmo
          secondarySize = e.weapon.sizeLevel
          secondaryMax = e.weapon.sizeMaxLevel
        }
      }

      stateBuffer[offset + OFFSETS.WEAPON_SLOT_MAIN_HAS] = mainSlot.hasWeapon
        ? 1
        : 0
      stateBuffer[offset + OFFSETS.WEAPON_SLOT_MAIN_TYPE] = mainSlot.hasWeapon
        ? getWeaponTypeId(mainSlot.weaponType)
        : WEAPON_TYPES.SWORD
      stateBuffer[offset + OFFSETS.WEAPON_SLOT_MAIN_W] = mainSlot.width
      stateBuffer[offset + OFFSETS.WEAPON_SLOT_MAIN_H] = mainSlot.height
      stateBuffer[offset + OFFSETS.WEAPON_SLOT_MAIN_AMMO] = mainAmmo
      stateBuffer[offset + OFFSETS.WEAPON_SLOT_MAIN_SIZE] = mainSize
      stateBuffer[offset + OFFSETS.WEAPON_SLOT_MAIN_MAX] = mainMax

      stateBuffer[offset + OFFSETS.WEAPON_SLOT_SECONDARY_HAS] =
        secondarySlot.hasWeapon ? 1 : 0
      stateBuffer[offset + OFFSETS.WEAPON_SLOT_SECONDARY_TYPE] =
        secondarySlot.hasWeapon
          ? getWeaponTypeId(secondarySlot.weaponType)
          : WEAPON_TYPES.SWORD
      stateBuffer[offset + OFFSETS.WEAPON_SLOT_SECONDARY_W] =
        secondarySlot.width
      stateBuffer[offset + OFFSETS.WEAPON_SLOT_SECONDARY_H] =
        secondarySlot.height
      stateBuffer[offset + OFFSETS.WEAPON_SLOT_SECONDARY_AMMO] = secondaryAmmo
      stateBuffer[offset + OFFSETS.WEAPON_SLOT_SECONDARY_SIZE] = secondarySize
      stateBuffer[offset + OFFSETS.WEAPON_SLOT_SECONDARY_MAX] = secondaryMax
      stateBuffer[offset + OFFSETS.WEAPON_SLOT_ACTIVE] = activeSlotIndex
    } else {
      stateBuffer[offset + OFFSETS.WEAPON_SLOT_MAIN_HAS] = 0
      stateBuffer[offset + OFFSETS.WEAPON_SLOT_MAIN_TYPE] = WEAPON_TYPES.SWORD
      stateBuffer[offset + OFFSETS.WEAPON_SLOT_MAIN_W] = 0
      stateBuffer[offset + OFFSETS.WEAPON_SLOT_MAIN_H] = 0
      stateBuffer[offset + OFFSETS.WEAPON_SLOT_MAIN_AMMO] = 0
      stateBuffer[offset + OFFSETS.WEAPON_SLOT_MAIN_SIZE] = 0
      stateBuffer[offset + OFFSETS.WEAPON_SLOT_MAIN_MAX] = 0
      stateBuffer[offset + OFFSETS.WEAPON_SLOT_SECONDARY_HAS] = 0
      stateBuffer[offset + OFFSETS.WEAPON_SLOT_SECONDARY_TYPE] =
        WEAPON_TYPES.SWORD
      stateBuffer[offset + OFFSETS.WEAPON_SLOT_SECONDARY_W] = 0
      stateBuffer[offset + OFFSETS.WEAPON_SLOT_SECONDARY_H] = 0
      stateBuffer[offset + OFFSETS.WEAPON_SLOT_SECONDARY_AMMO] = 0
      stateBuffer[offset + OFFSETS.WEAPON_SLOT_SECONDARY_SIZE] = 0
      stateBuffer[offset + OFFSETS.WEAPON_SLOT_SECONDARY_MAX] = 0
      stateBuffer[offset + OFFSETS.WEAPON_SLOT_ACTIVE] = 0
    }

    count++
  }

  let ropePointCount = 0
  if (playerEntity?.grapple?.isTethering) {
    ropePointCount = grappleSystem.writeActiveRopePoints(
      playerEntity,
      stateBuffer,
      ROPE_POINTS_BASE_OFFSET,
      MAX_ROPE_POINTS
    )
  }

  stateMessage.entitiesBuffer = stateBuffer.buffer
  stateMessage.entityCount = count
  stateMessage.effectsCount = effectsCount
  stateMessage.ropePointCount = ropePointCount
  stateMessage.camera.x = camera.x
  stateMessage.camera.y = camera.y
  stateMessage.zoom = zoom
  const shouldSendDebug =
    DEBUG_DRAW_SENSORS || DEBUG_DRAW_SOUND || DEBUG_DRAW_CAMERA
  if (sharedStateBuffer) {
    ctx.postMessage(stateMessage)
    if (shouldSendDebug) {
      debugMessage.sensors = DEBUG_DRAW_SENSORS
        ? collectSensorDebugData(entities)
        : emptySensors
      debugMessage.soundWaves = DEBUG_DRAW_SOUND
        ? collectSoundWaveDebugData()
        : emptySoundWaves
      debugMessage.soundListeners = DEBUG_DRAW_SOUND
        ? collectSoundListenerDebugData(entities)
        : emptySoundListeners
      debugMessage.camera = DEBUG_DRAW_CAMERA ? debugCameraData : null
      ctx.postMessage(debugMessage)
    }
    effectsCount = 0
    return
  }

  const buffer = stateBuffer.buffer as ArrayBuffer
  ctx.postMessage(stateMessage, [buffer])
  if (shouldSendDebug) {
    debugMessage.sensors = DEBUG_DRAW_SENSORS
      ? collectSensorDebugData(entities)
      : emptySensors
    debugMessage.soundWaves = DEBUG_DRAW_SOUND
      ? collectSoundWaveDebugData()
      : emptySoundWaves
    debugMessage.soundListeners = DEBUG_DRAW_SOUND
      ? collectSoundListenerDebugData(entities)
      : emptySoundListeners
    debugMessage.camera = DEBUG_DRAW_CAMERA ? debugCameraData : null
    ctx.postMessage(debugMessage)
  }
  effectsCount = 0

  const nextView = stateBufferViews.pop()
  if (nextView) {
    stateBuffer = nextView
  }
}

function restart() {
  if (!world || !box2d) return

  world.clear()

  if (worldId) {
    const { b2DestroyWorld } = box2d
    b2DestroyWorld(worldId)
  }

  const { b2DefaultWorldDef, b2CreateWorld, b2Vec2 } = box2d
  const worldDef = b2DefaultWorldDef()
  worldDef.gravity = new b2Vec2(0, DEFAULT_GRAVITY)
  worldId = b2CreateWorld(worldDef)
  worldDef.delete()

  spatialHash = new SpatialHash(5)
  obstacles = []

  const groundHeight = 0.5
  const groundY = canvasHeight / pixelsPerMeter - groundHeight
  groundTopY = groundY - groundHeight

  createEnvironment()
  initializeSystems()
  enemyEntity = null
  createPlayerAndWeapon(groundTopY, activeMapData)

  enemyAISystem.setPlayer(playerEntity)
  soundSystem.setPlayer(playerEntity)
  targetingSystem.setPlayer(playerEntity)

  prevKeys.clear()
  currKeys.clear()
  prevMouseButtons.clear()
  currMouseButtons.clear()
  rHoldMs = 0
  rHoldActive = false
  rHoldTriggered = false

  // Reset camera state variables
  isCameraLocked = false
  isTransitioning = false
  transitionStartTime = 0
  transitionStartCameraX = 0
  lastVelocityDirection = 0
  needsReturnToCenter = false
  lastUnlockTime = 0
  outOfCenterTime = 0

  // Reset Vertical State
  isVerticalCameraLocked = false
  isVerticalTransitioning = false
  verticalTransitionStartTime = 0
  verticalTransitionStartCameraY = 0
  verticalOutOfCenterTime = 0
  lastVerticalUnlockTime = 0
  initialPlayerScreenRatioY = 0.8
  verticalLookAheadOffsetY = 0
  verticalForceCenterAfterEmergency = false

  if (activeMapData) {
    applyMapCamera(activeMapData)
  } else if (playerEntity && playerEntity.transform) {
    camera.x = 0
    camera.y = 0
    zoom = DEFAULT_CAMERA_ZOOM
    targetZoom = DEFAULT_CAMERA_ZOOM

    const centerX = canvasWidth / 2
    camera.x = playerEntity.transform.x - centerX / pixelsPerMeter

    // Vertical initialization
    const canvasHeightInMeters = canvasHeight / pixelsPerMeter
    camera.y = canvasHeightInMeters - canvasHeightInMeters

    initialPlayerScreenRatioY = 0.8

    isCameraLocked = true
  }
  effectsCount = 0
  isPaused = false
  lastTime = performance.now()
  accumulator = 0
  currentTime = 0
}

// Message Handler
ctx.onmessage = (e: MessageEvent<MainToWorkerMessage>) => {
  const msg = e.data
  switch (msg.type) {
    case 'init':
      init(msg.canvasWidth, msg.canvasHeight, msg.pixelsPerMeter)
      break
    case 'input':
      if (world && playerEntity && 'mouseButtons' in msg) {
        handleInput(
          msg.keys,
          msg.mouseButtons,
          msg.mouseZoom,
          msg.mouseX,
          msg.mouseY,
          msg.mouseCaptured
        )
      }
      break
    case 'buffer_release':
      releaseStateBuffer(msg.buffer)
      break
    case 'control':
      if (msg.action === 'stop') isPaused = true
      if (msg.action === 'start') {
        isPaused = false
        lastTime = performance.now()
      }
      if (msg.action === 'restart') restart()
      if (msg.action === 'clear_map_preview') {
        activeMapData = defaultMapData
        isMapPreview = false
        if (activeMapData) {
          ctx.postMessage({
            type: 'map_data',
            map: activeMapData,
          })
        }
        restart()
      }
      if (msg.action === 'reload_default_map') {
        void reloadDefaultMap()
      }
      if (msg.action === 'update_param') {
        updateParam(msg.paramId, msg.value)
      }
      break
    case 'map_preview':
      activeMapData = msg.map
      isMapPreview = true
      restart()
      break
    case 'save_request':
      exportGameState(msg.saveId)
      break
    case 'load_save':
      loadFromSave(msg.saveData)
      break
  }
}

function updateParam(id?: string, value?: number) {
  if (!id || value === undefined) return

  if (!playerEntity) {
    pendingParams[id] = value
    return
  }

  // Map params similarly to main.ts
  // 'jumpForce' -> player.movement.jumpForce
  // etc.
  // Ideally we should have a map or switch

  if (playerEntity.movement) {
    switch (id) {
      case 'jumpForce':
        playerEntity.movement.jumpForce = value
        break
      case 'maxJumpDuration':
        playerEntity.movement.maxJumpDuration = value
        break
      case 'jumpForceMultiplier':
        playerEntity.movement.jumpForceMultiplier = value
        break
      case 'wallJumpPushAway':
        playerEntity.movement.wallJumpPushAwayMultiplier = value
        break
      case 'wallJumpUpward':
        playerEntity.movement.wallJumpUpwardMultiplier = value
        break
      case 'maxWallJumps':
        playerEntity.movement.maxWallJumps = Math.floor(value)
        break
      case 'moveSpeed':
        playerEntity.movement.moveSpeed = value
        break
      case 'baseWeight':
        playerEntity.movement.baseWeight = Math.max(1, value)
        break
    }
    // Handle carryWeight sync if needed? done in update usually
  }

  if (playerEntity.physics) {
    if (id === 'bodyFriction') {
      const { b2Shape_SetFriction } = box2d
      b2Shape_SetFriction(playerEntity.physics.shapeId, value)
      if (playerEntity.movement) {
        playerEntity.movement.bodyFriction = value
        if (playerEntity.movement.isGrounded) {
          playerEntity.movement.currentFriction = value
        }
      }
    }
    if (id === 'bodyLinearDamping') {
      const { b2Body_SetLinearDamping } = box2d
      b2Body_SetLinearDamping(playerEntity.physics.bodyId, value)
    }
  }

  if (id === 'groundFriction') {
    groundFriction = value
    if (groundShapeIds.length > 0) {
      const { b2Shape_SetFriction } = box2d
      for (let i = 0; i < groundShapeIds.length; i++) {
        b2Shape_SetFriction(groundShapeIds[i], value)
      }
    }
  }

  if (id === 'obstacleFriction') {
    obstacleFriction = value
    const { b2Shape_SetFriction } = box2d
    obstacles.forEach((obs) => {
      // Only update the Top Cap friction
      b2Shape_SetFriction(obs.capShapeId, value)
      // Base friction remains 0
    })
  }

  if (id === 'ropeDensity') {
    grappleSystem.setRopeDensity(value)
  }

  if (id === 'ropeLinearDamping') {
    grappleSystem.setRopeLinearDamping(value)
  }

  if (id === 'ropeHertz') {
    grappleSystem.setRopeHertz(value)
  }

  if (id === 'ropeDampingRatio') {
    grappleSystem.setRopeDampingRatio(value)
  }

  if (id === 'swingForce') {
    grappleSystem.setSwingForce(value)
  }

  if (id === 'jumpBufferWindow') {
    if (playerEntity.input) {
      playerEntity.input.inputBuffer.setDefaultBufferWindow(value)
    }
  }
}

function ensureTransformTemps(): void {
  if (!box2d) return
  if (!tempSetTransformVec) {
    tempSetTransformVec = new box2d.b2Vec2(0, 0)
  }
  if (!tempZeroVec) {
    tempZeroVec = new box2d.b2Vec2(0, 0)
  }
  if (!tempSetTransformRot) {
    tempSetTransformRot = new box2d.b2Rot()
    tempSetTransformRot.SetAngle(0)
  }
}

function setEntityTransformFromSave(
  entity: Entity,
  x: number,
  y: number
): void {
  if (!entity.transform) return
  entity.transform.x = x
  entity.transform.y = y

  if (!entity.physics || !box2d) return

  ensureTransformTemps()
  if (!tempSetTransformVec || !tempZeroVec || !tempSetTransformRot) return

  tempSetTransformVec.Set(x, y)
  box2d.b2Body_SetTransform(
    entity.physics.bodyId,
    tempSetTransformVec,
    tempSetTransformRot
  )
  box2d.b2Body_SetLinearVelocity(entity.physics.bodyId, tempZeroVec)
  entity.physics.posX = x
  entity.physics.posY = y
  entity.physics.prevX = x
  entity.physics.prevY = y
  entity.physics.velX = 0
  entity.physics.velY = 0
  entity.physics.hasPrev = true
}

function ensureEnemyPersistentId(entity: Entity): string {
  if (!entity.stats) return ''
  if (entity.stats.persistentId) {
    return entity.stats.persistentId
  }
  const nextId = `enemy-${nextPersistentEnemyId}`
  nextPersistentEnemyId += 1
  entity.stats.persistentId = nextId
  return nextId
}

function syncEnemyIdCounter(persistentId: string): void {
  if (!persistentId.startsWith('enemy-')) return
  const suffix = persistentId.slice(6)
  const parsed = Number.parseInt(suffix, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return
  if (parsed >= nextPersistentEnemyId) {
    nextPersistentEnemyId = parsed + 1
  }
}

function applyWeaponSlotState(
  slot: {
    hasWeapon: boolean
    weaponType: WeaponVisualType
    width: number
    height: number
    baseWidth: number
    sizeLevel: number
    sizeMaxLevel: number
    cornerRadius: number
    weight: number
    attackDamage: number
    postureDamage: number
    toughnessDamage: number
    bowAmmo: number
    bowAmmoMax: number
  },
  state: SaveWeaponSlotState | null
): void {
  if (!state) {
    slot.hasWeapon = false
    return
  }

  slot.hasWeapon = true
  slot.weaponType = state.weaponType
  slot.sizeLevel = state.sizeLevel
  if (state.width !== undefined) slot.width = state.width
  if (state.height !== undefined) slot.height = state.height
  if (state.baseWidth !== undefined) slot.baseWidth = state.baseWidth
  if (state.sizeMaxLevel !== undefined) slot.sizeMaxLevel = state.sizeMaxLevel
  if (state.cornerRadius !== undefined) slot.cornerRadius = state.cornerRadius
  if (state.weight !== undefined) slot.weight = state.weight
  slot.attackDamage = state.attackDamage
  slot.postureDamage = state.postureDamage
  slot.toughnessDamage = state.toughnessDamage
  slot.bowAmmo = state.bowAmmo
  slot.bowAmmoMax = state.bowAmmoMax
}

function syncActiveSlotFromWeapon(
  weaponSlots: {
    activeSlot: 'main' | 'secondary'
    main: {
      hasWeapon: boolean
      weaponType: WeaponVisualType
      width: number
      height: number
      baseWidth: number
      sizeLevel: number
      sizeMaxLevel: number
      cornerRadius: number
      weight: number
      attackDamage: number
      postureDamage: number
      toughnessDamage: number
      bowAmmo: number
      bowAmmoMax: number
    }
    secondary: {
      hasWeapon: boolean
      weaponType: WeaponVisualType
      width: number
      height: number
      baseWidth: number
      sizeLevel: number
      sizeMaxLevel: number
      cornerRadius: number
      weight: number
      attackDamage: number
      postureDamage: number
      toughnessDamage: number
      bowAmmo: number
      bowAmmoMax: number
    }
  },
  weapon: {
    isEquipped: boolean
    weaponType: WeaponVisualType
    width: number
    height: number
    baseWidth: number
    sizeLevel: number
    sizeMaxLevel: number
    cornerRadius: number
    weight: number
    attackDamage: number
    postureDamage: number
    toughnessDamage: number
    bowAmmo: number
    bowAmmoMax: number
  }
): void {
  if (!weapon.isEquipped) return
  const targetSlot =
    weaponSlots.activeSlot === 'main' ? weaponSlots.main : weaponSlots.secondary
  targetSlot.hasWeapon = true
  targetSlot.weaponType = weapon.weaponType
  targetSlot.width = weapon.baseWidth
  targetSlot.height = weapon.height
  targetSlot.baseWidth = weapon.baseWidth
  targetSlot.sizeLevel = weapon.sizeLevel
  targetSlot.sizeMaxLevel = weapon.sizeMaxLevel
  targetSlot.cornerRadius = weapon.cornerRadius
  targetSlot.weight = weapon.weight
  targetSlot.attackDamage = weapon.attackDamage
  targetSlot.postureDamage = weapon.postureDamage
  targetSlot.toughnessDamage = weapon.toughnessDamage
  targetSlot.bowAmmo = weapon.bowAmmo
  targetSlot.bowAmmoMax = weapon.bowAmmoMax
}

function applyWeaponFromSlot(
  weapon: {
    sizeLevel: number
    width: number
    height: number
    baseWidth: number
    sizeMaxLevel: number
    cornerRadius: number
    weight: number
    blockWidthStart: number
    blockWidthTarget: number
    weaponType: WeaponVisualType
    attackDamage: number
    postureDamage: number
    toughnessDamage: number
    bowAmmo: number
    bowAmmoMax: number
    isEquipped: boolean
  },
  slot: {
    hasWeapon: boolean
    weaponType: WeaponVisualType
    sizeLevel: number
    width: number
    height: number
    baseWidth: number
    sizeMaxLevel: number
    cornerRadius: number
    weight: number
    attackDamage: number
    postureDamage: number
    toughnessDamage: number
    bowAmmo: number
    bowAmmoMax: number
  }
): void {
  if (!slot.hasWeapon) {
    weapon.isEquipped = false
    return
  }

  const weaponType = slot.weaponType
  weapon.weaponType = weaponType
  weapon.sizeLevel = slot.sizeLevel
  weapon.attackDamage = slot.attackDamage
  weapon.postureDamage = slot.postureDamage
  weapon.toughnessDamage = slot.toughnessDamage
  weapon.bowAmmo = slot.bowAmmo
  weapon.bowAmmoMax = slot.bowAmmoMax
  weapon.isEquipped = true

  if (slot.width > 0) {
    weapon.width = slot.width
    weapon.height = slot.height
    weapon.baseWidth = slot.baseWidth
    weapon.blockWidthStart = slot.width
    weapon.blockWidthTarget = slot.width
  }
  if (slot.sizeMaxLevel > 0) {
    weapon.sizeMaxLevel = slot.sizeMaxLevel
  }
  if (slot.cornerRadius > 0) {
    weapon.cornerRadius = slot.cornerRadius
  }
  if (slot.weight > 0) {
    weapon.weight = slot.weight
  }
}

function applyGroundWeaponState(
  weapon: {
    weaponType: WeaponVisualType
    sizeLevel: number
    width: number
    height: number
    baseWidth: number
    sizeMaxLevel: number
    cornerRadius: number
    weight: number
    blockWidthStart: number
    blockWidthTarget: number
    attackDamage: number
    postureDamage: number
    toughnessDamage: number
    bowAmmo: number
    bowAmmoMax: number
    isEquipped: boolean
    position: { x: number; y: number }
    visual: { x: number; y: number; rotation: number }
    attackStartTransform: { x: number; y: number; rotation: number }
    swingStartTransform: { x: number; y: number; rotation: number }
    swingEndTransform: { x: number; y: number; rotation: number }
  },
  state: SaveGroundWeaponState
): void {
  weapon.weaponType = state.weaponType
  weapon.sizeLevel = state.sizeLevel
  weapon.attackDamage = state.attackDamage
  weapon.postureDamage = state.postureDamage
  weapon.toughnessDamage = state.toughnessDamage
  weapon.bowAmmo = state.bowAmmo
  weapon.bowAmmoMax = state.bowAmmoMax
  weapon.isEquipped = false

  if (state.width !== undefined) {
    weapon.width = state.width
    weapon.blockWidthStart = state.width
    weapon.blockWidthTarget = state.width
  }
  if (state.height !== undefined) {
    weapon.height = state.height
  }
  if (state.baseWidth !== undefined) {
    weapon.baseWidth = state.baseWidth
  }
  if (state.sizeMaxLevel !== undefined) {
    weapon.sizeMaxLevel = state.sizeMaxLevel
  }
  if (state.cornerRadius !== undefined) {
    weapon.cornerRadius = state.cornerRadius
  }
  if (state.weight !== undefined) {
    weapon.weight = state.weight
  }

  weapon.position.x = state.position.x
  weapon.position.y = state.position.y
  weapon.visual.x = state.position.x
  weapon.visual.y = state.position.y
  weapon.attackStartTransform.x = state.position.x
  weapon.attackStartTransform.y = state.position.y
  weapon.swingStartTransform.x = state.position.x
  weapon.swingStartTransform.y = state.position.y
  weapon.swingEndTransform.x = state.position.x
  weapon.swingEndTransform.y = state.position.y
}

function extractWeaponSlotState(
  slot: {
    hasWeapon: boolean
    weaponType: string
    sizeLevel: number
    width: number
    height: number
    baseWidth: number
    sizeMaxLevel: number
    cornerRadius: number
    weight: number
    attackDamage: number
    postureDamage: number
    toughnessDamage: number
    bowAmmo: number
    bowAmmoMax: number
  } | null
): SaveWeaponSlotState | null {
  if (!slot || !slot.hasWeapon) return null
  return {
    weaponType: slot.weaponType as SaveWeaponSlotState['weaponType'],
    sizeLevel: slot.sizeLevel,
    width: slot.width,
    height: slot.height,
    baseWidth: slot.baseWidth,
    sizeMaxLevel: slot.sizeMaxLevel,
    cornerRadius: slot.cornerRadius,
    weight: slot.weight,
    attackDamage: slot.attackDamage,
    postureDamage: slot.postureDamage,
    toughnessDamage: slot.toughnessDamage,
    bowAmmo: slot.bowAmmo,
    bowAmmoMax: slot.bowAmmoMax,
  }
}

function extractPlayerState(): SavePlayerState {
  const transform = playerEntity.transform
  const stats = playerEntity.stats
  const input = playerEntity.input
  const weaponSlots = playerEntity.weaponSlots
  const weapon = playerEntity.weapon
  const grapple = playerEntity.grapple

  if (weaponSlots && weapon) {
    syncActiveSlotFromWeapon(weaponSlots, weapon)
  }

  return {
    id: stats?.persistentId ?? PLAYER_PERSISTENT_ID,
    position: { x: transform?.x ?? 0, y: transform?.y ?? 0 },
    facing: input?.lastMoveDirection ?? 1,
    health: stats?.health ?? 100,
    maxHealth: stats?.maxHealth ?? 100,
    posture: stats?.posture ?? 100,
    maxPosture: stats?.maxPosture ?? 100,
    toughness: stats?.toughness ?? 100,
    maxToughness: stats?.maxToughness ?? 100,
    hasGrapple: grapple?.hasGrapple ?? false,
    mainWeapon: weaponSlots ? extractWeaponSlotState(weaponSlots.main) : null,
    secondaryWeapon: weaponSlots
      ? extractWeaponSlotState(weaponSlots.secondary)
      : null,
    activeSlot: weaponSlots?.activeSlot ?? 'main',
  }
}

function extractEnemiesState(): SaveEnemyState[] {
  const enemies: SaveEnemyState[] = []
  const entities = world.getEntities()

  let spawnIndex = 0
  for (let i = 0; i < entities.length; i++) {
    const entity = entities[i]
    if (!entity.enemyAI || !entity.faction) continue
    if (entity.faction.faction !== Faction.Enemy) continue

    const transform = entity.transform
    const stats = entity.stats
    const input = entity.input
    const weaponSlots = entity.weaponSlots
    const weapon = entity.weapon
    const enemyAI = entity.enemyAI

    if (weaponSlots && weapon) {
      syncActiveSlotFromWeapon(weaponSlots, weapon)
    }

    const persistentId = stats ? ensureEnemyPersistentId(entity) : ''
    const nextSpawnIndex =
      enemyAI.mapSpawnIndex >= 0 ? enemyAI.mapSpawnIndex : spawnIndex
    enemies.push({
      spawnIndex: nextSpawnIndex,
      id: persistentId || undefined,
      enemyType: enemyAI.enemyType,
      position: { x: transform?.x ?? 0, y: transform?.y ?? 0 },
      facing: input?.lastMoveDirection ?? 1,
      health: stats?.health ?? 100,
      posture: stats?.posture ?? 100,
      toughness: stats?.toughness ?? 100,
      isDead: stats?.isDead ?? false,
      isVanished: stats?.isVanished ?? false,
      aiState: enemyAI.state,
      currentWaypointIndex: enemyAI.currentWaypointIndex,
      mainWeapon: weaponSlots ? extractWeaponSlotState(weaponSlots.main) : null,
      secondaryWeapon: weaponSlots
        ? extractWeaponSlotState(weaponSlots.secondary)
        : null,
      activeSlot: weaponSlots?.activeSlot ?? 'main',
    })
    if (enemyAI.mapSpawnIndex < 0) {
      spawnIndex++
    }
  }

  return enemies
}

function extractGroundWeaponsState(): SaveGroundWeaponState[] {
  const weapons: SaveGroundWeaponState[] = []
  const entities = world.getEntities()

  let spawnIndex = 0
  for (let i = 0; i < entities.length; i++) {
    const entity = entities[i]
    if (!entity.weapon || entity.faction) continue
    if (entity.weapon.isEquipped) continue

    const transform = entity.transform
    const weapon = entity.weapon

    weapons.push({
      spawnIndex,
      position: { x: transform?.x ?? 0, y: transform?.y ?? 0 },
      weaponType: weapon.weaponType,
      sizeLevel: weapon.sizeLevel,
      width: weapon.width,
      height: weapon.height,
      baseWidth: weapon.baseWidth,
      sizeMaxLevel: weapon.sizeMaxLevel,
      cornerRadius: weapon.cornerRadius,
      weight: weapon.weight,
      attackDamage: weapon.attackDamage,
      postureDamage: weapon.postureDamage,
      toughnessDamage: weapon.toughnessDamage,
      bowAmmo: weapon.bowAmmo,
      bowAmmoMax: weapon.bowAmmoMax,
    })
    spawnIndex++
  }

  return weapons
}

function exportGameState(saveId: string): void {
  if (isMapPreview) {
    return
  }
  if (!world || !playerEntity) return

  const activeCheckpoint = readActiveCheckpointForSave()

  const response: WorkerSaveResponseMessage = {
    type: 'save_response',
    saveId,
    playTimeMs,
    activeCheckpoint,
    player: extractPlayerState(),
    enemies: extractEnemiesState(),
    groundWeapons: extractGroundWeaponsState(),
    camera: { x: camera.x, y: camera.y, zoom },
  }

  ctx.postMessage(response)
}

function readActiveCheckpointForSave(): SaveCheckpointState | null {
  if (!checkpointSystem) {
    return null
  }
  if (
    !checkpointSystem.readActiveCheckpointPosition(activeCheckpointSavePosition)
  ) {
    return null
  }
  return activeCheckpointSavePosition
}

function loadFromSave(saveData: SaveData): void {
  if (!world || !box2d) return

  playTimeMs = saveData.playTimeMs

  activeMapData = saveData.mapData
  isMapPreview = false

  restart()

  if (playerEntity && playerEntity.stats) {
    const playerState = saveData.player

    setEntityTransformFromSave(
      playerEntity,
      playerState.position.x,
      playerState.position.y
    )
    playerEntity.stats.persistentId = playerState.id ?? PLAYER_PERSISTENT_ID
    playerEntity.stats.health = playerState.health
    playerEntity.stats.maxHealth = playerState.maxHealth
    playerEntity.stats.posture = playerState.posture
    playerEntity.stats.maxPosture = playerState.maxPosture
    playerEntity.stats.toughness = playerState.toughness
    playerEntity.stats.maxToughness = playerState.maxToughness

    if (playerEntity.input) {
      playerEntity.input.lastMoveDirection = playerState.facing
    }

    if (playerEntity.grapple) {
      playerEntity.grapple.hasGrapple = !!playerState.hasGrapple
      playerEntity.grapple.isPulling = false
      playerEntity.grapple.pullElapsedMs = 0
      playerEntity.grapple.moveLockEndTime = 0
    }

    restorePlayerWeapons(saveData.player)
  }

  if (saveData.worldStateReady !== false) {
    restoreEnemiesState(saveData.enemies)
    restoreGroundWeaponsState(saveData.groundWeapons)
  }

  restoreActiveCheckpointFromSave(saveData)

  camera.x = saveData.camera.x
  camera.y = saveData.camera.y
  zoom = saveData.camera.zoom
  targetZoom = saveData.camera.zoom

  ctx.postMessage({
    type: 'map_data',
    map: activeMapData,
  })
}

function restoreActiveCheckpointFromSave(saveData: SaveData): void {
  if (!world) return
  const savedCheckpoint = saveData.activeCheckpoint
  if (!savedCheckpoint) return

  const entities = world.getEntities()
  for (let i = 0; i < entities.length; i++) {
    const entity = entities[i]
    if (!entity.checkpoint || !entity.transform) continue
    if (
      entity.transform.x === savedCheckpoint.x &&
      entity.transform.y === savedCheckpoint.y
    ) {
      checkpointSystem.setActiveCheckpoint(entity, false)
      break
    }
  }
}

function restorePlayerWeapons(playerState: SaveData['player']): void {
  if (!playerEntity || !playerEntity.weaponSlots || !playerEntity.weapon) return

  const slots = playerEntity.weaponSlots

  applyWeaponSlotState(slots.main, playerState.mainWeapon)
  applyWeaponSlotState(slots.secondary, playerState.secondaryWeapon)

  slots.activeSlot = playerState.activeSlot

  const activeSlot = slots.activeSlot === 'main' ? slots.main : slots.secondary

  if (activeSlot.hasWeapon) {
    applyWeaponFromSlot(playerEntity.weapon, activeSlot)
    if (activeSlot.width <= 0) {
      const weaponType = activeSlot.weaponType as WeaponType
      if (isTemplateWeaponType(weaponType)) {
        const template = WEAPON_DEFAULT_DATA[weaponType]
        applyWeaponSizeLevel(
          playerEntity.weapon,
          template,
          activeSlot.sizeLevel
        )
      }
    }
  } else {
    playerEntity.weapon.isEquipped = false
  }
}

function restoreEnemiesState(enemiesState: SaveEnemyState[]): void {
  if (!world || !box2d) return

  const entities = world.getEntities()
  const currentEnemies: Entity[] = []
  const currentById = new Map<string, Entity>()
  const currentWithoutId: Entity[] = []

  for (let i = 0; i < entities.length; i++) {
    const entity = entities[i]
    if (!entity.enemyAI || !entity.faction) continue
    if (entity.faction.faction !== Faction.Enemy) continue
    currentEnemies.push(entity)
    if (entity.stats?.persistentId) {
      currentById.set(entity.stats.persistentId, entity)
    } else {
      currentWithoutId.push(entity)
    }
  }

  const savedById = new Map<string, SaveEnemyState>()
  const savedWithoutId: SaveEnemyState[] = []
  for (let i = 0; i < enemiesState.length; i++) {
    const savedState = enemiesState[i]
    if (savedState.id) {
      savedById.set(savedState.id, savedState)
    } else {
      savedWithoutId.push(savedState)
    }
  }

  const usedEntities = new Set<Entity>()

  const applyStateToEntity = (entity: Entity, savedState: SaveEnemyState) => {
    setEntityTransformFromSave(
      entity,
      savedState.position.x,
      savedState.position.y
    )
    if (entity.stats) {
      entity.stats.health = savedState.health
      entity.stats.posture = savedState.posture
      entity.stats.toughness = savedState.toughness
      entity.stats.isDead = savedState.isDead
      entity.stats.isVanished = savedState.isVanished
      if (savedState.id) {
        entity.stats.persistentId = savedState.id
        syncEnemyIdCounter(savedState.id)
      } else {
        ensureEnemyPersistentId(entity)
      }
    }

    if (entity.input) {
      entity.input.lastMoveDirection = savedState.facing
    }

    if (entity.enemyAI) {
      entity.enemyAI.state = savedState.aiState
      entity.enemyAI.currentWaypointIndex = savedState.currentWaypointIndex
      entity.enemyAI.lastPosition.x = savedState.position.x
      entity.enemyAI.lastPosition.y = savedState.position.y
    }

    if (entity.weaponSlots && entity.weapon) {
      applyWeaponSlotState(entity.weaponSlots.main, savedState.mainWeapon)
      applyWeaponSlotState(
        entity.weaponSlots.secondary,
        savedState.secondaryWeapon
      )
      entity.weaponSlots.activeSlot = savedState.activeSlot

      const activeSlot =
        entity.weaponSlots.activeSlot === 'main'
          ? entity.weaponSlots.main
          : entity.weaponSlots.secondary
      applyWeaponFromSlot(entity.weapon, activeSlot)
      if (activeSlot.hasWeapon && activeSlot.width <= 0) {
        const weaponType = activeSlot.weaponType as WeaponType
        if (isTemplateWeaponType(weaponType)) {
          const template = WEAPON_DEFAULT_DATA[weaponType]
          applyWeaponSizeLevel(entity.weapon, template, activeSlot.sizeLevel)
        }
      }
    }

    if (savedState.isDead || savedState.isVanished) {
      if (entity.stats) {
        entity.stats.isDead = true
        entity.stats.isVanished = true
      }
      if (entity.render) {
        entity.render.visible = false
      }
      if (entity.physics) {
        const { b2DestroyBody } = box2d
        b2DestroyBody(entity.physics.bodyId)
        entity.removeComponent('Physics')
      }
    }
    usedEntities.add(entity)
  }

  for (const [id, savedState] of savedById.entries()) {
    const entity = currentById.get(id)
    if (entity) {
      applyStateToEntity(entity, savedState)
      continue
    }
    const enemyType = savedState.enemyType ?? 'default'
    const created = createEnemy(
      world,
      box2d,
      worldId,
      savedState.position.x,
      savedState.position.y,
      groundTopY,
      enemyType
    )
    applyStateToEntity(created, savedState)
  }

  let fallbackIndex = 0
  for (let i = 0; i < savedWithoutId.length; i++) {
    const savedState = savedWithoutId[i]
    if (fallbackIndex < currentWithoutId.length) {
      const entity = currentWithoutId[fallbackIndex]
      fallbackIndex += 1
      applyStateToEntity(entity, savedState)
      continue
    }
    const enemyType = savedState.enemyType ?? 'default'
    const created = createEnemy(
      world,
      box2d,
      worldId,
      savedState.position.x,
      savedState.position.y,
      groundTopY,
      enemyType
    )
    applyStateToEntity(created, savedState)
  }

  for (let i = 0; i < currentEnemies.length; i++) {
    const entity = currentEnemies[i]
    if (usedEntities.has(entity)) continue
    if (entity.stats) {
      entity.stats.isDead = true
      entity.stats.isVanished = true
    }
    if (entity.render) {
      entity.render.visible = false
    }
    if (entity.physics) {
      const { b2DestroyBody } = box2d
      b2DestroyBody(entity.physics.bodyId)
      entity.removeComponent('Physics')
    }
  }
}

function restoreGroundWeaponsState(
  groundWeaponsState: SaveGroundWeaponState[]
): void {
  if (!world) return

  const entities = world.getEntities()
  let spawnIndex = 0

  for (let i = 0; i < entities.length; i++) {
    const entity = entities[i]
    if (!entity.weapon || entity.faction) continue
    if (entity.weapon.isEquipped) continue

    const savedState = groundWeaponsState[spawnIndex]
    if (savedState) {
      setEntityTransformFromSave(
        entity,
        savedState.position.x,
        savedState.position.y
      )
      applyGroundWeaponState(entity.weapon, savedState)
    } else {
      spatialHash.removeEntity(entity)
      world.destroyEntity(entity)
    }
    spawnIndex++
  }

  if (spawnIndex < groundWeaponsState.length && box2d) {
    for (let i = spawnIndex; i < groundWeaponsState.length; i++) {
      const savedState = groundWeaponsState[i]
      const created = createWeapon(
        world,
        box2d,
        worldId,
        savedState.position.x,
        savedState.position.y,
        groundTopY,
        savedState.weaponType as WeaponType
      )
      setEntityTransformFromSave(
        created,
        savedState.position.x,
        savedState.position.y
      )
      if (created.weapon) {
        applyGroundWeaponState(created.weapon, savedState)
      }
    }
  }
}
