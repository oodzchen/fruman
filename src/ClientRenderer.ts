import type { AudioManager } from './AudioManager'
import { BowTrajectoryCalculator } from './BowTrajectory'
import {
  getCharacterBodyColor,
  getCharacterBodyProfileFromMap,
  getCharacterBodyProfileHeight,
  getCharacterBodyProfileWidth,
} from './characterBodyProfile'
import {
  BOW_GRAVITY_SCALE,
  BOW_MAX_DRAW_MS,
  BOW_MIN_FORCE_RATIO,
  BOW_MIN_WINDUP_MS,
  DEATH_CROSS_DURATION_MS,
  DEATH_PRE_SPLATTER_PAUSE_MS,
  DEFAULT_PLAYER_RADIUS,
  GRAPE_GRAVITY_SCALE,
  GRAPE_MAX_SPEED,
  GRAPE_MIN_FORCE_RATIO,
  GRAPE_MIN_SPEED,
  GRAPE_MIN_WINDUP_MS,
  GRAPPLE_ANCHOR_HIGHLIGHT_SCALE,
  WEAPON_DEFAULT_DATA,
} from './constants'
import { DEFAULT_WEAPON_HEIGHT, DEFAULT_WEAPON_WIDTH } from './constants'
import type { EditorMapData } from './editorMapTypes'
import {
  computeDistanceAttenuation,
  getCameraShakeFalloffDistance,
  getSoundFalloffDistance,
} from './effectAttenuation'
import { renderBody } from './renderer/BodyRenderer'
import { renderBodyCached } from './renderer/BodyRenderer'
import {
  HUD_AMMO_ALPHA,
  HUD_ICON_ALPHA,
  HUD_ICON_COLOR,
  HUD_SLOT_MARGIN,
  HUD_SLOT_SIZE,
  HUD_SLOT_SPACING,
  HUD_ULTIMATE_SIZE,
  drawHudUltimateSlot,
  drawHudWeaponSlot,
} from './renderer/HudWeaponSlotRenderer'
import { ParticleSystem } from './renderer/ParticleSystem'
import type { ParticleSnapshot } from './renderer/ParticleSystem'
import type { RenderContext2D } from './renderer/RenderContext2D'
import { renderWeapon as renderWeaponShape } from './renderer/WeaponRenderer'
import { getGrapeChargeRangeScale } from './weaponTypeUtils'
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
  MAX_ROPE_POINTS,
  ROPE_POINTS_BASE_OFFSET,
  ROPE_POINT_STRIDE,
} from './worker/effectsProtocol'
import type {
  SensorDebugData,
  SoundListenerDebugData,
  SoundWaveDebugData,
} from './worker/protocol'

const MAX_PARTICLES = 600
const DEBUG_DRAW_TRAJECTORY = false
const DEBUG_DRAW_GRAPPLE_JOINTS = false
const RETICLE_EDGE_PX = 8
const BOW_ARROW_LENGTH = DEFAULT_WEAPON_WIDTH * 0.9
const BOW_ARROW_THICKNESS = DEFAULT_WEAPON_HEIGHT * 0.15
const GRAPPLE_ICON_COLOR = '#c6b07a'
const GRAPPLE_LINE_COLOR = '#d9c896'
const SUN_COLOR = '#ffd700'
const EXP_COLOR = '#3d7fff'
const FOLLOW_BOUND_BORDER_COLOR = '#ffee58'
const SMALL_SUN_PICKUP_SIZE_NUMERATOR = 35
const LARGE_SUN_PICKUP_SIZE_NUMERATOR = 70
const PICKUP_SIZE_DENOMINATOR = 100
const EXP_ORB_SIZE_NUMERATOR = SMALL_SUN_PICKUP_SIZE_NUMERATOR
const PICKUP_GLOW_SIZE_NUMERATOR = 8
const PICKUP_GLOW_SIZE_DENOMINATOR = 5

export class ClientRenderer {
  private ctx: RenderContext2D
  private worldCtx: RenderContext2D
  private hudCtx: RenderContext2D
  private pixelsPerMeter: number
  private camera: { x: number; y: number }
  private zoom: number = 1.0
  private playerWorldX = 0
  private playerWorldY = 0
  private hasPlayerWorldPosition = false

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
  private ropePointCount = 0
  private ropePointsBuffer = new Float32Array(
    MAX_ROPE_POINTS * ROPE_POINT_STRIDE
  )

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
  private grappleLineActive = false
  private grappleLineAutoHideRemainingMs = 0
  private grappleLineStartedClose = false
  private grappleLineHidden = false
  private cameraShakeElapsedMs = 0
  private cameraShakeDurationMs = 0
  private cameraShakeIntensityPx = 0
  private cameraShakePhaseMs = 0
  private cameraShakeOffsetX = 0
  private cameraShakeOffsetY = 0
  // 血条宽度动画（升级时最大血量增加，血条等比例变长）
  private healthBarDisplayWidth = 0
  private healthBarAnimStartWidth = 0
  private healthBarAnimTargetWidth = 0
  private healthBarAnimElapsedSec = 0
  private lastRenderDeltaSec = 0
  private readonly HEALTH_BAR_ANIM_SEC = 2.0
  private debugEffectTimer = 0
  private handshakeIcon: HTMLImageElement
  private handshakeIconLoaded = false
  private wavingHandIcon: HTMLImageElement
  private wavingHandIconLoaded = false
  private characterBodyMap: EditorMapData | null = null
  private characterBodyTextureCache = new Map<string, HTMLImageElement>()
  private readonly entityFacingCache = new Map<number, number>()
  private readonly dynamicRenderLayers: number[] = []
  private readonly frameRenderLayers: number[] = []

  // HUD dirty detection
  private hudLastHash = -1
  private hudLastCanvasWidth = 0
  private hudLastCanvasHeight = 0
  private hudLastHealthBarWidth = 0

  constructor(
    worldCtx: RenderContext2D,
    hudCtx: RenderContext2D,
    pixelsPerMeter: number
  ) {
    this.ctx = worldCtx
    this.worldCtx = worldCtx
    this.hudCtx = hudCtx
    this.pixelsPerMeter = pixelsPerMeter
    this.camera = { x: 0, y: 0 }
    this.particleSystem = new ParticleSystem(MAX_PARTICLES)
    this.trajectoryCalculator = new BowTrajectoryCalculator()
    this.handshakeIcon = new Image()
    this.handshakeIcon.onload = () => {
      this.handshakeIconLoaded = true
    }
    this.handshakeIcon.src = '/images/handshake_yellow.png'
    this.wavingHandIcon = new Image()
    this.wavingHandIcon.onload = () => {
      this.wavingHandIconLoaded = true
    }
    this.wavingHandIcon.src = '/images/waving_hand.png'
  }

  setAudioManager(audioManager: AudioManager): void {
    this.audioManager = audioManager
  }

  setCharacterBodyMap(map: EditorMapData | null): void {
    this.characterBodyMap = map
  }

  private getCharacterBodyTexture(
    textureDataUrl: string | undefined
  ): HTMLImageElement | null {
    if (!textureDataUrl || textureDataUrl.length === 0) {
      return null
    }
    const cached = this.characterBodyTextureCache.get(textureDataUrl)
    if (cached) {
      return cached
    }
    const image = new Image()
    image.src = textureDataUrl
    this.characterBodyTextureCache.set(textureDataUrl, image)
    return image
  }

  updateState(
    buffer: ArrayBuffer | SharedArrayBuffer,
    count: number,
    ropePointCount: number
  ) {
    if (this.incomingBuffer !== buffer) {
      this.incomingBuffer = buffer
      this.incomingView = new Float32Array(buffer)
    }
    const incoming = this.incomingView
    if (!incoming) return
    const copyLength = count * ENTITY_STRIDE
    this.stateBuffer.set(incoming.subarray(0, copyLength), 0)
    this.entityCount = count
    this.hasPlayerWorldPosition = false
    for (let i = 0; i < count; i++) {
      const offset = i * ENTITY_STRIDE
      const flags = incoming[offset + OFFSETS.FLAGS] | 0
      if ((flags & FLAGS.IS_PLAYER) === 0) continue
      this.playerWorldX = incoming[offset + OFFSETS.X]
      this.playerWorldY = incoming[offset + OFFSETS.Y]
      this.hasPlayerWorldPosition = true
      break
    }
    const clampedRopePointCount =
      ropePointCount < 0
        ? 0
        : ropePointCount > MAX_ROPE_POINTS
          ? MAX_ROPE_POINTS
          : ropePointCount
    this.ropePointCount = clampedRopePointCount
    if (clampedRopePointCount > 0) {
      const ropeFloatCount = clampedRopePointCount * ROPE_POINT_STRIDE
      const ropeStart = ROPE_POINTS_BASE_OFFSET
      this.ropePointsBuffer.set(
        incoming.subarray(ropeStart, ropeStart + ropeFloatCount),
        0
      )
    }
  }

