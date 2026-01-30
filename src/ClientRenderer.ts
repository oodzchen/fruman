import type { AudioManager } from './AudioManager'
import { BowTrajectoryCalculator } from './BowTrajectory'
import {
  BOW_MAX_DRAW_MS,
  BOW_MIN_FORCE_RATIO,
  BOW_MIN_WINDUP_MS,
  WEAPON_DEFAULT_DATA,
} from './constants'
import {
  DEFAULT_WEAPON_GROUND_ROTATION_RAD,
  DEFAULT_WEAPON_HEIGHT,
  DEFAULT_WEAPON_WIDTH,
} from './constants'
import { renderBody } from './renderer/BodyRenderer'
import { ParticleSystem } from './renderer/ParticleSystem'
import { renderWeapon as renderWeaponShape } from './renderer/WeaponRenderer'
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
import type {
  SensorDebugData,
  SoundListenerDebugData,
  SoundWaveDebugData,
} from './worker/protocol'

const MAX_PARTICLES = 600
const DEBUG_DRAW_TRAJECTORY = false
const RETICLE_EDGE_PX = 8
const BOW_ARROW_LENGTH = DEFAULT_WEAPON_WIDTH * 0.9
const BOW_ARROW_THICKNESS = DEFAULT_WEAPON_HEIGHT * 0.15
const HUD_SLOT_SIZE = 46
const HUD_SLOT_SPACING = 14
const HUD_SLOT_MARGIN = 16
const HUD_SLOT_FILL = 'rgba(0, 0, 0, 0.5)'
const HUD_SLOT_BORDER = 'rgba(255, 255, 255, 0.35)'
const HUD_SLOT_BORDER_ACTIVE = 'rgba(255, 255, 255, 0.75)'
const HUD_ICON_COLOR = '#ffffff'
const HUD_ICON_ALPHA = 0.65
const HUD_ICON_ALPHA_ACTIVE = 0.9
const HUD_AMMO_ALPHA = 0.85
const HUD_ICON_SCALE = 0.6
const HUD_SIZE_BOX = 5
const HUD_SIZE_OUTER_GAP = 0

export class ClientRenderer {
  private ctx: CanvasRenderingContext2D
  private pixelsPerMeter: number
  private camera: { x: number; y: number }
  private zoom: number = 1.0

  private tempOffset = { x: 0, y: 0 }
  private tempScale = { x: 1, y: 1 }
  private viewBounds = { left: 0, right: 0, top: 0, bottom: 0 }
  private reticleClampPos = { x: 0, y: 0 }
  private readonly emptyDash: number[] = []
  private readonly dashedLine: number[] = [5, 5]

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
  private trajectoryCalculator: BowTrajectoryCalculator
  private sensorDebugData: SensorDebugData[] = []
  private soundWaveDebugData: SoundWaveDebugData[] = []
  private soundListenerDebugData: SoundListenerDebugData[] = []
  private ammoTextCache: string[] = []

