import type { RenderEntity } from './worker/protocol'

export class ClientRenderer {
  private ctx: CanvasRenderingContext2D
  private pixelsPerMeter: number
  private camera: { x: number; y: number }

  private tempOffset = { x: 0, y: 0 }
  private tempScale = { x: 1, y: 1 }

  constructor(
    ctx: CanvasRenderingContext2D,
    pixelsPerMeter: number
  ) {
    this.ctx = ctx
    this.pixelsPerMeter = pixelsPerMeter
    this.camera = { x: 0, y: 0 }
  }

  setCamera(x: number, y: number) {
      this.camera.x = x
      this.camera.y = y
  }

  render(entities: RenderEntity[], playerLockedTargetId?: number | null) {
    for (const entity of entities) {
      if (entity.stats?.isVanished) continue
      if (!entity.render.visible) continue

      const facing = entity.input && entity.input.lastMoveDirection !== 0
          ? entity.input.lastMoveDirection
          : 1
      
      // Draw weapon behind
      if (facing < 0 && entity.weapon) {
          this.renderWeapon(entity)
      }

      this.renderEntity(entity)

      // Draw weapon in front
      if (facing >= 0 && entity.weapon) {
          this.renderWeapon(entity)
      }
    }
    
    // Draw LockOn Reticle
    if (playerLockedTargetId) {
        const target = entities.find(e => e.id === playerLockedTargetId)
        if (target && !target.stats?.isVanished) {
            this.drawLockOnReticle(target)
        }
    }
  }

  private drawLockOnReticle(target: RenderEntity): void {
    const pos = target.transform
    const shakeOffset = this.getHitShakeOffset(target)
    const centerX = (pos.x + shakeOffset.x) * this.pixelsPerMeter
    const centerY = (pos.y + shakeOffset.y) * this.pixelsPerMeter

    this.ctx.save()
    this.ctx.translate(centerX, centerY)
    this.ctx.strokeStyle = '#FFFFFF'
    this.ctx.lineWidth = 1 
    const size = 7.5

    this.ctx.beginPath()
    this.ctx.moveTo(-size, 0)
    this.ctx.lineTo(size, 0)
    this.ctx.moveTo(0, -size)
    this.ctx.lineTo(0, size)
    this.ctx.stroke()

    this.ctx.fillStyle = '#FFFFFF'
    this.ctx.beginPath()
    this.ctx.arc(0, 0, 2.5, 0, Math.PI * 2) 
    this.ctx.fill()
    this.ctx.restore()
  }

  private renderEntity(entity: RenderEntity): void {
    const pos = entity.transform
    const render = entity.render

    const shakeOffset = this.getHitShakeOffset(entity)
    const centerX = (pos.x + shakeOffset.x) * this.pixelsPerMeter
    const centerY = (pos.y + shakeOffset.y) * this.pixelsPerMeter
    const radius = render.radius * this.pixelsPerMeter
    const deathScale = this.getDeathScale(entity)
    const alpha = this.getDeathAlpha(entity)

    this.ctx.save()
    this.ctx.translate(centerX, centerY)
    this.ctx.scale(deathScale.x, deathScale.y)
    this.ctx.globalAlpha *= alpha

    if (entity.movement && entity.movement.isRolling) {
      this.ctx.rotate(entity.movement.rollAngle)
    }

    this.ctx.fillStyle = render.color
    this.ctx.beginPath()
    this.ctx.arc(0, 0, radius, 0, 2 * Math.PI)
    this.ctx.fill()

    this.ctx.strokeStyle = render.borderColor
    this.ctx.lineWidth = 3
    this.ctx.stroke()

    // Eyes
    const eyeRadius = 0.08 * this.pixelsPerMeter
    const eyeOffsetX = 0.25 * this.pixelsPerMeter
    const eyeOffsetY = -0.25 * this.pixelsPerMeter

    const direction =
      entity.input && entity.input.lastMoveDirection !== 0 ? entity.input.lastMoveDirection : 1
    const eyeX = direction < 0 ? -eyeOffsetX : eyeOffsetX
    const eyeY = eyeOffsetY

    this.ctx.fillStyle = '#000000'
    this.ctx.beginPath()
    this.ctx.arc(eyeX, eyeY, eyeRadius, 0, 2 * Math.PI)
    this.ctx.fill()

    this.ctx.restore()

    if (entity.stats) {
      this.drawStatusBars(entity.stats, centerX, centerY, render.radius)
    }
  }

