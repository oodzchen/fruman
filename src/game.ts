import {
  DEFAULT_CAMERA_ZOOM,
  DEFAULT_GROUND_FRICTION,
  DEFAULT_OBSTACLE_FRICTION,
  DEFAULT_PLAYER_RADIUS,
  DEFAULT_WEAPON_ATTACK_PAUSE_MS,
  DEFAULT_WEAPON_ATTACK_RADIUS,
  DEFAULT_WEAPON_ATTACK_RECOVER_MS,
  DEFAULT_WEAPON_ATTACK_SWING_MS,
  DEFAULT_WEAPON_ATTACK_WINDUP_MS,
  DEFAULT_WEAPON_COMBAT_TIMEOUT_MS,
  DEFAULT_WEAPON_CORNER_RADIUS,
  DEFAULT_WEAPON_FINAL_WINDUP_MS,
  DEFAULT_WEAPON_FOLLOW_OFFSET_X,
  DEFAULT_WEAPON_FOLLOW_OFFSET_Y,
  DEFAULT_WEAPON_FRONT_OFFSET_X,
  DEFAULT_WEAPON_FRONT_OFFSET_Y,
  DEFAULT_WEAPON_GROUND_ROTATION_RAD,
  DEFAULT_WEAPON_HEIGHT,
  DEFAULT_WEAPON_PICKUP_DISTANCE,
  DEFAULT_WEAPON_PLAYER_CLEARANCE,
  DEFAULT_WEAPON_VERTICAL_ROTATION_RAD,
  DEFAULT_WEAPON_WIDTH,
} from './constants'
import { Player } from './player'
import type { MainModule, b2BodyId, b2ShapeId, b2WorldId } from './types'

type ObstacleRenderData = {
  bodyId: b2BodyId
  shapeId: b2ShapeId
  width: number
  height: number
}

type WeaponState = {
  width: number
  height: number
  cornerRadius: number
  position: { x: number; y: number }
  rotation: number
  isEquipped: boolean
  isInCombat: boolean
  attackPhase:
    | 'idle'
    | 'windup'
    | 'swing'
    | 'pause'
    | 'resetHead'
    | 'headHold'
    | 'recover'
    | 'finalWindup'
  attackElapsedMs: number
  lastAttackTimestamp: number
  attackStartTransform: WeaponTransform
  visual: WeaponTransform
  attackQueued: boolean
  comboCount: number
  swingDirection: 'toFront' | 'toHead'
  nextSwingDirection: 'toFront' | 'toHead'
  attackFacing: number
  attackStartOffset: WeaponRelativeTransform
  swingStartOffset: WeaponRelativeTransform
  swingEndOffset: WeaponRelativeTransform
  swingStartTransform: WeaponTransform
  swingEndTransform: WeaponTransform
  attackRadius: number
}

type WeaponTransform = { x: number; y: number; rotation: number }
type WeaponRelativeTransform = { dx: number; dy: number; rotation: number }

export class Game {
  private box2d: MainModule
  private worldId: b2WorldId
  private player: Player
  private groundBodyId: b2BodyId
  private groundShapeId!: b2ShapeId
  private obstacles: ObstacleRenderData[] = []
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
  private weapon: WeaponState | null = null
  private groundTopY = 0
  private attackKeyPressed = false

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
    worldDef.gravity = new b2Vec2(0, 30)
    this.worldId = b2CreateWorld(worldDef)
    worldDef.delete()

    this.camera = { x: 0, y: 0 }

    this.groundBodyId = this.createGround()
    this.createObstacles()
    this.backgroundPattern = this.createBackgroundPattern()
    this.groundPattern = this.createGroundPattern()
    this.obstaclePattern = this.createObstaclePattern()

    const groundHeight = 0.5
    const groundY = this.canvas.height / this.pixelsPerMeter - groundHeight
    const groundTopY = groundY - groundHeight
    this.groundTopY = groundTopY
    this.player = new Player(this.box2d, this.worldId, 2, groundTopY - 0.6)
    this.initializeWeapon(groundTopY)

    this.setupInput()
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
    this.groundShapeId = b2CreatePolygonShape(groundBodyId, shapeDef, groundBox)

    groundDef.delete()
    groundBox.delete()
    shapeDef.delete()

