import Box2DFactory from 'box2d3-wasm'

import {
  CATEGORY_GROUND,
  CATEGORY_OBSTACLE,
  DEFAULT_GRAVITY,
  DEFAULT_GROUND_FRICTION,
  DEFAULT_OBSTACLE_FRICTION,
} from '../constants'
import { componentRegistry } from '../ecs/ComponentRegistry'
import type { Entity } from '../ecs/Entity'
import { SpatialHash } from '../ecs/SpatialHash'
import { World } from '../ecs/World'
import { createEnemy, createPlayer } from '../ecs/factories/PlayerFactory'
import { EnemyAISystem } from '../ecs/systems/EnemyAISystem'
import { MovementSystem } from '../ecs/systems/MovementSystem'
import { PhysicsSystem } from '../ecs/systems/PhysicsSystem'
import { type EffectsEmitter, StatsSystem } from '../ecs/systems/StatsSystem'
import { TargetingSystem } from '../ecs/systems/TargetingSystem'
import { WeaponSystem } from '../ecs/systems/WeaponSystem'
import type { MainModule, b2BodyId, b2ShapeId } from '../types'
import { ENTITY_STRIDE, FLAGS, MAX_ENTITIES, OFFSETS } from './binaryProtocol'
import {
  EFFECTS_BASE_OFFSET,
  EFFECT_OFFSETS,
  EFFECT_STRIDE,
  EFFECT_TYPES,
  MAX_EFFECTS,
  STATE_BUFFER_FLOATS,
} from './effectsProtocol'
import type { MainToWorkerMessage, WorkerToMainMessage } from './protocol'

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
let enemyAISystem: EnemyAISystem
let targetingSystem: TargetingSystem

let groundShapeId: b2ShapeId
let obstacles: {
  bodyId: b2BodyId
  shapeId: b2ShapeId
  width: number
  height: number
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
let zoom = 1.0
let targetZoom = 1.0
let canvasWidth = 0

// Reusable message object for sendState
const stateMessage: WorkerToMainMessage = {
  type: 'state',
  entitiesBuffer: null as unknown as ArrayBuffer | SharedArrayBuffer,
  entityCount: 0,
  effectsCount: 0,
  camera: { x: 0, y: 0 },
}

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

  // Apply pending parameters
  Object.entries(pendingParams).forEach(([id, value]) => {
    updateParam(id, value)
  })

  // Start Loop
  lastTime = performance.now()
  accumulator = 0
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
  componentRegistry.registerComponent('Faction')
  componentRegistry.registerComponent('EnemyAI')
}