  private renderWeapon(entity: RenderEntity): void {
    if (!entity.weapon) return
    if (entity.stats?.isDead || entity.stats?.isVanished) return

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
    this.ctx.strokeStyle = '#5a4b2a'
    this.ctx.lineWidth = 2
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

  private drawStatusBars(
    stats: NonNullable<RenderEntity['stats']>,
    centerX: number,
    centerY: number,
    radius: number
  ): void {
    const barWidth = radius * 2.2 * this.pixelsPerMeter
    const barHeight = 6
    const spacing = 2
    const startX = centerX - barWidth / 2
    const barTopOffset = 18
    const baseY = centerY - radius * this.pixelsPerMeter - barTopOffset
    const healthY = baseY
    const toughnessY = baseY + barHeight + spacing

    const healthRatio = stats.maxHealth > 0 ? stats.health / stats.maxHealth : 0
    this.drawBar(
      startX,
      healthY,
      barWidth,
      barHeight,
      healthRatio,
      '#5a1b1b',
      '#ff4d4f'
    )

    const toughnessRatio =
      stats.maxToughness > 0 ? stats.toughness / stats.maxToughness : 0
    this.drawBar(
      startX,
      toughnessY,
      barWidth,
      barHeight,
      toughnessRatio,
      '#665511',
      '#ffd666'
    )
  }

  private drawBar(
    x: number,
    y: number,
    width: number,
    height: number,
    ratio: number,
    background: string,
    foreground: string
  ): void {
    const clampedRatio = Math.max(0, Math.min(1, ratio))

    this.ctx.fillStyle = background
    this.ctx.fillRect(x, y, width, height)

    this.ctx.fillStyle = foreground
    this.ctx.fillRect(x, y, width * clampedRatio, height)

    this.ctx.strokeStyle = '#111111'
    this.ctx.lineWidth = 1
    this.ctx.strokeRect(x, y, width, height)
  }

  private getDeathScale(entity: RenderEntity): { x: number; y: number } {
    if (!entity.stats || !entity.stats.isDead) {
      this.tempScale.x = 1
      this.tempScale.y = 1
      return this.tempScale
    }
    const elapsed = entity.stats.deathElapsedSec
    const flash = entity.stats.deathFlashDurationSec
    const flatten = entity.stats.deathFlattenDurationSec
    if (elapsed <= flash) {
      this.tempScale.x = 1
      this.tempScale.y = 1
      return this.tempScale
    }
    const progress = Math.min(1, Math.max(0, (elapsed - flash) / flatten))
    const scaleY = Math.max(0.05, 1 - progress)
    const scaleX = 1 + progress * 0.3
    this.tempScale.x = scaleX
    this.tempScale.y = scaleY
    return this.tempScale
  }

  private getDeathAlpha(entity: RenderEntity): number {
    if (!entity.stats || !entity.stats.isDead) return 1
    const elapsed = entity.stats.deathElapsedSec
    const flash = entity.stats.deathFlashDurationSec
    const flatten = entity.stats.deathFlattenDurationSec
    if (elapsed <= flash) {
      return 0.5 + 0.5 * Math.sin(elapsed * 20)
    }
    const progress = Math.min(1, Math.max(0, (elapsed - flash) / flatten))
    return 1 - progress
  }

  private getHitShakeOffset(entity: RenderEntity): { x: number; y: number } {
    if (!entity.stats || entity.stats.hitShakeDurationMs === 0) {
      this.tempOffset.x = 0
      this.tempOffset.y = 0
      return this.tempOffset
    }

    const progress =
      entity.stats.hitShakeElapsedMs / entity.stats.hitShakeDurationMs
    const decay = 1 - progress
    const frequency = 30
    const shake = Math.sin(progress * frequency) * decay

    const offsetX =
      shake * entity.stats.hitShakeIntensity * entity.stats.hitShakeDirectionX

    this.tempOffset.x = offsetX
    this.tempOffset.y = 0
    return this.tempOffset
  }
}
