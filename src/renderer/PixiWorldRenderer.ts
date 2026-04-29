import type { Spine } from '@esotericsoftware/spine-pixi-v8'
import { Container, Graphics, Sprite, Text, Texture } from 'pixi.js'

import type { ClientRenderer } from '../ClientRenderer'
import {
  getCharacterBodyColor,
  getCharacterBodyProfileHeight,
  getCharacterBodyProfileWidth,
} from '../characterBodyProfile'
import {
  CHECKPOINT_TREE_TOP_COLOR_ACTIVE,
  CHECKPOINT_TREE_TOP_COLOR_INACTIVE,
  CHECKPOINT_TREE_TRUNK_COLOR_ACTIVE,
  CHECKPOINT_TREE_TRUNK_COLOR_INACTIVE,
  DEATH_CROSS_DURATION_MS,
  DEBUG_DRAW_BREAKABLE_CRATE_HEALTH,
  DEBUG_DRAW_PLAYER_COLLISION_SHAPE,
  DEBUG_DRAW_TERRAIN_COLLISION_SHAPE,
  DEFAULT_CHECKPOINT_RENDER_RADIUS,
  DEFAULT_PLAYER_RADIUS,
  DEFAULT_WEAPON_HEIGHT,
  DEFAULT_WEAPON_WIDTH,
  FOLLOW_BOND_ICON_RENDER_HEIGHT,
  FOLLOW_BOND_ICON_RENDER_WIDTH,
  FOLLOW_UNBOND_ICON_RENDER_HEIGHT,
  FOLLOW_UNBOND_ICON_RENDER_WIDTH,
  GRAPPLE_ANCHOR_HIGHLIGHT_SCALE,
  TERRAIN_COLLISION_DEBUG_ALPHA,
  TERRAIN_COLLISION_DEBUG_COLOR,
  TERRAIN_COLLISION_DEBUG_LINE_WIDTH,
  WEAPON_DEFAULT_DATA,
} from '../constants'
import type { MapCharacterBodyProfile } from '../editorMapTypes'
import { getPublicAssetUrl } from '../publicAssetUrl'
import { RENDER_LAYER_SKY } from '../renderLayers'
import {
  resolveSkeletalAnimationNameFromMotionState,
  resolveSkeletalMoveDirection,
} from '../skeletalAnimation'
import { getCharacterBodyTextureDataUrl } from '../skeletalBodyProfile'
import {
  ENTITY_STRIDE,
  FLAGS,
  OFFSETS,
  WEAPON_TYPES,
} from '../worker/binaryProtocol'
import { ROPE_POINT_STRIDE } from '../worker/effectsProtocol'
import { getBodySpriteSource, isBodyVisualAssetsReady } from './BodyRenderer'
import { BombExplosionEmitterPool } from './BombExplosionEmitterPool'
import { createCheckpointTreeTextureSource } from './CheckpointTreeTextureFactory'
import { HUD_ICON_ALPHA, HUD_ICON_COLOR } from './HudWeaponSlotRenderer'
import { ParrySparkEmitterPool } from './ParrySparkEmitterPool'
import {
  PARTICLE_TYPE_CHECKPOINT_PULSE,
  PARTICLE_TYPE_DEATH,
  PARTICLE_TYPE_HEAL,
  PARTICLE_TYPE_SPARK,
} from './ParticleSystem'
import {
  type GaitState,
  acquireGaitState,
  releaseGaitState,
  updateSkeletalPose,
} from './SkeletalPoseDriver'
import {
  areSkeletalBoneShapeTexturesReady,
  buildSkeletalSpineCacheKey,
  getOrBuildSkeletalSpineDefinition,
} from './SkeletalSpineBuilder'
import {
  acquireProceduralSpine,
  acquireSpine,
  getSpineBoundsAtScale,
  getSpinePreviewMatchedScale,
  isSpineLoaded,
  releaseSpine,
} from './SpineBodyManager'
import { type WeaponRenderType, renderWeapon } from './WeaponRenderer'

const FOLLOW_BOUND_BORDER_COLOR = '#ffee58'
const GRAPPLE_LINE_COLOR = '#d9c896'
const SUN_COLOR = '#ffd700'
const EXP_COLOR = '#3d7fff'
const RETICLE_COLOR = '#ffffff'
const ASSASSINATION_RETICLE_TINT = 0xe04646
const ASSASSINATION_RETICLE_OUTLINE_TINT = 0xffffff
const ASSASSINATION_RETICLE_SCALE = 2
const ASSASSINATION_RETICLE_OUTLINE_SCALE = 2.24
const RETICLE_SIZE = 7.5
const SMALL_SUN_PICKUP_SIZE_NUMERATOR = 35
const LARGE_SUN_PICKUP_SIZE_NUMERATOR = 70
const PICKUP_SIZE_DENOMINATOR = 100
const EXP_ORB_SIZE_NUMERATOR = SMALL_SUN_PICKUP_SIZE_NUMERATOR
const PICKUP_GLOW_SIZE_NUMERATOR = 8
const PICKUP_GLOW_SIZE_DENOMINATOR = 5
const CHECKPOINT_PULSE_EDGE_COLOR = '#d4be55'
const CHECKPOINT_PULSE_MID_COLOR = '#d8c46f'
const CHECKPOINT_PULSE_CORE_COLOR = '#e2d48d'
const CHECKPOINT_PULSE_EDGE_ALPHA = 0.18
const CHECKPOINT_PULSE_MID_ALPHA = 0.32
const CHECKPOINT_PULSE_CORE_ALPHA = 0.45
const CHECKPOINT_PULSE_START_RADIUS_NUMERATOR = 3
const CHECKPOINT_PULSE_START_RADIUS_DENOMINATOR = 20
const CHECKPOINT_PULSE_EXPAND_DISTANCE_NUMERATOR = 3
const CHECKPOINT_PULSE_EXPAND_DISTANCE_DENOMINATOR = 2
const CHECKPOINT_PULSE_RING_WIDTH_NUMERATOR = 1
const CHECKPOINT_PULSE_RING_WIDTH_DENOMINATOR = 10
const CHECKPOINT_PULSE_SOFT_EDGE_NUMERATOR = 2
const CHECKPOINT_PULSE_SOFT_EDGE_DENOMINATOR = 5
const BOW_ARROW_LENGTH = DEFAULT_WEAPON_WIDTH * 0.9
const BOW_ARROW_THICKNESS = DEFAULT_WEAPON_HEIGHT * 0.15
const BOW_DRAW_TEXTURE_STEPS = 16
const ENTITY_VIEW_RETIRE_FRAMES = 180
const ENTITY_VIEW_PRESSURE_RETIRE_FRAMES = 45
const MAX_ENTITY_VIEW_CACHE = 512
const MAX_WEAPON_TEXTURE_CACHE = 192
const WEAPON_TEXTURE_RETIRE_FRAMES = 180
const CHECKPOINT_TREE_TOP_COLOR_ACTIVE_INT = 0x4fae2f
const DAMAGE_TEXT_FONT_SIZE = 16
const DAMAGE_TEXT_LIFETIME_MS = 480
const DAMAGE_TEXT_RISE_PX = 22
const DAMAGE_TEXT_VERTICAL_GAP_PX = 4
const DAMAGE_TEXT_COLOR = '#f3d8a2'
const DAMAGE_TEXT_STROKE_COLOR = '#2c160f'
const DAMAGE_TEXT_POOL_LIMIT = 96
const COLLISION_DEBUG_COLOR = '#ff3b30'
const COLLISION_DEBUG_LINE_WIDTH = 2
const SOUND_DEBUG_LISTENER_COLOR = 0x8cb36b
const SOUND_DEBUG_WAVE_COLOR = 0xff9f1a
const SOUND_DEBUG_RANGE_COLOR = 0xffcc80
const SOUND_DEBUG_LISTENER_ALPHA = 0.45
const SOUND_DEBUG_RANGE_ALPHA_MULTIPLIER = 0.5
const ENTITY_GROUND_SORT_SCALE = 16
const SKELETAL_EDITOR_PPM = 128
const STANDALONE_WEAPON_SORT_OFFSET = -1
const CHECKPOINT_SORT_OFFSET = -10000
const SUN_PICKUP_SORT_OFFSET = -5000
const TERRAIN_DEBRIS_SORT_OFFSET = -2
const PIXI_WORLD_PERF_SECTION_COUNT = 12
const PIXI_WORLD_PERF_PARALLAX = 0
const PIXI_WORLD_PERF_PLAYER_SCAN = 1
const PIXI_WORLD_PERF_ENTITY_LOOP = 2
const PIXI_WORLD_PERF_HIDE_STALE = 3
const PIXI_WORLD_PERF_PRUNE = 4
const PIXI_WORLD_PERF_RETICLE = 5
const PIXI_WORLD_PERF_ROPE = 6
const PIXI_WORLD_PERF_ULTIMATE = 7
const PIXI_WORLD_PERF_PARTICLES = 8
const PIXI_WORLD_PERF_PARRY = 9
const PIXI_WORLD_PERF_SPINE = 10
const PIXI_WORLD_PERF_CHECKPOINT_TEX = 11
const TERRAIN_COLLISION_DEBUG_COLOR_CSS = '#4f7cff'

interface LayerBucket {
  container: Container
  glowContainer: Container
  staticContainer: Container
  environmentContainer: Container
  dynamicContainer: Container
  staticCacheDirty: boolean
}

interface EntityView {
  readonly id: number
  readonly root: Container
  readonly specialGraphics: Graphics
  readonly specialSprite: Sprite
  readonly bodySprite: Sprite
  readonly weaponSprite: Sprite
  readonly statusGraphics: Graphics
  readonly damageTextContainer: Container
  readonly deathGraphics: Graphics
  readonly collisionDebugGraphics: Graphics
  readonly followBondSprite: Sprite
  readonly followUnbondSprite: Sprite
  readonly activeDamageTexts: DamageTextView[]
  layer: number
  lastSeenFrame: number
  lastHealthRatio: number
  lastDamageTextToken: number
  bodyHash: number
  weaponHash: number
  specialKey: string
  collisionDebugKey: string
  spineBody: Spine | null
  spineKey: string
  spineAnimState: string
  weaponChildIndex: number
  skeletalGait: GaitState | null
  skeletalProfileKey: string
}

interface DamageTextView {
  readonly text: Text
  elapsedMs: number
  baseX: number
  baseY: number
}

interface ParticleSpriteView {
  readonly sprite: Sprite
}

interface WeaponTextureEntry {
  texture: Texture
  lastUsedFrame: number
}

interface CheckpointTextureEntry {
  texture: Texture
  anchorX: number
  anchorY: number
}

function createCanvas2D(
  width: number,
  height: number
): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.ceil(width))
  canvas.height = Math.max(1, Math.ceil(height))
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    return null
  }
  return { canvas, ctx }
}

function createImageTexture(path: string): Texture {
  const image = new Image()
  image.decoding = 'async'
  const texture = Texture.from(image)
  image.onload = () => {
    texture.source.update()
    texture.update()
  }
  image.src = getPublicAssetUrl(path)
  if (image.complete && image.naturalWidth > 0 && image.naturalHeight > 0) {
    texture.source.update()
    texture.update()
  }
  return texture
}

function hideSprite(sprite: Sprite): void {
  sprite.visible = false
  sprite.alpha = 1
}

function hideGraphics(graphics: Graphics): void {
  graphics.visible = false
}

function getWeaponRenderType(weaponType: number): WeaponRenderType {
  if (weaponType === WEAPON_TYPES.BOW) {
    return 'bow'
  }
  if (weaponType === WEAPON_TYPES.GRAPE) {
    return 'grape'
  }
  if (weaponType === WEAPON_TYPES.BOMB) {
    return 'bomb'
  }
  if (weaponType === WEAPON_TYPES.HOOK) {
    return 'hook'
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
  if (weaponType === WEAPON_TYPES.ARROW) {
    return 'arrow'
  }
  if (weaponType === WEAPON_TYPES.GRAPE_SHOT) {
    return 'grapeShot'
  }
  return 'sword'
}

function isProjectileWeaponType(weaponType: number): boolean {
  return (
    weaponType === WEAPON_TYPES.ARROW || weaponType === WEAPON_TYPES.GRAPE_SHOT
  )
}

function fnvMix(hash: number, value: number): number {
  return Math.imul(hash ^ ((value * 1000) | 0), 0x01000193)
}

function fnvMixStr(hash: number, str: string): number {
  let h = hash
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 0x01000193)
  }
  return h
}

function getQuantizedBowDraw(drawRatio: number): number {
  const clamped = Math.max(0, Math.min(1, drawRatio))
  return Math.round(clamped * BOW_DRAW_TEXTURE_STEPS) / BOW_DRAW_TEXTURE_STEPS
}

function drawArrowToContext(
  ctx: CanvasRenderingContext2D,
  lengthPx: number,
  thicknessPx: number,
  color: string,
  isAttacking: boolean,
  baseOffsetY: number
): void {
  const lineWidth = Math.max(1, thicknessPx * 0.9)
  const headLen = Math.max(4, lengthPx * 0.18)
  const headWidth = Math.max(4, thicknessPx * 1.6)
  const tipY = baseOffsetY - lengthPx

  ctx.strokeStyle = isAttacking ? '#ffffff' : color
  ctx.lineWidth = lineWidth
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(0, baseOffsetY)
  ctx.lineTo(0, tipY)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(0, tipY)
  ctx.lineTo(-headWidth / 2, tipY + headLen)
  ctx.moveTo(0, tipY)
  ctx.lineTo(headWidth / 2, tipY + headLen)
  ctx.stroke()
}

function getArrowTextureHalfHeight(
  lengthPx: number,
  thicknessPx: number,
  baseOffsetY: number
): number {
  const lineWidth = Math.max(1, thicknessPx * 0.9)
  const headLen = Math.max(4, lengthPx * 0.18)
  const topExtent = Math.max(0, lengthPx - baseOffsetY)
  const bottomExtent = Math.max(0, baseOffsetY)
  return Math.ceil(
    Math.max(topExtent + lineWidth, bottomExtent + headLen + lineWidth) + 8
  )
}

function drawProjectileDebugToContext(
  ctx: CanvasRenderingContext2D,
  weaponType: number,
  width: number,
  height: number,
  radius: number
): void {
  ctx.save()
  ctx.strokeStyle = TERRAIN_COLLISION_DEBUG_COLOR_CSS
  ctx.lineWidth = TERRAIN_COLLISION_DEBUG_LINE_WIDTH

  if (weaponType === WEAPON_TYPES.ARROW) {
    ctx.globalAlpha = TERRAIN_COLLISION_DEBUG_ALPHA * 0.7
    ctx.beginPath()
    ctx.arc(0, 0, radius, 0, Math.PI * 2)
    ctx.stroke()

    ctx.globalAlpha = TERRAIN_COLLISION_DEBUG_ALPHA
    ctx.strokeRect(-height / 2, -width, height, width)

    ctx.beginPath()
    ctx.arc(0, -width, radius, 0, Math.PI * 2)
    ctx.stroke()
  } else if (weaponType === WEAPON_TYPES.GRAPE_SHOT) {
    ctx.globalAlpha = TERRAIN_COLLISION_DEBUG_ALPHA
    ctx.beginPath()
    ctx.arc(0, 0, radius, 0, Math.PI * 2)
    ctx.stroke()
  }

  ctx.restore()
}

