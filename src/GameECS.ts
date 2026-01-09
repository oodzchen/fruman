import {
  CATEGORY_GROUND,
  CATEGORY_OBSTACLE,
  DEFAULT_CAMERA_ZOOM,
  DEFAULT_GRAVITY,
  DEFAULT_GROUND_FRICTION,
  DEFAULT_OBSTACLE_FRICTION,
} from './constants'
import type { WeaponComponent } from './ecs/Component'
import { componentRegistry } from './ecs/ComponentRegistry'
import type { Entity } from './ecs/Entity'
import { SpatialHash } from './ecs/SpatialHash'
import { World } from './ecs/World'
import { createEnemy, createPlayer } from './ecs/factories/PlayerFactory'
import { EnemyAISystem } from './ecs/systems/EnemyAISystem'
import { MovementSystem } from './ecs/systems/MovementSystem'
import { PhysicsSystem } from './ecs/systems/PhysicsSystem'
import { RenderSystem } from './ecs/systems/RenderSystem'
import { StatsSystem } from './ecs/systems/StatsSystem'
import { TargetingSystem } from './ecs/systems/TargetingSystem'
import { WeaponSystem } from './ecs/systems/WeaponSystem'
import type { MainModule, b2BodyId, b2ShapeId } from './types'

type ObstacleRenderData = {
  bodyId: b2BodyId
  shapeId: b2ShapeId
  width: number
  height: number
}

export class GameECS {
  private box2d: MainModule
  private worldId: ReturnType<MainModule['b2CreateWorld']>
  private world: World
  private playerEntity!: Entity
  private enemyEntity: Entity | null = null
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private camera: { x: number; y: number }
  private pixelsPerMeter = 50
  private keys = new Set<string>()
  private zoom = DEFAULT_CAMERA_ZOOM
  private targetZoom = DEFAULT_CAMERA_ZOOM
  private spaceKeyPressed = false
  private jumpRequested = false
  private isPaused = false
  private groundFriction = DEFAULT_GROUND_FRICTION
  private obstacleFriction = DEFAULT_OBSTACLE_FRICTION
  private backgroundPattern: CanvasPattern | null = null
  private groundPattern: CanvasPattern | null = null
  private obstaclePattern: CanvasPattern | null = null
  private groundTopY = 0
  private attackKeyPressed = false
  private groundBodyId: b2BodyId
  private groundShapeId!: b2ShapeId
  private obstacles: ObstacleRenderData[] = []

  private physicsSystem!: PhysicsSystem
  private movementSystem!: MovementSystem
  private statsSystem!: StatsSystem
  private weaponSystem!: WeaponSystem
  private renderSystem!: RenderSystem
  private enemyAISystem!: EnemyAISystem
  private targetingSystem!: TargetingSystem

  private fps = 0
  private frameCount = 0
  private fpsUpdateTime = 0

  private spatialHash: SpatialHash

  constructor(
    box2d: MainModule,
    canvas: HTMLCanvasElement,
    ctx: CanvasRenderingContext2D
  ) {
    this.box2d = box2d
    this.canvas = canvas
    this.ctx = ctx

    const { b2DefaultWorldDef, b2CreateWorld, b2Vec2 } = this.box2d

    const worldDef = b2DefaultWorldDef()
    worldDef.gravity = new b2Vec2(0, DEFAULT_GRAVITY)
    this.worldId = b2CreateWorld(worldDef)
    worldDef.delete()

    this.camera = { x: 0, y: 0 }
    this.world = new World()
    this.spatialHash = new SpatialHash(5)

    this.registerComponents()

    this.groundBodyId = this.createGround()
    this.createObstacles()
    this.backgroundPattern = this.createBackgroundPattern()
    this.groundPattern = this.createGroundPattern()
    this.obstaclePattern = this.createObstaclePattern()

    const groundHeight = 0.5
    const groundY = this.canvas.height / this.pixelsPerMeter - groundHeight
    const groundTopY = groundY - groundHeight
    this.groundTopY = groundTopY

    this.initializeSystems()
    this.createPlayerAndWeapon(groundTopY)
    this.setupInput()
  }