  update(deltaTime: number): void {
    this.particleSystem.update(deltaTime)
    this.updateCameraShake(Math.max(0, (deltaTime * 1000) | 0))
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
      } else if (type === EFFECT_TYPES.HEAL) {
        this.particleSystem.spawnHeal(x, y, color)
      } else if (type === EFFECT_TYPES.CAMERA_SHAKE) {
        const attenuatedIntensity =
          color *
          this.getEventAttenuation(x, y, getCameraShakeFalloffDistance(color))
        this.applyCameraShake(attenuatedIntensity, radius)
      } else if (type === EFFECT_TYPES.SOUND) {
        const soundId = color
        const playbackRate = radius || 1.0
        const volume =
          Number.isFinite(x) && Number.isFinite(y)
            ? this.getEventAttenuation(x, y, getSoundFalloffDistance(soundId))
            : 1.0
        this.audioManager?.play(soundId, volume, playbackRate)
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

  getCameraShakeOffsetX(): number {
    return this.cameraShakeOffsetX
  }

  getCameraShakeOffsetY(): number {
    return this.cameraShakeOffsetY
  }

  getStateBuffer(): Float32Array {
    return this.stateBuffer
  }

  getEntityCount(): number {
    return this.entityCount
  }

  getCanvasWidth(): number {
    return this.hudCtx.canvas.width
  }

  getCanvasHeight(): number {
    return this.hudCtx.canvas.height
  }

  getRopePointCount(): number {
    return this.ropePointCount
  }

  getRopePointsBuffer(): Float32Array {
    return this.ropePointsBuffer
  }

  getParticleSystem(): ParticleSystem {
    return this.particleSystem
  }

  getActiveParticleCount(): number {
    return this.particleSystem.getActiveParticleCount()
  }

  getActiveParticle(index: number): ParticleSnapshot | null {
    return this.particleSystem.getActiveParticle(index)
  }

  getCharacterBodyProfile(index: number) {
    return getCharacterBodyProfileFromMap(this.characterBodyMap, index)
  }

  getCharacterBodyTextureSource(
    textureDataUrl: string | undefined
  ): HTMLImageElement | null {
    return this.getCharacterBodyTexture(textureDataUrl)
  }

  getColorHex(colorInt: number): string {
    return this.getColorString(colorInt)
  }

  getFacingForEntity(buf: Float32Array, offset: number): number {
    return this.getEntityFacing(buf, offset)
  }

  getClampedReticlePosition(
    playerX: number,
    playerY: number,
    reticleX: number,
    reticleY: number,
    weaponDrawRatio: number,
    weaponType: number
  ): { x: number; y: number } {
    return this.clampReticleToViewport(
      playerX,
      playerY,
      reticleX,
      reticleY,
      weaponDrawRatio,
      weaponType
    )
  }

  getEffectiveRangedDrawRatio(
    weaponType: number,
    drawRatio: number,
    drawActive: boolean
  ): number {
    if (drawActive) {
      return drawRatio
    }
    return Math.max(drawRatio, this.getRangedMinForceRatio(weaponType))
  }

  private applyCameraShake(intensityPx: number, durationMs: number): void {
    if (intensityPx <= 0 || durationMs <= 0) return
    this.cameraShakeIntensityPx = Math.max(
      this.cameraShakeIntensityPx,
      intensityPx
    )
    this.cameraShakeDurationMs = Math.max(
      this.cameraShakeDurationMs,
      durationMs
    )
    this.cameraShakeElapsedMs = 0
  }

  private updateCameraShake(deltaMs: number): void {
    if (this.cameraShakeDurationMs <= 0 || deltaMs <= 0) {
      if (this.cameraShakeDurationMs <= 0) {
        this.cameraShakeOffsetX = 0
        this.cameraShakeOffsetY = 0
      }
      return
    }

    this.cameraShakeElapsedMs += deltaMs
    this.cameraShakePhaseMs += deltaMs
    if (this.cameraShakeElapsedMs >= this.cameraShakeDurationMs) {
      this.cameraShakeElapsedMs = 0
      this.cameraShakeDurationMs = 0
      this.cameraShakeIntensityPx = 0
      this.cameraShakeOffsetX = 0
      this.cameraShakeOffsetY = 0
      return
    }

    const progress = this.cameraShakeElapsedMs / this.cameraShakeDurationMs
    const decay = 1 - progress
    const phaseA = (this.cameraShakePhaseMs * 30) / 1000
    const phaseB = (this.cameraShakePhaseMs * 47) / 1000
    this.cameraShakeOffsetX =
      Math.sin(phaseA * Math.PI * 2) * this.cameraShakeIntensityPx * decay
    this.cameraShakeOffsetY =
      Math.cos(phaseB * Math.PI * 2) * this.cameraShakeIntensityPx * decay * 0.7
  }

  private getEventAttenuation(
    sourceX: number,
    sourceY: number,
    maxDistance: number
  ): number {
    if (!this.hasPlayerWorldPosition) {
      return 1
    }
    return computeDistanceAttenuation(
      this.playerWorldX,
      this.playerWorldY,
      sourceX,
      sourceY,
      maxDistance
    )
  }

  private getColorString(colorInt: number): string {
    const cached = this.colorCache.get(colorInt)
    if (cached) return cached
    const str = `#${colorInt.toString(16).padStart(6, '0')}`
    this.colorCache.set(colorInt, str)
    return str
  }

  private insertSortedUniqueLayer(target: number[], layer: number): void {
    for (let i = 0; i < target.length; i++) {
      const current = target[i]
      if (current === layer) {
        return
      }
      if (current > layer) {
        target.splice(i, 0, layer)
        return
      }
    }
    target.push(layer)
  }

  private getEntityRenderLayer(buf: Float32Array, offset: number): number {
    return buf[offset + OFFSETS.RENDER_LAYER] | 0
  }

  render(
    deltaMs: number,
    staticLayers: readonly number[] = [],
    drawStaticLayer?: (layer: number) => void
  ) {
    this.ctx = this.worldCtx
    this.lastRenderDeltaSec = deltaMs / 1000
    if (
      this.entityCount === 0 &&
      staticLayers.length === 0 &&
      !this.particleSystem.hasActiveParticles()
    )
      return
    const buf = this.stateBuffer

    // First pass: Find Player (Check for IS_PLAYER flag)
    let playerOffset = -1
    let playerLockedTargetId = -1
    let playerFreeAimActive = false
    let playerFreeAimX = 0
    let playerFreeAimY = 0
    let playerX = 0
    let playerY = 0
    let playerDrawRatio = 0
    let playerDrawActive = false
    let playerWeaponType: number = WEAPON_TYPES.SWORD
    let playerGrappleActive = false
    let playerGrappleTargetX = 0
    let playerGrappleTargetY = 0
    let playerGrappleStartX = 0
    let playerGrappleStartY = 0
    let playerGrappleVx = 0
    let playerGrappleVy = 0
    let playerRenderLayer = 0
    for (let i = 0; i < this.entityCount; i++) {
      const offset = i * ENTITY_STRIDE
      const flags = buf[offset + OFFSETS.FLAGS]
      if (flags & FLAGS.IS_PLAYER) {
        playerOffset = offset
        playerLockedTargetId = buf[offset + OFFSETS.LOCKED_TARGET_ID]
        playerFreeAimActive = buf[offset + OFFSETS.FREE_AIM_ACTIVE] === 1
        playerFreeAimX = buf[offset + OFFSETS.FREE_AIM_X]
        playerFreeAimY = buf[offset + OFFSETS.FREE_AIM_Y]
        playerX = buf[offset + OFFSETS.X]
        playerY = buf[offset + OFFSETS.Y]
        playerDrawRatio = buf[offset + OFFSETS.WEAPON_DRAW]
        playerDrawActive = buf[offset + OFFSETS.WEAPON_DRAW_ACTIVE] === 1
        playerWeaponType = buf[offset + OFFSETS.WEAPON_TYPE]
        playerGrappleActive = buf[offset + OFFSETS.GRAPPLE_ACTIVE] === 1
        playerGrappleTargetX = buf[offset + OFFSETS.GRAPPLE_TARGET_X]
        playerGrappleTargetY = buf[offset + OFFSETS.GRAPPLE_TARGET_Y]
        playerGrappleStartX = buf[offset + OFFSETS.GRAPPLE_START_X]
        playerGrappleStartY = buf[offset + OFFSETS.GRAPPLE_START_Y]
        playerGrappleVx = buf[offset + OFFSETS.GRAPPLE_VX]
        playerGrappleVy = buf[offset + OFFSETS.GRAPPLE_VY]
        playerRenderLayer = this.getEntityRenderLayer(buf, offset)
        break
      }
    }

    let shouldDrawGrappleLine = false
    if (playerGrappleActive) {
      const playerPxX = Math.round(playerX * this.pixelsPerMeter)
      const playerPxY = Math.round(playerY * this.pixelsPerMeter)
      const targetPxX = Math.round(playerGrappleTargetX * this.pixelsPerMeter)
      const targetPxY = Math.round(playerGrappleTargetY * this.pixelsPerMeter)
      const dx = targetPxX - playerPxX
      const dy = targetPxY - playerPxY
      const distSq = dx * dx + dy * dy
      const diameterPx = Math.round(
        DEFAULT_PLAYER_RADIUS * 2 * this.pixelsPerMeter
      )
      const thresholdSq = diameterPx * diameterPx
      const isClose = distSq <= thresholdSq

      if (!this.grappleLineActive) {
        if (isClose) {
          this.grappleLineAutoHideRemainingMs = 500
          this.grappleLineStartedClose = true
          this.grappleLineHidden = false
        } else {
          this.grappleLineAutoHideRemainingMs = 0
          this.grappleLineStartedClose = false
          this.grappleLineHidden = false
        }
      }

      if (this.grappleLineAutoHideRemainingMs > 0) {
        this.grappleLineAutoHideRemainingMs =
          this.grappleLineAutoHideRemainingMs > deltaMs
            ? this.grappleLineAutoHideRemainingMs - deltaMs
            : 0
        shouldDrawGrappleLine = true
      } else if (this.grappleLineStartedClose) {
        this.grappleLineHidden = true
      }

      if (!this.grappleLineHidden && !this.grappleLineStartedClose && isClose) {
        this.grappleLineHidden = true
      } else if (this.grappleLineHidden && !isClose) {
        this.grappleLineHidden = false
      }

      if (
        !this.grappleLineHidden &&
        this.grappleLineAutoHideRemainingMs === 0
      ) {
        shouldDrawGrappleLine = true
      }
      this.grappleLineActive = true
    } else {
      this.grappleLineActive = false
      this.grappleLineAutoHideRemainingMs = 0
      this.grappleLineStartedClose = false
      this.grappleLineHidden = false
    }

    this.dynamicRenderLayers.length = 0
    for (let i = 0; i < this.entityCount; i++) {
      const offset = i * ENTITY_STRIDE
      const flags = buf[offset + OFFSETS.FLAGS]
      if (flags & FLAGS.VANISHED) continue
      if (!(flags & FLAGS.VISIBLE)) continue
      this.insertSortedUniqueLayer(
        this.dynamicRenderLayers,
        this.getEntityRenderLayer(buf, offset)
      )
    }
    this.frameRenderLayers.length = 0
    for (let i = 0; i < staticLayers.length; i++) {
      this.insertSortedUniqueLayer(this.frameRenderLayers, staticLayers[i] | 0)
    }
    for (let i = 0; i < this.dynamicRenderLayers.length; i++) {
      this.insertSortedUniqueLayer(
        this.frameRenderLayers,
        this.dynamicRenderLayers[i]
      )
    }

    for (
      let layerIndex = 0;
      layerIndex < this.frameRenderLayers.length;
      layerIndex++
    ) {
      const layer = this.frameRenderLayers[layerIndex]
      if (drawStaticLayer) {
        drawStaticLayer(layer)
      }
      if (shouldDrawGrappleLine && layer === playerRenderLayer) {
        const hasRopePoints =
          this.ropePointCount > 1 &&
          this.incomingView !== null &&
          playerGrappleActive
        if (hasRopePoints) {
          this.drawGrappleRopePoints()
        } else {
          this.drawGrappleLine(
            playerX,
            playerY,
            playerGrappleTargetX,
            playerGrappleTargetY
          )
        }
      }
      for (let i = 0; i < this.entityCount; i++) {
        const offset = i * ENTITY_STRIDE
        const flags = buf[offset + OFFSETS.FLAGS]
        if (flags & FLAGS.VANISHED) continue
        if (!(flags & FLAGS.VISIBLE)) continue
        if (this.getEntityRenderLayer(buf, offset) !== layer) continue

        const facing = this.getEntityFacing(buf, offset)
        const hasWeapon = buf[offset + OFFSETS.WEAPON_ACTIVE] === 1
        const inUltimate =
          !!(flags & FLAGS.IS_PLAYER) &&
          buf[offset + OFFSETS.ULTIMATE_SWORD_ACTIVE] >= 1

        if (facing < 0 && hasWeapon && !inUltimate) {
          this.renderWeapon(buf, offset, flags)
        }
        this.renderEntity(buf, offset, flags, playerLockedTargetId)
        if (facing >= 0 && hasWeapon && !inUltimate) {
          this.renderWeapon(buf, offset, flags)
        }
      }

      if (
        layer === playerRenderLayer &&
        playerOffset !== -1 &&
        buf[playerOffset + OFFSETS.ULTIMATE_SWORD_ACTIVE] >= 1
      ) {
        const playerFlags = buf[playerOffset + OFFSETS.FLAGS]
        this.renderWeapon(buf, playerOffset, playerFlags)
        this.renderUltimateSword(playerOffset)
        this.renderHammerUltimateShockwave(playerOffset)
        this.renderSpearUltimatePhantoms(playerOffset)
      }
    }
    this.particleSystem.render(this.ctx, this.pixelsPerMeter)
    this.drawSensorDebug()
    this.drawSoundDebug()

    // Draw follow bond icons
    if (playerOffset !== -1) {
      for (let i = 0; i < this.entityCount; i++) {
        const offset = i * ENTITY_STRIDE
        const flags = buf[offset + OFFSETS.FLAGS]
        if (!(flags & FLAGS.IS_FOLLOWING)) continue
        if (flags & FLAGS.VANISHED) continue
        const npcX = buf[offset + OFFSETS.X]
        const npcY = buf[offset + OFFSETS.Y]
        const npcRadius = buf[offset + OFFSETS.RADIUS]
        const midX = ((playerX + npcX) / 2) * this.pixelsPerMeter
        const baseY =
          (Math.min(playerY, npcY) - npcRadius) * this.pixelsPerMeter - 42
        // progress: 1.0(刚开始) → 0.0(结束)，elapsed = (1-progress)*1200
        const progress = buf[offset + OFFSETS.FOLLOW_FLASH_PROGRESS]
        const elapsed = (1 - progress) * 1200
        // 上升阶段 0-300ms：从 +15px 下方升到最终位置
        const riseOffset =
          elapsed < 300 ? Math.round(15 * (1 - elapsed / 300)) : 0
        // 消失阶段 800-1200ms：alpha 从 1 渐变到 0
        const alpha = elapsed > 800 ? (1200 - elapsed) / 400 : 1
        this.drawFollowBondIcon(midX, baseY + riseOffset, alpha)
      }
    }

    // Draw follow unbond icons
    for (let i = 0; i < this.entityCount; i++) {
      const offset = i * ENTITY_STRIDE
      const unbondProgress = buf[offset + OFFSETS.UNBOND_FLASH_PROGRESS]
      if (unbondProgress <= 0) continue
      const flags = buf[offset + OFFSETS.FLAGS]
      if (flags & FLAGS.VANISHED) continue
      const npcX = buf[offset + OFFSETS.X]
      const npcY = buf[offset + OFFSETS.Y]
      const npcRadius = buf[offset + OFFSETS.RADIUS]
      const cx = npcX * this.pixelsPerMeter
      const baseY = (npcY - npcRadius) * this.pixelsPerMeter - 42
      const elapsed = (1 - unbondProgress) * 1200
      const riseOffset =
        elapsed < 300 ? Math.round(15 * (1 - elapsed / 300)) : 0
      const alpha = elapsed > 800 ? (1200 - elapsed) / 400 : 1
      this.drawFollowUnbondIcon(cx, baseY + riseOffset, alpha)
    }

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
      const minForceRatio = this.getRangedMinForceRatio(playerWeaponType)
      const effectiveDrawRatio = playerDrawActive
        ? playerDrawRatio
        : Math.max(playerDrawRatio, minForceRatio)
      if (DEBUG_DRAW_TRAJECTORY) {
        this.drawTrajectory(
          playerX,
          playerY,
          playerFreeAimX,
          playerFreeAimY,
          effectiveDrawRatio,
          playerWeaponType
        )
      }
      this.drawFreeAimReticle(
        playerX,
        playerY,
        playerFreeAimX,
        playerFreeAimY,
        effectiveDrawRatio,
        playerWeaponType
      )
    }
  }

