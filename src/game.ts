import { Player } from './player'
import type { MainModule, b2BodyId, b2WorldId } from './types'

export class Game {
  private box2d: MainModule
  private worldId: b2WorldId
  private player: Player
  private groundBodyId: b2BodyId
  private obstacles: Array<{
    bodyId: b2BodyId
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

    // 玩家初始位置：在地面上方一点点
    const groundY = this.canvas.height / this.pixelsPerMeter - 0.5
    this.player = new Player(this.box2d, this.worldId, 2, groundY - 2)

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
    shapeDef.material.friction = 0.6
    b2CreatePolygonShape(groundBodyId, shapeDef, groundBox)

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
      { x: -5, width: 1, height: 3 },
      { x: 0, width: 0.5, height: 1.5 },
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
      shapeDef.material.friction = 0.05
      b2CreatePolygonShape(bodyId, shapeDef, box)

      this.obstacles.push({ bodyId, width: obs.width, height: obs.height })

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
    let moveDirection = 0
    if (this.keys.has('a') || this.keys.has('arrowleft')) moveDirection -= 1
    if (this.keys.has('d') || this.keys.has('arrowright')) moveDirection += 1

    this.player.move(moveDirection)
    this.player.updateJump()

    const { b2World_Step } = this.box2d
    const timeStep = 1 / 60
    b2World_Step(this.worldId, timeStep, 4)

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
}
