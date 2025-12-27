import { HumanPlayer } from './humanPlayer'
import type { MainModule, b2BodyId, b2ShapeId, b2WorldId } from './types'

export class Game {
  private box2d: MainModule
  private worldId: b2WorldId
  private player: HumanPlayer
  private groundBodyId: b2BodyId
  private groundShapeId!: b2ShapeId
  private obstacles: Array<{
    bodyId: b2BodyId
    shapeId: b2ShapeId
    width: number
    height: number
  }> = []
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private camera: { x: number; y: number }
  private pixelsPerMeter = 50
  private keys = new Set<string>()
  private zoom = 1.0
  private targetZoom = 1.0
  private zoomLevels = [0.6, 1.0, 1.8]
  private currentZoomLevel = 1
  private spaceKeyPressed = false
  private isPaused = false
  private groundFriction = 1.0
  private obstacleFriction = 0.5

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

    const groundHeight = 0.5
    const groundY = this.canvas.height / this.pixelsPerMeter - groundHeight
    const groundTopY = groundY - groundHeight
    const footOffset = 0.29
    this.player = new HumanPlayer(
      this.box2d,
      this.worldId,
      2,
      groundTopY - footOffset
    )

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

    // 创建多个不同高度的障碍物/柱子作为参考
    const obstacleConfigs = [
      { x: -10, width: 1, height: 2 },
      { x: 5, width: 1, height: 2.5 },
      { x: 10, width: 1, height: 1 },
      { x: 15, width: 0.8, height: 3.5 },
      { x: -15, width: 1.2, height: 2.8 },
      { x: 20, width: 1, height: 2 },
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
        this.player.startJump()
      }

      // 缩放控制（三阶段）
      if (e.key.toLowerCase() === 'i') {
        // 放大：增加级别
        this.currentZoomLevel = Math.min(
          this.currentZoomLevel + 1,
          this.zoomLevels.length - 1
        )
        this.targetZoom = this.zoomLevels[this.currentZoomLevel]
      } else if (e.key.toLowerCase() === 'o') {
        // 缩小：减少级别
        this.currentZoomLevel = Math.max(this.currentZoomLevel - 1, 0)
        this.targetZoom = this.zoomLevels[this.currentZoomLevel]
      } else if (e.key.toLowerCase() === 'u') {
        // 复原：回到中间级别
        this.currentZoomLevel = 1
        this.targetZoom = this.zoomLevels[this.currentZoomLevel]
      } else if (e.key.toLowerCase() === 'k') {
        this.player.setAlive(false)
      } else if (e.key.toLowerCase() === 'l') {
        this.player.setAlive(true)
      }
    })

    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.key.toLowerCase())

      if (e.key === ' ') {
        this.spaceKeyPressed = false
        this.player.stopJump()
      }
    })
  }

  update(_deltaTime: number) {
    if (this.isPaused) return

    let moveDirection = 0
    if (this.keys.has('a') || this.keys.has('arrowleft')) moveDirection -= 1
    if (this.keys.has('d') || this.keys.has('arrowright')) moveDirection += 1

    this.player.move(moveDirection)
    this.player.updateJump()

    const { b2World_Step } = this.box2d
    const timeStep = 1 / 60
    b2World_Step(this.worldId, timeStep, 4)
    this.player.postStepUpdate()
    this.updateWallProximity()

    const playerPos = this.player.getPosition()
    // 相机跟随角色，保持角色在屏幕中心（不受缩放影响）
    this.camera.x = playerPos.x - this.canvas.width / (2 * this.pixelsPerMeter)

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

  private updateWallProximity() {
    const { b2Body_GetPosition } = this.box2d
    const playerPos = this.player.getPosition()
    const playerHalfHeight = 1.1
    const wallDistanceThreshold = 0.25
    let closestDirection = 0
    let closestDistance = Number.POSITIVE_INFINITY

    for (const obstacle of this.obstacles) {
      const obstaclePos = b2Body_GetPosition(obstacle.bodyId)
      const minY = obstaclePos.y - obstacle.height - playerHalfHeight
      const maxY = obstaclePos.y + obstacle.height + playerHalfHeight

      if (playerPos.y < minY || playerPos.y > maxY) {
        obstaclePos.delete()
        continue
      }

      const left = obstaclePos.x - obstacle.width
      const right = obstaclePos.x + obstacle.width

      if (playerPos.x < left) {
        const distance = left - playerPos.x
        if (distance <= wallDistanceThreshold && distance < closestDistance) {
          closestDistance = distance
          closestDirection = 1
        }
      } else if (playerPos.x > right) {
        const distance = playerPos.x - right
        if (distance <= wallDistanceThreshold && distance < closestDistance) {
          closestDistance = distance
          closestDirection = -1
        }
      }

      obstaclePos.delete()
    }

    playerPos.delete()
    this.player.setWallProximity(closestDirection)
  }

  render() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)

    this.ctx.save()

    // 以画布中心为缩放中心（固定位置，避免跳跃时垂直晃动）
    const centerX = this.canvas.width / 2
    const centerY = this.canvas.height / 2

    this.ctx.translate(centerX, centerY)
    this.ctx.scale(this.zoom, this.zoom)
    this.ctx.translate(-centerX, -centerY)

    // 应用相机偏移
    this.ctx.translate(
      -this.camera.x * this.pixelsPerMeter,
      -this.camera.y * this.pixelsPerMeter
    )

    this.drawGround()
    this.drawObstacles()
    this.player.render(this.ctx, this.pixelsPerMeter)

    this.ctx.restore()
  }

  private drawGround() {
    const { b2Body_GetPosition } = this.box2d
    const pos = b2Body_GetPosition(this.groundBodyId)
    const groundHeight = 0.5

    const topY = (pos.y - groundHeight) * this.pixelsPerMeter
    const height = groundHeight * 2 * this.pixelsPerMeter

    this.ctx.fillStyle = '#654321'
    this.ctx.fillRect(
      (pos.x - 50) * this.pixelsPerMeter,
      topY,
      100 * this.pixelsPerMeter,
      height
    )
  }

  private drawObstacles() {
    const { b2Body_GetPosition } = this.box2d

    this.obstacles.forEach((obstacle, index) => {
      const pos = b2Body_GetPosition(obstacle.bodyId)

      // 使用不同颜色以区分
      const colors = ['#8B4513', '#A0522D', '#D2691E', '#CD853F', '#DEB887']
      this.ctx.fillStyle = colors[index % colors.length]

      // 使用实际的物理形状尺寸绘制
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
    // Destroy old player first
    this.player.destroy()

    // Recreate player at initial position
    const groundHeight = 0.5
    const groundY = this.canvas.height / this.pixelsPerMeter - groundHeight
    const groundTopY = groundY - groundHeight
    const footOffset = 0.29
    this.player = new HumanPlayer(
      this.box2d,
      this.worldId,
      2,
      groundTopY - footOffset
    )
    this.isPaused = false

    // Log all parameters
    this.logParameters()
  }

  logParameters() {
    console.log('=== 游戏重启 - 当前参数 ===')
    console.log('--- 环境参数 ---')
    console.log({
      地面摩擦力: this.groundFriction,
      障碍物摩擦力: this.obstacleFriction,
    })
    this.player.logParameters()
  }

  getPlayer(): HumanPlayer {
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
}