  private drawFollowBondIcon(cx: number, cy: number, alpha: number): void {
    if (!this.handshakeIconLoaded) return
    const ctx = this.ctx
    ctx.save()
    ctx.globalAlpha = alpha
    const size = 20
    ctx.drawImage(this.handshakeIcon, cx - size / 2, cy - size / 2, size, size)
    ctx.restore()
  }

  private drawFollowUnbondIcon(cx: number, cy: number, alpha: number): void {
    if (!this.wavingHandIconLoaded) return
    const ctx = this.ctx
    ctx.save()
    ctx.globalAlpha = alpha
    const size = 20
    ctx.drawImage(this.wavingHandIcon, cx - size / 2, cy - size / 2, size, size)
    ctx.restore()
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
    drawRatio: number,
    weaponType: number
  ): void {
    const clampedPos = this.clampReticleToViewport(
      playerX,
      playerY,
      reticleX,
      reticleY,
      drawRatio,
      weaponType
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
    if (flags & FLAGS.EXP_ORB) {
      this.drawExpOrbIcon(buf[offset + OFFSETS.X], buf[offset + OFFSETS.Y])
      return
    }
    if (flags & FLAGS.SUN_PICKUP_SMALL) {
      this.drawSunPickupIcon(
        buf[offset + OFFSETS.X],
        buf[offset + OFFSETS.Y],
        false
      )
      return
    }
    if (flags & FLAGS.SUN_PICKUP_LARGE) {
      this.drawSunPickupIcon(
        buf[offset + OFFSETS.X],
        buf[offset + OFFSETS.Y],
        true
      )
      return
    }
    if (flags & FLAGS.GRAPPLE_ANCHOR) {
      this.renderGrappleAnchor(buf, offset, flags)
      return
    }
    if (flags & FLAGS.CHECKPOINT) {
      this.renderCheckpoint(buf, offset, flags)
      return
    }
    const isStandaloneWeapon =
      buf[offset + OFFSETS.WEAPON_ACTIVE] === 1 &&
      buf[offset + OFFSETS.STATS_HEALTH_MAX] <= 0
    if (isStandaloneWeapon) {
      return
    }

    const x = buf[offset + OFFSETS.X]
    const y = buf[offset + OFFSETS.Y]
    const radius = buf[offset + OFFSETS.RADIUS] * this.pixelsPerMeter
    const colorInt = buf[offset + OFFSETS.COLOR]
    const hasFollowBound = !!(flags & FLAGS.FOLLOW_BOUND)

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
    const bodyHeightPx = buf[offset + OFFSETS.BODY_HEIGHT] * this.pixelsPerMeter
    const bodyProfileIndex = buf[offset + OFFSETS.BODY_PROFILE_INDEX] | 0
    const bodyProfile = getCharacterBodyProfileFromMap(
      this.characterBodyMap,
      bodyProfileIndex
    )
    const bodyTexture = this.getCharacterBodyTexture(
      bodyProfile?.textureDataUrl ?? bodyProfile?.surfaceDataUrl
    )
    const profileWidthPx =
      getCharacterBodyProfileWidth(bodyProfile) > 0
        ? getCharacterBodyProfileWidth(bodyProfile) * this.pixelsPerMeter
        : 0
    const profileHeightPx =
      getCharacterBodyProfileHeight(bodyProfile) > 0
        ? getCharacterBodyProfileHeight(bodyProfile) * this.pixelsPerMeter
        : 0
    const bodyRenderHalfWidthPx =
      profileWidthPx > 0 ? profileWidthPx * 0.5 : radius
    const bodyRenderHalfHeightPx =
      profileHeightPx > 0
        ? profileHeightPx * 0.5
        : bodyHeightPx > 0
          ? bodyHeightPx * 0.5
          : radius
    if (rollAngle !== 0) {
      if (bodyRenderHalfWidthPx > 0) {
        // 非圆形体型旋转时，调整 Y 偏移使视觉最低点始终贴在物理底部
        // 椭圆旋转后最低点 = sqrt(rx² * sin²θ + ry² * cos²θ)
        if (bodyRenderHalfHeightPx !== bodyRenderHalfWidthPx) {
          const sinA = Math.sin(rollAngle)
          const cosA = Math.cos(rollAngle)
          const rotatedLow = Math.sqrt(
            bodyRenderHalfWidthPx * bodyRenderHalfWidthPx * sinA * sinA +
              bodyRenderHalfHeightPx * bodyRenderHalfHeightPx * cosA * cosA
          )
          this.ctx.translate(0, bodyRenderHalfHeightPx - rotatedLow)
        }
      }
      this.ctx.rotate(rollAngle)
    }

    // 只有 radius > 0 时才渲染圆圈和眼睛
    if (radius > 0) {
      const direction = this.getEntityFacing(buf, offset)
      const outlineWidthPx = hasFollowBound ? Math.max(1, radius >> 3) : 0
      const bodyColor = getCharacterBodyColor(
        bodyProfile,
        this.getColorString(colorInt)
      )
      renderBodyCached(
        this.ctx,
        radius,
        bodyColor,
        this.pixelsPerMeter,
        direction,
        bodyHeightPx || undefined,
        hasFollowBound ? FOLLOW_BOUND_BORDER_COLOR : '',
        outlineWidthPx,
        bodyProfile,
        bodyTexture,
        true,
        '#000000',
        String(bodyProfileIndex),
        [
          bodyProfile?.textureDataUrl ?? '',
          bodyProfile?.surfaceDataUrl ?? '',
          bodyProfile?.layers?.length ?? 0,
        ].join('|')
      )
    }

    this.ctx.restore()

    this.renderDeathCross(buf, offset, flags, centerX, centerY, radius)

    // Status Bars
    const maxHealth = buf[offset + OFFSETS.STATS_HEALTH_MAX]
    const isPlayer = !!(flags & FLAGS.IS_PLAYER)
    const isInCombat = !!(flags & FLAGS.IN_COMBAT)
    const isLocked = buf[offset + OFFSETS.ID] === playerLockedTargetId
    const isHealthBarFlash = !!(flags & FLAGS.HEALTH_BAR_FLASH)

    if (
      maxHealth > 0 &&
      !isPlayer &&
      (isInCombat || isLocked || isHealthBarFlash)
    ) {
      this.drawStatusBars(
        buf,
        offset,
        centerX,
        centerY,
        buf[offset + OFFSETS.RADIUS]
      )
    }
  }

  private getEntityFacing(buf: Float32Array, offset: number): number {
    const rawFacing = buf[offset + OFFSETS.MOVE_DIR]
    const entityId = buf[offset + OFFSETS.ID] | 0

    if (rawFacing < 0) {
      this.entityFacingCache.set(entityId, -1)
      return -1
    }
    if (rawFacing > 0) {
      this.entityFacingCache.set(entityId, 1)
      return 1
    }

    const cachedFacing = this.entityFacingCache.get(entityId)
    if (cachedFacing === -1 || cachedFacing === 1) {
      return cachedFacing
    }

    if (buf[offset + OFFSETS.WEAPON_ACTIVE] === 1) {
      const entityX = buf[offset + OFFSETS.X]
      const weaponX = buf[offset + OFFSETS.WEAPON_X]
      if (weaponX < entityX) {
        this.entityFacingCache.set(entityId, -1)
        return -1
      }
      if (weaponX > entityX) {
        this.entityFacingCache.set(entityId, 1)
        return 1
      }
    }

    this.entityFacingCache.set(entityId, 1)
    return 1
  }

  private renderCheckpoint(
    buf: Float32Array,
    offset: number,
    flags: number
  ): void {
    const x = buf[offset + OFFSETS.X]
    const y = buf[offset + OFFSETS.Y]
    const radius = buf[offset + OFFSETS.RADIUS] * this.pixelsPerMeter
    const colorInt = buf[offset + OFFSETS.COLOR]
    const trunkColorInt = buf[offset + OFFSETS.BORDER_COLOR]

    const shakeOffset = this.getHitShakeOffset(buf, offset)
    const centerX = (x + shakeOffset.x) * this.pixelsPerMeter
    const centerY = (y + shakeOffset.y) * this.pixelsPerMeter

    const alpha = this.getDeathAlpha(buf, offset, flags)

    this.ctx.save()
    this.ctx.translate(centerX, centerY)
    this.ctx.globalAlpha *= alpha

    const canopyRadiusX = radius * 1.1
    const canopyRadiusY = radius * 0.8
    const canopyOffsetY = -radius * 0.6
    const trunkHeight = radius * 1.2
    const trunkTopWidth = radius * 0.6
    const trunkBottomWidth = radius

    this.ctx.fillStyle = this.getColorString(colorInt)
    this.ctx.beginPath()
    this.ctx.ellipse(
      0,
      canopyOffsetY,
      canopyRadiusX,
      canopyRadiusY,
      0,
      0,
      Math.PI * 2
    )
    this.ctx.fill()

    this.ctx.fillStyle = this.getColorString(trunkColorInt)
    this.ctx.beginPath()
    this.ctx.moveTo(-trunkTopWidth, 0)
    this.ctx.lineTo(trunkTopWidth, 0)
    this.ctx.lineTo(trunkBottomWidth, trunkHeight)
    this.ctx.lineTo(-trunkBottomWidth, trunkHeight)
    this.ctx.closePath()
    this.ctx.fill()

    this.ctx.restore()
  }

  private renderGrappleAnchor(
    buf: Float32Array,
    offset: number,
    flags: number
  ): void {
    const x = buf[offset + OFFSETS.X]
    const y = buf[offset + OFFSETS.Y]
    const radius = buf[offset + OFFSETS.RADIUS] * this.pixelsPerMeter
    const colorInt = buf[offset + OFFSETS.COLOR]
    const borderColorInt = buf[offset + OFFSETS.BORDER_COLOR]

    const shakeOffset = this.getHitShakeOffset(buf, offset)
    const centerX = (x + shakeOffset.x) * this.pixelsPerMeter
    const centerY = (y + shakeOffset.y) * this.pixelsPerMeter

    const alpha = this.getDeathAlpha(buf, offset, flags)

    const highlightScale =
      flags & FLAGS.GRAPPLE_ANCHOR_HIGHLIGHT
        ? GRAPPLE_ANCHOR_HIGHLIGHT_SCALE
        : 1
    const ringRadius = Math.max(3, Math.round(radius * 0.7 * highlightScale))
    const strokeWidth = Math.max(2, Math.round(ringRadius * 0.18))
    const dotRadius = Math.max(2, Math.round(ringRadius * 0.2))

    this.ctx.save()
    this.ctx.translate(centerX, centerY)
    this.ctx.globalAlpha *= alpha

    this.ctx.strokeStyle = this.getColorString(colorInt)
    this.ctx.lineWidth = strokeWidth
    this.ctx.beginPath()
    this.ctx.arc(0, 0, ringRadius, 0, Math.PI * 2)
    this.ctx.stroke()

    this.ctx.fillStyle = this.getColorString(borderColorInt)
    this.ctx.beginPath()
    this.ctx.arc(0, 0, dotRadius, 0, Math.PI * 2)
    this.ctx.fill()

    this.ctx.restore()
  }

  private static readonly HUD_HASH_OFFSETS = [
    OFFSETS.FLAGS,
    OFFSETS.STATS_HEALTH_MAX,
    OFFSETS.STATS_HEALTH,
    OFFSETS.STATS_POSTURE_MAX,
    OFFSETS.STATS_POSTURE,
    OFFSETS.SOLAR_SMALL,
    OFFSETS.SOLAR_LARGE,
    OFFSETS.SOLAR_LARGE_MAX,
    OFFSETS.PLAYER_EXP_RATIO100,
    OFFSETS.WEAPON_SLOT_MAIN_HAS,
    OFFSETS.WEAPON_SLOT_MAIN_TYPE,
    OFFSETS.WEAPON_SLOT_MAIN_W,
    OFFSETS.WEAPON_SLOT_MAIN_H,
    OFFSETS.WEAPON_SLOT_MAIN_AMMO,
    OFFSETS.WEAPON_SLOT_SECONDARY_HAS,
    OFFSETS.WEAPON_SLOT_SECONDARY_TYPE,
    OFFSETS.WEAPON_SLOT_SECONDARY_W,
    OFFSETS.WEAPON_SLOT_SECONDARY_H,
    OFFSETS.WEAPON_SLOT_SECONDARY_AMMO,
    OFFSETS.WEAPON_SLOT_ACTIVE,
    OFFSETS.WEAPON_SLOT_MAIN_SIZE,
    OFFSETS.WEAPON_SLOT_SECONDARY_SIZE,
    OFFSETS.WEAPON_SLOT_MAIN_MAX,
    OFFSETS.WEAPON_SLOT_SECONDARY_MAX,
    OFFSETS.ULTIMATE_COOLDOWN_RATIO,
    OFFSETS.ULTIMATE_READY,
    OFFSETS.ULTIMATE_SWORD_ACTIVE,
    OFFSETS.ULTIMATE_FLASH_TIMER100,
    OFFSETS.HAMMER_ULTIMATE_ACTIVE,
    OFFSETS.HAMMER_ULTIMATE_IMPACT100,
    OFFSETS.SPEAR_ULTIMATE_ACTIVE,
    OFFSETS.SPEAR_ULTIMATE_ALPHA100,
  ]

  isHudDirty(canvasWidth: number, canvasHeight: number): boolean {
    if (
      canvasWidth !== this.hudLastCanvasWidth ||
      canvasHeight !== this.hudLastCanvasHeight
    ) {
      return true
    }
    if (this.healthBarDisplayWidth !== this.hudLastHealthBarWidth) {
      return true
    }
    const buf = this.stateBuffer
    const playerOffset = this.findPlayerOffset()
    if (playerOffset === -1) {
      return this.hudLastHash !== 0
    }
    const offsets = ClientRenderer.HUD_HASH_OFFSETS
    let hash = 0x811c9dc5
    for (let i = 0; i < offsets.length; i++) {
      const bits = (buf[playerOffset + offsets[i]] * 1000) | 0
      hash = Math.imul(hash ^ bits, 0x01000193)
    }
    hash = (hash >>> 0) | 0
    if (hash === this.hudLastHash) {
      return false
    }
    this.hudLastHash = hash
    return true
  }

  private findPlayerOffset(): number {
    const buf = this.stateBuffer
    for (let i = 0; i < this.entityCount; i++) {
      const offset = i * ENTITY_STRIDE
      if (buf[offset + OFFSETS.FLAGS] & FLAGS.IS_PLAYER) {
        return offset
      }
    }
    return -1
  }

  public renderPlayerUI(): void {
    this.ctx = this.hudCtx
    const buf = this.stateBuffer
    const playerOffset = this.findPlayerOffset()

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
    const solarSmall = buf[playerOffset + OFFSETS.SOLAR_SMALL] | 0
    const solarLarge = buf[playerOffset + OFFSETS.SOLAR_LARGE] | 0
    const solarLargeMax = buf[playerOffset + OFFSETS.SOLAR_LARGE_MAX] | 0
    const expRatio100 = buf[playerOffset + OFFSETS.PLAYER_EXP_RATIO100] | 0

    if (maxHealth <= 0) return

    // UI Configuration
    const canvasWidth = this.ctx.canvas.width
    const canvasHeight = this.ctx.canvas.height

    // Weapon Slots Layout (Right side)
    const weaponSlotSize = HUD_SLOT_SIZE
    const weaponTotalWidth = weaponSlotSize * 2 + HUD_SLOT_SPACING
    const slotY = canvasHeight - HUD_SLOT_MARGIN - weaponSlotSize

    // Health Bar & Exp Bar & Grapple Icon Layout (Left side)
    const barHeight = 12
    const expBarHeight = 6
    const expBarGap = 3
    const iconSize = 10
    const iconGap = 6

    // Sun icon dimensions
    const sunIconSize = 42
    const sunIconGap = 16 // gap between sun icon right edge and health bar
    const leftMargin = 16 // distance from screen left edge to sun icon left edge
    // Health bar starts after sun icon + gap
    const startX = leftMargin + sunIconSize + sunIconGap

    // Calculate total height of left UI group (HealthBar + ExpBar + Gap + Icon)
    const leftGroupHeight =
      barHeight + expBarGap + expBarHeight + iconGap + iconSize

    // Center left group vertically relative to right weapon slots
    const weaponCenterY = slotY + weaponSlotSize / 2
    const leftGroupStartY = weaponCenterY - leftGroupHeight / 2

    // Start drawing
    const startY = leftGroupStartY

    // Scale: 2 pixels per 1 unit of stats（视觉缩小到1/2，数值不变）
    const pixelsPerUnit = 2

    // 血条宽度动画：升级时最大血量增加，血条等比例变长
    const targetWidth = maxHealth * pixelsPerUnit
    if (this.healthBarDisplayWidth === 0) {
      this.healthBarDisplayWidth = targetWidth
      this.healthBarAnimStartWidth = targetWidth
      this.healthBarAnimTargetWidth = targetWidth
    }
    if (targetWidth > this.healthBarAnimTargetWidth) {
      this.healthBarAnimStartWidth = this.healthBarDisplayWidth
      this.healthBarAnimTargetWidth = targetWidth
      this.healthBarAnimElapsedSec = 0
    }
    if (this.healthBarDisplayWidth < this.healthBarAnimTargetWidth) {
      this.healthBarAnimElapsedSec += this.lastRenderDeltaSec
      const t = Math.min(
        1,
        this.healthBarAnimElapsedSec / this.HEALTH_BAR_ANIM_SEC
      )
      const eased = 1 - (1 - t) * (1 - t)
      this.healthBarDisplayWidth =
        (this.healthBarAnimStartWidth +
          (this.healthBarAnimTargetWidth - this.healthBarAnimStartWidth) *
            eased) |
        0
      if (t >= 1) this.healthBarDisplayWidth = this.healthBarAnimTargetWidth
    }
    const displayBarWidth = this.healthBarDisplayWidth

    // Sun HUD: single orb icon
    const orbCX = leftMargin + sunIconSize / 2
    const orbCY = startY + barHeight / 2
    const fillPct = solarLarge > 0 ? 100 : solarSmall * 10
    this.drawSunHudIcon(orbCX, orbCY, sunIconSize, fillPct)
    // Count badge: to the right of icon, bottom aligned with icon bottom
    this.drawSunCount(
      leftMargin + sunIconSize + 2,
      orbCY + sunIconSize / 2,
      solarLarge
    )

    // Health Bar
    const healthRatio = health / maxHealth
    const isGrowing =
      this.healthBarDisplayWidth < this.healthBarAnimTargetWidth ||
      (this.healthBarAnimElapsedSec > 0 &&
        this.healthBarAnimElapsedSec < this.HEALTH_BAR_ANIM_SEC)
    this.drawBar(
      startX,
      startY,
      displayBarWidth,
      barHeight,
      healthRatio,
      '#5a1b1b',
      '#ff4d4f'
    )
    if (isGrowing) {
      this.drawHealthBarGrowEffect(
        startX,
        startY + (barHeight >> 1),
        barHeight,
        this.healthBarAnimStartWidth,
        displayBarWidth,
        this.healthBarAnimElapsedSec
      )
    }

    // Exp Bar（血条下方，蓝色，细）
    const expBarY = startY + barHeight + expBarGap
    this.drawBar(
      startX,
      expBarY,
      displayBarWidth,
      expBarHeight,
      expRatio100 / 100,
      '#0b2966',
      EXP_COLOR
    )

    void posture
    void maxPosture

    if (flags & FLAGS.GRAPPLE_READY) {
      const iconX = startX + 6
      const iconY = expBarY + expBarHeight + iconGap + iconSize / 2
      this.renderGrappleIcon(iconX, iconY, iconSize)
    }

    this.renderWeaponSlots(playerOffset)

    this.hudLastCanvasWidth = this.ctx.canvas.width
    this.hudLastCanvasHeight = this.ctx.canvas.height
    this.hudLastHealthBarWidth = this.healthBarDisplayWidth
  }

  private renderGrappleIcon(x: number, y: number, size: number): void {
    this.ctx.save()
    this.ctx.translate(x, y)
    renderWeaponShape(this.ctx, 'hook', size, size, GRAPPLE_ICON_COLOR, false)
    this.ctx.restore()
  }

  // 绘制太阳形路径（cx/cy为圆心，size为直径，8角锯齿）
  private buildSunPath(
    ctx: RenderContext2D,
    cx: number,
    cy: number,
    size: number
  ): void {
    const rays = 8
    const outerR = size / 2
    const innerR = (size / 2) * 0.6
    const step = Math.PI / rays
    ctx.beginPath()
    for (let i = 0; i < rays * 2; i++) {
      const angle = i * step - Math.PI / 2
      const r = i % 2 === 0 ? outerR : innerR
      const px = cx + Math.cos(angle) * r
      const py = cy + Math.sin(angle) * r
      if (i === 0) ctx.moveTo(px, py)
      else ctx.lineTo(px, py)
    }
    ctx.closePath()
  }

  // HUD 太阳图标（cx/cy 为圆心，size 为直径，fillPct 为 0-100 整数）
  private drawSunHudIcon(
    cx: number,
    cy: number,
    size: number,
    fillPct: number
  ): void {
    const ctx = this.ctx
    const isFull = fillPct >= 100
    const fillColor = isFull ? SUN_COLOR : '#c49a00'
    const strokeColor = isFull ? SUN_COLOR : '#8a6b00'

    // 满格时先画光晕（在图形下方，不裁剪）
    if (isFull) {
      ctx.save()
      const glowR = size / 2 + 4
      const grad = ctx.createRadialGradient(cx, cy, size / 2 - 2, cx, cy, glowR)
      grad.addColorStop(0, 'rgba(255,215,0,0.35)')
      grad.addColorStop(1, 'rgba(255,215,0,0)')
      ctx.fillStyle = grad
      ctx.beginPath()
      ctx.arc(cx, cy, glowR, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    }

    ctx.save()
    if (fillPct > 0) {
      this.buildSunPath(ctx, cx, cy, size)
      ctx.clip()
      const fillH = Math.round((size * fillPct) / 100)
      ctx.fillStyle = fillColor
      ctx.fillRect(cx - size / 2, cy + size / 2 - fillH, size, fillH)
      ctx.restore()
      ctx.save()
    }
    this.buildSunPath(ctx, cx, cy, size)
    ctx.strokeStyle = strokeColor
    ctx.lineWidth = 1
    ctx.stroke()
    ctx.restore()
  }

  // HUD 太阳数量标注
  private drawSunCount(x: number, y: number, count: number): void {
    const ctx = this.ctx
    ctx.save()
    ctx.font = '12px monospace'
    ctx.fillStyle = HUD_ICON_COLOR
    ctx.globalAlpha = HUD_AMMO_ALPHA
    ctx.textAlign = 'left'
    ctx.textBaseline = 'bottom'
    ctx.fillText(String(count), x, y)
    ctx.restore()
  }

  // 世界中太阳拾取图标（世界坐标）
  private drawSunPickupIcon(
    worldX: number,
    worldY: number,
    isLarge: boolean
  ): void {
    const ctx = this.ctx
    const ppm = this.pixelsPerMeter
    const cx = worldX * ppm
    const cy = worldY * ppm
    const size =
      (ppm *
        (isLarge
          ? LARGE_SUN_PICKUP_SIZE_NUMERATOR
          : SMALL_SUN_PICKUP_SIZE_NUMERATOR)) /
      PICKUP_SIZE_DENOMINATOR
    const glowRadius =
      (((size / 2) * PICKUP_GLOW_SIZE_NUMERATOR) /
        PICKUP_GLOW_SIZE_DENOMINATOR) |
      0
    ctx.save()
    const glow = ctx.createRadialGradient(cx, cy, size / 4, cx, cy, glowRadius)
    glow.addColorStop(0, 'rgba(255, 255, 255, 0.45)')
    glow.addColorStop(0.55, 'rgba(255, 255, 255, 0.18)')
    glow.addColorStop(1, 'rgba(255, 255, 255, 0)')
    ctx.fillStyle = glow
    ctx.beginPath()
    ctx.arc(cx, cy, glowRadius, 0, Math.PI * 2)
    ctx.fill()
    this.buildSunPath(ctx, cx, cy, size)
    ctx.fillStyle = SUN_COLOR
    ctx.fill()
    if (isLarge) {
      ctx.strokeStyle = '#c8a800'
      ctx.lineWidth = 1
      ctx.stroke()
    }
    ctx.restore()
  }

  private drawExpOrbIcon(worldX: number, worldY: number): void {
    const ctx = this.ctx
    const ppm = this.pixelsPerMeter
    const cx = worldX * ppm
    const cy = worldY * ppm
    const r = ((ppm * EXP_ORB_SIZE_NUMERATOR) / PICKUP_SIZE_DENOMINATOR / 2) | 0
    const glowRadius =
      (((r * PICKUP_GLOW_SIZE_NUMERATOR) / PICKUP_GLOW_SIZE_DENOMINATOR) | 0) +
      1
    ctx.save()
    const glow = ctx.createRadialGradient(cx, cy, r / 2, cx, cy, glowRadius)
    glow.addColorStop(0, 'rgba(255, 255, 255, 0.5)')
    glow.addColorStop(0.55, 'rgba(255, 255, 255, 0.2)')
    glow.addColorStop(1, 'rgba(255, 255, 255, 0)')
    ctx.fillStyle = glow
    ctx.beginPath()
    ctx.arc(cx, cy, glowRadius, 0, Math.PI * 2)
    ctx.fill()
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.fillStyle = EXP_COLOR
    ctx.fill()
    ctx.restore()
  }

  // 血条增长区域向外飞溅白色粒子特效（屏幕坐标空间）
  // 粒子从血条增长区域的上边、右边、下边向外飞出，突出血条矩形轮廓
  private drawHealthBarGrowEffect(
    barStartX: number,
    ry: number,
    barHeight: number,
    animStartWidth: number,
    displayWidth: number,
    elapsedSec: number
  ): void {
    const growWidth = displayWidth - animStartWidth
    const fade = Math.max(0, 1 - elapsedSec / this.HEALTH_BAR_ANIM_SEC)
    if (fade <= 0 || growWidth <= 0) return

    const ctx = this.ctx
    const half = barHeight >> 1
    const topY = ry - half
    const botY = ry + half
    const tipX = barStartX + displayWidth
    const segStartX = barStartX + animStartWidth
    const PARTICLE_COUNT = 18
    const PARTICLE_LIFE = 0.4

    ctx.save()
    ctx.fillStyle = '#ffffff'

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      // 三条边轮流分配：上边(0)、右边(1)、下边(2)
      const side = i % 3
      // 黄金比例在边内均匀分布位置
      const frac = (i * 0.618033988749895) % 1
      const startOffset = (i * 0.11) % PARTICLE_LIFE
      const localT =
        ((elapsedSec + startOffset) % PARTICLE_LIFE) / PARTICLE_LIFE
      const dist = localT * (4 + (i % 4) * 2)

      let sx: number, sy: number, dx: number, dy: number
      if (side === 0) {
        // 上边 → 向上飞，带微小横向扩散
        sx = segStartX + frac * growWidth
        sy = topY
        dx = (frac - 0.5) * 0.25
        dy = -1
      } else if (side === 1) {
        // 右边 → 向右飞，带微小纵向扩散
        sx = tipX
        sy = topY + frac * barHeight
        dx = 1
        dy = (frac - 0.5) * 0.3
      } else {
        // 下边 → 向下飞，带微小横向扩散
        sx = segStartX + frac * growWidth
        sy = botY
        dx = (frac - 0.5) * 0.25
        dy = 1
      }

      const alpha = (1 - localT) * fade
      if (alpha <= 0) continue

      const px = sx + dx * dist
      const py = sy + dy * dist

      // 外层光晕
      ctx.globalCompositeOperation = 'lighter'
      ctx.globalAlpha = alpha * 0.5
      ctx.beginPath()
      ctx.arc(px, py, 4, 0, Math.PI * 2)
      ctx.fill()

      // 核心亮点
      ctx.globalCompositeOperation = 'source-over'
      ctx.globalAlpha = alpha
      ctx.beginPath()
      ctx.arc(px, py, 2.2, 0, Math.PI * 2)
      ctx.fill()
    }

    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'source-over'
    ctx.restore()
  }

  private drawGrappleLine(
    startX: number,
    startY: number,
    targetX: number,
    targetY: number
  ): void {
    const ctx = this.ctx
    ctx.save()
    ctx.strokeStyle = GRAPPLE_LINE_COLOR
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(startX * this.pixelsPerMeter, startY * this.pixelsPerMeter)
    ctx.lineTo(targetX * this.pixelsPerMeter, targetY * this.pixelsPerMeter)
    ctx.stroke()
    ctx.restore()
  }

  private drawGrappleRopePoints(): void {
    if (this.ropePointCount <= 1) {
      return
    }

    const ctx = this.ctx
    const view = this.ropePointsBuffer
    let offset = 0
    ctx.save()
    ctx.strokeStyle = GRAPPLE_LINE_COLOR
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(
      view[offset] * this.pixelsPerMeter,
      view[offset + 1] * this.pixelsPerMeter
    )

    for (let i = 1; i < this.ropePointCount; i++) {
      offset += ROPE_POINT_STRIDE
      ctx.lineTo(
        view[offset] * this.pixelsPerMeter,
        view[offset + 1] * this.pixelsPerMeter
      )
    }
    ctx.stroke()

    if (DEBUG_DRAW_GRAPPLE_JOINTS) {
      ctx.fillStyle = '#f3e3b8'
      const radiusPx = 2
      offset = 0
      for (let i = 0; i < this.ropePointCount; i++) {
        const x = view[offset] * this.pixelsPerMeter
        const y = view[offset + 1] * this.pixelsPerMeter
        ctx.beginPath()
        ctx.arc(x, y, radiusPx, 0, Math.PI * 2)
        ctx.fill()
        offset += ROPE_POINT_STRIDE
      }
    }
    ctx.restore()
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

    const mainWeaponKind = this.getWeaponRenderTypeFromId(mainType)
    const secondaryWeaponKind = this.getWeaponRenderTypeFromId(secondaryType)
    const mainAmmoValue = mainAmmo < 0 ? 0 : mainAmmo
    const secondaryAmmoValue = secondaryAmmo < 0 ? 0 : secondaryAmmo

    drawHudWeaponSlot(
      this.ctx,
      mainX,
      slotY,
      HUD_SLOT_SIZE,
      activeSlot === 0,
      mainHasWeapon,
      mainWeaponKind,
      mainWidth,
      mainHeight,
      mainSize,
      mainMax,
      mainAmmoValue,
      this.isRangedWeaponTypeId(mainType) ? this.getAmmoText(mainAmmoValue) : ''
    )
    drawHudWeaponSlot(
      this.ctx,
      secondaryX,
      slotY,
      HUD_SLOT_SIZE,
      activeSlot === 1,
      secondaryHasWeapon,
      secondaryWeaponKind,
      secondaryWidth,
      secondaryHeight,
      secondarySize,
      secondaryMax,
      secondaryAmmoValue,
      this.isRangedWeaponTypeId(secondaryType)
        ? this.getAmmoText(secondaryAmmoValue)
        : ''
    )

    const ultimateActiveWeaponType =
      activeSlot === 0
        ? buf[playerOffset + OFFSETS.WEAPON_SLOT_MAIN_TYPE] | 0
        : buf[playerOffset + OFFSETS.WEAPON_SLOT_SECONDARY_TYPE] | 0
    const currentWeaponIsHammer =
      ultimateActiveWeaponType === WEAPON_TYPES.HAMMER ||
      ultimateActiveWeaponType === WEAPON_TYPES.BIG_HAMMER
    const currentWeaponIsSpear = ultimateActiveWeaponType === WEAPON_TYPES.SPEAR
    const currentWeaponIsSword =
      ultimateActiveWeaponType === WEAPON_TYPES.SWORD ||
      ultimateActiveWeaponType === WEAPON_TYPES.SHORT_SWORD ||
      ultimateActiveWeaponType === WEAPON_TYPES.LONG_SWORD
    if (currentWeaponIsSword || currentWeaponIsHammer || currentWeaponIsSpear) {
      const cooldownRatio =
        buf[playerOffset + OFFSETS.ULTIMATE_COOLDOWN_RATIO] | 0
      // 绝招动画进行中时立即显示满蒙层
      const ultimateAnimActive =
        (buf[playerOffset + OFFSETS.ULTIMATE_SWORD_ACTIVE] | 0) >= 1 ||
        buf[playerOffset + OFFSETS.HAMMER_ULTIMATE_ACTIVE] === 1 ||
        buf[playerOffset + OFFSETS.SPEAR_ULTIMATE_ACTIVE] === 1
      const displayCooldownRatio = ultimateAnimActive ? 100 : cooldownRatio
      // 有蒙层时不显示光晕
      const ultimateReady =
        displayCooldownRatio === 0 &&
        buf[playerOffset + OFFSETS.ULTIMATE_READY] === 1
      const flashTimer100 =
        buf[playerOffset + OFFSETS.ULTIMATE_FLASH_TIMER100] | 0
      const ultimateCx = canvasWidth >> 1
      const ultimateCy = canvasHeight - HUD_SLOT_MARGIN - HUD_ULTIMATE_SIZE / 2
      drawHudUltimateSlot(
        this.ctx,
        ultimateCx,
        ultimateCy,
        displayCooldownRatio,
        ultimateReady,
        flashTimer100,
        currentWeaponIsHammer
          ? 'hammer'
          : currentWeaponIsSpear
            ? 'spear'
            : 'sword'
      )
    }
  }

  private getAmmoText(ammo: number): string {
    const cached = this.ammoTextCache[ammo]
    if (cached) return cached
    const text = String(ammo)
    this.ammoTextCache[ammo] = text
    return text
  }

  private isRangedWeaponTypeId(weaponType: number): boolean {
    return weaponType === WEAPON_TYPES.BOW || weaponType === WEAPON_TYPES.GRAPE
  }

  private getRangedMinForceRatio(weaponType: number): number {
    if (weaponType === WEAPON_TYPES.GRAPE) {
      return Math.max(
        GRAPE_MIN_FORCE_RATIO,
        Math.min(1, GRAPE_MIN_WINDUP_MS / BOW_MAX_DRAW_MS)
      )
    }
    return Math.max(
      BOW_MIN_FORCE_RATIO,
      Math.min(1, BOW_MIN_WINDUP_MS / BOW_MAX_DRAW_MS)
    )
  }

  private getRangedGravityScale(weaponType: number): number {
    return weaponType === WEAPON_TYPES.GRAPE
      ? GRAPE_GRAVITY_SCALE
      : BOW_GRAVITY_SCALE
  }

  private getRangedLaunchSpeed(weaponType: number, drawRatio: number): number {
    if (weaponType === WEAPON_TYPES.GRAPE) {
      const baseSpeed = this.trajectoryCalculator.getLaunchSpeed(
        drawRatio,
        GRAPE_MIN_SPEED,
        GRAPE_MAX_SPEED
      )
      return baseSpeed * getGrapeChargeRangeScale(drawRatio)
    }
    return this.trajectoryCalculator.getBowSpeed(drawRatio)
  }

  private getWeaponRenderTypeFromId(
    weaponType: number
  ): 'sword' | 'spear' | 'hammer' | 'bow' | 'grape' | 'hook' {
    if (weaponType === WEAPON_TYPES.BOW) {
      return 'bow'
    }
    if (weaponType === WEAPON_TYPES.GRAPE) {
      return 'grape'
    }
    if (weaponType === WEAPON_TYPES.SPEAR) {
      return 'spear'
    }
    if (
      weaponType === WEAPON_TYPES.HAMMER ||
      weaponType === WEAPON_TYPES.BIG_HAMMER
    ) {
      return 'hammer'
    }
    if (weaponType === WEAPON_TYPES.HOOK) {
      return 'hook'
    }
    return 'sword'
  }

  private renderWeapon(buf: Float32Array, offset: number, flags: number): void {
    if (flags & FLAGS.DEAD) return
    if (flags & FLAGS.VANISHED) return

    const wx = buf[offset + OFFSETS.WEAPON_X]
    const wy = buf[offset + OFFSETS.WEAPON_Y]
    const wRot = buf[offset + OFFSETS.WEAPON_ROT]
    let wWidth = buf[offset + OFFSETS.WEAPON_W] * this.pixelsPerMeter
    let wHeight = buf[offset + OFFSETS.WEAPON_H] * this.pixelsPerMeter
    const weaponType = buf[offset + OFFSETS.WEAPON_TYPE]
    const bowDraw = buf[offset + OFFSETS.WEAPON_DRAW]
    const bowDrawActive = buf[offset + OFFSETS.WEAPON_DRAW_ACTIVE] === 1
    const bowHasArrow = buf[offset + OFFSETS.WEAPON_HAS_ARROW] === 1

    const isAttacking = !!(flags & FLAGS.WEAPON_ATTACKING)
    const isBlocking = !!(flags & FLAGS.WEAPON_BLOCKING)
    const isInCombat = !!(flags & FLAGS.IN_COMBAT)
    const isProjectileWeapon =
      weaponType === WEAPON_TYPES.ARROW ||
      weaponType === WEAPON_TYPES.GRAPE_SHOT
    const isStandaloneWeapon =
      buf[offset + OFFSETS.STATS_HEALTH_MAX] <= 0 && !isProjectileWeapon
    const bodyColor = isStandaloneWeapon ? HUD_ICON_COLOR : '#b4bdc7'

    if (isStandaloneWeapon) {
      const maxSizePx = Math.round(
        (DEFAULT_PLAYER_RADIUS * 2 * 2 * this.pixelsPerMeter) / 3
      )
      const groundScale = maxSizePx / wWidth
      wWidth = Math.round(wWidth * groundScale)
      wHeight = Math.round(wHeight * groundScale)
    }

    this.ctx.save()
    if (isStandaloneWeapon) {
      this.ctx.globalAlpha = HUD_ICON_ALPHA
    }
    this.ctx.translate(wx * this.pixelsPerMeter, wy * this.pixelsPerMeter)
    this.ctx.rotate(wRot)

    if (weaponType === WEAPON_TYPES.ARROW) {
      this.drawArrowShape(wWidth, wHeight, isAttacking, bodyColor)
    } else if (weaponType === WEAPON_TYPES.GRAPE_SHOT) {
      renderWeaponShape(
        this.ctx,
        'grapeShot',
        wWidth,
        wHeight,
        bodyColor,
        isAttacking
      )
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
    } else if (weaponType === WEAPON_TYPES.GRAPE) {
      renderWeaponShape(
        this.ctx,
        'grape',
        wWidth,
        wHeight,
        bodyColor,
        isAttacking
      )
    } else if (weaponType === WEAPON_TYPES.HOOK) {
      renderWeaponShape(
        this.ctx,
        'hook',
        wWidth,
        wHeight,
        bodyColor,
        isAttacking
      )
    } else if (weaponType === WEAPON_TYPES.SPEAR) {
      renderWeaponShape(
        this.ctx,
        'spear',
        wWidth,
        wHeight,
        bodyColor,
        isAttacking
      )
    } else if (
      weaponType === WEAPON_TYPES.HAMMER ||
      weaponType === WEAPON_TYPES.BIG_HAMMER
    ) {
      renderWeaponShape(
        this.ctx,
        'hammer',
        wWidth,
        wHeight,
        bodyColor,
        isAttacking
      )
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

  private renderUltimateSword(playerOffset: number): void {
    const buf = this.stateBuffer
    if (buf[playerOffset + OFFSETS.ULTIMATE_SWORD_ACTIVE] !== 1) return

    const rise100 = buf[playerOffset + OFFSETS.ULTIMATE_SWORD_RISE100] | 0
    const alpha100 = buf[playerOffset + OFFSETS.ULTIMATE_SWORD_ALPHA100] | 0
    const giantX = buf[playerOffset + OFFSETS.ULTIMATE_SWORD_X]
    const groundY = buf[playerOffset + OFFSETS.ULTIMATE_SWORD_GROUND_Y]
    const ppm = this.pixelsPerMeter

    // 巨剑尺寸：10x 大剑基准尺寸（长16m，厚3m）
    const GIANT_LEN = 16 * ppm
    const GIANT_THICK = 3 * ppm
    const screenH = this.ctx.canvas.height

    // 巨剑从屏幕底部入、顶部出，纵穿整个屏幕：
    // rise100=0:   剑尖在屏幕底部（完全在屏幕外下方）
    // rise100=100: 剑尖在屏幕顶部（剑身居中横跨屏幕）
    // rise100=200: 剑柄在屏幕顶部（完全飞出屏幕上方）
    const risenFrac = rise100 / 200
    const centerX = giantX * ppm
    const centerY =
      groundY * ppm +
      screenH / 2 +
      GIANT_LEN / 2 -
      risenFrac * (screenH + GIANT_LEN)

    const alpha = (alpha100 / 100) * 0.55

    this.ctx.save()
    this.ctx.globalAlpha = alpha
    this.ctx.translate(centerX, centerY)
    this.ctx.rotate(-Math.PI / 2) // 尖向上
    renderWeaponShape(
      this.ctx,
      'sword',
      GIANT_LEN,
      GIANT_THICK,
      '#c8d8ff',
      false
    )
    this.ctx.restore()
  }

  private renderHammerUltimateShockwave(playerOffset: number): void {
    const buf = this.stateBuffer
    if (buf[playerOffset + OFFSETS.HAMMER_ULTIMATE_ACTIVE] !== 1) return
    const impact100 = buf[playerOffset + OFFSETS.HAMMER_ULTIMATE_IMPACT100] | 0
    if (impact100 <= 0) return

    const ppm = this.pixelsPerMeter
    // 冲击波中心 = 锤头触地点，与游戏 AOE 圆心一致
    const cx = buf[playerOffset + OFFSETS.ULTIMATE_SWORD_X] * ppm
    const cy = buf[playerOffset + OFFSETS.ULTIMATE_SWORD_GROUND_Y] * ppm

    const progress = impact100 / 100
    // AOE 半径与 WeaponSystem.ts 中 HAMMER_AOE_RADIUS 保持一致（4m）
    const HAMMER_AOE_R_M = 4
    const maxReach = HAMMER_AOE_R_M * ppm
    // 固定长度条状物从中心向外飞散，中心保持空旷
    const BAR_LEN = ppm * 0.8
    const outerEdge = progress * maxReach
    const innerEdge = Math.max(0, outerEdge - BAR_LEN)
    const BAR_COUNT = 7
    const BAR_W = Math.max(3, ppm * 0.12)
    const alpha = (1 - progress) * 0.8

    this.ctx.save()
    this.ctx.globalAlpha = alpha
    this.ctx.strokeStyle = '#e8e0c8'
    this.ctx.lineWidth = BAR_W
    this.ctx.lineCap = 'round'

    // 上半圆（从右→上→左），贴地爆炸向四周扩散
    for (let i = 0; i < BAR_COUNT; i++) {
      const angle = -(i / (BAR_COUNT - 1)) * Math.PI
      const cos = Math.cos(angle)
      const sin = Math.sin(angle)
      this.ctx.beginPath()
      this.ctx.moveTo(cx + cos * innerEdge, cy + sin * innerEdge)
      this.ctx.lineTo(cx + cos * outerEdge, cy + sin * outerEdge)
      this.ctx.stroke()
    }

    this.ctx.restore()
  }

  private renderSpearUltimatePhantoms(playerOffset: number): void {
    const buf = this.stateBuffer
    if (buf[playerOffset + OFFSETS.SPEAR_ULTIMATE_ACTIVE] !== 1) return

    const alpha100 = buf[playerOffset + OFFSETS.SPEAR_ULTIMATE_ALPHA100] | 0
    if (alpha100 <= 0) return

    const ppm = this.pixelsPerMeter
    const width = buf[playerOffset + OFFSETS.SPEAR_ULTIMATE_W] * ppm
    const height = buf[playerOffset + OFFSETS.SPEAR_ULTIMATE_H] * ppm
    const alpha = (alpha100 / 100) * 0.45

    this.ctx.save()
    this.ctx.globalAlpha = alpha
    this.ctx.translate(
      buf[playerOffset + OFFSETS.SPEAR_ULTIMATE_TOP_X] * ppm,
      buf[playerOffset + OFFSETS.SPEAR_ULTIMATE_TOP_Y] * ppm
    )
    this.ctx.rotate(buf[playerOffset + OFFSETS.SPEAR_ULTIMATE_TOP_ROT])
    renderWeaponShape(this.ctx, 'spear', width, height, '#d9dbc8', false)
    this.ctx.restore()

    this.ctx.save()
    this.ctx.globalAlpha = alpha
    this.ctx.translate(
      buf[playerOffset + OFFSETS.SPEAR_ULTIMATE_BOTTOM_X] * ppm,
      buf[playerOffset + OFFSETS.SPEAR_ULTIMATE_BOTTOM_Y] * ppm
    )
    this.ctx.rotate(buf[playerOffset + OFFSETS.SPEAR_ULTIMATE_BOTTOM_ROT])
    renderWeaponShape(this.ctx, 'spear', width, height, '#d9dbc8', false)
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
    buf: Float32Array,
    offset: number,
    flags: number
  ): number {
    if (!(flags & FLAGS.DEAD)) return 1
    if (flags & FLAGS.VANISHED) return 0
    const elapsedMs = buf[offset + OFFSETS.STATS_DEATH_ELAPSED] * 1000
    if (elapsedMs < DEATH_CROSS_DURATION_MS) {
      return 1
    }
    return 0
  }

  private renderDeathCross(
    buf: Float32Array,
    offset: number,
    flags: number,
    centerX: number,
    centerY: number,
    radius: number
  ): void {
    if (!(flags & FLAGS.DEAD)) return
    if (flags & FLAGS.VANISHED) return
    if (radius <= 0) return

    const elapsedMs = buf[offset + OFFSETS.STATS_DEATH_ELAPSED] * 1000
    const crossElapsedMs = elapsedMs
    if (crossElapsedMs <= 0 || crossElapsedMs > DEATH_CROSS_DURATION_MS) {
      return
    }

    const radiusInt = Math.max(1, Math.floor(radius))
    const lineWidth = Math.max(2, Math.floor((radiusInt * 18) / 100))
    const maxRadiusInner = Math.max(0, radiusInt - Math.ceil(lineWidth / 2))
    const maxLength = Math.floor((maxRadiusInner * 707) / 1000)
    const length = Math.floor(
      (maxLength * crossElapsedMs) / DEATH_CROSS_DURATION_MS
    )
    if (length <= 0) return
    const alphaScaled =
      maxLength > 0 ? Math.floor((length * 1000) / maxLength) : 0
    const alpha = alphaScaled / 1000

    this.ctx.save()
    this.ctx.translate(centerX, centerY)
    this.ctx.strokeStyle = '#FFFFFF'
    this.ctx.lineWidth = lineWidth
    this.ctx.lineCap = 'round'
    this.ctx.globalAlpha *= alpha
    this.ctx.beginPath()
    this.ctx.moveTo(-length, -length)
    this.ctx.lineTo(length, length)
    this.ctx.moveTo(-length, length)
    this.ctx.lineTo(length, -length)
    this.ctx.stroke()
    this.ctx.restore()
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
    drawRatio: number,
    weaponType: number
  ): void {
    const speed = this.getRangedLaunchSpeed(weaponType, drawRatio) * 1.5
    this.trajectoryCalculator.setGravityScale(
      this.getRangedGravityScale(weaponType)
    )
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
    weaponDrawRatio: number,
    weaponType: number
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

    const speed = this.getRangedLaunchSpeed(weaponType, weaponDrawRatio) * 1.5
    this.trajectoryCalculator.setGravityScale(
      this.getRangedGravityScale(weaponType)
    )
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
      const facing = sensor.facing >= 0 ? 1 : -1
      const eyeX = sensor.eyeX * pixelsPerMeter
      const eyeY = sensor.eyeY * pixelsPerMeter
      const halfFov = sensor.fov * 0.5
      const baseAngle = facing >= 0 ? 0 : Math.PI
      const fovAngle1 = baseAngle - halfFov
      const fovAngle2 = baseAngle + halfFov

      ctx.strokeStyle = '#22cc88'
      ctx.beginPath()
      ctx.moveTo(eyeX, eyeY)
      ctx.lineTo(
        eyeX + Math.cos(fovAngle1) * radius,
        eyeY + Math.sin(fovAngle1) * radius
      )
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(eyeX, eyeY)
      ctx.lineTo(
        eyeX + Math.cos(fovAngle2) * radius,
        eyeY + Math.sin(fovAngle2) * radius
      )
      ctx.stroke()

      ctx.strokeStyle = '#ffffff'
      ctx.beginPath()
      ctx.moveTo(eyeX, eyeY)
      ctx.lineTo(eyeX + facing * radius, eyeY)
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
