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
import { StatsSystem } from '../ecs/systems/StatsSystem'
import { TargetingSystem } from '../ecs/systems/TargetingSystem'
import { WeaponSystem } from '../ecs/systems/WeaponSystem'
import type { MainModule, b2BodyId, b2ShapeId } from '../types'
import type { MainToWorkerMessage, RenderEntity, WorkerToMainMessage } from './protocol'

// Worker global scope
const ctx: Worker = self as any

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

let groundBodyId: b2BodyId
let groundShapeId: b2ShapeId
let obstacles: { bodyId: b2BodyId; shapeId: b2ShapeId; width: number; height: number }[] = []

let isPaused = false
let loopInterval: any
const TARGET_FPS = 60
const TIME_STEP = 1 / TARGET_FPS

// Game State needed for logic
let keys = new Set<string>()
let canvasHeight = 0
let pixelsPerMeter = 50
let groundFriction = DEFAULT_GROUND_FRICTION
let obstacleFriction = DEFAULT_OBSTACLE_FRICTION
let groundTopY = 0

// Parameter buffer for async init
const pendingParams: Record<string, number> = {}

// Camera tracking logic (moved from Main to here to send correct camera pos)
let camera = { x: 0, y: 0 }
let zoom = 1.0
let targetZoom = 1.0
let canvasWidth = 0

async function init(width: number, height: number, ppm: number) {
  canvasWidth = width
  canvasHeight = height
  pixelsPerMeter = ppm

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
  groundBodyId = createGround()
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
  clearInterval(loopInterval)
  loopInterval = setInterval(update, 1000 / TARGET_FPS)
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
  enemyAISystem = new EnemyAISystem(box2d, worldId)
  physicsSystem = new PhysicsSystem(box2d, worldId)
  movementSystem = new MovementSystem(box2d)
  weaponSystem = new WeaponSystem(box2d, statsSystem)
  enemyAISystem.setWeaponSystem(weaponSystem)
  targetingSystem = new TargetingSystem(box2d, worldId)

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

function createPlayerAndWeapon(groundY: number) {
    playerEntity = createPlayer(
      world,
      box2d,
      worldId,
      -12,
      groundY - 0.6,
      groundY
    )
    enemyEntity = createEnemy(
      world,
      box2d,
      worldId,
      -7,
      groundY - 0.6,
      groundY
    )
    createEnemy(
        world,
        box2d,
        worldId,
        8,
        groundY - 0.6,
        groundY
    )

    enemyAISystem.setPlayer(playerEntity)
    targetingSystem.setPlayer(playerEntity)
}

function handleInput(activeKeys: string[], mouseZoomTarget: number) {
    // Diff keys to detect press events if needed, but since we run on tick, checking existence is usually enough
    // EXCEPT for events that should trigger once like 'jump' or 'attack' start.
    // The main thread sends "current active keys".
    // Logic needs to know "just pressed".
    // Simple approach: Store previous keys.
    
    const currentKeys = new Set(activeKeys)
    
    // Check specific actions
    const isPlayerDead = playerEntity.stats?.isDead ?? false
    
    if (playerEntity.input) {
        let moveDirection = 0
        if (currentKeys.has('a') || currentKeys.has('arrowleft')) moveDirection -= 1
        if (currentKeys.has('d') || currentKeys.has('arrowright')) moveDirection += 1
        
        playerEntity.input.moveDirection = isPlayerDead ? 0 : moveDirection
        
        // Jump
        if (currentKeys.has(' ') && !keys.has(' ') && !isPlayerDead) {
             playerEntity.input.inputBuffer.bufferAction('jump')
             playerEntity.input.jumpRequested = true
        } else if (!currentKeys.has(' ')) {
             playerEntity.input.jumpRequested = false
        }
        
        // Attack
        if (currentKeys.has('j') && !keys.has('j') && !isPlayerDead) {
             weaponSystem.startAttack(playerEntity)
        }
        
        // Block
        if (currentKeys.has('k') && !isPlayerDead) {
            playerEntity.input.blockRequested = true
        } else {
            playerEntity.input.blockRequested = false
        }
        
        // Lock On
        if (currentKeys.has('h') && !keys.has('h') && !isPlayerDead) {
             const dir = playerEntity.input.moveDirection
             const isLocked = playerEntity.input.lockedTargetId !== null
             if (dir !== 0 && isLocked) {
                 playerEntity.input.lockSwitchIntent = dir
             } else {
                 playerEntity.input.lockToggleRequested = true
             }
        }
        
        // Roll
        if (currentKeys.has('l') && !keys.has('l') && !isPlayerDead) { // Using 'l' (lowercase L) for roll based on original code 'keypress'
             playerEntity.input.inputBuffer.bufferAction('roll')
        }
    }
    
    keys = currentKeys
    targetZoom = mouseZoomTarget
}

function update() {
    if (isPaused || !world) return

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

    sendState()
}

function updateCamera(playerX: number) {
    const centerX = canvasWidth / 2
    const playerScreenX =
      centerX +
      ((playerX - camera.x) * pixelsPerMeter - centerX) * zoom

    const deadZoneLeft = canvasWidth / 8
    const deadZoneRight = (7 * canvasWidth) / 8

    if (playerScreenX < deadZoneLeft) {
      const targetCameraX =
        playerX -
        ((deadZoneLeft - centerX) / zoom + centerX) / pixelsPerMeter
      camera.x = targetCameraX
    } else if (playerScreenX > deadZoneRight) {
      const targetCameraX =
        playerX -
        ((deadZoneRight - centerX) / zoom + centerX) / pixelsPerMeter
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
        world.destroyEntity(entity)
      }
    }
}

