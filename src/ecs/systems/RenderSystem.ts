import type { StatsComponent } from '../Component'
import { componentRegistry } from '../ComponentRegistry'
import type { Entity } from '../Entity'
import { System } from '../System'

export class RenderSystem extends System {
  private ctx: CanvasRenderingContext2D
  private pixelsPerMeter: number
  private camera: { x: number; y: number }
  private player?: Entity

  private tempOffset = { x: 0, y: 0 }
  private tempScale = { x: 1, y: 1 }

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

  setPlayer(player: Entity): void {
    this.player = player
  }

  update(entities: Entity[], _deltaTime: number): void {
    for (const entity of entities) {
      if (!entity.transform || !entity.render) continue
      if (entity.stats?.isVanished) continue
      if (!entity.render.visible) continue

      this.renderEntity(entity)
      // if (entity.sensor) {
      //   this.renderSensorRays(entity)
      // }
      // this.renderDebugInfo(entity) // Removed old debug line
    }
  }

  renderLockOn(entities: Entity[]): void {
    if (this.player?.input?.lockedTargetId) {
      const targetId = this.player.input.lockedTargetId
      const target = entities.find((e) => e.id === targetId)
      if (target && target.transform && !target.stats?.isVanished) {
        this.drawLockOnReticle(target)
      }
    }
  }

  private drawLockOnReticle(target: Entity): void {
    if (!target.transform) return
    const pos = target.transform
    // 计算屏幕位置（逻辑同 renderEntity）
    const shakeOffset = this.getHitShakeOffset(target)
    const centerX = (pos.x + shakeOffset.x) * this.pixelsPerMeter
    const centerY = (pos.y + shakeOffset.y) * this.pixelsPerMeter

    this.ctx.save()
    this.ctx.translate(centerX, centerY)

    // 绘制白色十字架标识

    this.ctx.strokeStyle = '#FFFFFF'

    this.ctx.lineWidth = 1 // 线条变细

    const size = 7.5 // 十字架臂长缩短 1/4 (10 -> 7.5)

    this.ctx.beginPath()

    // 横线

    this.ctx.moveTo(-size, 0)

    this.ctx.lineTo(size, 0)

    // 竖线

    this.ctx.moveTo(0, -size)

    this.ctx.lineTo(0, size)

    this.ctx.stroke()

    // 中心白色圆点

    this.ctx.fillStyle = '#FFFFFF'

    this.ctx.beginPath()

    this.ctx.arc(0, 0, 2.5, 0, Math.PI * 2) // 圆点变大

    this.ctx.fill()

    this.ctx.restore()
  }

  private renderSensorRays(entity: Entity): void {
    if (!entity.sensor) return
    const { scanResults } = entity.sensor

    this.ctx.save()
    this.ctx.lineWidth = 3

    for (const res of scanResults) {
      const startX = res.start.x * this.pixelsPerMeter
      const startY = res.start.y * this.pixelsPerMeter
      const endX =
        (res.hitPoint ? res.hitPoint.x : res.end.x) * this.pixelsPerMeter
      const endY =
        (res.hitPoint ? res.hitPoint.y : res.end.y) * this.pixelsPerMeter

      this.ctx.beginPath()
      this.ctx.moveTo(startX, startY)
      this.ctx.lineTo(endX, endY)

      if (res.hit) {
        if (res.isHostile) {
          this.ctx.strokeStyle = 'rgba(255, 0, 0, 0.8)' // Red for hostile entity hit
        } else {
          this.ctx.strokeStyle = 'rgba(128, 128, 128, 0.5)' // Grey for non-hostile hit (ground, obstacles)
        }
      } else {
        this.ctx.strokeStyle = 'rgba(0, 255, 0, 0.3)' // Green for clear
      }
      this.ctx.stroke()
    }
    this.ctx.restore()
  }

  renderEntity(entity: Entity): void {
    if (!entity.transform || !entity.render || !entity.input) return

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

    const eyeRadius = 0.08 * this.pixelsPerMeter
    const eyeOffsetX = 0.25 * this.pixelsPerMeter
    const eyeOffsetY = -0.25 * this.pixelsPerMeter

    const direction =
      entity.input.lastMoveDirection !== 0 ? entity.input.lastMoveDirection : 1
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

    if (entity.input?.lockedTargetId) {
      // 这里的entity是玩家，lockedTargetId是敌人的ID
      // 这里的RenderSystem是遍历所有实体渲染，没办法直接获得“全部实体”来查找目标位置
      // 所以我们把绘制锁定准星的逻辑放在 update 的循环外或者 GameECS 中可能更好
      // 或者在这里判断，如果“当前渲染的实体”是被玩家锁定的实体，则绘制准星
      // 但 RenderSystem 不知道谁是玩家。
      // 方案调整：在 GameECS 的 render 方法中额外绘制准星，或者给被锁定的实体加一个标记组件。
      // 鉴于 RenderSystem 的结构，我们可以简单地在 drawStatusBars 后面补充逻辑：
      // 如果当前渲染的实体被某些人锁定了？不，应该是“如果当前渲染的是玩家，且他有锁定目标”，则需要在目标位置画准星。
      // 但这里我们没有目标的引用。
      // 更好的方式：在 GameECS 中传递 playerEntity 给 RenderSystem 或者在 RenderSystem 中存储 playerEntity。
    }
  }

  renderWeapon(entity: Entity): void {
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

  private drawStatusBars(
    stats: StatsComponent,
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

  private getDeathScale(entity: Entity): { x: number; y: number } {
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

  private getDeathAlpha(entity: Entity): number {
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

  private getHitShakeOffset(entity: Entity): { x: number; y: number } {
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
