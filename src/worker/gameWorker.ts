import Box2DFactory from 'box2d3-wasm'

import {
  CATEGORY_GROUND,
  CATEGORY_OBSTACLE,
  DEBUG_DRAW_CAMERA,
  DEBUG_DRAW_SENSORS,
  DEBUG_DRAW_SOUND,
  DEFAULT_CAMERA_ZOOM,
  DEFAULT_GRAVITY,
  DEFAULT_GROUND_FRICTION,
  DEFAULT_OBSTACLE_FRICTION,
  DEFAULT_PLAYER_RADIUS,
  ENEMY_HEARING_RANGE_MULTIPLIER,
} from '../constants'
import { ArrowPools } from '../ecs/ArrowPools'
import { Faction } from '../ecs/Component'
import { componentRegistry } from '../ecs/ComponentRegistry'
import type { Entity } from '../ecs/Entity'
import { SpatialHash } from '../ecs/SpatialHash'
import { World } from '../ecs/World'
import { createPlayer, createWeapon } from '../ecs/factories/PlayerFactory'
import { ArrowSystem } from '../ecs/systems/ArrowSystem'
import { EnemyAISystem } from '../ecs/systems/EnemyAISystem'
import { InteractionSystem } from '../ecs/systems/InteractionSystem'
import { MovementSystem } from '../ecs/systems/MovementSystem'
import { PhysicsSystem } from '../ecs/systems/PhysicsSystem'
import { SoundSystem } from '../ecs/systems/SoundSystem'
import { type EffectsEmitter, StatsSystem } from '../ecs/systems/StatsSystem'
import { TargetingSystem } from '../ecs/systems/TargetingSystem'
import { WeaponSystem } from '../ecs/systems/WeaponSystem'
import type {
  MainModule,
  WeaponVisualType,
  b2BodyId,
  b2Hull,
  b2Polygon,
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
  STATE_BUFFER_FLOATS,
} from './effectsProtocol'
import type {
  CameraDebugData,
  MainToWorkerMessage,
  SensorDebugData,
  SoundListenerDebugData,
  SoundWaveDebugData,
  WorkerDebugMessage,
  WorkerStateMessage,
} from './protocol'

// Worker global scope
const ctx: Worker = self as unknown as Worker

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
let arrowPools: ArrowPools

let groundShapeId: b2ShapeId
let obstacles: {
  bodyId: b2BodyId
  mainShapeId: b2ShapeId
  capBodyId: b2BodyId
  capShapeId: b2ShapeId
  centerX: number
  centerY: number
  width: number
  height: number
  vertices?: { x: number; y: number }[]
  worldVertices?: { x: number; y: number }[]
}[] = []

let isPaused = false
let loopInterval: ReturnType<typeof setInterval>
const TARGET_FPS = 60
const TIME_STEP = 1 / TARGET_FPS

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
    case 'hammer':
      return WEAPON_TYPES.HAMMER
    case 'bow':
      return WEAPON_TYPES.BOW
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
  if (effectsCount >= MAX_EFFECTS) return
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

// Vertical Camera State
let isVerticalCameraLocked = false
let isVerticalTransitioning = false
let verticalTransitionStartTime = 0
let verticalTransitionStartCameraY = 0
let verticalOutOfCenterTime = 0
let lastVerticalUnlockTime = 0
let initialPlayerScreenRatioY = 0.95 // Default to near bottom

const TRANSITION_DURATION = 3.0
const UNLOCK_COOLDOWN = 0.2
const OUTSIDE_THIRD_RELOCK_DELAY = 0.15
const CAMERA_FORWARD_OFFSET = 0.67 // 2/3 角色宽度前向偏移