function sendState() {
    const entities = world.getEntities()
    const renderEntities: RenderEntity[] = entities.map(e => {
        return {
            id: e.id,
            transform: e.transform!, // Most entities have transform, if not, filter?
            render: e.render!,       // RenderSystem filters this anyway
            weapon: e.weapon ? {
                visual: e.weapon.visual,
                width: e.weapon.width,
                height: e.weapon.height,
                cornerRadius: e.weapon.cornerRadius,
                isEquipped: e.weapon.isEquipped
            } : undefined,
            stats: e.stats ? {
                health: e.stats.health,
                maxHealth: e.stats.maxHealth,
                maxToughness: e.stats.maxToughness,
                toughness: e.stats.toughness,
                isDead: e.stats.isDead,
                isVanished: e.stats.isVanished,
                deathElapsedSec: e.stats.deathElapsedSec,
                deathFlashDurationSec: e.stats.deathFlashDurationSec,
                deathFlattenDurationSec: e.stats.deathFlattenDurationSec,
                hitShakeDurationMs: e.stats.hitShakeDurationMs,
                hitShakeElapsedMs: e.stats.hitShakeElapsedMs,
                hitShakeIntensity: e.stats.hitShakeIntensity,
                hitShakeDirectionX: e.stats.hitShakeDirectionX
            } : undefined,
            input: e.input ? {
                lastMoveDirection: e.input.lastMoveDirection,
                lockedTargetId: e.input.lockedTargetId
            } : undefined,
            movement: e.movement ? {
                isRolling: e.movement.isRolling,
                rollAngle: e.movement.rollAngle
            } : undefined
        }
    }).filter(e => e.transform && e.render) // Only send what can be rendered

    const msg: WorkerToMainMessage = {
        type: 'state',
        entities: renderEntities,
        camera: { x: camera.x, y: camera.y }
    }
    
    ctx.postMessage(msg)
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
}

// Message Handler
ctx.onmessage = (e: MessageEvent<MainToWorkerMessage>) => {
    const msg = e.data
    switch (msg.type) {
        case 'init':
            init(msg.canvasWidth, msg.canvasHeight, msg.pixelsPerMeter)
            break
        case 'input':
            if (world && playerEntity) {
                handleInput(msg.keys, msg.mouseZoom)
            }
            break
        case 'control':
            if (msg.action === 'stop') isPaused = true
            if (msg.action === 'start') isPaused = false
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
        switch(id) {
            case 'jumpForce': playerEntity.movement.jumpForce = value; break;
            case 'maxJumpDuration': playerEntity.movement.maxJumpDuration = value; break;
            case 'jumpForceMultiplier': playerEntity.movement.jumpForceMultiplier = value; break;
            case 'wallJumpPushAway': playerEntity.movement.wallJumpPushAwayMultiplier = value; break;
            case 'wallJumpUpward': playerEntity.movement.wallJumpUpwardMultiplier = value; break;
            case 'maxWallJumps': playerEntity.movement.maxWallJumps = Math.floor(value); break;
            case 'moveSpeed': playerEntity.movement.moveSpeed = value; break;
            case 'baseWeight': playerEntity.movement.baseWeight = Math.max(1, value); break;
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
        obstacles.forEach(obs => {
             b2Shape_SetFriction(obs.shapeId, value)
        })
    }
    
    if (id === 'jumpBufferWindow') {
        if (playerEntity.input) {
            playerEntity.input.inputBuffer.setDefaultBufferWindow(value)
        }
    }
}
