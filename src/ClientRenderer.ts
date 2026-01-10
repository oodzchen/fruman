import {
  ENTITY_STRIDE,
  FLAGS,
  MAX_ENTITIES,
  OFFSETS,
} from './worker/binaryProtocol'

export class ClientRenderer {
  private ctx: CanvasRenderingContext2D
  private pixelsPerMeter: number
  private camera: { x: number; y: number }

  private tempOffset = { x: 0, y: 0 }
  private tempScale = { x: 1, y: 1 }

  // Pre-allocated buffer to avoid creating new Float32Array each frame
  private stateBuffer = new Float32Array(MAX_ENTITIES * ENTITY_STRIDE)
  private entityCount = 0
  private incomingBuffer: ArrayBuffer | SharedArrayBuffer | null = null
  private incomingView: Float32Array | null = null

  // Cache for int -> hex color
  private colorCache = new Map<number, string>()

  constructor(ctx: CanvasRenderingContext2D, pixelsPerMeter: number) {
    this.ctx = ctx
    this.pixelsPerMeter = pixelsPerMeter
    this.camera = { x: 0, y: 0 }
  }

  updateState(buffer: ArrayBuffer | SharedArrayBuffer, count: number) {
    if (this.incomingBuffer !== buffer) {
      this.incomingBuffer = buffer
      this.incomingView = new Float32Array(buffer)
    }
    const incoming = this.incomingView
    if (!incoming) return
    const copyLength = count * ENTITY_STRIDE
    for (let i = 0; i < copyLength; i++) {
      this.stateBuffer[i] = incoming[i]
    }
    this.entityCount = count
  }

  setCamera(x: number, y: number) {
    this.camera.x = x
    this.camera.y = y
  }

  private getColorString(colorInt: number): string {
    const cached = this.colorCache.get(colorInt)
    if (cached) return cached
    const str = `#${colorInt.toString(16).padStart(6, '0')}`
    this.colorCache.set(colorInt, str)
    return str
  }

  render() {
    if (this.entityCount === 0) return
    const buf = this.stateBuffer

    // First pass: Find Player (Check for IS_PLAYER flag)
    let playerLockedTargetId = -1
    for (let i = 0; i < this.entityCount; i++) {
      const offset = i * ENTITY_STRIDE
      const flags = buf[offset + OFFSETS.FLAGS]
      if (flags & FLAGS.IS_PLAYER) {
        playerLockedTargetId = buf[offset + OFFSETS.LOCKED_TARGET_ID]
        break
      }
    }

    // Render Entities
    for (let i = 0; i < this.entityCount; i++) {
      const offset = i * ENTITY_STRIDE
      const flags = buf[offset + OFFSETS.FLAGS]

      if (flags & FLAGS.VANISHED) continue
      if (!(flags & FLAGS.VISIBLE)) continue

      const facing = buf[offset + OFFSETS.MOVE_DIR] // 1 or -1
      const hasWeapon = buf[offset + OFFSETS.WEAPON_ACTIVE] === 1

      // Draw weapon behind
      if (facing < 0 && hasWeapon) {
        this.renderWeapon(buf, offset, flags)
      }

      this.renderEntity(buf, offset, flags)

      // Draw weapon in front
      if (facing >= 0 && hasWeapon) {
        this.renderWeapon(buf, offset, flags)
      }
    }

    // Draw LockOn Reticle
    if (playerLockedTargetId !== -1) {
      // Find target
      for (let i = 0; i < this.entityCount; i++) {
        const offset = i * ENTITY_STRIDE
        if (buf[offset + OFFSETS.ID] === playerLockedTargetId) {
          const flags = buf[offset + OFFSETS.FLAGS]
          if (!(flags & FLAGS.VANISHED)) {
            this.drawLockOnReticle(buf, offset)
          }
          break
        }
      }
    }
  }