  private registerComponents(): void {
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

  private initializeSystems(): void {
    this.statsSystem = new StatsSystem(this.box2d, this.worldId)
    this.enemyAISystem = new EnemyAISystem(this.box2d, this.worldId)
    this.physicsSystem = new PhysicsSystem(this.box2d, this.worldId)
    this.movementSystem = new MovementSystem(this.box2d)
    this.weaponSystem = new WeaponSystem(this.box2d, this.statsSystem)
    this.enemyAISystem.setWeaponSystem(this.weaponSystem)
    this.targetingSystem = new TargetingSystem(this.box2d, this.worldId)
    this.renderSystem = new RenderSystem(
      this.ctx,
      this.pixelsPerMeter,
      this.camera
    )

    this.world.addSystem(this.statsSystem)
    this.world.addSystem(this.enemyAISystem)
    this.world.addSystem(this.movementSystem)
    this.world.addSystem(this.physicsSystem)
    this.world.addSystem(this.weaponSystem)
    this.world.addSystem(this.targetingSystem)
    this.weaponSystem.setObstacles(this.obstacles)
  }

  private createPlayerAndWeapon(groundTopY: number): void {
    this.playerEntity = createPlayer(
      this.world,
      this.box2d,
      this.worldId,
      -12, // 玩家在左侧障碍物左边
      groundTopY - 0.6,
      groundTopY
    )
    this.enemyEntity = createEnemy(
      this.world,
      this.box2d,
      this.worldId,
      -7, // 敌人在左侧障碍物右边 (障碍物在 -9.5)
      groundTopY - 0.6,
      groundTopY
    )
    // 添加第二个敌人用于测试锁定切换
    createEnemy(
      this.world,
      this.box2d,
      this.worldId,
      8,
      groundTopY - 0.6,
      groundTopY
    )

    this.enemyAISystem.setPlayer(this.playerEntity)
    this.targetingSystem.setPlayer(this.playerEntity)
    this.renderSystem.setPlayer(this.playerEntity)
  }

  private createGround(): b2BodyId {
    const {
      b2DefaultBodyDef,
      b2CreateBody,
      b2MakeBox,
      b2DefaultShapeDef,
      b2CreatePolygonShape,
    } = this.box2d

    const groundHeight = 0.5
    const canvasHeightInMeters = this.canvas.height / this.pixelsPerMeter
    const groundY = canvasHeightInMeters - groundHeight

    const groundDef = b2DefaultBodyDef()
    groundDef.position.Set(0, groundY)
    const groundBodyId = b2CreateBody(this.worldId, groundDef)

    const groundBox = b2MakeBox(50, groundHeight)
    const shapeDef = b2DefaultShapeDef()
    shapeDef.material.friction = this.groundFriction
    shapeDef.material.restitution = 0
    shapeDef.filter.categoryBits = CATEGORY_GROUND
    this.groundShapeId = b2CreatePolygonShape(groundBodyId, shapeDef, groundBox)

    groundDef.delete()
    groundBox.delete()
    shapeDef.delete()

    return groundBodyId
  }

  private createObstacles(): void {
    const {
      b2DefaultBodyDef,
      b2CreateBody,
      b2MakeBox,
      b2DefaultShapeDef,
      b2CreatePolygonShape,
    } = this.box2d

    const canvasHeightInMeters = this.canvas.height / this.pixelsPerMeter
    const groundY = canvasHeightInMeters - 0.5

    const obstacleConfigs = [
      { x: -9.5, width: 1.2, height: 2.8 },
      { x: 9.5, width: 1.2, height: 2.8 },
    ]

    obstacleConfigs.forEach((obs) => {
      const bodyDef = b2DefaultBodyDef()
      bodyDef.position.Set(obs.x, groundY - obs.height)
      const bodyId = b2CreateBody(this.worldId, bodyDef)

      const box = b2MakeBox(obs.width, obs.height)
      const shapeDef = b2DefaultShapeDef()
      shapeDef.material.friction = this.obstacleFriction
      shapeDef.material.restitution = 0
      shapeDef.filter.categoryBits = CATEGORY_OBSTACLE
      const shapeId = b2CreatePolygonShape(bodyId, shapeDef, box)

      this.obstacles.push({
        bodyId,
        shapeId,
        width: obs.width,
        height: obs.height,
      })

      bodyDef.delete()
      box.delete()
      shapeDef.delete()
    })
  }

  private setupInput(): void {
    window.addEventListener('keydown', (e) => {
      this.keys.add(e.key.toLowerCase())
      const isPlayerDead = this.playerEntity.stats?.isDead

      if (e.key === ' ' && !this.spaceKeyPressed && !isPlayerDead) {
        this.spaceKeyPressed = true
        this.jumpRequested = true
      }

      if (
        e.key.toLowerCase() === 'j' &&
        !this.attackKeyPressed &&
        !isPlayerDead
      ) {
        this.attackKeyPressed = true
        this.weaponSystem.startAttack(this.playerEntity)
      }

      if (e.key.toLowerCase() === 'k' && !isPlayerDead) {
        if (this.playerEntity.input) {
          this.playerEntity.input.blockRequested = true
        }
      }

      if (e.key.toLowerCase() === 'h' && !isPlayerDead) {
        if (this.playerEntity.input) {
          const dir = this.playerEntity.input.moveDirection
          const isLocked = this.playerEntity.input.lockedTargetId !== null

          if (dir !== 0 && isLocked) {
            this.playerEntity.input.lockSwitchIntent = dir
          } else {
            this.playerEntity.input.lockToggleRequested = true
          }
        }
      }

      if (e.key.toLowerCase() === 'i') {
        this.targetZoom = Math.max(0.1, this.targetZoom + 0.2)
      } else if (e.key.toLowerCase() === 'o') {
        this.targetZoom = Math.max(0.1, this.targetZoom - 0.2)
      } else if (e.key.toLowerCase() === 'u') {
        this.targetZoom = 1.0
      }
    })

    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.key.toLowerCase())

      if (e.key === ' ') {
        this.spaceKeyPressed = false
        if (this.playerEntity.input) {
          this.playerEntity.input.jumpRequested = false
        }
      }

      if (e.key.toLowerCase() === 'j') {
        this.attackKeyPressed = false
      }

      if (e.key.toLowerCase() === 'k') {
        if (this.playerEntity.input) {
          this.playerEntity.input.blockRequested = false
        }
      }
    })

    window.addEventListener('keypress', (e) => {
      const isPlayerDead = this.playerEntity.stats?.isDead
      if (e.key.toLowerCase() === 'l' && !isPlayerDead) {
        if (this.playerEntity.input) {
          this.playerEntity.input.inputBuffer.bufferAction('roll')
        }
      }
    })

    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault()
      const zoomDelta = e.deltaY > 0 ? -0.1 : 0.1
      this.targetZoom = Math.max(
        0.1,
        Math.min(2.0, this.targetZoom + zoomDelta)
      )
    })
  }

  update(deltaTime: number): void {
    if (this.isPaused) return

    this.frameCount++
    this.fpsUpdateTime += deltaTime
    if (this.fpsUpdateTime >= 1.0) {
      this.fps = Math.round(this.frameCount / this.fpsUpdateTime)
      this.frameCount = 0
      this.fpsUpdateTime = 0
    }

    this.weaponSystem.tryPickUpWeapon(this.playerEntity)

    let moveDirection = 0
    if (this.keys.has('a') || this.keys.has('arrowleft')) moveDirection -= 1
    if (this.keys.has('d') || this.keys.has('arrowright')) moveDirection += 1
    const isPlayerDead = this.playerEntity.stats?.isDead ?? false

    if (this.playerEntity.input) {
      this.playerEntity.input.moveDirection = isPlayerDead ? 0 : moveDirection
      if (this.jumpRequested && !isPlayerDead) {
        this.playerEntity.input.inputBuffer.bufferAction('jump')
        this.playerEntity.input.jumpRequested = true
        this.jumpRequested = false
      } else if (isPlayerDead) {
        this.playerEntity.input.jumpRequested = false
        this.jumpRequested = false
      }
    }

    const entities = this.world.getEntities()

    this.spatialHash.update(entities)

    this.weaponSystem.setEntities(entities)
    this.weaponSystem.setSpatialHash(this.spatialHash)
    this.movementSystem.setEntities(entities)
    this.movementSystem.setSpatialHash(this.spatialHash)
    // TargetingSystem doesn't need setEntities as it receives them in update
    this.world.update(deltaTime)
    this.cleanupDestroyedEntities()

    if (this.playerEntity.transform) {
      this.updateCamera(this.playerEntity.transform.x)
    }

    const zoomDiff = this.targetZoom - this.zoom
    if (Math.abs(zoomDiff) > 0.001) {
      this.zoom += zoomDiff * 0.15
    } else {
      this.zoom = this.targetZoom
    }
  }

  private updateCamera(playerX: number): void {
    const centerX = this.canvas.width / 2
    const playerScreenX =
      centerX +
      ((playerX - this.camera.x) * this.pixelsPerMeter - centerX) * this.zoom

    const deadZoneLeft = this.canvas.width / 8
    const deadZoneRight = (7 * this.canvas.width) / 8

    if (playerScreenX < deadZoneLeft) {
      const targetCameraX =
        playerX -
        ((deadZoneLeft - centerX) / this.zoom + centerX) / this.pixelsPerMeter
      this.camera.x = targetCameraX
    } else if (playerScreenX > deadZoneRight) {
      const targetCameraX =
        playerX -
        ((deadZoneRight - centerX) / this.zoom + centerX) / this.pixelsPerMeter
      this.camera.x = targetCameraX
    }

    const canvasHeightInMeters = this.canvas.height / this.pixelsPerMeter
    this.camera.y = canvasHeightInMeters - canvasHeightInMeters
  }

  render(): void {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
    this.drawBackground()

    this.ctx.save()

    const centerX = this.canvas.width / 2
    const bottomY = this.canvas.height

    this.ctx.translate(centerX, bottomY)
    this.ctx.scale(this.zoom, this.zoom)
    this.ctx.translate(-centerX, -bottomY)

    this.ctx.translate(
      -this.camera.x * this.pixelsPerMeter,
      -this.camera.y * this.pixelsPerMeter
    )

    this.drawGround()
    this.drawObstacles()
    const entities = this.world.getEntities()
    for (const entity of entities) {
      const facing =
        entity.input && entity.input.lastMoveDirection !== 0
          ? entity.input.lastMoveDirection
          : 1

      if (facing < 0 && entity.weapon) {
        this.renderSystem.renderWeapon(entity)
      }

      if (entity.transform && entity.render) {
        this.renderSystem.renderEntity(entity)
      }

      if (facing >= 0 && entity.weapon) {
        this.renderSystem.renderWeapon(entity)
      }
    }

    this.renderSystem.renderLockOn(entities)

    this.ctx.restore()

    this.ctx.save()
    this.ctx.font = '20px monospace'
    this.ctx.fillStyle = '#00ff00'
    this.ctx.strokeStyle = '#000000'
    this.ctx.lineWidth = 3
    const fpsText = `${this.fps} FPS`
    this.ctx.strokeText(fpsText, 10, 30)
    this.ctx.fillText(fpsText, 10, 30)
    this.ctx.restore()
  }

  private cleanupDestroyedEntities(): void {
    const entities = this.world.getEntities()
    for (const entity of entities) {
      const isPlayer = entity.id === this.playerEntity.id
      if (entity.stats?.isDead && entity.weapon) {
        entity.weapon.hitEntityIds.clear()
        entity.removeComponent('Weapon')
      }
      if (entity.stats?.isVanished && !isPlayer) {
        if (this.enemyEntity && this.enemyEntity.id === entity.id) {
          this.enemyEntity = null
        }
        this.world.destroyEntity(entity)
      }
    }
  }

  private drawBackground(): void {
    if (!this.backgroundPattern) {
      return
    }
    this.ctx.save()
    this.ctx.fillStyle = this.backgroundPattern
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height)
    this.ctx.restore()
  }

  private drawGround(): void {
    const { b2Body_GetPosition } = this.box2d
    const pos = b2Body_GetPosition(this.groundBodyId)
    const groundHeight = 0.5

    const topY = (pos.y - groundHeight) * this.pixelsPerMeter
    const height = groundHeight * 2 * this.pixelsPerMeter

    this.ctx.fillStyle = this.groundPattern ?? '#654321'
    this.ctx.fillRect(
      (pos.x - 50) * this.pixelsPerMeter,
      topY,
      100 * this.pixelsPerMeter,
      height
    )
  }

  private drawObstacles(): void {
    const { b2Body_GetPosition } = this.box2d

    this.obstacles.forEach((obstacle) => {
      const pos = b2Body_GetPosition(obstacle.bodyId)

      this.ctx.fillStyle = this.obstaclePattern ?? '#d2691e'
      this.ctx.fillRect(
        (pos.x - obstacle.width) * this.pixelsPerMeter,
        (pos.y - obstacle.height) * this.pixelsPerMeter,
        obstacle.width * 2 * this.pixelsPerMeter,
        obstacle.height * 2 * this.pixelsPerMeter
      )

      this.ctx.strokeStyle = '#000'
      this.ctx.lineWidth = 2
      this.ctx.strokeRect(
        (pos.x - obstacle.width) * this.pixelsPerMeter,
        (pos.y - obstacle.height) * this.pixelsPerMeter,
        obstacle.width * 2 * this.pixelsPerMeter,
        obstacle.height * 2 * this.pixelsPerMeter
      )
    })
  }

  private createBackgroundPattern(): CanvasPattern | null {
    const patternSize = 80
    const patternCanvas = document.createElement('canvas')
    patternCanvas.width = patternSize
    patternCanvas.height = patternSize
    const patternCtx = patternCanvas.getContext('2d')

    if (!patternCtx) {
      return null
    }

    patternCtx.fillStyle = '#0b0c0e'
    patternCtx.fillRect(0, 0, patternSize, patternSize)

    patternCtx.strokeStyle = '#394155'
    patternCtx.lineWidth = 1

    const drawTriangle = (
      x1: number,
      y1: number,
      x2: number,
      y2: number,
      x3: number,
      y3: number
    ) => {
      patternCtx.beginPath()
      patternCtx.moveTo(x1, y1)
      patternCtx.lineTo(x2, y2)
      patternCtx.lineTo(x3, y3)
      patternCtx.closePath()
      patternCtx.stroke()
    }

    const halfSize = patternSize / 2
    const height = (Math.sqrt(3) / 2) * halfSize

    drawTriangle(0, height, halfSize, 0, halfSize, height)
    drawTriangle(halfSize, 0, patternSize, height, halfSize, height)

    drawTriangle(0, height, halfSize, height * 2, halfSize, height)
    drawTriangle(halfSize, height * 2, patternSize, height, halfSize, height)

    patternCtx.beginPath()
    patternCtx.moveTo(0, height)
    patternCtx.lineTo(patternSize, height)
    patternCtx.stroke()

    return this.ctx.createPattern(patternCanvas, 'repeat')
  }

  private createGroundPattern(): CanvasPattern | null {
    const size = 96
    const patternCanvas = document.createElement('canvas')
    patternCanvas.width = size
    patternCanvas.height = size
    const patternCtx = patternCanvas.getContext('2d')

    if (!patternCtx) {
      return null
    }

    patternCtx.fillStyle = '#826343'
    patternCtx.fillRect(0, 0, size, size)

    patternCtx.strokeStyle = '#a29f4f'
    patternCtx.lineWidth = 1

    const mid = size / 2
    patternCtx.beginPath()
    patternCtx.moveTo(0, mid)
    patternCtx.lineTo(mid, 0)
    patternCtx.lineTo(size, mid)
    patternCtx.lineTo(mid, size)
    patternCtx.closePath()
    patternCtx.stroke()

    patternCtx.beginPath()
    patternCtx.moveTo(mid / 2, mid)
    patternCtx.lineTo(mid, mid / 2)
    patternCtx.lineTo((mid * 3) / 2, mid)
    patternCtx.lineTo(mid, (mid * 3) / 2)
    patternCtx.closePath()
    patternCtx.stroke()

    return this.ctx.createPattern(patternCanvas, 'repeat')
  }

  private createObstaclePattern(): CanvasPattern | null {
    const size = 88
    const patternCanvas = document.createElement('canvas')
    patternCanvas.width = size
    patternCanvas.height = size
    const patternCtx = patternCanvas.getContext('2d')

    if (!patternCtx) {
      return null
    }

    patternCtx.fillStyle = '#70400e'
    patternCtx.fillRect(0, 0, size, size)

    patternCtx.strokeStyle = '#d7a168'
    patternCtx.lineWidth = 1

    const radius = size / 4
    const rowHeight = Math.sqrt(3) * radius

    const drawHex = (cx: number, cy: number) => {
      patternCtx.beginPath()
      for (let i = 0; i < 6; i += 1) {
        const angle = (Math.PI / 3) * i + Math.PI / 6
        const x = cx + radius * Math.cos(angle)
        const y = cy + radius * Math.sin(angle)
        if (i === 0) {
          patternCtx.moveTo(x, y)
        } else {
          patternCtx.lineTo(x, y)
        }
      }
      patternCtx.closePath()
      patternCtx.stroke()
    }

    for (let row = -1; row <= 2; row += 1) {
      const y = row * rowHeight + rowHeight
      for (let col = -1; col <= 2; col += 1) {
        const xOffset = row % 2 === 0 ? 0 : radius
        const x = col * radius * 2 + radius + xOffset
        drawHex(x, y)
      }
    }

    return this.ctx.createPattern(patternCanvas, 'repeat')
  }

  stop(): void {
    this.isPaused = true
  }

  start(): void {
    this.isPaused = false
  }

  restart(): void {
    const groundHeight = 0.5
    const groundY = this.canvas.height / this.pixelsPerMeter - groundHeight
    const groundTopY = groundY - groundHeight
    this.groundTopY = groundTopY

    this.world.clear()
    this.initializeSystems()
    this.createPlayerAndWeapon(groundTopY)
    this.enemyAISystem.setPlayer(this.playerEntity)
    this.targetingSystem.setPlayer(this.playerEntity)
    this.renderSystem.setPlayer(this.playerEntity)

    this.isPaused = false
    this.logParameters()
  }

  logParameters(): void {
    console.log('=== 游戏重启 - 当前参数 ===')
    console.log('--- 环境参数 ---')
    console.log({
      地面摩擦力: this.groundFriction,
      障碍物摩擦力: this.obstacleFriction,
    })
  }

  applyPlayerHit(attackerWeapon?: WeaponComponent): void {
    const weaponStats = attackerWeapon ?? this.playerEntity.weapon
    this.statsSystem.applyWeaponHit(this.playerEntity, weaponStats)
  }

  revivePlayer(): void {
    this.statsSystem.revive(this.playerEntity)
  }

  getPlayer() {
    return {
      setJumpForce: (value: number) => {
        if (this.playerEntity.movement) {
          this.playerEntity.movement.jumpForce = value
        }
      },
      setMaxJumpDuration: (value: number) => {
        if (this.playerEntity.movement) {
          this.playerEntity.movement.maxJumpDuration = value
        }
      },
      setJumpForceMultiplier: (value: number) => {
        if (this.playerEntity.movement) {
          this.playerEntity.movement.jumpForceMultiplier = value
        }
      },
      setWallJumpPushAwayMultiplier: (value: number) => {
        if (this.playerEntity.movement) {
          this.playerEntity.movement.wallJumpPushAwayMultiplier = value
        }
      },
      setWallJumpUpwardMultiplier: (value: number) => {
        if (this.playerEntity.movement) {
          this.playerEntity.movement.wallJumpUpwardMultiplier = value
        }
      },
      setMaxWallJumps: (value: number) => {
        if (this.playerEntity.movement) {
          this.playerEntity.movement.maxWallJumps = Math.floor(value)
        }
      },
      setMoveSpeed: (value: number) => {
        if (this.playerEntity.movement) {
          this.playerEntity.movement.moveSpeed = value
        }
      },
      setBodyFriction: (value: number) => {
        if (this.playerEntity.physics) {
          const { b2Shape_SetFriction } = this.box2d
          b2Shape_SetFriction(this.playerEntity.physics.shapeId, value)
        }
      },
      setBodyLinearDamping: (value: number) => {
        if (this.playerEntity.physics) {
          const { b2Body_SetLinearDamping } = this.box2d
          b2Body_SetLinearDamping(this.playerEntity.physics.bodyId, value)
        }
      },
      setBaseWeight: (value: number) => {
        if (this.playerEntity.movement) {
          this.playerEntity.movement.baseWeight = Math.max(1, value)
        }
      },
      setWeaponWeight: (value: number) => {
        if (this.playerEntity.weapon) {
          this.playerEntity.weapon.weight = Math.max(0, value)
          if (
            this.playerEntity.weapon.isEquipped &&
            this.playerEntity.movement
          ) {
            this.playerEntity.movement.carryWeight =
              this.playerEntity.weapon.weight
          }
        }
      },
      applyHit: () => {
        this.applyPlayerHit()
      },
      revive: () => {
        this.revivePlayer()
      },
    }
  }

  setGroundFriction(value: number): void {
    this.groundFriction = value
    const { b2Shape_SetFriction } = this.box2d
    b2Shape_SetFriction(this.groundShapeId, value)
  }

  setObstacleFriction(value: number): void {
    this.obstacleFriction = value
    const { b2Shape_SetFriction } = this.box2d
    for (const obstacle of this.obstacles) {
      b2Shape_SetFriction(obstacle.shapeId, value)
    }
  }

  getZoom(): number {
    return this.targetZoom
  }

  setZoom(value: number): void {
    this.targetZoom = Math.max(0.1, Math.min(2.0, value))
  }

  setJumpBufferWindow(value: number): void {
    if (this.playerEntity.input) {
      this.playerEntity.input.inputBuffer.setDefaultBufferWindow(value)
    }
  }
}