// 视差参数：每层级的缩放/移动倍率增量，|layer|=100 时缩放约 0.5x/1.5x
const PARALLAX_FACTOR_PER_LAYER = 0.005
// 每层级亮度衰减量，|layer|=100 时亮度约 40%
const PARALLAX_BRIGHTNESS_PER_LAYER = 0.006
const PARALLAX_MIN_BRIGHTNESS = 0.3

function getParallaxScaleForLayer(layer: number): number {
  if (layer === RENDER_LAYER_SKY) {
    return 1
  }
  return Math.max(0.1, 1 + layer * PARALLAX_FACTOR_PER_LAYER)
}

function getParallaxBrightnessForLayer(layer: number): number {
  if (layer === RENDER_LAYER_SKY) {
    return 1
  }
  return Math.max(
    PARALLAX_MIN_BRIGHTNESS,
    1 - Math.abs(layer) * PARALLAX_BRIGHTNESS_PER_LAYER
  )
}

export class PixiWorldRenderer {
  private readonly root: Container
  private readonly pixelsPerMeter: number
  private readonly buckets = new Map<number, LayerBucket>()
  private readonly bucketLayers: number[] = []
  private readonly entityViews = new Map<number, EntityView>()
  private readonly overlayContainer: Container
  private readonly particleContainer: Container
  private readonly ropeGraphics: Graphics
  private readonly soundDebugGraphics: Graphics
  private readonly hammerShockwaveGraphics: Graphics
  private readonly giantSwordSprite: Sprite
  private readonly spearTopSprite: Sprite
  private readonly spearBottomSprite: Sprite
  private readonly lockedReticleOutlineSprite: Sprite
  private readonly lockedReticleSprite: Sprite
  private readonly freeAimReticleSprite: Sprite
  private readonly handshakeTexture: Texture
  private readonly wavingTexture: Texture
  private readonly bodyTextureCache = new WeakMap<HTMLCanvasElement, Texture>()
  private readonly weaponTextureCache = new Map<string, WeaponTextureEntry>()
  private readonly iconTextureCache = new Map<string, Texture>()
  private readonly checkpointTextureCache = new Map<
    string,
    CheckpointTextureEntry
  >()
  private readonly checkpointPulseTextureCache = new Map<string, Texture>()
  private checkpointTexGenUs = 0
  private readonly damageTextPool: DamageTextView[] = []
  private readonly particleTexture: Texture
  private readonly particleSprites: ParticleSpriteView[] = []
  private readonly bombExplosionEmitterPool: BombExplosionEmitterPool
  private readonly parrySparkEmitterPool: ParrySparkEmitterPool
  private readonly activeSpineViews = new Set<EntityView>()
  private readonly perfSectionLastUs = new Int32Array(
    PIXI_WORLD_PERF_SECTION_COUNT
  )
  private readonly perfSectionTotalsUs = new Float64Array(
    PIXI_WORLD_PERF_SECTION_COUNT
  )
  private readonly perfSectionMaxUs = new Int32Array(
    PIXI_WORLD_PERF_SECTION_COUNT
  )
  private readonly perfSectionAvgUs = new Int32Array(
    PIXI_WORLD_PERF_SECTION_COUNT
  )
  private perfSampleCount = 0
  private perfVisibleEntityCount = 0
  private frameId = 0
  private currentFrameDeltaMs = 0
  private pruneSkipCounter = 0
  private readonly reusableShakeOffset = { x: 0, y: 0 }
  // 视差相机参数（每帧由 GameClient 更新）
  private parallaxCamX = 0
  private parallaxCamY = 0
  private parallaxZoom = 1
  private parallaxCenterX = 0
  private parallaxBottomY = 0
  private parallaxShakeX = 0
  private parallaxShakeY = 0
  private skyReferenceCamX = 0
  private skyReferenceCamY = 0
  private skyReferenceZoom = 1

  constructor(
    root: Container,
    emissiveRoot: Container,
    pixelsPerMeter: number
  ) {
    this.root = root
    this.pixelsPerMeter = pixelsPerMeter

    this.overlayContainer = new Container()
    this.overlayContainer.zIndex = 900000
    this.root.addChild(this.overlayContainer)

    this.particleContainer = new Container()
    this.particleContainer.zIndex = 850000
    emissiveRoot.addChild(this.particleContainer)
    this.bombExplosionEmitterPool = new BombExplosionEmitterPool(
      this.particleContainer
    )
    this.parrySparkEmitterPool = new ParrySparkEmitterPool(
      this.particleContainer
    )

    this.ropeGraphics = new Graphics()
    this.overlayContainer.addChild(this.ropeGraphics)

    this.soundDebugGraphics = new Graphics()
    hideGraphics(this.soundDebugGraphics)
    this.overlayContainer.addChild(this.soundDebugGraphics)

    this.hammerShockwaveGraphics = new Graphics()
    this.overlayContainer.addChild(this.hammerShockwaveGraphics)

    this.handshakeTexture = createImageTexture('images/handshake_yellow.png')
    this.wavingTexture = createImageTexture('images/waving_hand.png')
    this.particleTexture = this.createCircleTexture(24, '#ffffff')

    this.lockedReticleOutlineSprite = new Sprite(this.getReticleTexture())
    this.lockedReticleOutlineSprite.anchor.set(0.5)
    hideSprite(this.lockedReticleOutlineSprite)
    this.overlayContainer.addChild(this.lockedReticleOutlineSprite)

    this.lockedReticleSprite = new Sprite(this.getReticleTexture())
    this.lockedReticleSprite.anchor.set(0.5)
    hideSprite(this.lockedReticleSprite)
    this.overlayContainer.addChild(this.lockedReticleSprite)

    this.freeAimReticleSprite = new Sprite(this.getReticleTexture())
    this.freeAimReticleSprite.anchor.set(0.5)
    hideSprite(this.freeAimReticleSprite)
    this.overlayContainer.addChild(this.freeAimReticleSprite)

    this.giantSwordSprite = new Sprite()
    this.giantSwordSprite.anchor.set(0.5)
    hideSprite(this.giantSwordSprite)
    this.overlayContainer.addChild(this.giantSwordSprite)

    this.spearTopSprite = new Sprite()
    this.spearTopSprite.anchor.set(0.5)
    hideSprite(this.spearTopSprite)
    this.overlayContainer.addChild(this.spearTopSprite)

    this.spearBottomSprite = new Sprite()
    this.spearBottomSprite.anchor.set(0.5)
    hideSprite(this.spearBottomSprite)
    this.overlayContainer.addChild(this.spearBottomSprite)
  }

  getEntityViewCount(): number {
    return this.entityViews.size
  }

  getParticleSpriteCount(): number {
    return (
      this.particleSprites.length +
      this.parrySparkEmitterPool.getActiveParticleCount()
    )
  }

  getWeaponTextureCacheSize(): number {
    return this.weaponTextureCache.size
  }

  getVisibleEntityCount(): number {
    return this.perfVisibleEntityCount
  }

  getActiveSpineCount(): number {
    return this.activeSpineViews.size
  }

  getBucketCount(): number {
    return this.buckets.size
  }

  destroy(): void {
    for (const bucket of this.buckets.values()) {
      if (bucket.staticContainer.isCachedAsTexture) {
        bucket.staticContainer.cacheAsTexture(false)
      }
    }

    for (const [, view] of this.entityViews) {
      this.recycleDamageTexts(view)
      if (view.spineBody) {
        releaseSpine(view.spineKey, view.spineBody)
        view.spineBody = null
      }
    }
    this.entityViews.clear()
    this.activeSpineViews.clear()

    for (const [, entry] of this.weaponTextureCache) {
      entry.texture.destroy(true)
    }
    this.weaponTextureCache.clear()

    for (const [, texture] of this.iconTextureCache) {
      if (texture !== Texture.WHITE) {
        texture.destroy(true)
      }
    }
    this.iconTextureCache.clear()

    for (const [, entry] of this.checkpointTextureCache) {
      entry.texture.destroy(true)
    }
    this.checkpointTextureCache.clear()

    for (const [, texture] of this.checkpointPulseTextureCache) {
      if (texture !== Texture.WHITE) {
        texture.destroy(true)
      }
    }
    this.checkpointPulseTextureCache.clear()

    this.handshakeTexture.destroy(true)
    this.wavingTexture.destroy(true)
    this.particleTexture.destroy(true)
    this.bombExplosionEmitterPool.destroy()
    this.parrySparkEmitterPool.destroy()
  }

  getStaticCacheBucketCount(): number {
    let cachedCount = 0
    for (const bucket of this.buckets.values()) {
      if (bucket.staticContainer.isCachedAsTexture) {
        cachedCount++
      }
    }
    return cachedCount
  }

  getPerfSectionAvgUs(index: number): number {
    return this.perfSectionAvgUs[index] | 0
  }

  commitPerfWindow(shouldRefresh: boolean): void {
    this.perfSampleCount++
    for (let i = 0; i < PIXI_WORLD_PERF_SECTION_COUNT; i++) {
      const timeUs = this.perfSectionLastUs[i] | 0
      this.perfSectionTotalsUs[i] += timeUs
      if (timeUs > this.perfSectionMaxUs[i]) {
        this.perfSectionMaxUs[i] = timeUs
      }
    }
    if (!shouldRefresh || this.perfSampleCount <= 0) {
      return
    }
    for (let i = 0; i < PIXI_WORLD_PERF_SECTION_COUNT; i++) {
      this.perfSectionAvgUs[i] = Math.round(
        this.perfSectionTotalsUs[i] / this.perfSampleCount
      )
      this.perfSectionTotalsUs[i] = 0
      this.perfSectionMaxUs[i] = 0
    }
    this.perfSampleCount = 0
  }

  buildPerfDebugLines(formatUs: (timeUs: number) => string): string[] {
    return [
      `pixi player ${formatUs(this.perfSectionAvgUs[PIXI_WORLD_PERF_PLAYER_SCAN])}  ent ${formatUs(this.perfSectionAvgUs[PIXI_WORLD_PERF_ENTITY_LOOP])}  hide ${formatUs(this.perfSectionAvgUs[PIXI_WORLD_PERF_HIDE_STALE])}  spine ${formatUs(this.perfSectionAvgUs[PIXI_WORLD_PERF_SPINE])}`,
      `pixi ptx ${formatUs(this.perfSectionAvgUs[PIXI_WORLD_PERF_PARTICLES])}  parry ${formatUs(this.perfSectionAvgUs[PIXI_WORLD_PERF_PARRY])}  rope ${formatUs(this.perfSectionAvgUs[PIXI_WORLD_PERF_ROPE])}  ult ${formatUs(this.perfSectionAvgUs[PIXI_WORLD_PERF_ULTIMATE])}  ckptex ${formatUs(this.perfSectionAvgUs[PIXI_WORLD_PERF_CHECKPOINT_TEX])}`,
    ]
  }

  render(renderer: ClientRenderer, deltaMs: number): void {
    this.frameId += 1
    this.currentFrameDeltaMs = deltaMs
    this.checkpointTexGenUs = 0
    let sectionStartMs = performance.now()
    this.updateBucketParallax()
    this.perfSectionLastUs[PIXI_WORLD_PERF_PARALLAX] = Math.round(
      (performance.now() - sectionStartMs) * 1000
    )
    const buf = renderer.getStateBuffer()
    const entityCount = renderer.getEntityCount()
    this.perfVisibleEntityCount = 0

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

    sectionStartMs = performance.now()
    for (let i = 0; i < entityCount; i++) {
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
        break
      }
    }
    this.perfSectionLastUs[PIXI_WORLD_PERF_PLAYER_SCAN] = Math.round(
      (performance.now() - sectionStartMs) * 1000
    )

    let lockTargetCenterX = 0
    let lockTargetCenterY = 0
    let hasLockTarget = false
    let assassinationTargetCenterX = 0
    let assassinationTargetCenterY = 0
    let hasAssassinationTarget = false

    sectionStartMs = performance.now()
    for (let i = 0; i < entityCount; i++) {
      const offset = i * ENTITY_STRIDE
      const flags = buf[offset + OFFSETS.FLAGS]
      const entityId = buf[offset + OFFSETS.ID] | 0
      const visible = !(flags & FLAGS.VANISHED) && !!(flags & FLAGS.VISIBLE)

      if (!visible) {
        const hiddenView = this.entityViews.get(entityId)
        if (hiddenView) {
          this.hideEntityView(hiddenView)
        }
        continue
      }

      this.perfVisibleEntityCount++
      const view = this.ensureEntityView(entityId)
      view.lastSeenFrame = this.frameId

      const layer = buf[offset + OFFSETS.RENDER_LAYER] | 0
      this.attachViewToLayer(view, layer)

      const shake = this.getHitShakeOffset(buf, offset)
      const centerX = (buf[offset + OFFSETS.X] + shake.x) * this.pixelsPerMeter
      const centerY = (buf[offset + OFFSETS.Y] + shake.y) * this.pixelsPerMeter
      const alpha = this.getDeathAlpha(buf, offset, flags)

      view.root.visible = true
      view.root.zIndex = this.getEntityGroundSortZ(buf, offset, centerY)
      view.root.position.set(centerX, centerY)

      if (
        !playerFreeAimActive &&
        playerLockedTargetId !== -1 &&
        entityId === playerLockedTargetId
      ) {
        lockTargetCenterX = centerX
        lockTargetCenterY = centerY
        hasLockTarget = true
      }
      if (!playerFreeAimActive && (flags & FLAGS.ASSASSINATION_TARGET) !== 0) {
        assassinationTargetCenterX = centerX
        assassinationTargetCenterY = centerY
        hasAssassinationTarget = true
      }

      this.updateSpecialIcons(
        view,
        entityId,
        renderer,
        buf,
        offset,
        flags,
        alpha,
        playerOffset,
        playerLockedTargetId,
        playerX,
        playerY
      )
    }
    this.perfSectionLastUs[PIXI_WORLD_PERF_ENTITY_LOOP] = Math.round(
      (performance.now() - sectionStartMs) * 1000
    )

    sectionStartMs = performance.now()
    for (const view of this.entityViews.values()) {
      if (view.lastSeenFrame !== this.frameId) {
        this.hideEntityView(view)
      }
    }
    this.perfSectionLastUs[PIXI_WORLD_PERF_HIDE_STALE] = Math.round(
      (performance.now() - sectionStartMs) * 1000
    )

    let pruneUs = 0
    this.pruneSkipCounter++
    if (this.pruneSkipCounter >= 30) {
      const pruneStartMs = performance.now()
      this.pruneSkipCounter = 0
      this.pruneEntityViews()
      this.pruneWeaponTextures()
      pruneUs = Math.round((performance.now() - pruneStartMs) * 1000)
    }
    this.perfSectionLastUs[PIXI_WORLD_PERF_PRUNE] = pruneUs