  private drawLockOnReticle(buf: Float32Array, offset: number): void {
    const x = buf[offset + OFFSETS.X]
    const y = buf[offset + OFFSETS.Y]

    // Shake
    const shakeOffset = this.getHitShakeOffset(buf, offset)

    const centerX = (x + shakeOffset.x) * this.pixelsPerMeter
    const centerY = (y + shakeOffset.y) * this.pixelsPerMeter

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

  private renderEntity(buf: Float32Array, offset: number, flags: number): void {
    const x = buf[offset + OFFSETS.X]
    const y = buf[offset + OFFSETS.Y]
    const radius = buf[offset + OFFSETS.RADIUS] * this.pixelsPerMeter
    const colorInt = buf[offset + OFFSETS.COLOR]
    const borderColorInt = buf[offset + OFFSETS.BORDER_COLOR]

    const shakeOffset = this.getHitShakeOffset(buf, offset)
    const centerX = (x + shakeOffset.x) * this.pixelsPerMeter
    const centerY = (y + shakeOffset.y) * this.pixelsPerMeter

    const deathScale = this.getDeathScale(buf, offset, flags)
    const alpha = this.getDeathAlpha(buf, offset, flags)

    this.ctx.save()
    this.ctx.translate(centerX, centerY)
    this.ctx.scale(deathScale.x, deathScale.y)
    this.ctx.globalAlpha *= alpha

    if (flags & FLAGS.ROLLING) {
      const rollAngle = buf[offset + OFFSETS.ROLL_ANGLE]
      this.ctx.rotate(rollAngle)
    } else if (flags & FLAGS.STAGGERED) {
      const staggerAngle = buf[offset + OFFSETS.ROLL_ANGLE]
      this.ctx.rotate(staggerAngle)
    }

    this.ctx.fillStyle = this.getColorString(colorInt)
    this.ctx.beginPath()
    this.ctx.arc(0, 0, radius, 0, 2 * Math.PI)
    this.ctx.fill()

    this.ctx.strokeStyle = this.getColorString(borderColorInt)
    this.ctx.lineWidth = 3
    this.ctx.stroke()

    // Eyes
    const eyeRadius = 0.08 * this.pixelsPerMeter
    const eyeOffsetX = 0.25 * this.pixelsPerMeter
    const eyeOffsetY = -0.25 * this.pixelsPerMeter

    const direction = buf[offset + OFFSETS.MOVE_DIR]
    const eyeX = direction < 0 ? -eyeOffsetX : eyeOffsetX
    const eyeY = eyeOffsetY

    this.ctx.fillStyle = '#000000'
    this.ctx.beginPath()
    this.ctx.arc(eyeX, eyeY, eyeRadius, 0, 2 * Math.PI)
    this.ctx.fill()

    this.ctx.restore()

    // Status Bars
    const maxHealth = buf[offset + OFFSETS.STATS_HEALTH_MAX]
    if (maxHealth > 0) {
      this.drawStatusBars(
        buf,
        offset,
        centerX,
        centerY,
        buf[offset + OFFSETS.RADIUS]
      )
    }
  }

  private renderWeapon(buf: Float32Array, offset: number, flags: number): void {
    if (flags & FLAGS.DEAD) return
    if (flags & FLAGS.VANISHED) return

    const wx = buf[offset + OFFSETS.WEAPON_X]
    const wy = buf[offset + OFFSETS.WEAPON_Y]
    const wRot = buf[offset + OFFSETS.WEAPON_ROT]
    const wWidth = buf[offset + OFFSETS.WEAPON_W] * this.pixelsPerMeter
    const wHeight = buf[offset + OFFSETS.WEAPON_H] * this.pixelsPerMeter
    const wRad = buf[offset + OFFSETS.WEAPON_R] * this.pixelsPerMeter

    const isAttacking = !!(flags & FLAGS.WEAPON_ATTACKING)

    this.ctx.save()
    this.ctx.translate(wx * this.pixelsPerMeter, wy * this.pixelsPerMeter)
    this.ctx.rotate(wRot)
    this.ctx.fillStyle = '#c7b58f'
    this.ctx.strokeStyle = isAttacking ? '#FFFFFF' : '#5a4b2a'
    this.ctx.lineWidth = 2
    this.drawRoundedRect(wWidth, wHeight, wRad)
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
    buf: Float32Array,
    offset: number,
    centerX: number,
    centerY: number,
    radiusMeters: number
  ): void {
    const health = buf[offset + OFFSETS.STATS_HEALTH]
    const maxHealth = buf[offset + OFFSETS.STATS_HEALTH_MAX]
    const toughness = buf[offset + OFFSETS.STATS_TOUGHNESS]
    const maxToughness = buf[offset + OFFSETS.STATS_TOUGHNESS_MAX]

    const barWidth = radiusMeters * 2.2 * this.pixelsPerMeter
    const barHeight = 6
    const spacing = 2
    const startX = centerX - barWidth / 2
    const barTopOffset = 18
    const baseY = centerY - radiusMeters * this.pixelsPerMeter - barTopOffset
    const healthY = baseY
    const toughnessY = baseY + barHeight + spacing

    const healthRatio = maxHealth > 0 ? health / maxHealth : 0
    this.drawBar(
      startX,
      healthY,
      barWidth,
      barHeight,
      healthRatio,
      '#5a1b1b',
      '#ff4d4f'
    )

    const toughnessRatio = maxToughness > 0 ? toughness / maxToughness : 0
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

  private getDeathScale(
    buf: Float32Array,
    offset: number,
    flags: number
  ): { x: number; y: number } {
    if (!(flags & FLAGS.DEAD)) {
      this.tempScale.x = 1
      this.tempScale.y = 1
      return this.tempScale
    }
    const elapsed = buf[offset + OFFSETS.STATS_DEATH_ELAPSED]
    const flash = 0.3
    const flatten = 0.7

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

  private getDeathAlpha(
    buf: Float32Array,
    offset: number,
    flags: number
  ): number {
    if (!(flags & FLAGS.DEAD)) return 1
    const elapsed = buf[offset + OFFSETS.STATS_DEATH_ELAPSED]
    const flash = 0.3
    const flatten = 0.7
    if (elapsed <= flash) {
      return 0.5 + 0.5 * Math.sin(elapsed * 20)
    }
    const progress = Math.min(1, Math.max(0, (elapsed - flash) / flatten))
    return 1 - progress
  }

  private getHitShakeOffset(
    buf: Float32Array,
    offset: number
  ): { x: number; y: number } {
    const duration = buf[offset + OFFSETS.STATS_SHAKE_DURATION]
    if (duration === 0) {
      this.tempOffset.x = 0
      this.tempOffset.y = 0
      return this.tempOffset
    }

    const elapsed = buf[offset + OFFSETS.STATS_SHAKE_ELAPSED]
    const intensity = buf[offset + OFFSETS.STATS_SHAKE_INTENSITY]
    const dirX = buf[offset + OFFSETS.STATS_SHAKE_DIR_X]

    const progress = elapsed / duration
    const decay = 1 - progress
    const frequency = 30
    const shake = Math.sin(progress * frequency) * decay

    const offsetX = shake * intensity * dirX

    this.tempOffset.x = offsetX
    this.tempOffset.y = 0
    return this.tempOffset
  }
}