function initializeSystems() {
  statsSystem = new StatsSystem(box2d, worldId)
  statsSystem.setEffectsEmitter(effectsEmitter)
  statsSystem.setBloodEffectsEnabled(false)
  enemyAISystem = new EnemyAISystem(box2d, worldId)
  physicsSystem = new PhysicsSystem(box2d, worldId)
  movementSystem = new MovementSystem(box2d)
  weaponSystem = new WeaponSystem(box2d, statsSystem)
  enemyAISystem.setWeaponSystem(weaponSystem)
  targetingSystem = new TargetingSystem(box2d, worldId)

  const entityLookup = world.getEntityById.bind(world)
  movementSystem.setEntityLookup(entityLookup)
  targetingSystem.setEntityLookup(entityLookup)

  world.addSystem(statsSystem)
  world.addSystem(enemyAISystem)
  world.addSystem(movementSystem)
  world.addSystem(physicsSystem)
  world.addSystem(weaponSystem)
  world.addSystem(targetingSystem)

  weaponSystem.setObstacles(obstacles)
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

function createObstacles() {
  const {
    b2DefaultBodyDef,
    b2CreateBody,
    b2MakeBox,
    b2DefaultShapeDef,
    b2CreatePolygonShape,
  } = box2d

  const canvasHeightInMeters = canvasHeight / pixelsPerMeter
  const groundY = canvasHeightInMeters - 0.5
  obstacles = []

  const obstacleConfigs = [
    { x: -9.5, width: 1.2, height: 2.8 },
    { x: 9.5, width: 1.2, height: 2.8 },
  ]

  obstacleConfigs.forEach((obs) => {
    const bodyDef = b2DefaultBodyDef()
    bodyDef.position.Set(obs.x, groundY - obs.height)
    const bodyId = b2CreateBody(worldId, bodyDef)

    const box = b2MakeBox(obs.width, obs.height)
    const shapeDef = b2DefaultShapeDef()
    shapeDef.material.friction = obstacleFriction
    shapeDef.material.restitution = 0
    shapeDef.filter.categoryBits = CATEGORY_OBSTACLE
    const shapeId = b2CreatePolygonShape(bodyId, shapeDef, box)

    obstacles.push({
      bodyId,
      shapeId,
      width: obs.width,
      height: obs.height,
    })

    bodyDef.delete()
    box.delete()
    shapeDef.delete()
  })

  // Update weapon system obstacles
  if (weaponSystem) {
    weaponSystem.setObstacles(obstacles)
  }
}

const DEFALT_DEBUG_ENEMY_NUM = 1

function createPlayerAndWeapon(groundY: number) {
  playerEntity = createPlayer(
    world,
    box2d,
    worldId,
    -12,
    groundY - 0.6,
    groundY
  )

  // Initialize 10 enemies
  for (let i = 0; i < DEFALT_DEBUG_ENEMY_NUM; i++) {
    const x = -8 + i * 2 // Distribute enemies from x = -8 to x = 10
    const enemy = createEnemy(world, box2d, worldId, x, groundY - 0.6, groundY)
    if (i === 0) {
      enemyEntity = enemy
    }
  }

  enemyAISystem.setPlayer(playerEntity)
  targetingSystem.setPlayer(playerEntity)
}

function handleInput(
  activeKeys: string[],
  activeMouseButtons: number[],
  mouseZoomTarget: number
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

    playerEntity.input.moveDirection = isPlayerDead ? 0 : moveDirection

    if (currKeys.has(' ') && !prevKeys.has(' ') && !isPlayerDead) {
      playerEntity.input.inputBuffer.bufferAction('jump')
      playerEntity.input.jumpRequested = true
    } else if (!currKeys.has(' ')) {
      playerEntity.input.jumpRequested = false
    }

    // Left click or J for attack
    const attackJustPressed =
      (currKeys.has('j') && !prevKeys.has('j')) ||
      (currMouseButtons.has(0) && !prevMouseButtons.has(0))

    if (attackJustPressed && !isPlayerDead) {
      weaponSystem.startAttack(playerEntity)
    }

    // Right click or K for block
    const blockPressed = currKeys.has('k') || currMouseButtons.has(2)
    if (blockPressed && !isPlayerDead) {
      playerEntity.input.blockRequested = true
    } else {
      playerEntity.input.blockRequested = false
    }

    // Middle click or H for lock toggle
    const lockToggleJustPressed =
      (currKeys.has('h') && !prevKeys.has('h')) ||
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

    if (currKeys.has('shift') && !prevKeys.has('shift') && !isPlayerDead) {
      playerEntity.input.inputBuffer.bufferAction('roll')
    }

    if (currKeys.has('shift') && !isPlayerDead) {
      playerEntity.input.sprintRequested = true
    } else {
      playerEntity.input.sprintRequested = false
    }
  }

  targetZoom = mouseZoomTarget
}