    return groundBodyId
  }

  private createObstacles() {
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
      { x: -10, width: 1, height: 2 },
      { x: 10, width: 1, height: 1.5 },
      { x: 20, width: 1, height: 2.5 },
    ]

    obstacleConfigs.forEach((obs) => {
      const bodyDef = b2DefaultBodyDef()
      bodyDef.position.Set(obs.x, groundY - obs.height)
      const bodyId = b2CreateBody(this.worldId, bodyDef)

      const box = b2MakeBox(obs.width, obs.height)
      const shapeDef = b2DefaultShapeDef()
      shapeDef.material.friction = this.obstacleFriction
      shapeDef.material.restitution = 0
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

  private setupInput() {
    window.addEventListener('keydown', (e) => {
      this.keys.add(e.key.toLowerCase())

      // 只有在空格键之前没有按下时才触发跳跃（避免键盘重复触发）
      if (e.key === ' ' && !this.spaceKeyPressed) {
        this.spaceKeyPressed = true
        this.jumpRequested = true
      }

      if (e.key.toLowerCase() === 'j' && !this.attackKeyPressed) {
        this.attackKeyPressed = true
        this.startAttack()
      }

      // 缩放控制（阶梯0.2，不限制范围）
      if (e.key.toLowerCase() === 'i') {
        // 放大：增加0.2
        this.targetZoom = Math.max(0.1, this.targetZoom + 0.2)
      } else if (e.key.toLowerCase() === 'o') {
        // 缩小：减少0.2
        this.targetZoom = Math.max(0.1, this.targetZoom - 0.2)
      } else if (e.key.toLowerCase() === 'u') {
        // 复原：回到1.0
        this.targetZoom = 1.0
      }
    })

    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.key.toLowerCase())

      if (e.key === ' ') {
        this.spaceKeyPressed = false
        this.player.stopJump()
      }

      if (e.key.toLowerCase() === 'j') {
        this.attackKeyPressed = false
      }
    })

    // 鼠标滚轮缩放
    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault()
      const zoomDelta = e.deltaY > 0 ? -0.1 : 0.1
      this.targetZoom = Math.max(
        0.1,
        Math.min(2.0, this.targetZoom + zoomDelta)
      )
    })
  }

  update(deltaTime: number) {
    if (this.isPaused) return

    this.tryPickUpWeapon()

    const deltaMs = Math.max(0, deltaTime * 1000)

    let moveDirection = 0
    if (this.keys.has('a') || this.keys.has('arrowleft')) moveDirection -= 1
    if (this.keys.has('d') || this.keys.has('arrowright')) moveDirection += 1

    if (this.jumpRequested) {
      this.player.startJump()
      this.jumpRequested = false
    }

    this.player.move(moveDirection)
    this.player.updateJump()
    this.updateWeapon(deltaMs)

    const { b2World_Step } = this.box2d
    const timeStep = 1 / 60
    b2World_Step(this.worldId, timeStep, 4)

    const playerPos = this.player.getPosition()

    // 相机死区跟随：计算玩家在屏幕上的位置，判断是否在1/8死区内
    const centerX = this.canvas.width / 2
    // 玩家在屏幕上的x坐标（考虑缩放变换）
    const playerScreenX =
      centerX +
      ((playerPos.x - this.camera.x) * this.pixelsPerMeter - centerX) *
        this.zoom

    const deadZoneLeft = this.canvas.width / 8
    const deadZoneRight = (7 * this.canvas.width) / 8

    // 玩家在左边1/8死区外，调整相机让玩家回到左边界
    if (playerScreenX < deadZoneLeft) {
      // 解方程：deadZoneLeft = centerX + ((playerPos.x - camera.x) * pixelsPerMeter - centerX) * zoom
      const targetCameraX =
        playerPos.x -
        ((deadZoneLeft - centerX) / this.zoom + centerX) / this.pixelsPerMeter
      this.camera.x = targetCameraX
    }
    // 玩家在右边1/8死区外，调整相机让玩家回到右边界
    else if (playerScreenX > deadZoneRight) {
      const targetCameraX =
        playerPos.x -
        ((deadZoneRight - centerX) / this.zoom + centerX) / this.pixelsPerMeter
      this.camera.x = targetCameraX
    }

    // 让相机保持在底部，这样地面始终可见
    const canvasHeightInMeters = this.canvas.height / this.pixelsPerMeter
    this.camera.y = canvasHeightInMeters - canvasHeightInMeters

    // 平滑缩放过渡（使用 ease-out cubic）
    const zoomDiff = this.targetZoom - this.zoom
    if (Math.abs(zoomDiff) > 0.001) {
      this.zoom += zoomDiff * 0.15
    } else {
      this.zoom = this.targetZoom
    }
  }

  render() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
    this.drawBackground()

    this.ctx.save()

    // 以画布底部中心为缩放中心，确保地面始终贴着视窗底部
    const centerX = this.canvas.width / 2
    const bottomY = this.canvas.height

    this.ctx.translate(centerX, bottomY)
    this.ctx.scale(this.zoom, this.zoom)
    this.ctx.translate(-centerX, -bottomY)

    // 应用相机偏移
    this.ctx.translate(
      -this.camera.x * this.pixelsPerMeter,
      -this.camera.y * this.pixelsPerMeter
    )

    this.drawGround()
    this.drawObstacles()
    this.renderWeapon()
    this.player.render(this.ctx, this.pixelsPerMeter)

    this.ctx.restore()
  }

  private drawGround() {
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

  private drawObstacles() {
    const { b2Body_GetPosition } = this.box2d

    this.obstacles.forEach((obstacle, _index) => {
      const pos = b2Body_GetPosition(obstacle.bodyId)

      // 使用简单几何纹理填充
      this.ctx.fillStyle = this.obstaclePattern ?? '#d2691e'
      this.ctx.fillRect(
        (pos.x - obstacle.width) * this.pixelsPerMeter,
        (pos.y - obstacle.height) * this.pixelsPerMeter,
        obstacle.width * 2 * this.pixelsPerMeter,
        obstacle.height * 2 * this.pixelsPerMeter
      )

      // 添加边框
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

  // Public methods for control panel
  stop() {
    this.isPaused = true
  }

  start() {
    this.isPaused = false
  }

  restart() {
    const groundHeight = 0.5
    const groundY = this.canvas.height / this.pixelsPerMeter - groundHeight
    const groundTopY = groundY - groundHeight
    this.groundTopY = groundTopY
    this.player = new Player(this.box2d, this.worldId, 2, groundTopY - 0.6)
    this.initializeWeapon(groundTopY)
    this.isPaused = false

    this.logParameters()
  }

  logParameters() {
    console.log('=== 游戏重启 - 当前参数 ===')
    console.log('--- 环境参数 ---')
    console.log({
      地面摩擦力: this.groundFriction,
      障碍物摩擦力: this.obstacleFriction,
    })
  }

  getPlayer(): Player {
    return this.player
  }

  setGroundFriction(value: number) {
    this.groundFriction = value
    const { b2Shape_SetFriction } = this.box2d
    b2Shape_SetFriction(this.groundShapeId, value)
  }

  setObstacleFriction(value: number) {
    this.obstacleFriction = value
    const { b2Shape_SetFriction } = this.box2d
    for (const obstacle of this.obstacles) {
      b2Shape_SetFriction(obstacle.shapeId, value)
    }
  }

  getZoom(): number {
    return this.targetZoom
  }

  setZoom(value: number) {
    this.targetZoom = Math.max(0.1, Math.min(2.0, value))
  }

  setJumpBufferWindow(value: number) {
    this.player.setJumpBufferWindow(value)
  }

  setWeaponSize(width: number, height: number) {
    if (!this.weapon) return
    const safeWidth = Math.max(0.1, width)
    const safeHeight = Math.max(0.05, height)
    this.weapon.width = safeWidth
    this.weapon.height = safeHeight

    if (!this.weapon.isEquipped) {
      this.weapon.position.y = this.groundTopY - safeHeight / 2
    }
  }

  private initializeWeapon(groundTopY: number) {
    const initialX = 6
    this.weapon = {
      width: DEFAULT_WEAPON_WIDTH,
      height: DEFAULT_WEAPON_HEIGHT,
      cornerRadius: DEFAULT_WEAPON_CORNER_RADIUS,
      position: {
        x: initialX,
        y: groundTopY - DEFAULT_WEAPON_HEIGHT / 2,
      },
      rotation: DEFAULT_WEAPON_GROUND_ROTATION_RAD,
      isEquipped: false,
      isInCombat: false,
      attackPhase: 'idle',
      attackElapsedMs: 0,
      lastAttackTimestamp: 0,
      attackStartTransform: {
        x: initialX,
        y: groundTopY - DEFAULT_WEAPON_HEIGHT / 2,
        rotation: DEFAULT_WEAPON_GROUND_ROTATION_RAD,
      },
      visual: {
        x: initialX,
        y: groundTopY - DEFAULT_WEAPON_HEIGHT / 2,
        rotation: DEFAULT_WEAPON_GROUND_ROTATION_RAD,
      },
      attackQueued: false,
      comboCount: 0,
      swingDirection: 'toFront',
      nextSwingDirection: 'toFront',
      attackFacing: 1,
      attackStartOffset: {
        dx: 0,
        dy: 0,
        rotation: DEFAULT_WEAPON_VERTICAL_ROTATION_RAD,
      },
      swingStartOffset: {
        dx: 0,
        dy: 0,
        rotation: DEFAULT_WEAPON_VERTICAL_ROTATION_RAD,
      },
      swingEndOffset: {
        dx: 0,
        dy: 0,
        rotation: DEFAULT_WEAPON_VERTICAL_ROTATION_RAD,
      },
      swingStartTransform: {
        x: initialX,
        y: groundTopY - DEFAULT_WEAPON_HEIGHT / 2,
        rotation: DEFAULT_WEAPON_GROUND_ROTATION_RAD,
      },
      swingEndTransform: {
        x: initialX,
        y: groundTopY - DEFAULT_WEAPON_HEIGHT / 2,
        rotation: DEFAULT_WEAPON_GROUND_ROTATION_RAD,
      },
      attackRadius: DEFAULT_WEAPON_ATTACK_RADIUS,
    }
  }

  private tryPickUpWeapon() {
    if (!this.weapon || this.weapon.isEquipped) return
    const playerPos = this.player.getPosition()
    const dx = playerPos.x - this.weapon.position.x
    const dy = playerPos.y - this.weapon.position.y
    const distance = Math.hypot(dx, dy)

    if (distance > DEFAULT_WEAPON_PICKUP_DISTANCE) return

    this.weapon.isEquipped = true
    this.weapon.rotation = DEFAULT_WEAPON_VERTICAL_ROTATION_RAD
    this.weapon.visual.rotation = DEFAULT_WEAPON_VERTICAL_ROTATION_RAD
  }

  private startAttack() {
    if (!this.weapon || !this.weapon.isEquipped) return

    const now = Date.now()
    const playerPos = this.player.getPosition()
    const facing = this.player.getFacingDirection()
    const attackRadius = this.getAttackRadius()
    this.weapon.attackRadius = attackRadius
    this.weapon.attackFacing = facing

    // 每个连续序列最多5次
    if (this.weapon.comboCount >= 5) return

    if (this.weapon.attackPhase === 'idle') {
      const { swingStartTransform, swingEndTransform } =
        this.getSwingTransforms(
          attackRadius,
          facing,
          this.weapon.swingDirection,
          playerPos
        )
      const attackStartOffset = this.getOffsetFromTransform(
        {
          x: this.weapon.visual.x,
          y: this.weapon.visual.y,
          rotation: this.weapon.visual.rotation,
        },
        playerPos
      )
      const swingStartOffset = this.getOffsetFromTransform(
        swingStartTransform,
        playerPos
      )
      const swingEndOffset = this.getOffsetFromTransform(
        swingEndTransform,
        playerPos
      )

      this.weapon.swingDirection = this.weapon.nextSwingDirection
      this.weapon.nextSwingDirection =
        this.weapon.swingDirection === 'toFront' ? 'toHead' : 'toFront'
      this.weapon.isInCombat = true
      this.weapon.attackPhase = 'windup'
      this.weapon.attackElapsedMs = 0
      this.weapon.lastAttackTimestamp = now
      this.weapon.attackStartOffset = attackStartOffset
      this.weapon.swingStartOffset = swingStartOffset
      this.weapon.swingEndOffset = swingEndOffset
      this.weapon.attackStartTransform = this.applyOffset(
        attackStartOffset,
        playerPos
      )
      this.weapon.swingStartTransform = swingStartTransform
      this.weapon.swingEndTransform = swingEndTransform
      this.weapon.attackRadius = attackRadius
      this.weapon.comboCount = 1
      this.weapon.attackQueued = false
      this.weapon.visual = this.applyOffset(attackStartOffset, playerPos)
      return
    }

    // 非idle阶段记录队列请求
    if (!this.weapon.attackQueued) {
      this.weapon.attackQueued = true
      this.weapon.lastAttackTimestamp = now
    }
  }

  private updateWeapon(deltaMs: number) {
    if (!this.weapon) return

    // 非装备状态保持地面静止
    if (!this.weapon.isEquipped) {
      this.weapon.visual = {
        x: this.weapon.position.x,
        y: this.weapon.position.y,
        rotation: this.weapon.rotation,
      }
      return
    }

    const playerPos = this.player.getPosition()
    const facing = this.player.getFacingDirection()
    const now = Date.now()
    const attackRadius = this.weapon.attackRadius || this.getAttackRadius()
    const attackFacing = this.weapon.attackFacing || facing
    const attackStartTransform = this.applyOffset(
      this.weapon.attackStartOffset,
      playerPos
    )
    const swingStartTransform = this.applyOffset(
      this.weapon.swingStartOffset,
      playerPos
    )
    const swingEndTransform = this.applyOffset(
      this.weapon.swingEndOffset,
      playerPos
    )
    this.weapon.attackStartTransform = attackStartTransform
    this.weapon.swingStartTransform = swingStartTransform
    this.weapon.swingEndTransform = swingEndTransform

    // 超时退出战斗状态并重置连击
    const hasTimedOut =
      this.weapon.isInCombat &&
      now - this.weapon.lastAttackTimestamp > DEFAULT_WEAPON_COMBAT_TIMEOUT_MS
    if (hasTimedOut) {
      this.weapon.isInCombat = false
      this.weapon.comboCount = 0
      this.weapon.attackQueued = false
      this.weapon.nextSwingDirection = 'toFront'
    }

    if (this.weapon.attackPhase === 'idle') {
      this.weapon.visual = this.weapon.isInCombat
        ? this.getFrontTransform(playerPos, facing)
        : this.getBackTransform(playerPos, facing)

      // 如果在idle阶段存在排队攻击，则立刻开启新攻击
      if (this.weapon.attackQueued && this.weapon.comboCount < 5) {
        this.weapon.attackQueued = false
        this.weapon.comboCount += 1
        this.weapon.swingDirection = this.weapon.nextSwingDirection
        this.weapon.nextSwingDirection =
          this.weapon.swingDirection === 'toFront' ? 'toHead' : 'toFront'
        const { swingStartTransform, swingEndTransform } =
          this.getSwingTransforms(
            attackRadius,
            attackFacing,
            this.weapon.swingDirection,
            playerPos
          )
        const attackStartOffset = this.getOffsetFromTransform(
          this.weapon.visual,
          playerPos
        )
        const swingStartOffset = this.getOffsetFromTransform(
          swingStartTransform,
          playerPos
        )
        const swingEndOffset = this.getOffsetFromTransform(
          swingEndTransform,
          playerPos
        )
        this.weapon.isInCombat = true
        this.weapon.attackPhase = 'windup'
        this.weapon.attackElapsedMs = 0
        this.weapon.lastAttackTimestamp = now
        this.weapon.attackFacing = attackFacing
        this.weapon.attackStartOffset = attackStartOffset
        this.weapon.swingStartOffset = swingStartOffset
        this.weapon.swingEndOffset = swingEndOffset
        this.weapon.attackStartTransform = this.applyOffset(
          attackStartOffset,
          playerPos
        )
        this.weapon.swingStartTransform = swingStartTransform
        this.weapon.swingEndTransform = swingEndTransform
        this.weapon.attackRadius = attackRadius
        this.weapon.visual = this.applyOffset(attackStartOffset, playerPos)
      }
      return
    }

    this.weapon.attackElapsedMs += deltaMs

    if (this.weapon.attackPhase === 'windup') {
      const t = this.clamp01(
        this.weapon.attackElapsedMs / DEFAULT_WEAPON_ATTACK_WINDUP_MS
      )
      const target = this.weapon.swingStartTransform
      this.weapon.visual = this.lerpTransform(
        this.weapon.attackStartTransform,
        target,
        t
      )
      if (t >= 1) {
        this.weapon.attackPhase = 'swing'
        this.weapon.attackElapsedMs = 0
        this.weapon.attackStartTransform = this.weapon.swingStartTransform
      }
      return
    }

    if (this.weapon.attackPhase === 'finalWindup') {
      const t = this.clamp01(
        this.weapon.attackElapsedMs / DEFAULT_WEAPON_FINAL_WINDUP_MS
      )
      const target = this.weapon.swingStartTransform
      this.weapon.visual = this.lerpTransform(
        this.weapon.attackStartTransform,
        target,
        t
      )
      if (t >= 1) {
        this.weapon.attackPhase = 'swing'
        this.weapon.attackElapsedMs = 0
        this.weapon.attackStartTransform = this.weapon.swingStartTransform
      }
      return
    }

    if (this.weapon.attackPhase === 'swing') {
      const t = this.clamp01(
        this.weapon.attackElapsedMs / DEFAULT_WEAPON_ATTACK_SWING_MS
      )
      const from = this.weapon.swingStartTransform
      const to = this.weapon.swingEndTransform
      this.weapon.visual = this.lerpTransform(from, to, t)
      if (t >= 1) {
        this.weapon.attackPhase = 'pause'
        this.weapon.attackElapsedMs = 0
        this.weapon.attackStartOffset = this.getOffsetFromTransform(
          this.weapon.visual,
          playerPos
        )
        this.weapon.attackStartTransform = this.weapon.visual
        this.weapon.lastAttackTimestamp = now
      }
      return
    }

    if (this.weapon.attackPhase === 'pause') {
      this.weapon.visual = this.weapon.attackStartTransform

      const reachedPause =
        this.weapon.attackElapsedMs >= DEFAULT_WEAPON_ATTACK_PAUSE_MS
      const canChain = this.weapon.attackQueued && this.weapon.comboCount < 5

      if (canChain) {
        this.weapon.attackQueued = false
        this.weapon.comboCount += 1
        const isFinalAttack = this.weapon.comboCount === 5

        this.weapon.swingDirection = this.weapon.nextSwingDirection
        this.weapon.nextSwingDirection =
          this.weapon.swingDirection === 'toFront' ? 'toHead' : 'toFront'

        const frontAngle = attackFacing === 1 ? 0 : -Math.PI
        const headAngle = DEFAULT_WEAPON_VERTICAL_ROTATION_RAD

        if (isFinalAttack) {
          const finalWindupRadius = attackRadius * 1.5
          const windupAngle =
            this.weapon.swingDirection === 'toFront' ? headAngle : frontAngle
          const finalWindupTransform = this.getTransformAtAngle(
            playerPos,
            windupAngle,
            finalWindupRadius
          )
          const finalWindupOffset = this.getOffsetFromTransform(
            finalWindupTransform,
            playerPos
          )

          const swingEndAngle =
            this.weapon.swingDirection === 'toFront' ? frontAngle : headAngle
          const swingEndTransform = this.getTransformAtAngle(
            playerPos,
            swingEndAngle,
            attackRadius
          )
          const swingEndOffset = this.getOffsetFromTransform(
            swingEndTransform,
            playerPos
          )

          this.weapon.attackPhase = 'finalWindup'
          this.weapon.attackElapsedMs = 0
          this.weapon.attackStartOffset = this.getOffsetFromTransform(
            this.weapon.visual,
            playerPos
          )
          this.weapon.swingStartOffset = finalWindupOffset
          this.weapon.swingEndOffset = swingEndOffset
          this.weapon.attackStartTransform = this.weapon.visual
          this.weapon.swingStartTransform = finalWindupTransform
          this.weapon.swingEndTransform = swingEndTransform
          this.weapon.lastAttackTimestamp = now
          return
        }

        const swingEndAngle =
          this.weapon.swingDirection === 'toFront' ? frontAngle : headAngle
        const swingEndTransform = this.getTransformAtAngle(
          playerPos,
          swingEndAngle,
          attackRadius
        )

        const swingStartOffset = this.getOffsetFromTransform(
          this.weapon.visual,
          playerPos
        )
        const swingEndOffset = this.getOffsetFromTransform(
          swingEndTransform,
          playerPos
        )

        this.weapon.attackPhase = 'swing'
        this.weapon.attackElapsedMs = 0
        this.weapon.swingStartOffset = swingStartOffset
        this.weapon.swingEndOffset = swingEndOffset
        this.weapon.swingStartTransform = this.weapon.visual
        this.weapon.swingEndTransform = swingEndTransform
        this.weapon.attackStartTransform = this.weapon.visual
        this.weapon.lastAttackTimestamp = now
        return
      }

      if (!reachedPause) return

      this.weapon.attackPhase = 'recover'
      this.weapon.attackElapsedMs = 0
      this.weapon.attackStartTransform = this.weapon.visual
      return
    }

    if (this.weapon.attackPhase === 'recover') {
      const t = this.clamp01(
        this.weapon.attackElapsedMs / DEFAULT_WEAPON_ATTACK_RECOVER_MS
      )
      const target = this.getFrontTransform(playerPos, facing)
      this.weapon.visual = this.lerpTransform(
        this.weapon.attackStartTransform,
        target,
        t
      )
      if (t >= 1) {
        this.weapon.attackPhase = 'idle'
        this.weapon.attackElapsedMs = 0
        this.weapon.lastAttackTimestamp = now
        this.weapon.attackQueued = false
        this.weapon.comboCount = 0
        this.weapon.swingDirection = 'toFront'
        this.weapon.nextSwingDirection = 'toFront'
        this.weapon.attackRadius = DEFAULT_WEAPON_ATTACK_RADIUS
      }
    }
  }

  private clamp01(value: number): number {
    if (value < 0) return 0
    if (value > 1) return 1
    return value
  }

  private getAttackRadius(): number {
    if (!this.weapon) {
      return DEFAULT_WEAPON_ATTACK_RADIUS
    }
    const minRadius =
      DEFAULT_PLAYER_RADIUS +
      this.weapon.width / 2 +
      DEFAULT_WEAPON_PLAYER_CLEARANCE
    return Math.max(DEFAULT_WEAPON_ATTACK_RADIUS, minRadius)
  }

  private lerpTransform(
    from: WeaponTransform,
    to: WeaponTransform,
    t: number
  ): WeaponTransform {
    const clampedT = this.clamp01(t)
    return {
      x: from.x + (to.x - from.x) * clampedT,
      y: from.y + (to.y - from.y) * clampedT,
      rotation: from.rotation + (to.rotation - from.rotation) * clampedT,
    }
  }

  private getOffsetFromTransform(
    transform: WeaponTransform,
    playerPos: { x: number; y: number }
  ): WeaponRelativeTransform {
    return {
      dx: transform.x - playerPos.x,
      dy: transform.y - playerPos.y,
      rotation: transform.rotation,
    }
  }

  private applyOffset(
    offset: WeaponRelativeTransform,
    playerPos: { x: number; y: number }
  ): WeaponTransform {
    return {
      x: playerPos.x + offset.dx,
      y: playerPos.y + offset.dy,
      rotation: offset.rotation,
    }
  }

  private getBackTransform(
    playerPos: { x: number; y: number },
    facing: number
  ) {
    return {
      x: playerPos.x - facing * DEFAULT_WEAPON_FOLLOW_OFFSET_X,
      y: playerPos.y + DEFAULT_WEAPON_FOLLOW_OFFSET_Y,
      rotation: DEFAULT_WEAPON_VERTICAL_ROTATION_RAD,
    }
  }

  private getFrontTransform(
    playerPos: { x: number; y: number },
    facing: number
  ) {
    return {
      x: playerPos.x + facing * DEFAULT_WEAPON_FRONT_OFFSET_X,
      y: playerPos.y + DEFAULT_WEAPON_FRONT_OFFSET_Y,
      rotation: DEFAULT_WEAPON_VERTICAL_ROTATION_RAD,
    }
  }

  private getSwingTransforms(
    radius: number,
    facing: number,
    direction: 'toFront' | 'toHead',
    playerPos: { x: number; y: number }
  ): {
    swingStartTransform: WeaponTransform
    swingEndTransform: WeaponTransform
  } {
    const frontAngle = facing === 1 ? 0 : -Math.PI
    const headAngle = DEFAULT_WEAPON_VERTICAL_ROTATION_RAD
    const swingStartAngle = direction === 'toFront' ? headAngle : frontAngle
    const swingEndAngle = direction === 'toFront' ? frontAngle : headAngle

    return {
      swingStartTransform: this.getTransformAtAngle(
        playerPos,
        swingStartAngle,
        radius
      ),
      swingEndTransform: this.getTransformAtAngle(
        playerPos,
        swingEndAngle,
        radius
      ),
    }
  }

  private getTransformAtAngle(
    playerPos: { x: number; y: number },
    angle: number,
    radius: number
  ): WeaponTransform {
    return {
      x: playerPos.x + Math.cos(angle) * radius,
      y: playerPos.y + Math.sin(angle) * radius,
      rotation: angle,
    }
  }

  private renderWeapon() {
    if (!this.weapon) return

    const weapon = this.weapon
    const widthPx = weapon.width * this.pixelsPerMeter
    const heightPx = weapon.height * this.pixelsPerMeter
    const radiusPx = weapon.cornerRadius * this.pixelsPerMeter

    this.ctx.save()
    this.ctx.translate(
      weapon.visual.x * this.pixelsPerMeter,
      weapon.visual.y * this.pixelsPerMeter
    )
    this.ctx.rotate(weapon.visual.rotation)
    this.ctx.fillStyle = '#c7b58f'
    this.ctx.strokeStyle = '#5a4b2a'
    this.ctx.lineWidth = 2
    this.drawRoundedRect(widthPx, heightPx, radiusPx)
    this.ctx.fill()
    this.ctx.stroke()
    this.ctx.restore()
  }

  private drawRoundedRect(widthPx: number, heightPx: number, radiusPx: number) {
    const r = Math.min(radiusPx, widthPx / 2, heightPx / 2)
    this.ctx.beginPath()
    this.ctx.moveTo(-widthPx / 2 + r, -heightPx / 2)
    this.ctx.lineTo(widthPx / 2 - r, -heightPx / 2)
    this.ctx.quadraticCurveTo(
      widthPx / 2,
      -heightPx / 2,
      widthPx / 2,
      -heightPx / 2 + r
    )
    this.ctx.lineTo(widthPx / 2, heightPx / 2 - r)
    this.ctx.quadraticCurveTo(
      widthPx / 2,
      heightPx / 2,
      widthPx / 2 - r,
      heightPx / 2
    )
    this.ctx.lineTo(-widthPx / 2 + r, heightPx / 2)
    this.ctx.quadraticCurveTo(
      -widthPx / 2,
      heightPx / 2,
      -widthPx / 2,
      heightPx / 2 - r
    )
    this.ctx.lineTo(-widthPx / 2, -heightPx / 2 + r)
    this.ctx.quadraticCurveTo(
      -widthPx / 2,
      -heightPx / 2,
      -widthPx / 2 + r,
      -heightPx / 2
    )
    this.ctx.closePath()
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

    // 顶部三角形带轻微错位，便于平铺无缝
    drawTriangle(0, height, halfSize, 0, halfSize, height)
    drawTriangle(halfSize, 0, patternSize, height, halfSize, height)

    // 底部三角形
    drawTriangle(0, height, halfSize, height * 2, halfSize, height)
    drawTriangle(halfSize, height * 2, patternSize, height, halfSize, height)

    // 中央衔接线，确保重复时边缘连续
    patternCtx.beginPath()
    patternCtx.moveTo(0, height)
    patternCtx.lineTo(patternSize, height)
    patternCtx.stroke()

    return this.ctx.createPattern(patternCanvas, 'repeat')
  }

  private drawBackground() {
    if (!this.backgroundPattern) {
      return
    }
    this.ctx.save()
    this.ctx.fillStyle = this.backgroundPattern
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height)
    this.ctx.restore()
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
}
