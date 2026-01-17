import type { AudioManager } from './AudioManager'
import { ParticleSystem } from './ParticleSystem'
import {
  ENTITY_STRIDE,
  FLAGS,
  MAX_ENTITIES,
  OFFSETS,
  WEAPON_TYPES,
} from './worker/binaryProtocol'
import {
  EFFECTS_BASE_OFFSET,
  EFFECT_OFFSETS,
  EFFECT_STRIDE,
  EFFECT_TYPES,
} from './worker/effectsProtocol'

const MAX_PARTICLES = 600

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
  private particleSystem: ParticleSystem
  private effectsBuffer: ArrayBuffer | SharedArrayBuffer | null = null
  private effectsView: Float32Array | null = null
  private audioManager: AudioManager | null = null

  constructor(ctx: CanvasRenderingContext2D, pixelsPerMeter: number) {
    this.ctx = ctx
    this.pixelsPerMeter = pixelsPerMeter
    this.camera = { x: 0, y: 0 }
    this.particleSystem = new ParticleSystem(MAX_PARTICLES)
  }

  setAudioManager(audioManager: AudioManager): void {
    this.audioManager = audioManager
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

  update(deltaTime: number): void {
    this.particleSystem.update(deltaTime)
  }

  applyEffects(buffer: ArrayBuffer | SharedArrayBuffer, count: number): void {
    if (count <= 0) return
    if (this.effectsBuffer !== buffer) {
      this.effectsBuffer = buffer
      this.effectsView = new Float32Array(buffer)
    }
    const view = this.effectsView
    if (!view) return

    for (let i = 0; i < count; i++) {
      const base = EFFECTS_BASE_OFFSET + i * EFFECT_STRIDE
      const type = view[base + EFFECT_OFFSETS.TYPE] | 0
      const x = view[base + EFFECT_OFFSETS.X]
      const y = view[base + EFFECT_OFFSETS.Y]
      const color = view[base + EFFECT_OFFSETS.COLOR] | 0
      const radius = view[base + EFFECT_OFFSETS.RADIUS]
      if (type === EFFECT_TYPES.SPARK) {
        this.particleSystem.spawnSpark(x, y, color)
      } else if (type === EFFECT_TYPES.BLOOD) {
        this.particleSystem.spawnBlood(x, y, color)
      } else if (type === EFFECT_TYPES.DEATH) {
        this.particleSystem.spawnDeath(x, y, color, radius)
      } else if (type === EFFECT_TYPES.SOUND) {
        const soundId = color
        const playbackRate = radius || 1.0
        this.audioManager?.play(soundId, 1.0, playbackRate)
      }
    }
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
    if (this.entityCount === 0 && !this.particleSystem.hasActiveParticles())
      return
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

      this.renderEntity(buf, offset, flags, playerLockedTargetId)

      // Draw weapon in front
      if (facing >= 0 && hasWeapon) {
        this.renderWeapon(buf, offset, flags)
      }
    }

    this.particleSystem.render(this.ctx, this.pixelsPerMeter)

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

  private renderEntity(
    buf: Float32Array,
    offset: number,
    flags: number,
    playerLockedTargetId: number
  ): void {
    const x = buf[offset + OFFSETS.X]
    const y = buf[offset + OFFSETS.Y]
    const radius = buf[offset + OFFSETS.RADIUS] * this.pixelsPerMeter
    const colorInt = buf[offset + OFFSETS.COLOR]
    // const borderColorInt = buf[offset + OFFSETS.BORDER_COLOR]

    const shakeOffset = this.getHitShakeOffset(buf, offset)
    const centerX = (x + shakeOffset.x) * this.pixelsPerMeter
    const centerY = (y + shakeOffset.y) * this.pixelsPerMeter

    const deathScale = this.getDeathScale(buf, offset, flags)
    const alpha = this.getDeathAlpha(buf, offset, flags)

    this.ctx.save()
    this.ctx.translate(centerX, centerY)
    this.ctx.scale(deathScale.x, deathScale.y)
    this.ctx.globalAlpha *= alpha

    const rollAngle = buf[offset + OFFSETS.ROLL_ANGLE]
    if (rollAngle !== 0) {
      this.ctx.rotate(rollAngle)
    }

    // 只有 radius > 0 时才渲染圆圈和眼睛
    if (radius > 0) {
      this.ctx.fillStyle = this.getColorString(colorInt)
      this.ctx.beginPath()
      this.ctx.arc(0, 0, radius, 0, 2 * Math.PI)
      this.ctx.fill()

      this.ctx.strokeStyle = this.getColorString(colorInt)
      this.ctx.lineWidth = 3
      this.ctx.stroke()

      // Eyes
      const eyeRadius = 0.08 * this.pixelsPerMeter
      const eyeOffsetX = radius * 0.5
      const eyeOffsetY = -radius * 0.5

      const direction = buf[offset + OFFSETS.MOVE_DIR]
      const eyeX = direction < 0 ? -eyeOffsetX : eyeOffsetX
      const eyeY = eyeOffsetY

      this.ctx.fillStyle = '#000000'
      this.ctx.beginPath()
      this.ctx.arc(eyeX, eyeY, eyeRadius, 0, 2 * Math.PI)
      this.ctx.fill()
    }

    this.ctx.restore()

    // Status Bars
    const maxHealth = buf[offset + OFFSETS.STATS_HEALTH_MAX]
    const isPlayer = !!(flags & FLAGS.IS_PLAYER)
    const isInCombat = !!(flags & FLAGS.IN_COMBAT)
    const isLocked = buf[offset + OFFSETS.ID] === playerLockedTargetId

    if (maxHealth > 0 && !isPlayer && (isInCombat || isLocked)) {
      this.drawStatusBars(
        buf,
        offset,
        centerX,
        centerY,
        buf[offset + OFFSETS.RADIUS]
      )
    }
  }

  public renderPlayerUI(): void {
    const buf = this.stateBuffer
    let playerOffset = -1

    for (let i = 0; i < this.entityCount; i++) {
      const offset = i * ENTITY_STRIDE
      const flags = buf[offset + OFFSETS.FLAGS]
      if (flags & FLAGS.IS_PLAYER) {
        playerOffset = offset
        break
      }
    }

    if (playerOffset === -1) return

    const flags = buf[playerOffset + OFFSETS.FLAGS]
    if (!(flags & FLAGS.IN_COMBAT)) return

    const health = buf[playerOffset + OFFSETS.STATS_HEALTH]
    const maxHealth = buf[playerOffset + OFFSETS.STATS_HEALTH_MAX]
    const posture = buf[playerOffset + OFFSETS.STATS_POSTURE]
    const maxPosture = buf[playerOffset + OFFSETS.STATS_POSTURE_MAX]

    if (maxHealth <= 0) return

    // UI Configuration
    const startX = 16
    const barHeight = 12
    const spacing = 6
    const startY = this.ctx.canvas.height - (barHeight * 2 + spacing) - 14

    // Scale: 4 pixels per 1 unit of stats (increased by 1/3 from 3)
    const pixelsPerUnit = 4

    const healthWidth = maxHealth * pixelsPerUnit
    const postureWidth = maxPosture * pixelsPerUnit

    // Health Bar
    const healthRatio = health / maxHealth
    this.drawBar(
      startX,
      startY,
      healthWidth,
      barHeight,
      healthRatio,
      '#5a1b1b',
      '#ff4d4f'
    )

    // Posture Bar
    const postureRatio = maxPosture > 0 ? posture / maxPosture : 0
    this.drawBar(
      startX,
      startY + barHeight + spacing,
      postureWidth,
      barHeight,
      postureRatio,
      '#665511',
      '#ffd666'
    )
  }

  private renderWeapon(buf: Float32Array, offset: number, flags: number): void {
    if (flags & FLAGS.DEAD) return
    if (flags & FLAGS.VANISHED) return

    const wx = buf[offset + OFFSETS.WEAPON_X]
    const wy = buf[offset + OFFSETS.WEAPON_Y]
    const wRot = buf[offset + OFFSETS.WEAPON_ROT]
    const wWidth = buf[offset + OFFSETS.WEAPON_W] * this.pixelsPerMeter
    const wHeight = buf[offset + OFFSETS.WEAPON_H] * this.pixelsPerMeter
    const weaponType = buf[offset + OFFSETS.WEAPON_TYPE]
    const bowDraw = buf[offset + OFFSETS.WEAPON_DRAW]
    const bowDrawActive = buf[offset + OFFSETS.WEAPON_DRAW_ACTIVE] === 1

    const isAttacking = !!(flags & FLAGS.WEAPON_ATTACKING)
    const isBlocking = !!(flags & FLAGS.WEAPON_BLOCKING)
    const bodyColor = '#b4bdc7'

    this.ctx.save()
    this.ctx.translate(wx * this.pixelsPerMeter, wy * this.pixelsPerMeter)
    this.ctx.rotate(wRot)

    if (weaponType === WEAPON_TYPES.ARROW) {
      const arrowLen = wWidth
      const lineWidth = Math.max(1, wHeight * 0.9)
      const headLen = Math.max(4, wWidth * 0.18)
      const headWidth = Math.max(4, wHeight * 1.6)
      const tipY = -arrowLen

      this.ctx.strokeStyle = isAttacking ? '#FFFFFF' : bodyColor
      this.ctx.lineWidth = lineWidth

      this.ctx.beginPath()
      this.ctx.moveTo(0, 0)
      this.ctx.lineTo(0, tipY)
      this.ctx.stroke()

      this.ctx.beginPath()
      this.ctx.moveTo(0, tipY)
      this.ctx.lineTo(-headWidth / 2, tipY + headLen)
      this.ctx.moveTo(0, tipY)
      this.ctx.lineTo(headWidth / 2, tipY + headLen)
      this.ctx.stroke()
    } else if (weaponType === WEAPON_TYPES.BOW) {
      const halfLen = wWidth / 2
      const arcDepth = wHeight * 4
      const lineWidth = Math.max(1, wHeight * 0.55)
      const drawRatio = Math.max(0, Math.min(1, bowDraw))
      const pullOffset = drawRatio * wWidth * 0.25
      const stringWidth = Math.max(1, lineWidth * (1 - drawRatio * 0.5))

      this.ctx.strokeStyle = isAttacking ? '#FFFFFF' : bodyColor
      this.ctx.lineWidth = lineWidth

      // Minimal bow: shallow arc + straight string with shared endpoints
      this.ctx.beginPath()
      this.ctx.moveTo(-halfLen, 0)
      this.ctx.quadraticCurveTo(0, -arcDepth, halfLen, 0)
      this.ctx.stroke()

      this.ctx.beginPath()
      this.ctx.lineWidth = stringWidth
      this.ctx.moveTo(-halfLen, 0)
      this.ctx.lineTo(0, pullOffset)
      this.ctx.lineTo(halfLen, 0)
      this.ctx.stroke()

      if (bowDrawActive) {
        const arrowLen = wWidth * 0.9
        const arrowHead = Math.max(4, wHeight * 2.2)
        const arrowHeadWidth = Math.max(4, wHeight * 1.6)
        const arrowTipY = pullOffset - arrowLen

        this.ctx.lineWidth = Math.max(1, wHeight * 0.7)
        this.ctx.beginPath()
        this.ctx.moveTo(0, pullOffset)
        this.ctx.lineTo(0, arrowTipY)
        this.ctx.stroke()

        this.ctx.beginPath()
        this.ctx.moveTo(0, arrowTipY)
        this.ctx.lineTo(-arrowHeadWidth / 2, arrowTipY + arrowHead)
        this.ctx.moveTo(0, arrowTipY)
        this.ctx.lineTo(arrowHeadWidth / 2, arrowTipY + arrowHead)
        this.ctx.stroke()
      }
    } else {
      this.ctx.beginPath()
      const halfLen = wWidth / 2
      const halfThick = wHeight / 2

      // Draw custom shape: Flat base (left), Round tip (right)
      // Top-Left
      this.ctx.moveTo(-halfLen, -halfThick)
      // Top-Right (start of arc)
      this.ctx.lineTo(halfLen - halfThick, -halfThick)
      // Tip Arc (Semicircle at +X end)
      this.ctx.arc(halfLen - halfThick, 0, halfThick, -Math.PI / 2, Math.PI / 2)
      // Bottom-Right (end of arc) is implied
      // Bottom-Left
      this.ctx.lineTo(-halfLen, halfThick)
      // Close
      this.ctx.closePath()

      this.ctx.fillStyle = bodyColor
      // Border matches body unless attacking
      /* if (isBlocking) {
        this.ctx.strokeStyle = '#FFFF00' // Yellow for blocking
      } else { */
      this.ctx.strokeStyle = isAttacking ? '#FFFFFF' : bodyColor
      // }
      this.ctx.lineWidth = 2
      this.ctx.fill()
      this.ctx.stroke()
    }
    this.ctx.restore()
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
    const posture = buf[offset + OFFSETS.STATS_POSTURE]
    const maxPosture = buf[offset + OFFSETS.STATS_POSTURE_MAX]

    const barWidth = 1.1 * this.pixelsPerMeter
    const barHeight = 6
    const spacing = 2
    const startX = centerX - barWidth / 2
    const barTopOffset = 18
    const baseY = centerY - radiusMeters * this.pixelsPerMeter - barTopOffset
    const healthY = baseY
    const postureY = baseY + barHeight + spacing

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

    const postureRatio = maxPosture > 0 ? posture / maxPosture : 0
    this.drawBar(
      startX,
      postureY,
      barWidth,
      barHeight,
      postureRatio,
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
    _buf: Float32Array,
    _offset: number,
    _flags: number
  ): { x: number; y: number } {
    this.tempScale.x = 1
    this.tempScale.y = 1
    return this.tempScale
  }

  private getDeathAlpha(
    _buf: Float32Array,
    _offset: number,
    flags: number
  ): number {
    if (!(flags & FLAGS.DEAD)) return 1
    return 0
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