function fixedUpdate() {
  // Update Zoom logic (smooth transition)
  const zoomDiff = targetZoom - zoom
  if (Math.abs(zoomDiff) > 0.001) {
    zoom += zoomDiff * 0.15
  } else {
    zoom = targetZoom
  }

  weaponSystem.tryPickUpWeapon(playerEntity)

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

function updateCamera(playerX: number) {
  const centerX = canvasWidth / 2
  const playerScreenX =
    centerX + ((playerX - camera.x) * pixelsPerMeter - centerX) * zoom

  const deadZoneLeft = canvasWidth / 8
  const deadZoneRight = (7 * canvasWidth) / 8

  if (playerScreenX < deadZoneLeft) {
    const targetCameraX =
      playerX - ((deadZoneLeft - centerX) / zoom + centerX) / pixelsPerMeter
    camera.x = targetCameraX
  } else if (playerScreenX > deadZoneRight) {
    const targetCameraX =
      playerX - ((deadZoneRight - centerX) / zoom + centerX) / pixelsPerMeter
    camera.x = targetCameraX
  }

  const canvasHeightInMeters = canvasHeight / pixelsPerMeter
  camera.y = canvasHeightInMeters - canvasHeightInMeters
}

function cleanupDestroyedEntities() {
  const entities = world.getEntities()
  for (const entity of entities) {
    const isPlayer = entity.id === playerEntity.id
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

function sendState() {
  if (!sharedStateBuffer && stateBufferViews.length === 0) {
    return
  }

  const entities = world.getEntities()
  let count = 0

  for (const e of entities) {
    if (count >= MAX_ENTITIES) break
    if (!e.transform || !e.render) continue

    const offset = count * ENTITY_STRIDE

    stateBuffer[offset + OFFSETS.ID] = e.id
    stateBuffer[offset + OFFSETS.X] = e.transform.x
    stateBuffer[offset + OFFSETS.Y] = e.transform.y
    stateBuffer[offset + OFFSETS.RADIUS] = e.render.radius
    stateBuffer[offset + OFFSETS.COLOR] = parseColor(e.render.color)
    stateBuffer[offset + OFFSETS.BORDER_COLOR] = parseColor(
      e.render.borderColor
    )

    let flags = 0
    if (e.render.visible) flags |= FLAGS.VISIBLE
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

    stateBuffer[offset + OFFSETS.FLAGS] = flags

    stateBuffer[offset + OFFSETS.MOVE_DIR] = e.input
      ? e.input.lastMoveDirection
      : 1
    stateBuffer[offset + OFFSETS.ROLL_ANGLE] = e.movement
      ? e.movement.rollAngle
      : 0
    stateBuffer[offset + OFFSETS.LOCKED_TARGET_ID] =
      e.input?.lockedTargetId ?? -1

    if (e.stats) {
      stateBuffer[offset + OFFSETS.STATS_HEALTH_MAX] = e.stats.maxHealth
      stateBuffer[offset + OFFSETS.STATS_HEALTH] = e.stats.health
      stateBuffer[offset + OFFSETS.STATS_TOUGHNESS_MAX] = e.stats.maxToughness
      stateBuffer[offset + OFFSETS.STATS_TOUGHNESS] = e.stats.toughness
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

    if (e.weapon) {
      stateBuffer[offset + OFFSETS.WEAPON_ACTIVE] = 1
      stateBuffer[offset + OFFSETS.WEAPON_X] = e.weapon.visual.x
      stateBuffer[offset + OFFSETS.WEAPON_Y] = e.weapon.visual.y
      stateBuffer[offset + OFFSETS.WEAPON_ROT] = e.weapon.visual.rotation
      stateBuffer[offset + OFFSETS.WEAPON_W] = e.weapon.width
      stateBuffer[offset + OFFSETS.WEAPON_H] = e.weapon.height
      stateBuffer[offset + OFFSETS.WEAPON_R] = e.weapon.cornerRadius
    } else {
      stateBuffer[offset + OFFSETS.WEAPON_ACTIVE] = 0
    }

    count++
  }

  stateMessage.entitiesBuffer = stateBuffer.buffer
  stateMessage.entityCount = count
  stateMessage.effectsCount = effectsCount
  stateMessage.camera.x = camera.x
  stateMessage.camera.y = camera.y
  if (sharedStateBuffer) {
    ctx.postMessage(stateMessage)
    effectsCount = 0
    return
  }

  const buffer = stateBuffer.buffer as ArrayBuffer
  ctx.postMessage(stateMessage, [buffer])
  effectsCount = 0

  const nextView = stateBufferViews.pop()
  if (nextView) {
    stateBuffer = nextView
  }
}

function restart() {
  if (!world) return
  const groundHeight = 0.5
  const groundY = canvasHeight / pixelsPerMeter - groundHeight
  groundTopY = groundY - groundHeight

  world.clear()
  initializeSystems()
  createPlayerAndWeapon(groundTopY)
  enemyAISystem.setPlayer(playerEntity)
  targetingSystem.setPlayer(playerEntity)

  isPaused = false
  lastTime = performance.now()
  accumulator = 0
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
        handleInput(msg.keys, msg.mouseButtons, msg.mouseZoom)
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
      b2Shape_SetFriction(obs.shapeId, value)
    })
  }

  if (id === 'jumpBufferWindow') {
    if (playerEntity.input) {
      playerEntity.input.inputBuffer.setDefaultBufferWindow(value)
    }
  }
}