// Reusable message object for sendState
const stateMessage: WorkerStateMessage = {
  type: 'state',
  entitiesBuffer: null as unknown as ArrayBuffer | SharedArrayBuffer,
  entityCount: 0,
  effectsCount: 0,
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
  topLimitRatio: 0.5,
  bottomLimitRatio: 0.95,
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
  createGround()
  createObstacles()
  const groundHeight = 0.5
  const groundY = canvasHeight / pixelsPerMeter - groundHeight
  groundTopY = groundY - groundHeight

  initializeSystems()
  createPlayerAndWeapon(groundTopY)

  // Initialize camera to center on player
  if (playerEntity && playerEntity.transform) {
    const centerX = canvasWidth / 2
    camera.x = playerEntity.transform.x - centerX / pixelsPerMeter

    // Vertical initialization: Camera at top (0), Player near bottom
    const canvasHeightInMeters = canvasHeight / pixelsPerMeter
    camera.y = canvasHeightInMeters - canvasHeightInMeters // Effectively 0

    // Capture initial screen ratio (considering the 0.2 buffer)
    const initialPlayerFeetY =
      playerEntity.transform.y + DEFAULT_PLAYER_RADIUS + 0.2
    // Formula derived from GameClient's anchor-at-bottom-center transform
    const initialScreenY =
      canvasHeight +
      ((initialPlayerFeetY - camera.y) * pixelsPerMeter - canvasHeight) * zoom
    initialPlayerScreenRatioY = Math.max(
      0.6,
      Math.min(0.98, initialScreenY / canvasHeight)
    )

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
  componentRegistry.registerComponent('Arrow')
  componentRegistry.registerComponent('Faction')
  componentRegistry.registerComponent('EnemyAI')
}

function initializeSystems() {
  statsSystem = new StatsSystem(box2d, worldId)
  statsSystem.setEffectsEmitter(effectsEmitter)
  statsSystem.setBloodEffectsEnabled(false)
  soundSystem = new SoundSystem()
  enemyAISystem = new EnemyAISystem(box2d, worldId)
  physicsSystem = new PhysicsSystem(box2d, worldId)
  movementSystem = new MovementSystem(box2d)
  weaponSystem = new WeaponSystem(box2d, statsSystem)
  arrowSystem = new ArrowSystem(box2d, statsSystem)
  arrowPools = new ArrowPools()
  interactionSystem = new InteractionSystem()
  statsSystem.setWeaponSystem(weaponSystem)
  statsSystem.setSoundSystem(soundSystem)
  enemyAISystem.setWeaponSystem(weaponSystem)
  movementSystem.setSoundSystem(soundSystem)
  movementSystem.setStatsSystem(statsSystem)
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
  world.addSystem(soundSystem)
  world.addSystem(enemyAISystem)
  world.addSystem(movementSystem)
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
  groundShapeId = b2CreatePolygonShape(bodyId, shapeDef, groundBox)

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
  // groundY logic matches createGround: bottom of screen - 0.5 (ground center)
  // Actually ground center is at (Bottom - 0.5).
  const groundY = canvasHeightInMeters - 0.5
  obstacles = []

  // 跌落伤害测试平台（高度递增设计）
  // 玩家在x=-12，向右是测试阶梯区
  // height参数是半高，实际高度=height*2
  const obstacleConfigs: ObstacleConfig[] = [
    { type: 'box', x: -9.5, width: 1.5, height: 1.5 }, // 平台1: 3.0m高（基础平台）
    { type: 'box', x: -5, width: 1.5, height: 2.5 }, // 平台2: 5.0m高
    { type: 'box', x: 0, width: 1.5, height: 3.5 }, // 平台3: 7.0m高
    { type: 'box', x: 5, width: 1.5, height: 5.5 }, // 平台4: 11.0m高
    { type: 'box', x: 10, width: 1.5, height: 7.5 }, // 平台5: 15.0m高
    { type: 'box', x: 15, width: 1.5, height: 10.5 }, // 平台6: 21.0m高
  ]

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

function createPlayerAndWeapon(groundY: number) {
  playerEntity = createPlayer(
    world,
    box2d,
    worldId,
    -12,
    groundY - 0.6,
    groundY
  )

  // 在玩家右前方（向右7米）生成一把剑，方便看到
  // Spawn weapon higher to avoid clipping into obstacles (platform at x=-5 is 5m high, top at groundY-5.5)
  createWeapon(world, box2d, worldId, -5, groundY - 8.0, groundY, 'sword')

  // 在远处阶梯平台（x=15，高度21m）上生成一把小剑用于测试
  // 平台6：x=15, height=10.5 (全高21m), 顶部在 groundY - 21.0
  createWeapon(world, box2d, worldId, 15, groundY - 22.0, groundY, 'shortSword')

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

  enemyAISystem.setPlayer(playerEntity)
  soundSystem.setPlayer(playerEntity)
  targetingSystem.setPlayer(playerEntity)
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

    // Middle click or Q for lock toggle
    const lockToggleJustPressed =
      (currKeys.has('q') && !prevKeys.has('q')) ||
      (currMouseButtons.has(1) && !prevMouseButtons.has(1))

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

    if (currKeys.has('shift') && !isPlayerDead) {
      playerEntity.input.sprintRequested = !playerEntity.weapon?.bowFreeAim
    } else {
      playerEntity.input.sprintRequested = false
    }

    if (currKeys.has('e') && !prevKeys.has('e') && !isPlayerDead) {
      playerEntity.input.inputBuffer.bufferAction('interact')
    }

    if (currKeys.has('1') && !prevKeys.has('1') && !isPlayerDead) {
      weaponSystem.switchWeaponSlot(playerEntity, 'main')
    }

    if (currKeys.has('2') && !prevKeys.has('2') && !isPlayerDead) {
      weaponSystem.switchWeaponSlot(playerEntity, 'secondary')
    }

    let aimAdjust = 0
    if (
      currKeys.has('arrowup') ||
      currKeys.has('ArrowUp') ||
      currKeys.has('w')
    ) {
      aimAdjust -= 1
    }
    if (
      currKeys.has('arrowdown') ||
      currKeys.has('ArrowDown') ||
      currKeys.has('s')
    ) {
      aimAdjust += 1
    }
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

  // --- Vertical Logic ---
  const canvasHeightInMeters = canvasHeight / pixelsPerMeter
  let desiredCameraY = camera.y

  if (playerEntity && playerEntity.transform) {
    const playerY = playerEntity.transform.y
    const playerFeetY = playerY + DEFAULT_PLAYER_RADIUS
    const currentCameraY = camera.y

    // Screen-space position calculation (matching GameClient render transform)
    const playerScreenY =
      canvasHeight +
      ((playerFeetY - currentCameraY) * pixelsPerMeter - canvasHeight) * zoom

    const topLimit = 0.5 * canvasHeight
    const bottomLimit = initialPlayerScreenRatioY * canvasHeight
    const isOutsideVerticalZone =
      playerScreenY < topLimit || playerScreenY > bottomLimit

    if (DEBUG_DRAW_CAMERA) {
      debugCameraData.topLimitRatio = 0.5
      debugCameraData.bottomLimitRatio = initialPlayerScreenRatioY
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
      }
    }

    // Unlock Logic
    if (isVerticalCameraLocked) {
      if (playerEntity.physics) {
        const vel = box2d.b2Body_GetLinearVelocity(playerEntity.physics.bodyId)
        const verticalSpeed = Math.abs(vel.y)
        vel.delete()

        if (
          verticalSpeed < 0.2 &&
          !isVerticalTransitioning &&
          !isOutsideVerticalZone
        ) {
          isVerticalCameraLocked = false
          isVerticalTransitioning = false
          lastVerticalUnlockTime = currentTime
        }
      }
    }

    // Target Calculation
    if (isVerticalCameraLocked) {
      // Formula to find CameraY for a specific ScreenRatio:
      // camY = worldY - canvasHeightInMeters * ((ratio - 1) / zoom + 1)
      const targetY =
        playerFeetY -
        canvasHeightInMeters * ((initialPlayerScreenRatioY - 1) / zoom + 1)

      if (isVerticalTransitioning) {
        const elapsed = currentTime - verticalTransitionStartTime
        const progress = Math.min(elapsed / TRANSITION_DURATION, 1)

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

  // Vertical Interpolation (Slower)
  const diffY = desiredCameraY - camera.y
  if (Math.abs(diffY) > 0.001) {
    camera.y += diffY * 0.08
  } else {
    camera.y = desiredCameraY
  }

  // Emergency Clamp: Prevent player from falling out of screen (Scale-invariant)
  if (playerEntity && playerEntity.transform) {
    const playerFeetY = playerEntity.transform.y + DEFAULT_PLAYER_RADIUS
    const currentCameraY = camera.y
    const playerScreenY =
      canvasHeight +
      ((playerFeetY - currentCameraY) * pixelsPerMeter - canvasHeight) * zoom

    const bottomMarginRatio = 0.15
    const emergencyThreshold = (1 - bottomMarginRatio) * canvasHeight

    if (playerScreenY > emergencyThreshold) {
      // Force CameraY so that player stays at emergencyThreshold
      const ratio = 1 - bottomMarginRatio
      camera.y = playerFeetY - canvasHeightInMeters * ((ratio - 1) / zoom + 1)
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

  stateMessage.entitiesBuffer = stateBuffer.buffer
  stateMessage.entityCount = count
  stateMessage.effectsCount = effectsCount
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

  createGround()
  createObstacles()

  initializeSystems()
  createPlayerAndWeapon(groundTopY)

  enemyAISystem.setPlayer(playerEntity)
  soundSystem.setPlayer(playerEntity)
  targetingSystem.setPlayer(playerEntity)

  prevKeys.clear()
  currKeys.clear()
  prevMouseButtons.clear()
  currMouseButtons.clear()

  camera.x = 0
  camera.y = 0
  zoom = DEFAULT_CAMERA_ZOOM
  targetZoom = DEFAULT_CAMERA_ZOOM
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
  initialPlayerScreenRatioY = 0.95

  if (playerEntity && playerEntity.transform) {
    const centerX = canvasWidth / 2
    camera.x = playerEntity.transform.x - centerX / pixelsPerMeter

    // Vertical initialization
    const canvasHeightInMeters = canvasHeight / pixelsPerMeter
    camera.y = canvasHeightInMeters - canvasHeightInMeters

    const initialPlayerFeetY =
      playerEntity.transform.y + DEFAULT_PLAYER_RADIUS + 0.2
    const initialScreenY =
      canvasHeight +
      ((initialPlayerFeetY - camera.y) * pixelsPerMeter - canvasHeight) * zoom
    initialPlayerScreenRatioY = Math.max(
      0.6,
      Math.min(0.98, initialScreenY / canvasHeight)
    )

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
      if (msg.action === 'update_param') {
        updateParam(msg.paramId, msg.value)
      }
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
    if (groundShapeId) {
      const { b2Shape_SetFriction } = box2d
      b2Shape_SetFriction(groundShapeId, value)
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

  if (id === 'jumpBufferWindow') {
    if (playerEntity.input) {
      playerEntity.input.inputBuffer.setDefaultBufferWindow(value)
    }
  }
}