  constructor(ctx: CanvasRenderingContext2D, pixelsPerMeter: number) {
    this.ctx = ctx
    this.pixelsPerMeter = pixelsPerMeter
    this.camera = { x: 0, y: 0 }
    this.particleSystem = new ParticleSystem(MAX_PARTICLES)
    this.trajectoryCalculator = new BowTrajectoryCalculator()
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
    this.stateBuffer.set(incoming.subarray(0, copyLength), 0)
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

  setSensorDebugData(sensors: SensorDebugData[]): void {
    this.sensorDebugData = sensors
  }

  setSoundDebugData(
    waves: SoundWaveDebugData[],
    listeners: SoundListenerDebugData[]
  ): void {
    this.soundWaveDebugData = waves
    this.soundListenerDebugData = listeners
  }

  setCamera(x: number, y: number, zoom: number = 1.0) {
    this.camera.x = x
    this.camera.y = y
    this.zoom = zoom
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
    let playerFreeAimActive = false
    let playerFreeAimX = 0
    let playerFreeAimY = 0
    let playerX = 0
    let playerY = 0
    let playerDrawRatio = 0
    let playerDrawActive = false
    for (let i = 0; i < this.entityCount; i++) {
      const offset = i * ENTITY_STRIDE
      const flags = buf[offset + OFFSETS.FLAGS]
      if (flags & FLAGS.IS_PLAYER) {
        playerLockedTargetId = buf[offset + OFFSETS.LOCKED_TARGET_ID]
        playerFreeAimActive = buf[offset + OFFSETS.FREE_AIM_ACTIVE] === 1
        playerFreeAimX = buf[offset + OFFSETS.FREE_AIM_X]
        playerFreeAimY = buf[offset + OFFSETS.FREE_AIM_Y]
        playerX = buf[offset + OFFSETS.X]
        playerY = buf[offset + OFFSETS.Y]
        playerDrawRatio = buf[offset + OFFSETS.WEAPON_DRAW]
        playerDrawActive = buf[offset + OFFSETS.WEAPON_DRAW_ACTIVE] === 1
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
    this.drawSensorDebug()
    this.drawSoundDebug()

    // Draw LockOn Reticle
    if (!playerFreeAimActive && playerLockedTargetId !== -1) {
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

    if (playerFreeAimActive) {
      const minForceRatio = Math.max(
        BOW_MIN_FORCE_RATIO,
        Math.min(1, BOW_MIN_WINDUP_MS / BOW_MAX_DRAW_MS)
      )
      const effectiveDrawRatio = playerDrawActive
        ? playerDrawRatio
        : Math.max(playerDrawRatio, minForceRatio)
      if (DEBUG_DRAW_TRAJECTORY) {
        this.drawTrajectory(
          playerX,
          playerY,
          playerFreeAimX,
          playerFreeAimY,
          effectiveDrawRatio
        )
      }
      this.drawFreeAimReticle(
        playerX,
        playerY,
        playerFreeAimX,
        playerFreeAimY,
        effectiveDrawRatio
      )
    }
  }

  private drawLockOnReticle(buf: Float32Array, offset: number): void {
    const x = buf[offset + OFFSETS.X]
    const y = buf[offset + OFFSETS.Y]

    // Shake
    const shakeOffset = this.getHitShakeOffset(buf, offset)
    const centerX = (x + shakeOffset.x) * this.pixelsPerMeter
    const centerY = (y + shakeOffset.y) * this.pixelsPerMeter
    this.drawReticleAt(centerX, centerY)
  }

  private drawFreeAimReticle(
    playerX: number,
    playerY: number,
    reticleX: number,
    reticleY: number,
    drawRatio: number
  ): void {
    const clampedPos = this.clampReticleToViewport(
      playerX,
      playerY,
      reticleX,
      reticleY,
      drawRatio
    )
    const centerX = clampedPos.x * this.pixelsPerMeter
    const centerY = clampedPos.y * this.pixelsPerMeter
    this.drawReticleAt(centerX, centerY)
  }

  private drawReticleAt(centerX: number, centerY: number): void {
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
      const direction = buf[offset + OFFSETS.MOVE_DIR]
      renderBody(
        this.ctx,
        radius,
        this.getColorString(colorInt),
        this.pixelsPerMeter,
        direction
      )
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
    if (
      !(flags & FLAGS.IN_COMBAT) &&
      !(flags & FLAGS.HUD_VISIBLE) &&
      !(flags & FLAGS.DEAD)
    ) {
      return
    }

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

    /*
    // Posture Bar
    const postureWidth = maxPosture * pixelsPerUnit
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
    */
    void posture
    void maxPosture

    this.renderWeaponSlots(playerOffset)
  }

  private renderWeaponSlots(playerOffset: number): void {
    const buf = this.stateBuffer
    const mainHasWeapon = buf[playerOffset + OFFSETS.WEAPON_SLOT_MAIN_HAS] === 1
    const secondaryHasWeapon =
      buf[playerOffset + OFFSETS.WEAPON_SLOT_SECONDARY_HAS] === 1
    const mainType = buf[playerOffset + OFFSETS.WEAPON_SLOT_MAIN_TYPE] | 0
    const secondaryType =
      buf[playerOffset + OFFSETS.WEAPON_SLOT_SECONDARY_TYPE] | 0
    const mainWidth = buf[playerOffset + OFFSETS.WEAPON_SLOT_MAIN_W]
    const mainHeight = buf[playerOffset + OFFSETS.WEAPON_SLOT_MAIN_H]
    const secondaryWidth = buf[playerOffset + OFFSETS.WEAPON_SLOT_SECONDARY_W]
    const secondaryHeight = buf[playerOffset + OFFSETS.WEAPON_SLOT_SECONDARY_H]
    const mainAmmo = buf[playerOffset + OFFSETS.WEAPON_SLOT_MAIN_AMMO] | 0
    const secondaryAmmo =
      buf[playerOffset + OFFSETS.WEAPON_SLOT_SECONDARY_AMMO] | 0
    const mainSize = buf[playerOffset + OFFSETS.WEAPON_SLOT_MAIN_SIZE] | 0
    const secondarySize =
      buf[playerOffset + OFFSETS.WEAPON_SLOT_SECONDARY_SIZE] | 0
    const mainMax = buf[playerOffset + OFFSETS.WEAPON_SLOT_MAIN_MAX] | 0
    const secondaryMax =
      buf[playerOffset + OFFSETS.WEAPON_SLOT_SECONDARY_MAX] | 0
    const activeSlot = buf[playerOffset + OFFSETS.WEAPON_SLOT_ACTIVE] | 0

    const canvasWidth = this.ctx.canvas.width
    const canvasHeight = this.ctx.canvas.height
    const totalWidth = HUD_SLOT_SIZE * 2 + HUD_SLOT_SPACING
    const startX = canvasWidth - HUD_SLOT_MARGIN - totalWidth
    const slotY = canvasHeight - HUD_SLOT_MARGIN - HUD_SLOT_SIZE
    const mainX = startX
    const secondaryX = startX + HUD_SLOT_SIZE + HUD_SLOT_SPACING

    this.drawWeaponSlot(
      mainX,
      slotY,
      HUD_SLOT_SIZE,
      activeSlot === 0,
      mainHasWeapon,
      mainType,
      mainWidth,
      mainHeight,
      mainSize,
      mainMax,
      mainAmmo
    )
    this.drawWeaponSlot(
      secondaryX,
      slotY,
      HUD_SLOT_SIZE,
      activeSlot === 1,
      secondaryHasWeapon,
      secondaryType,
      secondaryWidth,
      secondaryHeight,
      secondarySize,
      secondaryMax,
      secondaryAmmo
    )
  }

  private drawWeaponSlot(
    x: number,
    y: number,
    size: number,
    isActive: boolean,
    hasWeapon: boolean,
    weaponType: number,
    weaponWidth: number,
    weaponHeight: number,
    sizeLevel: number,
    sizeMaxLevel: number,
    ammo: number
  ): void {
    this.ctx.save()
    this.ctx.globalAlpha = 1
    this.ctx.fillStyle = HUD_SLOT_FILL
    const slotBorder = isActive ? HUD_SLOT_BORDER_ACTIVE : HUD_SLOT_BORDER
    this.ctx.strokeStyle = slotBorder
    this.ctx.lineWidth = 2
    this.ctx.fillRect(x, y, size, size)
    this.ctx.strokeRect(x, y, size, size)
    this.drawWeaponSizeIndicator(
      x,
      y,
      size,
      hasWeapon ? sizeLevel : 0,
      hasWeapon ? sizeMaxLevel : 0,
      isActive,
      slotBorder
    )
    if (hasWeapon) {
      const slotWidth = weaponWidth > 0 ? weaponWidth : DEFAULT_WEAPON_WIDTH
      const slotHeight = weaponHeight > 0 ? weaponHeight : DEFAULT_WEAPON_HEIGHT
      const activeScale = isActive ? 1.2 : 1
      const iconMax = size * HUD_ICON_SCALE * activeScale
      const iconScale = iconMax / slotWidth
      const iconWidth = slotWidth * iconScale
      const iconHeight = slotHeight * iconScale
      const centerX = x + size * 0.5
      const centerY = y + size * 0.5

      this.ctx.save()
      this.ctx.translate(centerX, centerY)
      this.ctx.rotate(DEFAULT_WEAPON_GROUND_ROTATION_RAD)
      this.ctx.globalAlpha = isActive ? HUD_ICON_ALPHA_ACTIVE : HUD_ICON_ALPHA
      this.ctx.fillStyle = HUD_ICON_COLOR
      this.ctx.strokeStyle = HUD_ICON_COLOR

      if (weaponType === WEAPON_TYPES.BOW) {
        renderWeaponShape(
          this.ctx,
          'bow',
          iconWidth,
          iconHeight,
          HUD_ICON_COLOR,
          false,
          0
        )

        this.ctx.save()
        this.ctx.rotate(Math.PI / 6)
        const arrowLength = iconWidth * 0.85
        this.drawArrowShape(
          arrowLength,
          iconHeight * 0.2,
          false,
          HUD_ICON_COLOR,
          arrowLength * 0.5
        )
        this.ctx.restore()
      } else {
        const halfLen = iconWidth / 2
        const halfThick = iconHeight / 2

        this.ctx.beginPath()
        this.ctx.moveTo(-halfLen, -halfThick)
        this.ctx.lineTo(halfLen - halfThick, -halfThick)
        this.ctx.arc(
          halfLen - halfThick,
          0,
          halfThick,
          -Math.PI / 2,
          Math.PI / 2
        )
        this.ctx.lineTo(-halfLen, halfThick)
        this.ctx.closePath()

        this.ctx.fill()
        this.ctx.stroke()
      }
      this.ctx.restore()

      if (weaponType === WEAPON_TYPES.BOW) {
        const ammoValue = ammo < 0 ? 0 : ammo
        const ammoText = this.getAmmoText(ammoValue)
        this.ctx.save()
        this.ctx.globalAlpha = HUD_AMMO_ALPHA
        this.ctx.fillStyle = HUD_ICON_COLOR
        this.ctx.font = '12px monospace'
        this.ctx.textAlign = 'right'
        this.ctx.textBaseline = 'bottom'
        this.ctx.fillText(ammoText, x + size - 4, y + size - 2)
        this.ctx.restore()
      }
    }
    this.ctx.restore()
  }

  private drawWeaponSizeIndicator(
    x: number,
    y: number,
    size: number,
    filledCount: number,
    maxCount: number,
    isActive: boolean,
    borderColor: string
  ): void {
    if (maxCount <= 0) return
    const boxHeight = size / maxCount
    const startY = y
    const startX = x - HUD_SIZE_OUTER_GAP - HUD_SIZE_BOX

    this.ctx.save()
    this.ctx.lineWidth = 1
    this.ctx.strokeStyle = borderColor
    this.ctx.fillStyle = HUD_ICON_COLOR
    this.ctx.globalAlpha = HUD_ICON_ALPHA

    for (let i = 0; i < maxCount; i++) {
      const boxY = startY + size - boxHeight * (i + 1)
      this.ctx.fillStyle = HUD_SLOT_FILL
      this.ctx.fillRect(startX, boxY, HUD_SIZE_BOX, boxHeight)
      this.ctx.fillStyle = HUD_ICON_COLOR
      this.ctx.strokeRect(startX, boxY, HUD_SIZE_BOX, boxHeight)
      if (i < filledCount) {
        this.ctx.globalAlpha = isActive ? HUD_ICON_ALPHA_ACTIVE : HUD_ICON_ALPHA
        this.ctx.fillRect(startX, boxY, HUD_SIZE_BOX, boxHeight)
        this.ctx.globalAlpha = HUD_ICON_ALPHA
      }
    }
    this.ctx.restore()
  }

  private getAmmoText(ammo: number): string {
    const cached = this.ammoTextCache[ammo]
    if (cached) return cached
    const text = String(ammo)
    this.ammoTextCache[ammo] = text
    return text
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
    const bowHasArrow = buf[offset + OFFSETS.WEAPON_HAS_ARROW] === 1

    const isAttacking = !!(flags & FLAGS.WEAPON_ATTACKING)
    const isBlocking = !!(flags & FLAGS.WEAPON_BLOCKING)
    const isInCombat = !!(flags & FLAGS.IN_COMBAT)
    const bodyColor = '#b4bdc7'

    this.ctx.save()
    this.ctx.translate(wx * this.pixelsPerMeter, wy * this.pixelsPerMeter)
    this.ctx.rotate(wRot)

    if (weaponType === WEAPON_TYPES.ARROW) {
      this.drawArrowShape(wWidth, wHeight, isAttacking, bodyColor)
    } else if (weaponType === WEAPON_TYPES.BOW) {
      renderWeaponShape(
        this.ctx,
        'bow',
        wWidth,
        wHeight,
        bodyColor,
        isAttacking,
        bowDraw
      )

      const drawRatio = Math.max(0, Math.min(1, bowDraw))
      const pullOffset = drawRatio * wWidth * 0.25

      const shouldShowArrow =
        bowHasArrow && (bowDrawActive || (isInCombat && drawRatio <= 0))
      if (shouldShowArrow) {
        const bowBaseWidthPx =
          WEAPON_DEFAULT_DATA.bow.width * this.pixelsPerMeter
        const bowScale =
          bowBaseWidthPx > 0 ? Math.max(0.5, wWidth / bowBaseWidthPx) : 1
        const arrowLen = BOW_ARROW_LENGTH * this.pixelsPerMeter * bowScale
        const arrowThickness =
          BOW_ARROW_THICKNESS * this.pixelsPerMeter * bowScale
        const arrowBase = bowDrawActive ? pullOffset : 0
        this.drawArrowShape(
          arrowLen,
          arrowThickness,
          isAttacking,
          bodyColor,
          arrowBase
        )
      }
    } else {
      renderWeaponShape(
        this.ctx,
        'sword',
        wWidth,
        wHeight,
        bodyColor,
        isAttacking
      )
    }
    this.ctx.restore()
  }

  private drawArrowShape(
    lengthPx: number,
    thicknessPx: number,
    isAttacking: boolean,
    bodyColor: string,
    baseOffsetY: number = 0
  ): void {
    const lineWidth = Math.max(1, thicknessPx * 0.9)
    const headLen = Math.max(4, lengthPx * 0.18)
    const headWidth = Math.max(4, thicknessPx * 1.6)
    const tipY = baseOffsetY - lengthPx

    this.ctx.strokeStyle = isAttacking ? '#FFFFFF' : bodyColor
    this.ctx.lineWidth = lineWidth

    this.ctx.beginPath()
    this.ctx.moveTo(0, baseOffsetY)
    this.ctx.lineTo(0, tipY)
    this.ctx.stroke()

    this.ctx.beginPath()
    this.ctx.moveTo(0, tipY)
    this.ctx.lineTo(-headWidth / 2, tipY + headLen)
    this.ctx.moveTo(0, tipY)
    this.ctx.lineTo(headWidth / 2, tipY + headLen)
    this.ctx.stroke()
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

    /*
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
    */
    void posture
    void maxPosture
    void postureY
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

  private drawTrajectory(
    playerX: number,
    playerY: number,
    reticleX: number,
    reticleY: number,
    drawRatio: number
  ): void {
    const speed = this.trajectoryCalculator.getBowSpeed(drawRatio) * 1.5
    this.trajectoryCalculator.simulateTrajectory(
      playerX,
      playerY,
      reticleX,
      reticleY,
      speed
    )

    const points = this.trajectoryCalculator.getPoints()
    const count = this.trajectoryCalculator.getPointCount()

    if (count < 2) return

    this.ctx.save()
    this.ctx.strokeStyle = '#00FF00'
    this.ctx.lineWidth = 2
    this.ctx.setLineDash(this.dashedLine)
    this.ctx.globalAlpha = 0.6

    this.ctx.beginPath()
    const firstPoint = points[0]
    this.ctx.moveTo(
      firstPoint.x * this.pixelsPerMeter,
      firstPoint.y * this.pixelsPerMeter
    )

    for (let i = 1; i < count; i++) {
      const point = points[i]
      this.ctx.lineTo(
        point.x * this.pixelsPerMeter,
        point.y * this.pixelsPerMeter
      )
    }

    this.ctx.stroke()

    const viewBounds = this.updateViewBounds()

    this.ctx.strokeStyle = '#FF0000'
    this.ctx.setLineDash(this.emptyDash)
    this.ctx.strokeRect(
      viewBounds.left * this.pixelsPerMeter,
      viewBounds.top * this.pixelsPerMeter,
      (viewBounds.right - viewBounds.left) * this.pixelsPerMeter,
      (viewBounds.bottom - viewBounds.top) * this.pixelsPerMeter
    )

    this.ctx.restore()
  }

  private clampReticleToViewport(
    playerX: number,
    playerY: number,
    reticleX: number,
    reticleY: number,
    weaponDrawRatio: number
  ): { x: number; y: number } {
    const viewBounds = this.updateViewBounds()
    const reticlePadding = this.getReticlePaddingMeters()
    const paddedLeft = viewBounds.left + reticlePadding
    const paddedRight = viewBounds.right - reticlePadding
    const paddedTop = viewBounds.top + reticlePadding
    const paddedBottom = viewBounds.bottom - reticlePadding

    const reticleInView =
      reticleX >= paddedLeft &&
      reticleX <= paddedRight &&
      reticleY >= paddedTop &&
      reticleY <= paddedBottom

    if (reticleInView) {
      this.reticleClampPos.x = reticleX
      this.reticleClampPos.y = reticleY
      return this.reticleClampPos
    }

    const speed = this.trajectoryCalculator.getBowSpeed(weaponDrawRatio) * 1.5
    const intersection = this.trajectoryCalculator.findViewportIntersection(
      playerX,
      playerY,
      reticleX,
      reticleY,
      speed,
      paddedLeft,
      paddedRight,
      paddedTop,
      paddedBottom
    )

    if (intersection) {
      this.reticleClampPos.x = intersection.x
      this.reticleClampPos.y = intersection.y
      return this.reticleClampPos
    }

    this.reticleClampPos.x = reticleX
    this.reticleClampPos.y = reticleY
    return this.reticleClampPos
  }

  private updateViewBounds(): {
    left: number
    right: number
    top: number
    bottom: number
  } {
    const canvasWidth = this.ctx.canvas.width
    const canvasHeight = this.ctx.canvas.height
    const anchorX = canvasWidth * 0.5
    const anchorY = canvasHeight
    const invZoom = 1 / this.zoom
    const camX = this.camera.x * this.pixelsPerMeter
    const camY = this.camera.y * this.pixelsPerMeter

    const leftPx = -anchorX * invZoom + anchorX + camX
    const rightPx = (canvasWidth - anchorX) * invZoom + anchorX + camX
    const topPx = -anchorY * invZoom + anchorY + camY
    const bottomPx = (canvasHeight - anchorY) * invZoom + anchorY + camY

    const invPixelsPerMeter = 1 / this.pixelsPerMeter
    this.viewBounds.left = leftPx * invPixelsPerMeter
    this.viewBounds.right = rightPx * invPixelsPerMeter
    this.viewBounds.top = topPx * invPixelsPerMeter
    this.viewBounds.bottom = bottomPx * invPixelsPerMeter

    return this.viewBounds
  }

  private getReticlePaddingMeters(): number {
    return RETICLE_EDGE_PX / (this.pixelsPerMeter * this.zoom)
  }

  private drawSensorDebug(): void {
    if (this.sensorDebugData.length === 0) return

    const ctx = this.ctx
    const pixelsPerMeter = this.pixelsPerMeter
    const fullCircle = Math.PI * 2
    ctx.save()
    ctx.globalAlpha *= 0.7
    ctx.lineWidth = 1

    for (let i = 0; i < this.sensorDebugData.length; i++) {
      const sensor = this.sensorDebugData[i]
      const centerX = sensor.x * pixelsPerMeter
      const centerY = sensor.y * pixelsPerMeter
      const radius = sensor.radius * pixelsPerMeter

      ctx.setLineDash(this.dashedLine)
      ctx.strokeStyle = '#22cc88'
      ctx.beginPath()
      ctx.arc(centerX, centerY, radius, 0, fullCircle)
      ctx.stroke()

      ctx.setLineDash(this.emptyDash)
      ctx.strokeStyle = '#ffffff'
      const facing = sensor.facing >= 0 ? 1 : -1
      ctx.beginPath()
      ctx.moveTo(centerX, centerY)
      ctx.lineTo(centerX + facing * radius, centerY)
      ctx.stroke()

      const rays = sensor.rays
      for (let r = 0; r < rays.length; r++) {
        const ray = rays[r]
        ctx.strokeStyle = ray.isHostile
          ? '#ff4d4f'
          : ray.hit
            ? '#ffd166'
            : '#4aa3ff'
        ctx.beginPath()
        ctx.moveTo(ray.startX * pixelsPerMeter, ray.startY * pixelsPerMeter)
        ctx.lineTo(ray.endX * pixelsPerMeter, ray.endY * pixelsPerMeter)
        ctx.stroke()

        if (ray.hit) {
          ctx.fillStyle = ctx.strokeStyle
          const hitX = ray.hitX ?? ray.endX
          const hitY = ray.hitY ?? ray.endY
          ctx.beginPath()
          ctx.arc(
            hitX * pixelsPerMeter,
            hitY * pixelsPerMeter,
            2,
            0,
            fullCircle
          )
          ctx.fill()
        }
      }
    }

    ctx.restore()
  }

  private drawSoundDebug(): void {
    if (
      this.soundWaveDebugData.length === 0 &&
      this.soundListenerDebugData.length === 0
    ) {
      return
    }

    const ctx = this.ctx
    const pixelsPerMeter = this.pixelsPerMeter
    const fullCircle = Math.PI * 2
    const baseAlpha = ctx.globalAlpha
    ctx.save()
    ctx.lineWidth = 1
    ctx.globalAlpha = baseAlpha * 0.6

    ctx.setLineDash(this.dashedLine)
    ctx.strokeStyle = '#33b1ff'
    for (let i = 0; i < this.soundListenerDebugData.length; i++) {
      const listener = this.soundListenerDebugData[i]
      const centerX = listener.x * pixelsPerMeter
      const centerY = listener.y * pixelsPerMeter
      const radius = listener.radius * pixelsPerMeter
      ctx.beginPath()
      ctx.arc(centerX, centerY, radius, 0, fullCircle)
      ctx.stroke()
    }

    ctx.setLineDash(this.emptyDash)
    for (let i = 0; i < this.soundWaveDebugData.length; i++) {
      const wave = this.soundWaveDebugData[i]
      const centerX = wave.x * pixelsPerMeter
      const centerY = wave.y * pixelsPerMeter
      const radius = wave.radius * pixelsPerMeter
      const maxRadius = wave.maxRadius * pixelsPerMeter
      const intensity = Math.max(0.2, Math.min(1, wave.db))

      ctx.globalAlpha = baseAlpha * intensity
      ctx.strokeStyle = '#ff9f1a'
      ctx.beginPath()
      ctx.arc(centerX, centerY, radius, 0, fullCircle)
      ctx.stroke()

      ctx.globalAlpha = baseAlpha * intensity * 0.5
      ctx.setLineDash(this.dashedLine)
      ctx.strokeStyle = '#ffcc80'
      ctx.beginPath()
      ctx.arc(centerX, centerY, maxRadius, 0, fullCircle)
      ctx.stroke()
      ctx.setLineDash(this.emptyDash)
    }

    ctx.restore()
  }
}