    sectionStartMs = performance.now()
    this.updateLockReticle(
      hasAssassinationTarget || hasLockTarget,
      hasAssassinationTarget ? assassinationTargetCenterX : lockTargetCenterX,
      hasAssassinationTarget ? assassinationTargetCenterY : lockTargetCenterY,
      hasAssassinationTarget
    )
    this.updateFreeAimReticle(
      renderer,
      playerFreeAimActive,
      playerX,
      playerY,
      playerFreeAimX,
      playerFreeAimY,
      playerWeaponType,
      playerDrawRatio,
      playerDrawActive
    )
    this.perfSectionLastUs[PIXI_WORLD_PERF_RETICLE] = Math.round(
      (performance.now() - sectionStartMs) * 1000
    )

    sectionStartMs = performance.now()
    this.updateRope(
      renderer,
      playerGrappleActive,
      playerX,
      playerY,
      playerGrappleTargetX,
      playerGrappleTargetY
    )
    this.perfSectionLastUs[PIXI_WORLD_PERF_ROPE] = Math.round(
      (performance.now() - sectionStartMs) * 1000
    )

    this.updateSoundDebug(renderer)

    sectionStartMs = performance.now()
    this.updateUltimateOverlays(renderer, playerOffset)
    this.perfSectionLastUs[PIXI_WORLD_PERF_ULTIMATE] = Math.round(
      (performance.now() - sectionStartMs) * 1000
    )

    sectionStartMs = performance.now()
    this.updateParticles(renderer)
    this.perfSectionLastUs[PIXI_WORLD_PERF_PARTICLES] = Math.round(
      (performance.now() - sectionStartMs) * 1000
    )

    sectionStartMs = performance.now()
    this.updateBombExplosionEffects(renderer, deltaMs)
    this.updateParrySparkEffects(renderer, deltaMs)
    this.perfSectionLastUs[PIXI_WORLD_PERF_PARRY] = Math.round(
      (performance.now() - sectionStartMs) * 1000
    )

