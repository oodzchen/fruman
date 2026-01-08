import { componentRegistry } from '../ComponentRegistry'
import type { Entity } from '../Entity'
import { System } from '../System'

export class RenderSystem extends System {
  private ctx: CanvasRenderingContext2D
  private pixelsPerMeter: number
  private camera: { x: number; y: number }

  constructor(
    ctx: CanvasRenderingContext2D,
    pixelsPerMeter: number,
    camera: { x: number; y: number }
  ) {
    super()
    this.ctx = ctx
    this.pixelsPerMeter = pixelsPerMeter
    this.camera = camera

    const transformType = componentRegistry.getComponentType('Transform')
    const renderType = componentRegistry.getComponentType('Render')
    this.setRequiredComponents([transformType, renderType])
  }

  update(entities: Entity[], _deltaTime: number): void {
    for (const entity of entities) {
      if (!entity.transform || !entity.render) continue
      if (!entity.render.visible) continue

      this.renderEntity(entity)
    }
  }

  private renderEntity(entity: Entity): void {
    if (!entity.transform || !entity.render || !entity.input) return

    const pos = entity.transform
    const render = entity.render

    const centerX = pos.x * this.pixelsPerMeter
    const centerY = pos.y * this.pixelsPerMeter
    const radius = render.radius * this.pixelsPerMeter

    this.ctx.fillStyle = render.color
    this.ctx.beginPath()
    this.ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI)
    this.ctx.fill()

    this.ctx.strokeStyle = render.borderColor
    this.ctx.lineWidth = 3
    this.ctx.stroke()

    const eyeRadius = 0.08 * this.pixelsPerMeter
    const eyeOffsetX = 0.25 * this.pixelsPerMeter
    const eyeOffsetY = -0.25 * this.pixelsPerMeter

    const direction =
      entity.input.lastMoveDirection !== 0 ? entity.input.lastMoveDirection : 1
    const eyeX = centerX + (direction < 0 ? -eyeOffsetX : eyeOffsetX)
    const eyeY = centerY + eyeOffsetY

    this.ctx.fillStyle = '#000000'
    this.ctx.beginPath()
    this.ctx.arc(eyeX, eyeY, eyeRadius, 0, 2 * Math.PI)
    this.ctx.fill()
  }

  renderWeapon(entity: Entity): void {
    if (!entity.weapon) return

    const weapon = entity.weapon
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
    const isSwinging = weapon.attackPhase === 'swing'
    this.ctx.strokeStyle = weapon.isColliding
      ? '#ff4d4f'
      : isSwinging
        ? '#ffffff'
        : '#5a4b2a'
    this.ctx.lineWidth = weapon.isColliding ? 3 : 2
    this.drawRoundedRect(widthPx, heightPx, radiusPx)
    this.ctx.fill()
    this.ctx.stroke()
    this.ctx.restore()
  }

  private drawRoundedRect(
    widthPx: number,
    heightPx: number,
    radiusPx: number
  ): void {
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

  setCamera(x: number, y: number): void {
    this.camera.x = x
    this.camera.y = y
  }
}