    let spineUs = 0
    if (deltaMs > 0) {
      const spineStartMs = performance.now()
      const deltaSec = deltaMs / 1000
      for (const view of this.activeSpineViews) {
        view.spineBody?.update(deltaSec)
      }
      spineUs = Math.round((performance.now() - spineStartMs) * 1000)
    }
    this.perfSectionLastUs[PIXI_WORLD_PERF_SPINE] = spineUs
    this.perfSectionLastUs[PIXI_WORLD_PERF_CHECKPOINT_TEX] =
      this.checkpointTexGenUs
    this.checkpointTexGenUs = 0
  }

  private ensureEntityView(id: number): EntityView {
    const cached = this.entityViews.get(id)
    if (cached) {
      return cached
    }

    const root = new Container()
    root.visible = false

    const specialGraphics = new Graphics()
    root.addChild(specialGraphics)

    const specialSprite = new Sprite()
    specialSprite.anchor.set(0.5)
    hideSprite(specialSprite)
    root.addChild(specialSprite)

    const bodySprite = new Sprite()
    bodySprite.position.set(0, 0)
    hideSprite(bodySprite)
    root.addChild(bodySprite)

    const weaponSprite = new Sprite()
    weaponSprite.anchor.set(0.5)
    hideSprite(weaponSprite)
    root.addChild(weaponSprite)

    const statusGraphics = new Graphics()
    root.addChild(statusGraphics)

    const damageTextContainer = new Container()
    root.addChild(damageTextContainer)

    const deathGraphics = new Graphics()
    root.addChild(deathGraphics)

    const collisionDebugGraphics = new Graphics()
    hideGraphics(collisionDebugGraphics)
    root.addChild(collisionDebugGraphics)

    const followBondSprite = new Sprite(this.handshakeTexture)
    followBondSprite.anchor.set(0.5)
    followBondSprite.width = FOLLOW_BOND_ICON_RENDER_WIDTH
    followBondSprite.height = FOLLOW_BOND_ICON_RENDER_HEIGHT
    hideSprite(followBondSprite)
    root.addChild(followBondSprite)

    const followUnbondSprite = new Sprite(this.wavingTexture)
    followUnbondSprite.anchor.set(0.5)
    followUnbondSprite.width = FOLLOW_UNBOND_ICON_RENDER_WIDTH
    followUnbondSprite.height = FOLLOW_UNBOND_ICON_RENDER_HEIGHT
    hideSprite(followUnbondSprite)
    root.addChild(followUnbondSprite)

    const view: EntityView = {
      id,
      root,
      specialGraphics,
      specialSprite,
      bodySprite,
      weaponSprite,
      statusGraphics,
      damageTextContainer,
      deathGraphics,
      collisionDebugGraphics,
      followBondSprite,
      followUnbondSprite,
      activeDamageTexts: [],
      layer: 0,
      lastSeenFrame: -1,
      lastHealthRatio: -1,
      lastDamageTextToken: -1,
      bodyHash: -1,
      weaponHash: -1,
      specialKey: '',
      collisionDebugKey: '',
      spineBody: null,
      spineKey: '',
      spineAnimState: '',
      weaponChildIndex: -1,
      skeletalGait: null,
      skeletalProfileKey: '',
    }

    this.entityViews.set(id, view)
    this.attachViewToLayer(view, 0)
    return view
  }

  private ensureBucket(layer: number): LayerBucket {
    const cached = this.buckets.get(layer)
    if (cached) {
      return cached
    }

    const container = new Container()
    container.zIndex = layer * 10 + 5
    this.root.addChild(container)

    const glowContainer = new Container()
    container.addChild(glowContainer)

    const staticContainer = new Container()
    container.addChild(staticContainer)

    const environmentContainer = new Container()
    environmentContainer.sortableChildren = true
    container.addChild(environmentContainer)

    const dynamicContainer = new Container()
    dynamicContainer.sortableChildren = true
    container.addChild(dynamicContainer)

    // 计算亮度 tint：layer=0 最亮，越远越暗
    const brightness = getParallaxBrightnessForLayer(layer)
    const v = Math.round(brightness * 255)
    container.tint = (v << 16) | (v << 8) | v

    const bucket = {
      container,
      glowContainer,
      staticContainer,
      environmentContainer,
      dynamicContainer,
      staticCacheDirty: false,
    }
    this.buckets.set(layer, bucket)
    this.insertBucketLayer(layer)
    return bucket
  }

  private insertBucketLayer(layer: number): void {
    for (let i = 0; i < this.bucketLayers.length; i++) {
      const current = this.bucketLayers[i]
      if (current === layer) {
        return
      }
      if (current > layer) {
        this.bucketLayers.splice(i, 0, layer)
        return
      }
    }
    this.bucketLayers.push(layer)
  }

  getBucketLayerCount(): number {
    return this.bucketLayers.length
  }

  getBucketLayerAt(index: number): number {
    return this.bucketLayers[index] ?? 0
  }

  getLayerLightingContainer(layer: number): Container | null {
    return this.buckets.get(layer)?.container ?? null
  }

  getLayerGlowContainer(layer: number): Container | null {
    return this.buckets.get(layer)?.glowContainer ?? null
  }

  setParallaxCamera(
    camX: number,
    camY: number,
    zoom: number,
    centerX: number,
    bottomY: number,
    shakeX: number,
    shakeY: number
  ): void {
    this.parallaxCamX = camX
    this.parallaxCamY = camY
    this.parallaxZoom = zoom
    this.parallaxCenterX = centerX
    this.parallaxBottomY = bottomY
    this.parallaxShakeX = shakeX
    this.parallaxShakeY = shakeY
  }

  setSkyReferenceCamera(camX: number, camY: number, zoom: number): void {
    this.skyReferenceCamX = camX
    this.skyReferenceCamY = camY
    this.skyReferenceZoom = zoom > 0 ? zoom : 1
  }

  private updateBucketParallax(): void {
    const {
      parallaxCamX,
      parallaxCamY,
      parallaxZoom,
      parallaxCenterX,
      parallaxBottomY,
      parallaxShakeX,
      parallaxShakeY,
      skyReferenceCamX,
      skyReferenceCamY,
      skyReferenceZoom,
    } = this
    const originX = parallaxCenterX + parallaxCamX / parallaxZoom
    const originY = parallaxBottomY + parallaxCamY / parallaxZoom
    for (const [layer, bucket] of this.buckets) {
      if (layer === 0) continue
      if (layer === RENDER_LAYER_SKY) {
        // 天空层级作为背景：抵消世界缩放，并按编辑器相机框中心对齐。
        const skyScale = parallaxZoom > 0 ? skyReferenceZoom / parallaxZoom : 1
        bucket.container.scale.set(skyScale)
        bucket.container.position.set(
          parallaxCamX +
            (1 - skyScale) * parallaxCenterX -
            skyScale * skyReferenceCamX -
            parallaxShakeX,
          parallaxCamY +
            (1 - skyScale) * parallaxBottomY -
            skyScale * skyReferenceCamY -
            parallaxShakeY
        )
        continue
      }
      const factor = getParallaxScaleForLayer(layer)
      bucket.container.scale.set(factor)
      bucket.container.position.set(
        (1 - factor) * originX,
        (1 - factor) * originY
      )
    }
  }

  addStaticMesh(mesh: Container, layer: number): void {
    const bucket = this.ensureBucket(layer)
    if (bucket.staticContainer.isCachedAsTexture) {
      bucket.staticContainer.cacheAsTexture(false)
    }
    bucket.staticContainer.addChild(mesh)
    bucket.staticCacheDirty = true
  }

  addEnvironmentDecoration(mesh: Container, layer: number): void {
    const bucket = this.ensureBucket(layer)
    bucket.environmentContainer.addChild(mesh)
  }

  invalidateStaticMeshCaches(): void {
    for (const bucket of this.buckets.values()) {
      if (bucket.staticContainer.isCachedAsTexture) {
        bucket.staticContainer.cacheAsTexture(false)
      }
      bucket.staticCacheDirty = bucket.staticContainer.children.length > 0
    }
  }

  refreshStaticMeshCaches(): void {
    for (const bucket of this.buckets.values()) {
      const staticContainer = bucket.staticContainer
      if (staticContainer.children.length === 0) {
        if (staticContainer.isCachedAsTexture) {
          staticContainer.cacheAsTexture(false)
        }
        bucket.staticCacheDirty = false
        continue
      }
      if (bucket.staticCacheDirty) {
        staticContainer.cacheAsTexture(true)
        bucket.staticCacheDirty = false
      } else if (!staticContainer.isCachedAsTexture) {
        staticContainer.cacheAsTexture(true)
      }
    }
  }

  private attachViewToLayer(view: EntityView, layer: number): void {
    if (view.layer === layer && view.root.parent) {
      return
    }

    const bucket = this.ensureBucket(layer)
    if (view.root.parent !== bucket.dynamicContainer) {
      bucket.dynamicContainer.addChild(view.root)
    }
    view.layer = layer
  }

  private hideEntityView(view: EntityView): void {
    view.root.visible = false
    hideSprite(view.specialSprite)
    hideSprite(view.bodySprite)
    hideSprite(view.weaponSprite)
    hideGraphics(view.specialGraphics)
    hideGraphics(view.statusGraphics)
    hideGraphics(view.deathGraphics)
    hideGraphics(view.collisionDebugGraphics)
    hideSprite(view.followBondSprite)
    hideSprite(view.followUnbondSprite)
    view.lastHealthRatio = -1
    view.lastDamageTextToken = -1
    view.weaponChildIndex = -1
    this.recycleDamageTexts(view)
    if (view.spineBody) {
      view.spineBody.visible = false
      this.activeSpineViews.delete(view)
    }
  }

  private pruneEntityViews(): void {
    const normalRetireBeforeFrame = this.frameId - ENTITY_VIEW_RETIRE_FRAMES
    const pressureRetireBeforeFrame =
      this.frameId - ENTITY_VIEW_PRESSURE_RETIRE_FRAMES

    for (const [id, view] of this.entityViews) {
      if (view.lastSeenFrame === this.frameId) {
        continue
      }

      const shouldRetireNormally = view.lastSeenFrame < normalRetireBeforeFrame
      const shouldRetireUnderPressure =
        this.entityViews.size > MAX_ENTITY_VIEW_CACHE &&
        view.lastSeenFrame < pressureRetireBeforeFrame

      if (!shouldRetireNormally && !shouldRetireUnderPressure) {
        continue
      }

      this.destroyEntityView(id, view)
    }
  }

  private destroyEntityView(id: number, view: EntityView): void {
    this.recycleDamageTexts(view)
    if (view.spineBody) {
      releaseSpine(view.spineKey, view.spineBody)
      view.spineBody = null
      view.spineKey = ''
      view.spineAnimState = ''
      this.activeSpineViews.delete(view)
    }
    if (view.skeletalGait) {
      releaseGaitState(view.skeletalGait)
      view.skeletalGait = null
      view.skeletalProfileKey = ''
    }
    if (view.root.parent) {
      view.root.parent.removeChild(view.root)
    }

    view.root.destroy({ children: true })
    this.entityViews.delete(id)
  }

  private getEntityGroundSortZ(
    buf: Float32Array,
    offset: number,
    centerY: number
  ): number {
    const flags = buf[offset + OFFSETS.FLAGS]
    const radiusPx = buf[offset + OFFSETS.RADIUS] * this.pixelsPerMeter
    const healthMax = buf[offset + OFFSETS.STATS_HEALTH_MAX]
    const weaponActive = buf[offset + OFFSETS.WEAPON_ACTIVE] === 1
    const isStandaloneWeapon =
      weaponActive && !(radiusPx > 0) && !(healthMax > 0)
    const groundY = isStandaloneWeapon
      ? (buf[offset + OFFSETS.WEAPON_Y] +
          Math.max(0, buf[offset + OFFSETS.WEAPON_H] * 0.5)) *
        this.pixelsPerMeter
      : centerY + Math.max(0, radiusPx)

    let sortOffset = isStandaloneWeapon ? STANDALONE_WEAPON_SORT_OFFSET : 0
    if (flags & FLAGS.CHECKPOINT) {
      sortOffset += CHECKPOINT_SORT_OFFSET
    } else if (flags & (FLAGS.SUN_PICKUP_SMALL | FLAGS.SUN_PICKUP_LARGE)) {
      sortOffset += SUN_PICKUP_SORT_OFFSET
    } else if (flags & FLAGS.TERRAIN_DEBRIS) {
      sortOffset += TERRAIN_DEBRIS_SORT_OFFSET
    }

    return Math.round(groundY * ENTITY_GROUND_SORT_SCALE) + sortOffset
  }

  private updateSpecialIcons(
    view: EntityView,
    entityId: number,
    renderer: ClientRenderer,
    buf: Float32Array,
    offset: number,
    flags: number,
    alpha: number,
    playerOffset: number,
    playerLockedTargetId: number,
    playerX: number,
    playerY: number
  ): void {
    hideSprite(view.specialSprite)
    hideGraphics(view.specialGraphics)
    hideGraphics(view.statusGraphics)
    hideGraphics(view.deathGraphics)
    hideGraphics(view.collisionDebugGraphics)
    hideSprite(view.followBondSprite)
    hideSprite(view.followUnbondSprite)

    if (flags & FLAGS.TERRAIN_DEBRIS) {
      this.updateTerrainDebris(view, renderer, buf, offset, alpha)
      if (DEBUG_DRAW_BREAKABLE_CRATE_HEALTH) {
        this.updateStatusBars(
          view,
          renderer,
          buf,
          offset,
          flags,
          playerLockedTargetId
        )
      }
      return
    }
    if (flags & FLAGS.EXP_ORB) {
      this.updateExpOrb(view)
      return
    }
    if (flags & FLAGS.SUN_PICKUP_SMALL) {
      this.updateSunPickup(view, false)
      return
    }
    if (flags & FLAGS.SUN_PICKUP_LARGE) {
      this.updateSunPickup(view, true)
      return
    }
    if (flags & FLAGS.GRAPPLE_ANCHOR) {
      this.updateGrappleAnchor(view, renderer, buf, offset, flags, alpha)
      return
    }
    if (flags & FLAGS.CHECKPOINT) {
      this.updateCheckpoint(view, renderer, buf, offset, alpha)
      return
    }

    const weaponTypeId = buf[offset + OFFSETS.WEAPON_TYPE] | 0
    const isStandaloneWeapon =
      buf[offset + OFFSETS.WEAPON_ACTIVE] === 1 &&
      buf[offset + OFFSETS.STATS_HEALTH_MAX] <= 0 &&
      !isProjectileWeaponType(weaponTypeId)

    if (!isStandaloneWeapon) {
      const bodyProfileIndex = buf[offset + OFFSETS.BODY_PROFILE_INDEX] | 0
      const bodyProfile = renderer.getCharacterBodyProfile(bodyProfileIndex)

      if (bodyProfile?.skeletalMode) {
        const renderedSkeletalBody = this.updateSkeletalBody(
          view,
          renderer,
          buf,
          offset,
          alpha,
          bodyProfile
        )
        if (!renderedSkeletalBody) {
          this.updateBodySprite(view, renderer, buf, offset, flags, alpha)
        }
        if (DEBUG_DRAW_PLAYER_COLLISION_SHAPE) {
          this.updateCollisionDebug(view, renderer, buf, offset, entityId)
        }
      } else {
        const spineKey = bodyProfile?.spineKey ?? ''
        this.updateSpineBody(
          view,
          renderer,
          buf,
          offset,
          flags,
          alpha,
          bodyProfile,
          spineKey
        )
        if (!spineKey || bodyProfile?.spineMode === 'overlay') {
          this.updateBodySprite(view, renderer, buf, offset, flags, alpha)
        } else {
          hideSprite(view.bodySprite)
        }
        if (DEBUG_DRAW_PLAYER_COLLISION_SHAPE) {
          this.updateCollisionDebug(view, renderer, buf, offset, entityId)
        }
      } // end else (non-skeletal branch)
    } else {
      hideSprite(view.bodySprite)
      this.clearSpineBody(view)
    }

    this.updateWeaponSprite(
      view,
      renderer,
      buf,
      offset,
      flags,
      isStandaloneWeapon,
      alpha
    )
    this.updateStatusBars(
      view,
      renderer,
      buf,
      offset,
      flags,
      playerLockedTargetId
    )
    this.updateDeathCross(view, buf, offset, flags)
    this.updateFollowIcons(
      view,
      buf,
      offset,
      flags,
      playerOffset,
      playerX,
      playerY
    )
  }

  private updateTerrainDebris(
    view: EntityView,
    renderer: ClientRenderer,
    buf: Float32Array,
    offset: number,
    alpha: number
  ): void {
    const width = Math.max(
      2,
      Math.round(buf[offset + OFFSETS.WEAPON_W] * this.pixelsPerMeter)
    )
    const height = Math.max(
      2,
      Math.round(buf[offset + OFFSETS.WEAPON_H] * this.pixelsPerMeter)
    )
    const variant = buf[offset + OFFSETS.WEAPON_TYPE] | 0
    const fillColor = renderer.getColorHex(buf[offset + OFFSETS.COLOR] | 0)
    const strokeColor = renderer.getColorHex(
      buf[offset + OFFSETS.BORDER_COLOR] | 0
    )
    const strokeWidth = Math.max(1, Math.round(Math.min(width, height) * 0.12))
    const key = [
      width,
      height,
      variant,
      fillColor,
      strokeColor,
      strokeWidth,
    ].join('|')

    if (view.specialKey !== key) {
      const halfW = width * 0.5
      const halfH = height * 0.5
      view.specialGraphics.clear()
      if (variant >= 4) {
        const inset = Math.max(1, Math.round(Math.min(width, height) * 0.18))
        view.specialGraphics.rect(-halfW, -halfH, width, height)
        view.specialGraphics.fill({ color: fillColor })
        view.specialGraphics.stroke({
          color: strokeColor,
          width: strokeWidth,
          join: 'round',
        })
        if (variant === 4) {
          view.specialGraphics
            .moveTo(-halfW + inset, 0)
            .lineTo(halfW - inset, 0)
            .stroke({ color: strokeColor, width: 1, join: 'round' })
        } else {
          view.specialGraphics
            .moveTo(0, -halfH + inset)
            .lineTo(0, halfH - inset)
            .stroke({ color: strokeColor, width: 1, join: 'round' })
        }
      } else if ((variant & 3) === 0) {
        view.specialGraphics
          .moveTo(-halfW, -halfH * 0.55)
          .lineTo(-halfW * 0.2, -halfH)
          .lineTo(halfW, -halfH * 0.35)
          .lineTo(halfW * 0.45, halfH)
          .lineTo(-halfW, halfH * 0.45)
          .closePath()
      } else if ((variant & 3) === 1) {
        view.specialGraphics
          .moveTo(-halfW, -halfH * 0.3)
          .lineTo(-halfW * 0.15, -halfH)
          .lineTo(halfW, -halfH * 0.15)
          .lineTo(halfW * 0.2, halfH)
          .lineTo(-halfW * 0.85, halfH * 0.25)
          .closePath()
      } else if ((variant & 3) === 2) {
        view.specialGraphics
          .moveTo(-halfW, -halfH)
          .lineTo(halfW * 0.4, -halfH * 0.65)
          .lineTo(halfW, halfH * 0.1)
          .lineTo(halfW * 0.15, halfH)
          .lineTo(-halfW, halfH * 0.25)
          .closePath()
      } else {
        view.specialGraphics
          .moveTo(-halfW * 0.75, -halfH)
          .lineTo(halfW, -halfH * 0.55)
          .lineTo(halfW * 0.55, halfH * 0.15)
          .lineTo(-halfW * 0.15, halfH)
          .lineTo(-halfW, halfH * 0.1)
          .closePath()
      }
      if (variant < 4) {
        view.specialGraphics.fill({ color: fillColor })
        view.specialGraphics.stroke({
          color: strokeColor,
          width: strokeWidth,
          join: 'round',
        })
      }
      view.specialKey = key
    }

    this.updateTerrainDebrisCollisionDebug(
      view,
      width,
      height,
      variant,
      alpha * buf[offset + OFFSETS.WEAPON_DRAW],
      buf[offset + OFFSETS.WEAPON_ROT]
    )
    view.specialGraphics.visible = true
    view.specialGraphics.rotation = buf[offset + OFFSETS.WEAPON_ROT]
    view.specialGraphics.alpha = alpha * buf[offset + OFFSETS.WEAPON_DRAW]
    hideSprite(view.bodySprite)
    hideSprite(view.weaponSprite)
    this.clearSpineBody(view)
  }

  private updateTerrainDebrisCollisionDebug(
    view: EntityView,
    width: number,
    height: number,
    variant: number,
    alpha: number,
    rotation: number
  ): void {
    if (!DEBUG_DRAW_TERRAIN_COLLISION_SHAPE || variant < 4) {
      hideGraphics(view.collisionDebugGraphics)
      return
    }

    const key = `${width}|${height}|${variant}`
    if (view.collisionDebugKey !== key) {
      const halfW = width * 0.5
      const halfH = height * 0.5
      view.collisionDebugGraphics.clear()
      view.collisionDebugGraphics.rect(-halfW, -halfH, width, height)
      view.collisionDebugGraphics.stroke({
        color: TERRAIN_COLLISION_DEBUG_COLOR,
        width: TERRAIN_COLLISION_DEBUG_LINE_WIDTH,
        alpha: TERRAIN_COLLISION_DEBUG_ALPHA,
      })
      view.collisionDebugKey = key
    }

    view.collisionDebugGraphics.visible = true
    view.collisionDebugGraphics.rotation = rotation
    view.collisionDebugGraphics.alpha = alpha
  }

  private updateExpOrb(view: EntityView): void {
    view.specialSprite.visible = true
    view.specialSprite.texture = this.getExpOrbTexture()
    view.specialSprite.alpha = 1
    hideSprite(view.bodySprite)
    hideSprite(view.weaponSprite)
  }

  private updateSunPickup(view: EntityView, isLarge: boolean): void {
    view.specialSprite.visible = true
    view.specialSprite.texture = isLarge
      ? this.getSunTexture(true)
      : this.getSunTexture(false)
    view.specialSprite.alpha = 1
    hideSprite(view.bodySprite)
    hideSprite(view.weaponSprite)
  }

  private updateCheckpoint(
    view: EntityView,
    renderer: ClientRenderer,
    buf: Float32Array,
    offset: number,
    alpha: number
  ): void {
    const radius = buf[offset + OFFSETS.RADIUS] * this.pixelsPerMeter
    const leafColorInt = buf[offset + OFFSETS.COLOR] | 0
    const leafColor = renderer.getColorHex(leafColorInt)
    const trunkColor = renderer.getColorHex(
      buf[offset + OFFSETS.BORDER_COLOR] | 0
    )
    const active = leafColorInt === CHECKPOINT_TREE_TOP_COLOR_ACTIVE_INT
    const flags = buf[offset + OFFSETS.FLAGS] | 0
    const cellStroke = (flags & FLAGS.CHECKPOINT_CELL_STROKE) !== 0
    const key = [
      radius | 0,
      leafColor,
      trunkColor,
      active ? 1 : 0,
      cellStroke ? 1 : 0,
    ].join('|')

    if (view.specialKey !== key || !view.specialSprite.visible) {
      const textureEntry = this.getCheckpointTexture(
        radius,
        leafColor,
        trunkColor,
        active,
        cellStroke
      )
      view.specialSprite.texture = textureEntry.texture
      view.specialSprite.anchor.set(textureEntry.anchorX, textureEntry.anchorY)
      view.specialKey = key
    }

    view.specialSprite.visible = true
    view.specialSprite.alpha = alpha
    hideSprite(view.bodySprite)
    hideSprite(view.weaponSprite)
  }

  preloadCheckpointTextures(): void {
    const radiusPx = DEFAULT_CHECKPOINT_RENDER_RADIUS * this.pixelsPerMeter
    this.getCheckpointTexture(
      radiusPx,
      CHECKPOINT_TREE_TOP_COLOR_INACTIVE,
      CHECKPOINT_TREE_TRUNK_COLOR_INACTIVE,
      false,
      false
    )
    this.getCheckpointTexture(
      radiusPx,
      CHECKPOINT_TREE_TOP_COLOR_ACTIVE,
      CHECKPOINT_TREE_TRUNK_COLOR_ACTIVE,
      true,
      false
    )
  }

  private getCheckpointTexture(
    radius: number,
    leafColor: string,
    trunkColor: string,
    glow: boolean,
    cellStroke = false
  ): CheckpointTextureEntry {
    const key = [
      Math.max(1, Math.round(radius)),
      leafColor.toLowerCase(),
      trunkColor.toLowerCase(),
      glow ? 1 : 0,
      cellStroke ? 1 : 0,
    ].join('|')
    const cached = this.checkpointTextureCache.get(key)
    if (cached) {
      return cached
    }

    const t0 = performance.now()
    const source = createCheckpointTreeTextureSource({
      radiusPx: radius,
      leafColor,
      trunkColor,
      glow,
      cellStroke,
    })
    const entry: CheckpointTextureEntry = {
      texture: Texture.from(source.canvas),
      anchorX: source.originX / source.canvas.width,
      anchorY: source.originY / source.canvas.height,
    }
    const elapsedMs = performance.now() - t0
    this.checkpointTexGenUs += Math.round(elapsedMs * 1000)
    this.checkpointTextureCache.set(key, entry)
    return entry
  }

  private updateGrappleAnchor(
    view: EntityView,
    renderer: ClientRenderer,
    buf: Float32Array,
    offset: number,
    flags: number,
    alpha: number
  ): void {
    const radius = buf[offset + OFFSETS.RADIUS] * this.pixelsPerMeter
    const highlightScale =
      flags & FLAGS.GRAPPLE_ANCHOR_HIGHLIGHT
        ? GRAPPLE_ANCHOR_HIGHLIGHT_SCALE
        : 1
    const ringRadius = Math.max(3, Math.round(radius * 0.7 * highlightScale))
    const strokeWidth = Math.max(2, Math.round(ringRadius * 0.18))
    const dotRadius = Math.max(2, Math.round(ringRadius * 0.2))
    const ringColor = renderer.getColorHex(buf[offset + OFFSETS.COLOR] | 0)
    const dotColor = renderer.getColorHex(
      buf[offset + OFFSETS.BORDER_COLOR] | 0
    )
    const key = [ringRadius, strokeWidth, dotRadius, ringColor, dotColor].join(
      '|'
    )

    if (view.specialKey !== key) {
      view.specialGraphics.clear()
      view.specialGraphics
        .circle(0, 0, ringRadius)
        .stroke({ color: ringColor, width: strokeWidth })
      view.specialGraphics.circle(0, 0, dotRadius).fill(dotColor)
      view.specialKey = key
    }

    view.specialGraphics.visible = true
    view.specialGraphics.alpha = alpha
    hideSprite(view.bodySprite)
    hideSprite(view.weaponSprite)
  }

  private clearSpineBody(view: EntityView): void {
    if (!view.spineBody) return
    releaseSpine(view.spineKey, view.spineBody)
    view.spineBody = null
    view.spineKey = ''
    view.spineAnimState = ''
    this.activeSpineViews.delete(view)
  }

  private updateSkeletalBody(
    view: EntityView,
    renderer: ClientRenderer,
    buf: Float32Array,
    offset: number,
    alpha: number,
    bodyProfile: MapCharacterBodyProfile
  ): boolean {
    hideSprite(view.bodySprite)

    const radiusPx = buf[offset + OFFSETS.RADIUS] * this.pixelsPerMeter
    if (!(radiusPx > 0)) {
      this.clearSpineBody(view)
      return false
    }

    if (!areSkeletalBoneShapeTexturesReady(bodyProfile.boneSegments)) {
      this.clearSpineBody(view)
      return false
    }

    const profileKey = `skeletal:${buildSkeletalSpineCacheKey(
      bodyProfile.boneSegments,
      radiusPx,
      this.pixelsPerMeter
    )}`
    if (!view.skeletalGait) {
      view.skeletalGait = acquireGaitState()
    }
    if (view.skeletalProfileKey !== profileKey) {
      view.skeletalGait.phaseInt = 0
      view.skeletalGait.footLX = 0
      view.skeletalGait.footLY = 0
      view.skeletalGait.footRX = 0
      view.skeletalGait.footRY = 0
      view.skeletalProfileKey = profileKey
    }

    const definition = getOrBuildSkeletalSpineDefinition(
      bodyProfile.boneSegments,
      radiusPx,
      this.pixelsPerMeter
    )
    if (view.spineKey !== profileKey) {
      this.clearSpineBody(view)
      const spine = acquireProceduralSpine(profileKey, definition.skeletonData)
      view.spineBody = spine
      view.spineKey = profileKey
      view.spineAnimState = 'skeletal_walk'
      const bodyChildIndex = view.root.getChildIndex(view.bodySprite)
      view.root.addChildAt(spine, bodyChildIndex)
    }

    const spine = view.spineBody
    if (!spine) {
      return false
    }

    const facing = renderer.getFacingForEntity(buf, offset)
    const flags = buf[offset + OFFSETS.FLAGS] | 0
    const fallbackMoveDir = buf[offset + OFFSETS.MOVE_DIR] | 0
    const velocityX = buf[offset + OFFSETS.MOTION_VELOCITY_X]
    const velocityY = buf[offset + OFFSETS.MOTION_VELOCITY_Y]
    const isGrounded = buf[offset + OFFSETS.MOTION_IS_GROUNDED] === 1
    const isSprinting = buf[offset + OFFSETS.MOTION_IS_SPRINTING] === 1
    const animationName = resolveSkeletalAnimationNameFromMotionState(
      (flags & FLAGS.DEAD) !== 0,
      (flags & FLAGS.STAGGERED) !== 0,
      (flags & FLAGS.ROLLING) !== 0,
      (flags & FLAGS.WEAPON_ATTACKING) !== 0,
      (flags & FLAGS.WEAPON_BLOCKING) !== 0,
      isGrounded,
      isSprinting,
      fallbackMoveDir,
      velocityX,
      velocityY
    )
    const moveDir = resolveSkeletalMoveDirection(
      velocityX,
      fallbackMoveDir,
      facing
    )
    const deltaMsInt = Math.max(0, Math.round(this.currentFrameDeltaMs)) | 0
    const displayScale = this.pixelsPerMeter / SKELETAL_EDITOR_PPM

    view.spineAnimState = animationName
    updateSkeletalPose(
      spine.skeleton,
      definition.boneIndex,
      view.skeletalGait,
      animationName,
      buf,
      offset,
      moveDir,
      facing,
      SKELETAL_EDITOR_PPM,
      deltaMsInt
    )
    spine.position.set(0, 0)
    spine.scale.set(facing < 0 ? -displayScale : displayScale, displayScale)
    spine.alpha = alpha
    spine.visible = true
    spine.update(0)
    return true
  }

  private updateSpineBody(
    view: EntityView,
    renderer: ClientRenderer,
    buf: Float32Array,
    offset: number,
    flags: number,
    alpha: number,
    bodyProfile: MapCharacterBodyProfile | null,
    spineKey: string
  ): void {
    if (!spineKey || !isSpineLoaded(spineKey)) {
      this.clearSpineBody(view)
      return
    }

    if (view.spineKey !== spineKey) {
      this.clearSpineBody(view)
      const spine = acquireSpine(spineKey)
      if (!spine) return
      view.spineBody = spine
      view.spineKey = spineKey
      view.root.addChild(spine)
    }

    const spine = view.spineBody
    if (!spine) return

    const animName = bodyProfile?.spineAnimationName ?? ''
    if (animName && view.spineAnimState !== animName) {
      spine.state.setAnimation(0, animName, true)
      spine.update(0)
      view.spineAnimState = animName
    }

    const scale = getSpinePreviewMatchedScale(
      spineKey,
      bodyProfile?.spineScale ?? 1
    )
    // 渲染基准必须吃到与 Spine 分段碰撞同源的纵向偏移，
    // 否则动画本体会与 runtime bounding box 线框长期存在固定错位。
    const collisionOffsetY =
      renderer.getSpineCollisionRenderOffsetYPx(bodyProfile)
    const facing = renderer.getFacingForEntity(buf, offset)
    const radiusPx = buf[offset + OFFSETS.RADIUS] * this.pixelsPerMeter
    const bounds = getSpineBoundsAtScale(spineKey, scale)

    // 水平：以包围盒中心对齐物理体中心，翻转时位置随之调整
    // 垂直：对齐包围盒底部与物理体底部（地面接触点）
    const spineCenterOffsetX = bounds.offsetX + bounds.width / 2
    spine.scale.set(-facing * scale, scale)
    spine.position.set(
      facing * spineCenterOffsetX,
      radiusPx - bounds.offsetY - bounds.height + collisionOffsetY
    )
    spine.alpha = alpha
    spine.visible = true

    this.activeSpineViews.add(view)
  }

  private updateBodySprite(
    view: EntityView,
    renderer: ClientRenderer,
    buf: Float32Array,
    offset: number,
    flags: number,
    alpha: number
  ): void {
    const radius = buf[offset + OFFSETS.RADIUS] * this.pixelsPerMeter
    if (!(radius > 0)) {
      hideSprite(view.bodySprite)
      return
    }

    const bodyHeightPx = buf[offset + OFFSETS.BODY_HEIGHT] * this.pixelsPerMeter
    const bodyProfileIndex = buf[offset + OFFSETS.BODY_PROFILE_INDEX] | 0
    const bodyProfile = renderer.getCharacterBodyProfile(bodyProfileIndex)
    const bodyTexture = renderer.getCharacterBodyTextureSource(
      getCharacterBodyTextureDataUrl(bodyProfile)
    )
    const facing = renderer.getFacingForEntity(buf, offset)
    const hasFollowBound = !!(flags & FLAGS.FOLLOW_BOUND)
    const outlineWidthPx = hasFollowBound ? Math.max(1, radius >> 3) : 0
    const bodyColor = getCharacterBodyColor(
      bodyProfile,
      renderer.getColorHex(buf[offset + OFFSETS.COLOR] | 0)
    )
    const assetsReady = isBodyVisualAssetsReady(bodyProfile, bodyTexture)

    let bodyHash = 0x811c9dc5
    bodyHash = fnvMix(bodyHash, bodyProfileIndex)
    bodyHash = fnvMix(bodyHash, radius)
    bodyHash = fnvMixStr(bodyHash, bodyColor)
    bodyHash = fnvMix(bodyHash, bodyHeightPx)
    bodyHash = fnvMix(bodyHash, facing)
    bodyHash = fnvMix(bodyHash, outlineWidthPx)
    bodyHash = fnvMix(bodyHash, bodyProfile?.layers?.length ?? 0)
    bodyHash = fnvMix(bodyHash, assetsReady ? 1 : 0)
    bodyHash = bodyHash >>> 0

    if (view.bodyHash !== bodyHash) {
      const textureKey = [
        getCharacterBodyTextureDataUrl(bodyProfile),
        bodyProfile?.layers?.length ?? 0,
        assetsReady ? 1 : 0,
      ].join('|')
      const spriteSource = getBodySpriteSource(
        radius,
        bodyColor,
        this.pixelsPerMeter,
        facing,
        bodyHeightPx || undefined,
        hasFollowBound ? FOLLOW_BOUND_BORDER_COLOR : '',
        outlineWidthPx,
        bodyProfile,
        bodyTexture,
        true,
        '#000000',
        String(bodyProfileIndex),
        textureKey
      )

      if (!spriteSource) {
        hideSprite(view.bodySprite)
        return
      }

      view.bodySprite.texture = this.getBodyTexture(spriteSource.canvas)
      view.bodySprite.anchor.set(
        -spriteSource.drawX / spriteSource.drawWidth,
        -spriteSource.drawY / spriteSource.drawHeight
      )
      view.bodyHash = bodyHash
    }

    const rollAngle = buf[offset + OFFSETS.ROLL_ANGLE]
    const offsetY = this.getBodyRollOffsetY(
      bodyProfile,
      radius,
      bodyHeightPx,
      rollAngle
    )

    view.bodySprite.visible = true
    view.bodySprite.position.set(0, offsetY)
    view.bodySprite.rotation = rollAngle
    view.bodySprite.alpha = alpha
  }

  private getBodyRollOffsetY(
    bodyProfile: MapCharacterBodyProfile | null,
    radius: number,
    bodyHeightPx: number,
    rollAngle: number
  ): number {
    if (rollAngle === 0) {
      return 0
    }

    const profileWidthPx =
      getCharacterBodyProfileWidth(bodyProfile) > 0
        ? getCharacterBodyProfileWidth(bodyProfile) * this.pixelsPerMeter
        : 0
    const profileHeightPx =
      getCharacterBodyProfileHeight(bodyProfile) > 0
        ? getCharacterBodyProfileHeight(bodyProfile) * this.pixelsPerMeter
        : 0
    const halfWidth = profileWidthPx > 0 ? profileWidthPx * 0.5 : radius
    const halfHeight =
      profileHeightPx > 0
        ? profileHeightPx * 0.5
        : bodyHeightPx > 0
          ? bodyHeightPx * 0.5
          : radius

    if (halfWidth === halfHeight) {
      return 0
    }

    const sinA = Math.sin(rollAngle)
    const cosA = Math.cos(rollAngle)
    const rotatedLow = Math.sqrt(
      halfWidth * halfWidth * sinA * sinA +
        halfHeight * halfHeight * cosA * cosA
    )
    return halfHeight - rotatedLow
  }

  private updateCollisionDebug(
    view: EntityView,
    renderer: ClientRenderer,
    buf: Float32Array,
    offset: number,
    entityId: number
  ): void {
    const bodyProfileIndex = buf[offset + OFFSETS.BODY_PROFILE_INDEX] | 0
    const bodyProfile = renderer.getCharacterBodyProfile(bodyProfileIndex)
    const isSegmentedBody = bodyProfile?.spineSegmentedCollision === true
    const radius = buf[offset + OFFSETS.RADIUS]
    const bodyHeight = buf[offset + OFFSETS.BODY_HEIGHT]
    const ppm = this.pixelsPerMeter
    const g = view.collisionDebugGraphics

    // 与视觉 bodySprite 保持一致：facing 方向翻转 + roll 旋转
    const facing = renderer.getFacingForEntity(buf, offset)
    const rollAngle = buf[offset + OFFSETS.ROLL_ANGLE]
    const radiusPx = radius * ppm
    const bodyHeightPx = bodyHeight * ppm
    const offsetY = this.getBodyRollOffsetY(
      bodyProfile,
      radiusPx,
      bodyHeightPx,
      rollAngle
    )
    g.scale.x = facing < 0 ? -1 : 1
    g.rotation = rollAngle
    g.position.y = offsetY

    g.clear()
    g.visible = true

    const spineCollisionPolygons =
      renderer.getSpineCollisionDebugPolygons(entityId)
    if (spineCollisionPolygons && spineCollisionPolygons.length > 0) {
      g.scale.x = 1
      g.rotation = 0
      g.position.y = 0
      // Spine 角色调试时只画运行时分段碰撞；
      // 旧版静态轮廓不能与其叠加，否则会误导“真实碰撞形状”的判断。
      if (!this.appendCollisionDebugPolygons(g, spineCollisionPolygons, ppm)) {
        g.visible = false
        return
      }
      g.stroke({
        color: COLLISION_DEBUG_COLOR,
        width: COLLISION_DEBUG_LINE_WIDTH,
        alpha: 0.95,
      })
      return
    }

    if (isSegmentedBody) {
      g.visible = false
      return
    }

    const bodyCollisionPolygons = renderer.getBodyCollisionPolygons(
      bodyProfile,
      radius,
      bodyHeight
    )
    if (
      bodyCollisionPolygons &&
      this.appendCollisionDebugPolygons(g, bodyCollisionPolygons, ppm)
    ) {
      g.stroke({
        color: COLLISION_DEBUG_COLOR,
        width: COLLISION_DEBUG_LINE_WIDTH,
        alpha: 0.95,
      })
    } else {
      const halfHeightPx = bodyHeight > 0 ? bodyHeightPx / 2 : radiusPx
      g.ellipse(0, 0, radiusPx, halfHeightPx)
      g.stroke({
        color: COLLISION_DEBUG_COLOR,
        width: COLLISION_DEBUG_LINE_WIDTH,
        alpha: 0.95,
      })
    }
  }

  private appendCollisionDebugPolygons(
    graphics: Graphics,
    polygons: number[][] | null,
    pixelsPerMeter: number
  ): boolean {
    if (!polygons || polygons.length === 0) {
      return false
    }

    let hasPolygon = false
    for (let i = 0; i < polygons.length; i++) {
      const polygon = polygons[i]
      if (polygon.length < 6) {
        continue
      }
      graphics.moveTo(polygon[0] * pixelsPerMeter, polygon[1] * pixelsPerMeter)
      for (let j = 2; j < polygon.length; j += 2) {
        graphics.lineTo(
          polygon[j] * pixelsPerMeter,
          polygon[j + 1] * pixelsPerMeter
        )
      }
      graphics.closePath()
      hasPolygon = true
    }

    return hasPolygon
  }

  private updateWeaponSprite(
    view: EntityView,
    renderer: ClientRenderer,
    buf: Float32Array,
    offset: number,
    flags: number,
    isStandaloneWeapon: boolean,
    alpha: number
  ): void {
    if (flags & FLAGS.DEAD || flags & FLAGS.VANISHED) {
      hideSprite(view.weaponSprite)
      return
    }

    if (buf[offset + OFFSETS.WEAPON_ACTIVE] !== 1) {
      hideSprite(view.weaponSprite)
      return
    }
    const entityX = buf[offset + OFFSETS.X]
    const entityY = buf[offset + OFFSETS.Y]
    const weaponX = buf[offset + OFFSETS.WEAPON_X]
    const weaponY = buf[offset + OFFSETS.WEAPON_Y]
    const weaponRotation = buf[offset + OFFSETS.WEAPON_ROT]
    let weaponWidth = buf[offset + OFFSETS.WEAPON_W] * this.pixelsPerMeter
    let weaponHeight = buf[offset + OFFSETS.WEAPON_H] * this.pixelsPerMeter
    const weaponType = buf[offset + OFFSETS.WEAPON_TYPE] | 0
    const bowDraw = buf[offset + OFFSETS.WEAPON_DRAW]
    const bowDrawActive = buf[offset + OFFSETS.WEAPON_DRAW_ACTIVE] === 1
    const bowHasArrow = buf[offset + OFFSETS.WEAPON_HAS_ARROW] === 1
    const isAttacking = !!(flags & FLAGS.WEAPON_ATTACKING)
    const isInCombat = !!(flags & FLAGS.IN_COMBAT)
    const color = isStandaloneWeapon ? HUD_ICON_COLOR : '#b4bdc7'
    const weaponLocalX = (weaponX - entityX) * this.pixelsPerMeter
    const weaponLocalY = (weaponY - entityY) * this.pixelsPerMeter
    const projectileRadiusPx =
      buf[offset + OFFSETS.WEAPON_R] * this.pixelsPerMeter

    if (isStandaloneWeapon) {
      const maxSizePx = Math.round(
        (DEFAULT_PLAYER_RADIUS * 4 * this.pixelsPerMeter) / 3
      )
      const scale = weaponWidth > 0 ? maxSizePx / weaponWidth : 1
      weaponWidth = Math.round(weaponWidth * scale)
      weaponHeight = Math.round(weaponHeight * scale)
    }

    const arrowVisible =
      weaponType === WEAPON_TYPES.BOW &&
      bowHasArrow &&
      (bowDrawActive || (isInCombat && bowDraw <= 0))
    const quantizedBowDraw =
      weaponType === WEAPON_TYPES.BOW || weaponType === WEAPON_TYPES.BOMB
        ? getQuantizedBowDraw(bowDraw)
        : 0

    let weaponHash = 0x811c9dc5
    weaponHash = fnvMix(weaponHash, weaponType)
    weaponHash = fnvMix(weaponHash, weaponWidth)
    weaponHash = fnvMix(weaponHash, weaponHeight)
    weaponHash = fnvMix(weaponHash, isAttacking ? 1 : 0)
    weaponHash = fnvMix(weaponHash, quantizedBowDraw)
    weaponHash = fnvMix(weaponHash, arrowVisible ? 1 : 0)
    weaponHash = fnvMix(weaponHash, Math.round(projectileRadiusPx))
    weaponHash = fnvMix(weaponHash, isStandaloneWeapon ? 1 : 0)
    weaponHash = weaponHash >>> 0

    if (view.weaponHash !== weaponHash) {
      view.weaponSprite.texture = this.getWeaponTexture(
        weaponType,
        weaponWidth,
        weaponHeight,
        color,
        isAttacking,
        quantizedBowDraw,
        arrowVisible,
        projectileRadiusPx
      )
      view.weaponHash = weaponHash
    }

    view.weaponSprite.visible = true
    view.weaponSprite.position.set(weaponLocalX, weaponLocalY)
    view.weaponSprite.rotation = weaponRotation
    view.weaponSprite.alpha = isStandaloneWeapon ? HUD_ICON_ALPHA : alpha

    if (view.weaponSprite.parent === view.root) {
      const targetChildIndex =
        renderer.getFacingForEntity(buf, offset) < 0 ? 2 : 3
      if (view.weaponChildIndex !== targetChildIndex) {
        view.root.setChildIndex(view.weaponSprite, targetChildIndex)
        view.weaponChildIndex = targetChildIndex
      }
    }
  }

  private updateStatusBars(
    view: EntityView,
    renderer: ClientRenderer,
    buf: Float32Array,
    offset: number,
    flags: number,
    playerLockedTargetId: number
  ): void {
    const deltaMs = renderer.getLastRenderDeltaMs()
    const maxHealth = buf[offset + OFFSETS.STATS_HEALTH_MAX]
    const isPlayer = !!(flags & FLAGS.IS_PLAYER)
    const isInCombat = !!(flags & FLAGS.IN_COMBAT)
    const isLocked = (buf[offset + OFFSETS.ID] | 0) === playerLockedTargetId
    const isHealthBarFlash = !!(flags & FLAGS.HEALTH_BAR_FLASH)
    const isTerrainDebris = !!(flags & FLAGS.TERRAIN_DEBRIS)
    const isDebugCrateHealth =
      DEBUG_DRAW_BREAKABLE_CRATE_HEALTH && isTerrainDebris

    if (!(maxHealth > 0)) {
      hideGraphics(view.statusGraphics)
      view.lastHealthRatio = -1
      view.lastDamageTextToken = -1
      this.recycleDamageTexts(view)
      return
    }

    const health = buf[offset + OFFSETS.STATS_HEALTH]
    const damageTextValue = Math.max(
      0,
      Math.round(buf[offset + OFFSETS.STATS_DAMAGE_TEXT_VALUE])
    )
    const damageTextToken = buf[offset + OFFSETS.STATS_DAMAGE_TEXT_TOKEN] | 0
    const radiusMeters = buf[offset + OFFSETS.RADIUS]
    const barWidth = 1.1 * this.pixelsPerMeter
    const barHeight = 6
    let baseY = -radiusMeters * this.pixelsPerMeter - 18
    if (isTerrainDebris) {
      baseY =
        -Math.max(
          2,
          Math.round(buf[offset + OFFSETS.WEAPON_H] * this.pixelsPerMeter * 0.5)
        ) - 18
    } else {
      const bodyProfileIndex = buf[offset + OFFSETS.BODY_PROFILE_INDEX] | 0
      const bodyProfile = renderer.getCharacterBodyProfile(bodyProfileIndex)
      const spineBodyHeightPx = renderer.getSpineBodyHeightPx(bodyProfile)
      if (spineBodyHeightPx > 0) {
        baseY = radiusMeters * this.pixelsPerMeter - spineBodyHeightPx - 18
      }
    }
    const ratio = maxHealth > 0 ? health / maxHealth : 0
    const clampedRatio = Math.max(0, Math.min(1, ratio))
    const startX = -barWidth / 2
    this.maybeSpawnDamageText(
      view,
      damageTextValue,
      damageTextToken,
      startX + barWidth * clampedRatio,
      baseY - DAMAGE_TEXT_VERTICAL_GAP_PX
    )
    this.updateDamageTexts(view, deltaMs)

    if (
      isPlayer ||
      (!isDebugCrateHealth && !isInCombat && !isLocked && !isHealthBarFlash)
    ) {
      hideGraphics(view.statusGraphics)
      view.lastHealthRatio = -1
      return
    }

    if (clampedRatio !== view.lastHealthRatio) {
      view.lastHealthRatio = clampedRatio
      view.statusGraphics.clear()
      view.statusGraphics
        .rect(startX, baseY, barWidth, barHeight)
        .fill('#5a1b1b')
      view.statusGraphics
        .rect(startX, baseY, barWidth * clampedRatio, barHeight)
        .fill('#ff4d4f')
      view.statusGraphics
        .rect(startX, baseY, barWidth, barHeight)
        .stroke({ color: '#111111', width: 1 })
    }

    view.statusGraphics.visible = true
  }

  private maybeSpawnDamageText(
    view: EntityView,
    damageTextValue: number,
    damageTextToken: number,
    localX: number,
    localY: number
  ): void {
    if (view.lastDamageTextToken === damageTextToken) {
      return
    }
    view.lastDamageTextToken = damageTextToken
    if (damageTextValue <= 0) {
      return
    }

    const label = this.acquireDamageText()
    label.elapsedMs = 0
    label.baseX = Math.round(localX)
    label.baseY = Math.round(localY)
    label.text.text = String(damageTextValue)
    label.text.alpha = 1
    label.text.visible = true
    label.text.position.set(label.baseX, label.baseY)
    view.damageTextContainer.addChild(label.text)
    view.activeDamageTexts.push(label)
    view.damageTextContainer.visible = true
  }

  private updateDamageTexts(view: EntityView, deltaMs: number): void {
    const activeCount = view.activeDamageTexts.length
    if (activeCount <= 0) {
      view.damageTextContainer.visible = false
      return
    }

    let writeIndex = 0
    for (let i = 0; i < activeCount; i++) {
      const label = view.activeDamageTexts[i]
      label.elapsedMs += deltaMs
      if (label.elapsedMs >= DAMAGE_TEXT_LIFETIME_MS) {
        this.releaseDamageText(label)
        continue
      }

      const risePx =
        (label.elapsedMs * DAMAGE_TEXT_RISE_PX) / DAMAGE_TEXT_LIFETIME_MS
      const alpha = 1 - label.elapsedMs / DAMAGE_TEXT_LIFETIME_MS
      label.text.position.set(label.baseX, Math.round(label.baseY - risePx))
      label.text.alpha = alpha
      view.activeDamageTexts[writeIndex] = label
      writeIndex += 1
    }

    view.activeDamageTexts.length = writeIndex
    view.damageTextContainer.visible = writeIndex > 0
  }

  private recycleDamageTexts(view: EntityView): void {
    const activeCount = view.activeDamageTexts.length
    for (let i = 0; i < activeCount; i++) {
      this.releaseDamageText(view.activeDamageTexts[i])
    }
    view.activeDamageTexts.length = 0
    view.damageTextContainer.visible = false
  }

  private acquireDamageText(): DamageTextView {
    const pooled = this.damageTextPool.pop()
    if (pooled) {
      return pooled
    }

    const text = new Text({
      text: '',
      style: {
        fontFamily: 'monospace',
        fontSize: DAMAGE_TEXT_FONT_SIZE,
        fontWeight: '700',
        fill: DAMAGE_TEXT_COLOR,
        stroke: {
          color: DAMAGE_TEXT_STROKE_COLOR,
          width: 4,
        },
      },
    })
    text.anchor.set(0.5, 1)
    return {
      text,
      elapsedMs: 0,
      baseX: 0,
      baseY: 0,
    }
  }

  private releaseDamageText(label: DamageTextView): void {
    if (label.text.parent) {
      label.text.parent.removeChild(label.text)
    }
    label.elapsedMs = 0
    label.baseX = 0
    label.baseY = 0
    label.text.visible = false
    label.text.alpha = 1
    label.text.text = ''
    if (this.damageTextPool.length < DAMAGE_TEXT_POOL_LIMIT) {
      this.damageTextPool.push(label)
      return
    }
    label.text.destroy()
  }

  private updateDeathCross(
    view: EntityView,
    buf: Float32Array,
    offset: number,
    flags: number
  ): void {
    if (!(flags & FLAGS.DEAD) || flags & FLAGS.VANISHED) {
      hideGraphics(view.deathGraphics)
      return
    }

    const radius = buf[offset + OFFSETS.RADIUS] * this.pixelsPerMeter
    if (!(radius > 0)) {
      hideGraphics(view.deathGraphics)
      return
    }

    const elapsedMs = buf[offset + OFFSETS.STATS_DEATH_ELAPSED] * 1000
    if (elapsedMs <= 0 || elapsedMs > DEATH_CROSS_DURATION_MS) {
      hideGraphics(view.deathGraphics)
      return
    }

    const radiusInt = Math.max(1, Math.floor(radius))
    const lineWidth = Math.max(2, Math.floor((radiusInt * 18) / 100))
    const maxRadiusInner = Math.max(0, radiusInt - Math.ceil(lineWidth / 2))
    const maxLength = Math.floor((maxRadiusInner * 707) / 1000)
    const length = Math.floor((maxLength * elapsedMs) / DEATH_CROSS_DURATION_MS)
    if (length <= 0) {
      hideGraphics(view.deathGraphics)
      return
    }

    const alpha = maxLength > 0 ? length / maxLength : 0
    view.deathGraphics.clear()
    view.deathGraphics
      .moveTo(-length, -length)
      .lineTo(length, length)
      .moveTo(-length, length)
      .lineTo(length, -length)
      .stroke({
        color: '#ffffff',
        width: lineWidth,
        cap: 'round',
      })
    view.deathGraphics.visible = true
    view.deathGraphics.alpha = alpha
  }

  private updateFollowIcons(
    view: EntityView,
    buf: Float32Array,
    offset: number,
    flags: number,
    playerOffset: number,
    playerX: number,
    playerY: number
  ): void {
    if (playerOffset !== -1 && flags & FLAGS.IS_FOLLOWING) {
      const npcX = buf[offset + OFFSETS.X]
      const npcY = buf[offset + OFFSETS.Y]
      const npcRadius = buf[offset + OFFSETS.RADIUS]
      const progress = buf[offset + OFFSETS.FOLLOW_FLASH_PROGRESS]
      const elapsed = (1 - progress) * 1200
      const riseOffset =
        elapsed < 300 ? Math.round(15 * (1 - elapsed / 300)) : 0
      const alpha = elapsed > 800 ? (1200 - elapsed) / 400 : 1
      const npcCenterX = npcX * this.pixelsPerMeter
      const npcCenterY = npcY * this.pixelsPerMeter
      const midX = ((playerX + npcX) / 2) * this.pixelsPerMeter
      const baseY =
        (Math.min(playerY, npcY) - npcRadius) * this.pixelsPerMeter - 42

      view.followBondSprite.visible = true
      view.followBondSprite.position.set(
        midX - npcCenterX,
        baseY + riseOffset - npcCenterY
      )
      view.followBondSprite.alpha = alpha
    }

    const unbondProgress = buf[offset + OFFSETS.UNBOND_FLASH_PROGRESS]
    if (unbondProgress > 0) {
      const npcRadius = buf[offset + OFFSETS.RADIUS]
      const elapsed = (1 - unbondProgress) * 1200
      const riseOffset =
        elapsed < 300 ? Math.round(15 * (1 - elapsed / 300)) : 0
      const alpha = elapsed > 800 ? (1200 - elapsed) / 400 : 1

      view.followUnbondSprite.visible = true
      view.followUnbondSprite.position.set(
        0,
        -npcRadius * this.pixelsPerMeter - 42 + riseOffset
      )
      view.followUnbondSprite.alpha = alpha
    }
  }

  private updateLockReticle(
    visible: boolean,
    centerX: number,
    centerY: number,
    isAssassinationTarget: boolean
  ): void {
    if (!visible) {
      hideSprite(this.lockedReticleOutlineSprite)
      hideSprite(this.lockedReticleSprite)
      return
    }

    const showOutline = isAssassinationTarget
    this.lockedReticleOutlineSprite.visible = showOutline
    this.lockedReticleOutlineSprite.alpha = 1
    this.lockedReticleOutlineSprite.tint = ASSASSINATION_RETICLE_OUTLINE_TINT
    this.lockedReticleOutlineSprite.scale.set(
      showOutline ? ASSASSINATION_RETICLE_OUTLINE_SCALE : 1
    )
    this.lockedReticleOutlineSprite.position.set(centerX, centerY)
    this.lockedReticleSprite.visible = true
    this.lockedReticleSprite.alpha = 1
    this.lockedReticleSprite.tint = isAssassinationTarget
      ? ASSASSINATION_RETICLE_TINT
      : 0xffffff
    this.lockedReticleSprite.scale.set(
      isAssassinationTarget ? ASSASSINATION_RETICLE_SCALE : 1
    )
    this.lockedReticleSprite.position.set(centerX, centerY)
  }

  private updateFreeAimReticle(
    renderer: ClientRenderer,
    visible: boolean,
    playerX: number,
    playerY: number,
    reticleX: number,
    reticleY: number,
    weaponType: number,
    drawRatio: number,
    drawActive: boolean
  ): void {
    if (!visible) {
      hideSprite(this.freeAimReticleSprite)
      return
    }

    const effectiveDrawRatio = renderer.getEffectiveRangedDrawRatio(
      weaponType,
      drawRatio,
      drawActive
    )
    const clamped = renderer.getClampedReticlePosition(
      playerX,
      playerY,
      reticleX,
      reticleY,
      effectiveDrawRatio,
      weaponType
    )
    this.freeAimReticleSprite.visible = true
    this.freeAimReticleSprite.alpha = 1
    this.freeAimReticleSprite.position.set(
      clamped.x * this.pixelsPerMeter,
      clamped.y * this.pixelsPerMeter
    )
  }

  private updateRope(
    renderer: ClientRenderer,
    grappleActive: boolean,
    playerX: number,
    playerY: number,
    targetX: number,
    targetY: number
  ): void {
    if (!grappleActive) {
      if (this.ropeGraphics.visible) {
        this.ropeGraphics.clear()
        this.ropeGraphics.visible = false
      }
      return
    }
    this.ropeGraphics.clear()

    const ropePointCount = renderer.getRopePointCount()
    const ropePoints = renderer.getRopePointsBuffer()
    this.ropeGraphics.visible = true

    if (ropePointCount > 1) {
      this.ropeGraphics.moveTo(
        ropePoints[0] * this.pixelsPerMeter,
        ropePoints[1] * this.pixelsPerMeter
      )
      let ropeOffset = 0
      for (let i = 1; i < ropePointCount; i++) {
        ropeOffset += ROPE_POINT_STRIDE
        this.ropeGraphics.lineTo(
          ropePoints[ropeOffset] * this.pixelsPerMeter,
          ropePoints[ropeOffset + 1] * this.pixelsPerMeter
        )
      }
    } else {
      this.ropeGraphics.moveTo(
        playerX * this.pixelsPerMeter,
        playerY * this.pixelsPerMeter
      )
      this.ropeGraphics.lineTo(
        targetX * this.pixelsPerMeter,
        targetY * this.pixelsPerMeter
      )
    }

    this.ropeGraphics.stroke({ color: GRAPPLE_LINE_COLOR, width: 2 })
  }

  private updateSoundDebug(renderer: ClientRenderer): void {
    const waves = renderer.getSoundWaveDebugData()
    const listeners = renderer.getSoundListenerDebugData()
    if (waves.length === 0 && listeners.length === 0) {
      if (this.soundDebugGraphics.visible) {
        this.soundDebugGraphics.clear()
        hideGraphics(this.soundDebugGraphics)
      }
      return
    }

    const ppm = this.pixelsPerMeter
    const g = this.soundDebugGraphics
    g.clear()
    g.visible = true

    for (let i = 0; i < listeners.length; i++) {
      const listener = listeners[i]
      const radius = listener.radius * ppm
      if (radius <= 0) continue
      g.circle(listener.x * ppm, listener.y * ppm, radius)
      g.stroke({
        color: SOUND_DEBUG_LISTENER_COLOR,
        width: 1,
        alpha: SOUND_DEBUG_LISTENER_ALPHA,
      })
    }

    for (let i = 0; i < waves.length; i++) {
      const wave = waves[i]
      const radius = wave.radius * ppm
      const maxRadius = wave.maxRadius * ppm
      const intensity = Math.max(0.2, Math.min(1, wave.db))

      if (radius > 0) {
        g.circle(wave.x * ppm, wave.y * ppm, radius)
        g.stroke({
          color: SOUND_DEBUG_WAVE_COLOR,
          width: 1,
          alpha: intensity,
        })
      }

      if (maxRadius > 0) {
        g.circle(wave.x * ppm, wave.y * ppm, maxRadius)
        g.stroke({
          color: SOUND_DEBUG_RANGE_COLOR,
          width: 1,
          alpha: intensity * SOUND_DEBUG_RANGE_ALPHA_MULTIPLIER,
        })
      }
    }
  }

  private updateUltimateOverlays(
    renderer: ClientRenderer,
    playerOffset: number
  ): void {
    hideSprite(this.giantSwordSprite)
    hideSprite(this.spearTopSprite)
    hideSprite(this.spearBottomSprite)
    this.hammerShockwaveGraphics.clear()
    hideGraphics(this.hammerShockwaveGraphics)

    if (playerOffset === -1) {
      return
    }

    const buf = renderer.getStateBuffer()
    const ppm = this.pixelsPerMeter

    if (buf[playerOffset + OFFSETS.ULTIMATE_SWORD_ACTIVE] === 1) {
      const rise100 = buf[playerOffset + OFFSETS.ULTIMATE_SWORD_RISE100] | 0
      const alpha100 = buf[playerOffset + OFFSETS.ULTIMATE_SWORD_ALPHA100] | 0
      const giantX = buf[playerOffset + OFFSETS.ULTIMATE_SWORD_X]
      const groundY = buf[playerOffset + OFFSETS.ULTIMATE_SWORD_GROUND_Y]
      const screenH = renderer.getCanvasHeight()
      const giantLen = 16 * ppm
      const giantThick = 3 * ppm
      const risenFrac = rise100 / 200
      const centerY =
        groundY * ppm +
        screenH / 2 +
        giantLen / 2 -
        risenFrac * (screenH + giantLen)

      this.giantSwordSprite.texture = this.getWeaponTexture(
        WEAPON_TYPES.SWORD,
        giantLen,
        giantThick,
        '#c8d8ff',
        false,
        0,
        false
      )
      this.giantSwordSprite.visible = true
      this.giantSwordSprite.alpha = (alpha100 / 100) * 0.55
      this.giantSwordSprite.position.set(giantX * ppm, centerY)
      this.giantSwordSprite.rotation = -Math.PI / 2
    }

    if (buf[playerOffset + OFFSETS.HAMMER_ULTIMATE_ACTIVE] === 1) {
      const impact100 =
        buf[playerOffset + OFFSETS.HAMMER_ULTIMATE_IMPACT100] | 0
      if (impact100 > 0) {
        const cx = buf[playerOffset + OFFSETS.ULTIMATE_SWORD_X] * ppm
        const cy = buf[playerOffset + OFFSETS.ULTIMATE_SWORD_GROUND_Y] * ppm
        const progress = impact100 / 100
        const maxReach = ppm * 5.2
        const fragmentCount = 15
        const strokeWidth = Math.max(1, ppm * 0.045)

        this.hammerShockwaveGraphics.visible = true
        this.hammerShockwaveGraphics.alpha = (1 - progress) * 0.9
        for (let i = 0; i < fragmentCount; i++) {
          const t = i / (fragmentCount - 1)
          const angle = -Math.PI + t * Math.PI
          const dirX = Math.cos(angle)
          const dirY = Math.sin(angle)
          const speedScale = 0.72 + (i % 4) * 0.16
          const liftScale = 0.34 + (i % 5) * 0.08
          const travel = maxReach * progress * speedScale
          const lift = ppm * liftScale * progress * (1 - progress * 0.35)
          const shardX = cx + dirX * travel
          const shardY = cy + dirY * travel - lift
          const shardLen = ppm * (0.2 + (i % 5) * 0.04) * (1 - progress * 0.22)
          const shardHalfW =
            ppm * (0.05 + (i % 4) * 0.015) * (1 - progress * 0.12)
          const normalX = -dirY
          const normalY = dirX
          const tipX = shardX + dirX * shardLen
          const tipY = shardY + dirY * shardLen
          const tailX = shardX - dirX * shardLen * 0.55
          const tailY = shardY - dirY * shardLen * 0.55

          this.hammerShockwaveGraphics
            .moveTo(tailX + normalX * shardHalfW, tailY + normalY * shardHalfW)
            .lineTo(
              shardX + normalX * shardHalfW * 0.7,
              shardY + normalY * shardHalfW * 0.7
            )
            .lineTo(tipX, tipY)
            .lineTo(
              shardX - normalX * shardHalfW * 0.7,
              shardY - normalY * shardHalfW * 0.7
            )
            .lineTo(tailX - normalX * shardHalfW, tailY - normalY * shardHalfW)
            .closePath()
        }
        this.hammerShockwaveGraphics.fill({
          color: '#d7cab0',
        })
        this.hammerShockwaveGraphics.stroke({
          color: '#f3ecd8',
          width: strokeWidth,
          join: 'round',
        })
      }
    }

    if (buf[playerOffset + OFFSETS.SPEAR_ULTIMATE_ACTIVE] === 1) {
      const alpha100 = buf[playerOffset + OFFSETS.SPEAR_ULTIMATE_ALPHA100] | 0
      if (alpha100 > 0) {
        const width = buf[playerOffset + OFFSETS.SPEAR_ULTIMATE_W] * ppm
        const height = buf[playerOffset + OFFSETS.SPEAR_ULTIMATE_H] * ppm
        const texture = this.getWeaponTexture(
          WEAPON_TYPES.SPEAR,
          width,
          height,
          '#d9dbc8',
          false,
          0,
          false
        )

        this.spearTopSprite.texture = texture
        this.spearTopSprite.visible = true
        this.spearTopSprite.alpha = (alpha100 / 100) * 0.45
        this.spearTopSprite.position.set(
          buf[playerOffset + OFFSETS.SPEAR_ULTIMATE_TOP_X] * ppm,
          buf[playerOffset + OFFSETS.SPEAR_ULTIMATE_TOP_Y] * ppm
        )
        this.spearTopSprite.rotation =
          buf[playerOffset + OFFSETS.SPEAR_ULTIMATE_TOP_ROT]

        this.spearBottomSprite.texture = texture
        this.spearBottomSprite.visible = true
        this.spearBottomSprite.alpha = (alpha100 / 100) * 0.45
        this.spearBottomSprite.position.set(
          buf[playerOffset + OFFSETS.SPEAR_ULTIMATE_BOTTOM_X] * ppm,
          buf[playerOffset + OFFSETS.SPEAR_ULTIMATE_BOTTOM_Y] * ppm
        )
        this.spearBottomSprite.rotation =
          buf[playerOffset + OFFSETS.SPEAR_ULTIMATE_BOTTOM_ROT]
      }
    }
  }

  private updateParticles(renderer: ClientRenderer): void {
    const activeCount = renderer.getActiveParticleCount()
    this.ensureParticleSprites(activeCount)

    for (let i = 0; i < this.particleSprites.length; i++) {
      const sprite = this.particleSprites[i].sprite
      if (i >= activeCount) {
        hideSprite(sprite)
        continue
      }

      const particle = renderer.getActiveParticle(i)
      if (!particle) {
        hideSprite(sprite)
        continue
      }

      const lifeRatio = particle.age / particle.life
      const alpha = 1 - lifeRatio
      if (particle.type === PARTICLE_TYPE_CHECKPOINT_PULSE) {
        const startRadius =
          (particle.size * CHECKPOINT_PULSE_START_RADIUS_NUMERATOR) /
          CHECKPOINT_PULSE_START_RADIUS_DENOMINATOR
        const expandDistance =
          (particle.size * CHECKPOINT_PULSE_EXPAND_DISTANCE_NUMERATOR) /
          CHECKPOINT_PULSE_EXPAND_DISTANCE_DENOMINATOR
        const ringWidth = Math.max(
          particle.size / 10,
          (particle.size * CHECKPOINT_PULSE_RING_WIDTH_NUMERATOR) /
            CHECKPOINT_PULSE_RING_WIDTH_DENOMINATOR
        )
        const softEdge = Math.max(
          particle.size / 20,
          (ringWidth * CHECKPOINT_PULSE_SOFT_EDGE_NUMERATOR) /
            CHECKPOINT_PULSE_SOFT_EDGE_DENOMINATOR
        )
        const outerStartRadius =
          startRadius > ringWidth ? startRadius : ringWidth
        // 纹理用最大尺寸（lifeRatio=1）预生成一次，每帧通过 scale 动画化，避免每帧创建新纹理
        const maxOuterRadiusPx =
          (outerStartRadius + expandDistance) * this.pixelsPerMeter
        const ringWidthPx = Math.max(3, ringWidth * this.pixelsPerMeter)
        const softEdgePx = Math.max(2, softEdge * this.pixelsPerMeter)
        const texture = this.getCheckpointPulseTexture(
          maxOuterRadiusPx,
          ringWidthPx,
          softEdgePx
        )
        const currentOuterRadiusPx =
          (outerStartRadius + expandDistance * lifeRatio) * this.pixelsPerMeter
        const pulseScale =
          maxOuterRadiusPx > 0 ? currentOuterRadiusPx / maxOuterRadiusPx : 0
        sprite.visible = true
        sprite.texture = texture
        sprite.position.set(
          particle.x * this.pixelsPerMeter,
          particle.y * this.pixelsPerMeter
        )
        sprite.tint = 0xffffff
        sprite.alpha = alpha
        sprite.scale.set(pulseScale)
        sprite.blendMode = 'add'
        continue
      }

      let radius = particle.size * (0.4 + alpha * 0.6)
      let blendMode: 'normal' | 'add' = 'normal'

      if (
        particle.type === PARTICLE_TYPE_SPARK ||
        particle.type === PARTICLE_TYPE_HEAL
      ) {
        radius = particle.size * (1.8 - lifeRatio * 1.5)
        blendMode = 'add'
      } else if (particle.type === PARTICLE_TYPE_DEATH) {
        radius = particle.size * (1 - lifeRatio)
      }

      if (!(radius > 0)) {
        hideSprite(sprite)
        continue
      }

      const diameter = radius * this.pixelsPerMeter * 2
      sprite.visible = true
      sprite.texture = this.particleTexture
      sprite.position.set(
        particle.x * this.pixelsPerMeter,
        particle.y * this.pixelsPerMeter
      )
      sprite.tint = particle.color | 0
      sprite.alpha =
        particle.type === PARTICLE_TYPE_SPARK ||
        particle.type === PARTICLE_TYPE_HEAL
          ? alpha * 0.85
          : alpha
      sprite.scale.set(diameter / 24)
      sprite.blendMode = blendMode
    }
  }

  private updateParrySparkEffects(
    renderer: ClientRenderer,
    deltaMs: number
  ): void {
    const parrySparkCount = renderer.getParrySparkEventCount()
    for (let i = 0; i < parrySparkCount; i++) {
      this.parrySparkEmitterPool.emit(
        renderer.getParrySparkEventX(i),
        renderer.getParrySparkEventY(i),
        renderer.getParrySparkEventDirection(i)
      )
    }
    renderer.clearParrySparkEvents()

    if (deltaMs > 0) {
      this.parrySparkEmitterPool.update(deltaMs / 1000)
    }
  }

  private updateBombExplosionEffects(
    renderer: ClientRenderer,
    deltaMs: number
  ): void {
    const explosionCount = renderer.getBombExplosionEventCount()
    for (let i = 0; i < explosionCount; i++) {
      this.bombExplosionEmitterPool.emit(
        renderer.getBombExplosionEventX(i),
        renderer.getBombExplosionEventY(i),
        renderer.getBombExplosionEventRadius(i)
      )
    }
    renderer.clearBombExplosionEvents()

    if (deltaMs > 0) {
      this.bombExplosionEmitterPool.update(deltaMs / 1000)
    }
  }

  private ensureParticleSprites(count: number): void {
    while (this.particleSprites.length < count) {
      const sprite = new Sprite(this.particleTexture)
      sprite.anchor.set(0.5)
      hideSprite(sprite)
      this.particleContainer.addChild(sprite)
      this.particleSprites.push({ sprite })
    }
  }

  private getBodyTexture(canvas: HTMLCanvasElement): Texture {
    const cached = this.bodyTextureCache.get(canvas)
    if (cached) {
      return cached
    }
    const texture = Texture.from(canvas)
    this.bodyTextureCache.set(canvas, texture)
    return texture
  }

  private getWeaponTexture(
    weaponType: number,
    width: number,
    height: number,
    color: string,
    isAttacking: boolean,
    bowDraw: number,
    arrowVisible: boolean,
    projectileRadius: number = 0
  ): Texture {
    const quantizedBowDraw =
      weaponType === WEAPON_TYPES.BOW || weaponType === WEAPON_TYPES.BOMB
        ? getQuantizedBowDraw(bowDraw)
        : 0
    const key = [
      weaponType,
      width | 0,
      height | 0,
      color,
      isAttacking ? 1 : 0,
      Math.round(quantizedBowDraw * BOW_DRAW_TEXTURE_STEPS),
      arrowVisible ? 1 : 0,
      projectileRadius > 0 ? Math.round(projectileRadius) : 0,
    ].join('|')
    const cached = this.weaponTextureCache.get(key)
    if (cached) {
      cached.lastUsedFrame = this.frameId
      this.weaponTextureCache.delete(key)
      this.weaponTextureCache.set(key, cached)
      return cached.texture
    }

    let halfWidth = Math.max(
      16,
      Math.ceil(Math.max(width, height * 2, width * 0.65) + 12)
    )
    let halfHeight = Math.max(
      16,
      Math.ceil(Math.max(height * 2.5, width * 0.55, height + 12))
    )
    if (weaponType === WEAPON_TYPES.ARROW) {
      halfHeight = Math.max(
        halfHeight,
        getArrowTextureHalfHeight(width, height, 0)
      )
    } else if (weaponType === WEAPON_TYPES.BOW && arrowVisible) {
      const bowBaseWidthPx = WEAPON_DEFAULT_DATA.bow.width * this.pixelsPerMeter
      const bowScale =
        bowBaseWidthPx > 0 ? Math.max(0.5, width / bowBaseWidthPx) : 1
      const arrowLen = BOW_ARROW_LENGTH * this.pixelsPerMeter * bowScale
      const arrowThickness =
        BOW_ARROW_THICKNESS * this.pixelsPerMeter * bowScale
      const baseOffsetY =
        quantizedBowDraw > 0 ? quantizedBowDraw * width * 0.25 : 0
      halfHeight = Math.max(
        halfHeight,
        getArrowTextureHalfHeight(arrowLen, arrowThickness, baseOffsetY)
      )
      halfWidth = Math.max(
        halfWidth,
        Math.ceil(Math.max(width, arrowLen * 0.35) + 12)
      )
    }
    const created = createCanvas2D(halfWidth * 2, halfHeight * 2)
    if (!created) {
      return Texture.WHITE
    }

    const { canvas, ctx } = created
    ctx.translate(canvas.width / 2, canvas.height / 2)
    const renderType = getWeaponRenderType(weaponType)
    renderWeapon(
      ctx,
      renderType,
      width,
      height,
      color,
      isAttacking,
      quantizedBowDraw
    )
    if (
      DEBUG_DRAW_TERRAIN_COLLISION_SHAPE &&
      (weaponType === WEAPON_TYPES.ARROW ||
        weaponType === WEAPON_TYPES.GRAPE_SHOT)
    ) {
      drawProjectileDebugToContext(
        ctx,
        weaponType,
        width,
        height,
        Math.max(
          projectileRadius,
          weaponType === WEAPON_TYPES.GRAPE_SHOT ? width * 0.5 : height,
          1
        )
      )
    }

    if (weaponType === WEAPON_TYPES.BOW && arrowVisible) {
      const bowBaseWidthPx = WEAPON_DEFAULT_DATA.bow.width * this.pixelsPerMeter
      const bowScale =
        bowBaseWidthPx > 0 ? Math.max(0.5, width / bowBaseWidthPx) : 1
      const arrowLen = BOW_ARROW_LENGTH * this.pixelsPerMeter * bowScale
      const arrowThickness =
        BOW_ARROW_THICKNESS * this.pixelsPerMeter * bowScale
      const baseOffsetY =
        quantizedBowDraw > 0 ? quantizedBowDraw * width * 0.25 : 0
      drawArrowToContext(
        ctx,
        arrowLen,
        arrowThickness,
        color,
        isAttacking,
        baseOffsetY
      )
    }

    const texture = Texture.from(canvas)
    this.weaponTextureCache.set(key, {
      texture,
      lastUsedFrame: this.frameId,
    })
    return texture
  }

  private pruneWeaponTextures(): void {
    const staleBeforeFrame = this.frameId - WEAPON_TEXTURE_RETIRE_FRAMES

    for (const [key, entry] of this.weaponTextureCache) {
      const shouldRetireForAge = entry.lastUsedFrame < staleBeforeFrame
      const shouldRetireForSize =
        this.weaponTextureCache.size > MAX_WEAPON_TEXTURE_CACHE

      if (!shouldRetireForAge && !shouldRetireForSize) {
        break
      }
      if (this.hasWeaponTextureReference(entry.texture)) {
        continue
      }

      entry.texture.destroy(true)
      this.weaponTextureCache.delete(key)
    }
  }

  private hasWeaponTextureReference(texture: Texture): boolean {
    if (
      this.giantSwordSprite.texture === texture ||
      this.spearTopSprite.texture === texture ||
      this.spearBottomSprite.texture === texture
    ) {
      return true
    }

    for (const view of this.entityViews.values()) {
      if (view.weaponSprite.texture === texture) {
        return true
      }
    }
    return false
  }

  private getExpOrbTexture(): Texture {
    const key = `exp|${this.pixelsPerMeter}`
    const cached = this.iconTextureCache.get(key)
    if (cached) {
      return cached
    }
    const diameter =
      (this.pixelsPerMeter * EXP_ORB_SIZE_NUMERATOR) / PICKUP_SIZE_DENOMINATOR
    const texture = this.createGlowingCircleTexture(diameter, EXP_COLOR)
    this.iconTextureCache.set(key, texture)
    return texture
  }

  private getSunTexture(isLarge: boolean): Texture {
    const key = isLarge ? 'sun-large' : 'sun-small'
    const cached = this.iconTextureCache.get(key)
    if (cached) {
      return cached
    }

    const size =
      (this.pixelsPerMeter *
        (isLarge
          ? LARGE_SUN_PICKUP_SIZE_NUMERATOR
          : SMALL_SUN_PICKUP_SIZE_NUMERATOR)) /
      PICKUP_SIZE_DENOMINATOR
    const glowRadius =
      ((size / 2) * PICKUP_GLOW_SIZE_NUMERATOR) / PICKUP_GLOW_SIZE_DENOMINATOR
    const padding = Math.ceil(glowRadius + 2)
    const created = createCanvas2D(size + padding * 2, size + padding * 2)
    if (!created) {
      return Texture.WHITE
    }

    const { canvas, ctx } = created
    const cx = canvas.width / 2
    const cy = canvas.height / 2
    const rays = 8
    const outerR = size / 2
    const innerR = outerR * 0.6
    const step = Math.PI / rays
    const glow = ctx.createRadialGradient(
      cx,
      cy,
      outerR * 0.5,
      cx,
      cy,
      glowRadius
    )
    glow.addColorStop(0, 'rgba(255, 255, 255, 0.45)')
    glow.addColorStop(0.55, 'rgba(255, 255, 255, 0.18)')
    glow.addColorStop(1, 'rgba(255, 255, 255, 0)')
    ctx.fillStyle = glow
    ctx.beginPath()
    ctx.arc(cx, cy, glowRadius, 0, Math.PI * 2)
    ctx.fill()

    ctx.beginPath()
    for (let i = 0; i < rays * 2; i++) {
      const angle = i * step - Math.PI / 2
      const radius = i % 2 === 0 ? outerR : innerR
      const px = cx + Math.cos(angle) * radius
      const py = cy + Math.sin(angle) * radius
      if (i === 0) {
        ctx.moveTo(px, py)
      } else {
        ctx.lineTo(px, py)
      }
    }
    ctx.closePath()
    ctx.fillStyle = SUN_COLOR
    ctx.fill()
    if (isLarge) {
      ctx.strokeStyle = '#c8a800'
      ctx.lineWidth = 1
      ctx.stroke()
    }

    const texture = Texture.from(canvas)
    this.iconTextureCache.set(key, texture)
    return texture
  }

  private getReticleTexture(): Texture {
    const key = 'reticle'
    const cached = this.iconTextureCache.get(key)
    if (cached) {
      return cached
    }

    const size = 24
    const created = createCanvas2D(size, size)
    if (!created) {
      return Texture.WHITE
    }

    const { canvas, ctx } = created
    const center = canvas.width / 2
    ctx.strokeStyle = RETICLE_COLOR
    ctx.fillStyle = RETICLE_COLOR
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(center - RETICLE_SIZE, center)
    ctx.lineTo(center + RETICLE_SIZE, center)
    ctx.moveTo(center, center - RETICLE_SIZE)
    ctx.lineTo(center, center + RETICLE_SIZE)
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(center, center, 2.5, 0, Math.PI * 2)
    ctx.fill()

    const texture = Texture.from(canvas)
    this.iconTextureCache.set(key, texture)
    return texture
  }

  private createCircleTexture(size: number, color: string): Texture {
    const key = `circle|${size}|${color}`
    const cached = this.iconTextureCache.get(key)
    if (cached) {
      return cached
    }

    const created = createCanvas2D(size, size)
    if (!created) {
      return Texture.WHITE
    }

    const { canvas, ctx } = created
    const radius = size / 2
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.arc(radius, radius, radius, 0, Math.PI * 2)
    ctx.fill()
    const texture = Texture.from(canvas)
    this.iconTextureCache.set(key, texture)
    return texture
  }

  private getCheckpointPulseTexture(
    outerRadius: number,
    ringWidth: number,
    softEdge: number
  ): Texture {
    const outerRadiusPx = Math.max(1, Math.round(outerRadius))
    const ringWidthPx = Math.max(1, Math.round(ringWidth))
    const softEdgePx = Math.max(1, Math.round(softEdge))
    const key = [outerRadiusPx, ringWidthPx, softEdgePx].join('|')
    const cached = this.checkpointPulseTextureCache.get(key)
    if (cached) {
      return cached
    }

    const maxOuterRadius = outerRadiusPx + softEdgePx * 2
    const canvasSize = maxOuterRadius * 2 + 4
    const created = createCanvas2D(canvasSize, canvasSize)
    if (!created) {
      return Texture.WHITE
    }

    const { canvas, ctx } = created
    const centerX = canvas.width / 2
    const centerY = canvas.height / 2
    const innerRadiusPx = Math.max(0, outerRadiusPx - ringWidthPx)

    ctx.fillStyle = CHECKPOINT_PULSE_EDGE_COLOR
    ctx.globalAlpha = CHECKPOINT_PULSE_EDGE_ALPHA
    this.fillCheckpointPulseRing(
      ctx,
      centerX,
      centerY,
      innerRadiusPx,
      outerRadiusPx + softEdgePx * 2
    )

    ctx.fillStyle = CHECKPOINT_PULSE_MID_COLOR
    ctx.globalAlpha = CHECKPOINT_PULSE_MID_ALPHA
    this.fillCheckpointPulseRing(
      ctx,
      centerX,
      centerY,
      innerRadiusPx,
      outerRadiusPx + softEdgePx
    )

    ctx.fillStyle = CHECKPOINT_PULSE_CORE_COLOR
    ctx.globalAlpha = CHECKPOINT_PULSE_CORE_ALPHA
    this.fillCheckpointPulseRing(
      ctx,
      centerX,
      centerY,
      innerRadiusPx,
      outerRadiusPx
    )

    const texture = Texture.from(canvas)
    this.checkpointPulseTextureCache.set(key, texture)
    return texture
  }

  private fillCheckpointPulseRing(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    innerRadius: number,
    outerRadius: number
  ): void {
    if (!(outerRadius > 0) || outerRadius <= innerRadius) {
      return
    }
    ctx.beginPath()
    ctx.arc(x, y, outerRadius, 0, Math.PI * 2)
    if (innerRadius > 0) {
      ctx.moveTo(x + innerRadius, y)
      ctx.arc(x, y, innerRadius, 0, Math.PI * 2, true)
    }
    ctx.fill()
  }

  private createGlowingCircleTexture(size: number, color: string): Texture {
    const key = `circle-glow|${size}|${color}`
    const cached = this.iconTextureCache.get(key)
    if (cached) {
      return cached
    }

    const radius = Math.max(2, size / 2)
    const glowRadius =
      (radius * PICKUP_GLOW_SIZE_NUMERATOR) / PICKUP_GLOW_SIZE_DENOMINATOR
    const padding = Math.ceil(glowRadius + 2)
    const canvasSize = Math.ceil(radius * 2 + padding * 2)
    const created = createCanvas2D(canvasSize, canvasSize)
    if (!created) {
      return Texture.WHITE
    }

    const { canvas, ctx } = created
    const cx = canvas.width / 2
    const cy = canvas.height / 2
    const glow = ctx.createRadialGradient(
      cx,
      cy,
      radius * 0.5,
      cx,
      cy,
      glowRadius
    )
    glow.addColorStop(0, 'rgba(255, 255, 255, 0.5)')
    glow.addColorStop(0.55, 'rgba(255, 255, 255, 0.2)')
    glow.addColorStop(1, 'rgba(255, 255, 255, 0)')
    ctx.fillStyle = glow
    ctx.beginPath()
    ctx.arc(cx, cy, glowRadius, 0, Math.PI * 2)
    ctx.fill()

    ctx.fillStyle = color
    ctx.beginPath()
    ctx.arc(cx, cy, radius, 0, Math.PI * 2)
    ctx.fill()

    const texture = Texture.from(canvas)
    this.iconTextureCache.set(key, texture)
    return texture
  }

  private getHitShakeOffset(
    buf: Float32Array,
    offset: number
  ): { x: number; y: number } {
    const duration = buf[offset + OFFSETS.STATS_SHAKE_DURATION]
    if (duration === 0) {
      this.reusableShakeOffset.x = 0
      this.reusableShakeOffset.y = 0
      return this.reusableShakeOffset
    }

    const elapsed = buf[offset + OFFSETS.STATS_SHAKE_ELAPSED]
    const intensity = buf[offset + OFFSETS.STATS_SHAKE_INTENSITY]
    const dirX = buf[offset + OFFSETS.STATS_SHAKE_DIR_X]
    const progress = elapsed / duration
    const decay = 1 - progress
    const shake = Math.sin(progress * 30) * decay

    this.reusableShakeOffset.x = shake * intensity * dirX
    this.reusableShakeOffset.y = 0
    return this.reusableShakeOffset
  }

  private getDeathAlpha(
    buf: Float32Array,
    offset: number,
    flags: number
  ): number {
    if (!(flags & FLAGS.DEAD)) {
      return 1
    }
    if (flags & FLAGS.VANISHED) {
      return 0
    }
    const elapsedMs = buf[offset + OFFSETS.STATS_DEATH_ELAPSED] * 1000
    return elapsedMs < DEATH_CROSS_DURATION_MS ? 1 : 0
  }
}
