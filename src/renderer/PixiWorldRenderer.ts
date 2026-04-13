import { Container, Graphics, Sprite, Texture } from 'pixi.js'

import type { ClientRenderer } from '../ClientRenderer'
import {
  getCharacterBodyColor,
  getCharacterBodyProfileHeight,
  getCharacterBodyProfileWidth,
} from '../characterBodyProfile'
import {
  DEATH_CROSS_DURATION_MS,
  DEFAULT_PLAYER_RADIUS,
  DEFAULT_WEAPON_HEIGHT,
  DEFAULT_WEAPON_WIDTH,
  GRAPPLE_ANCHOR_HIGHLIGHT_SCALE,
  WEAPON_DEFAULT_DATA,
} from '../constants'
import type { MapCharacterBodyProfile } from '../editorMapTypes'
import {
  ENTITY_STRIDE,
  FLAGS,
  OFFSETS,
  WEAPON_TYPES,
} from '../worker/binaryProtocol'
import { ROPE_POINT_STRIDE } from '../worker/effectsProtocol'
import { getBodySpriteSource, isBodyVisualAssetsReady } from './BodyRenderer'
import { HUD_ICON_ALPHA, HUD_ICON_COLOR } from './HudWeaponSlotRenderer'
import {
  PARTICLE_TYPE_DEATH,
  PARTICLE_TYPE_HEAL,
  PARTICLE_TYPE_SPARK,
} from './ParticleSystem'
import { type WeaponRenderType, renderWeapon } from './WeaponRenderer'

const FOLLOW_BOUND_BORDER_COLOR = '#ffee58'
const GRAPPLE_LINE_COLOR = '#d9c896'
const SUN_COLOR = '#ffd700'
const EXP_COLOR = '#3d7fff'
const RETICLE_COLOR = '#ffffff'
const RETICLE_SIZE = 7.5
const SMALL_SUN_PICKUP_SIZE_NUMERATOR = 35
const LARGE_SUN_PICKUP_SIZE_NUMERATOR = 70
const PICKUP_SIZE_DENOMINATOR = 100
const EXP_ORB_SIZE_NUMERATOR = SMALL_SUN_PICKUP_SIZE_NUMERATOR
const PICKUP_GLOW_SIZE_NUMERATOR = 8
const PICKUP_GLOW_SIZE_DENOMINATOR = 5
const BOW_ARROW_LENGTH = DEFAULT_WEAPON_WIDTH * 0.9
const BOW_ARROW_THICKNESS = DEFAULT_WEAPON_HEIGHT * 0.15
const BOW_DRAW_TEXTURE_STEPS = 16
const ENTITY_VIEW_RETIRE_FRAMES = 180
const ENTITY_VIEW_PRESSURE_RETIRE_FRAMES = 45
const MAX_ENTITY_VIEW_CACHE = 512
const MAX_WEAPON_TEXTURE_CACHE = 192
const WEAPON_TEXTURE_RETIRE_FRAMES = 180

interface LayerBucket {
  container: Container
}

interface EntityView {
  readonly id: number
  readonly root: Container
  readonly specialGraphics: Graphics
  readonly specialSprite: Sprite
  readonly bodySprite: Sprite
  readonly weaponSprite: Sprite
  readonly statusGraphics: Graphics
  readonly deathGraphics: Graphics
  readonly followBondSprite: Sprite
  readonly followUnbondSprite: Sprite
  layer: number
  lastSeenFrame: number
  lastHealthRatio: number
  bodyHash: number
  weaponHash: number
  specialKey: string
}

interface ParticleSpriteView {
  readonly sprite: Sprite
}

interface WeaponTextureEntry {
  texture: Texture
  lastUsedFrame: number
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
  image.src = path
  return Texture.from(image)
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

export class PixiWorldRenderer {
  private readonly root: Container
  private readonly pixelsPerMeter: number
  private readonly buckets = new Map<number, LayerBucket>()
  private readonly entityViews = new Map<number, EntityView>()
  private readonly overlayContainer: Container
  private readonly particleContainer: Container
  private readonly ropeGraphics: Graphics
  private readonly hammerShockwaveGraphics: Graphics
  private readonly giantSwordSprite: Sprite
  private readonly spearTopSprite: Sprite
  private readonly spearBottomSprite: Sprite
  private readonly lockedReticleSprite: Sprite
  private readonly freeAimReticleSprite: Sprite
  private readonly handshakeTexture: Texture
  private readonly wavingTexture: Texture
  private readonly bodyTextureCache = new WeakMap<HTMLCanvasElement, Texture>()
  private readonly weaponTextureCache = new Map<string, WeaponTextureEntry>()
  private readonly iconTextureCache = new Map<string, Texture>()
  private readonly particleTexture: Texture
  private readonly particleSprites: ParticleSpriteView[] = []
  private frameId = 0
  private pruneSkipCounter = 0
  private readonly reusableShakeOffset = { x: 0, y: 0 }

  constructor(root: Container, pixelsPerMeter: number) {
    this.root = root
    this.pixelsPerMeter = pixelsPerMeter

    this.overlayContainer = new Container()
    this.overlayContainer.zIndex = 900000
    this.root.addChild(this.overlayContainer)

    this.particleContainer = new Container()
    this.particleContainer.zIndex = 850000
    this.root.addChild(this.particleContainer)

    this.ropeGraphics = new Graphics()
    this.overlayContainer.addChild(this.ropeGraphics)

    this.hammerShockwaveGraphics = new Graphics()
    this.overlayContainer.addChild(this.hammerShockwaveGraphics)

    this.handshakeTexture = createImageTexture('/images/handshake_yellow.png')
    this.wavingTexture = createImageTexture('/images/waving_hand.png')
    this.particleTexture = this.createCircleTexture(24, '#ffffff')

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
    return this.particleSprites.length
  }

  getWeaponTextureCacheSize(): number {
    return this.weaponTextureCache.size
  }

  render(renderer: ClientRenderer): void {
    this.frameId += 1
    const buf = renderer.getStateBuffer()
    const entityCount = renderer.getEntityCount()

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

    let lockTargetCenterX = 0
    let lockTargetCenterY = 0
    let hasLockTarget = false

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

      const view = this.ensureEntityView(entityId)
      view.lastSeenFrame = this.frameId

      const layer = buf[offset + OFFSETS.RENDER_LAYER] | 0
      this.attachViewToLayer(view, layer)

      const shake = this.getHitShakeOffset(buf, offset)
      const centerX = (buf[offset + OFFSETS.X] + shake.x) * this.pixelsPerMeter
      const centerY = (buf[offset + OFFSETS.Y] + shake.y) * this.pixelsPerMeter
      const alpha = this.getDeathAlpha(buf, offset, flags)

      view.root.visible = true
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

      this.updateSpecialIcons(
        view,
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

    for (const view of this.entityViews.values()) {
      if (view.lastSeenFrame !== this.frameId) {
        this.hideEntityView(view)
      }
    }

    this.pruneSkipCounter++
    if (this.pruneSkipCounter >= 30) {
      this.pruneSkipCounter = 0
      this.pruneEntityViews()
      this.pruneWeaponTextures()
    }

    this.updateLockReticle(hasLockTarget, lockTargetCenterX, lockTargetCenterY)
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
    this.updateRope(
      renderer,
      playerGrappleActive,
      playerX,
      playerY,
      playerGrappleTargetX,
      playerGrappleTargetY
    )
    this.updateUltimateOverlays(renderer, playerOffset)
    this.updateParticles(renderer)
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

    const deathGraphics = new Graphics()
    root.addChild(deathGraphics)

    const followBondSprite = new Sprite(this.handshakeTexture)
    followBondSprite.anchor.set(0.5)
    followBondSprite.width = 20
    followBondSprite.height = 20
    hideSprite(followBondSprite)
    this.overlayContainer.addChild(followBondSprite)

    const followUnbondSprite = new Sprite(this.wavingTexture)
    followUnbondSprite.anchor.set(0.5)
    followUnbondSprite.width = 20
    followUnbondSprite.height = 20
    hideSprite(followUnbondSprite)
    this.overlayContainer.addChild(followUnbondSprite)

    const view: EntityView = {
      id,
      root,
      specialGraphics,
      specialSprite,
      bodySprite,
      weaponSprite,
      statusGraphics,
      deathGraphics,
      followBondSprite,
      followUnbondSprite,
      layer: 0,
      lastSeenFrame: -1,
      lastHealthRatio: -1,
      bodyHash: -1,
      weaponHash: -1,
      specialKey: '',
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
    const bucket = { container }
    this.buckets.set(layer, bucket)
    return bucket
  }

  private attachViewToLayer(view: EntityView, layer: number): void {
    if (view.layer === layer && view.root.parent) {
      return
    }

    const bucket = this.ensureBucket(layer)
    if (view.root.parent !== bucket.container) {
      bucket.container.addChild(view.root)
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
    hideSprite(view.followBondSprite)
    hideSprite(view.followUnbondSprite)
    view.lastHealthRatio = -1
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
    if (view.root.parent) {
      view.root.parent.removeChild(view.root)
    }
    if (view.followBondSprite.parent) {
      view.followBondSprite.parent.removeChild(view.followBondSprite)
    }
    if (view.followUnbondSprite.parent) {
      view.followUnbondSprite.parent.removeChild(view.followUnbondSprite)
    }

    view.root.destroy({ children: true })
    view.followBondSprite.destroy()
    view.followUnbondSprite.destroy()
    this.entityViews.delete(id)
  }

  private updateSpecialIcons(
    view: EntityView,
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
    hideSprite(view.followBondSprite)
    hideSprite(view.followUnbondSprite)

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
      this.updateBodySprite(view, renderer, buf, offset, flags, alpha)
    } else {
      hideSprite(view.bodySprite)
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
    const canopyRadiusX = radius * 1.1
    const canopyRadiusY = radius * 0.8
    const canopyOffsetY = -radius * 0.6
    const trunkHeight = radius * 1.2
    const trunkTopWidth = radius * 0.6
    const trunkBottomWidth = radius
    const canopyColor = renderer.getColorHex(buf[offset + OFFSETS.COLOR] | 0)
    const trunkColor = renderer.getColorHex(
      buf[offset + OFFSETS.BORDER_COLOR] | 0
    )
    const key = [radius | 0, canopyColor, trunkColor].join('|')

    if (view.specialKey !== key) {
      view.specialGraphics.clear()
      view.specialGraphics
        .ellipse(0, canopyOffsetY, canopyRadiusX, canopyRadiusY)
        .fill(canopyColor)
      view.specialGraphics
        .moveTo(-trunkTopWidth, 0)
        .lineTo(trunkTopWidth, 0)
        .lineTo(trunkBottomWidth, trunkHeight)
        .lineTo(-trunkBottomWidth, trunkHeight)
        .closePath()
        .fill(trunkColor)
      view.specialKey = key
    }

    view.specialGraphics.visible = true
    view.specialGraphics.alpha = alpha
    hideSprite(view.bodySprite)
    hideSprite(view.weaponSprite)
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
      bodyProfile?.textureDataUrl ?? bodyProfile?.surfaceDataUrl
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
        bodyProfile?.textureDataUrl ?? '',
        bodyProfile?.surfaceDataUrl ?? '',
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
      weaponType === WEAPON_TYPES.BOW ? getQuantizedBowDraw(bowDraw) : 0

    let weaponHash = 0x811c9dc5
    weaponHash = fnvMix(weaponHash, weaponType)
    weaponHash = fnvMix(weaponHash, weaponWidth)
    weaponHash = fnvMix(weaponHash, weaponHeight)
    weaponHash = fnvMix(weaponHash, isAttacking ? 1 : 0)
    weaponHash = fnvMix(weaponHash, quantizedBowDraw)
    weaponHash = fnvMix(weaponHash, arrowVisible ? 1 : 0)
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
        arrowVisible
      )
      view.weaponHash = weaponHash
    }

    view.weaponSprite.visible = true
    view.weaponSprite.position.set(
      (weaponX - entityX) * this.pixelsPerMeter,
      (weaponY - entityY) * this.pixelsPerMeter
    )
    view.weaponSprite.rotation = weaponRotation
    view.weaponSprite.alpha = isStandaloneWeapon ? HUD_ICON_ALPHA : alpha

    if (view.weaponSprite.parent === view.root) {
      if (renderer.getFacingForEntity(buf, offset) < 0) {
        view.root.setChildIndex(view.weaponSprite, 2)
      } else {
        view.root.setChildIndex(view.weaponSprite, 3)
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
    const maxHealth = buf[offset + OFFSETS.STATS_HEALTH_MAX]
    const isPlayer = !!(flags & FLAGS.IS_PLAYER)
    const isInCombat = !!(flags & FLAGS.IN_COMBAT)
    const isLocked = (buf[offset + OFFSETS.ID] | 0) === playerLockedTargetId
    const isHealthBarFlash = !!(flags & FLAGS.HEALTH_BAR_FLASH)

    if (
      !(maxHealth > 0) ||
      isPlayer ||
      (!isInCombat && !isLocked && !isHealthBarFlash)
    ) {
      hideGraphics(view.statusGraphics)
      view.lastHealthRatio = -1
      return
    }

    const health = buf[offset + OFFSETS.STATS_HEALTH]
    const radiusMeters = buf[offset + OFFSETS.RADIUS]
    const barWidth = 1.1 * this.pixelsPerMeter
    const barHeight = 6
    const baseY = -radiusMeters * this.pixelsPerMeter - 18
    const ratio = maxHealth > 0 ? health / maxHealth : 0
    const clampedRatio = Math.max(0, Math.min(1, ratio))
    const startX = -barWidth / 2

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
      const midX = ((playerX + npcX) / 2) * this.pixelsPerMeter
      const baseY =
        (Math.min(playerY, npcY) - npcRadius) * this.pixelsPerMeter - 42
      const progress = buf[offset + OFFSETS.FOLLOW_FLASH_PROGRESS]
      const elapsed = (1 - progress) * 1200
      const riseOffset =
        elapsed < 300 ? Math.round(15 * (1 - elapsed / 300)) : 0
      const alpha = elapsed > 800 ? (1200 - elapsed) / 400 : 1

      view.followBondSprite.visible = true
      view.followBondSprite.position.set(midX, baseY + riseOffset)
      view.followBondSprite.alpha = alpha
    }

    const unbondProgress = buf[offset + OFFSETS.UNBOND_FLASH_PROGRESS]
    if (unbondProgress > 0) {
      const npcX = buf[offset + OFFSETS.X]
      const npcY = buf[offset + OFFSETS.Y]
      const npcRadius = buf[offset + OFFSETS.RADIUS]
      const baseY = (npcY - npcRadius) * this.pixelsPerMeter - 42
      const elapsed = (1 - unbondProgress) * 1200
      const riseOffset =
        elapsed < 300 ? Math.round(15 * (1 - elapsed / 300)) : 0
      const alpha = elapsed > 800 ? (1200 - elapsed) / 400 : 1

      view.followUnbondSprite.visible = true
      view.followUnbondSprite.position.set(
        npcX * this.pixelsPerMeter,
        baseY + riseOffset
      )
      view.followUnbondSprite.alpha = alpha
    }
  }

  private updateLockReticle(
    visible: boolean,
    centerX: number,
    centerY: number
  ): void {
    if (!visible) {
      hideSprite(this.lockedReticleSprite)
      return
    }

    this.lockedReticleSprite.visible = true
    this.lockedReticleSprite.alpha = 1
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
    arrowVisible: boolean
  ): Texture {
    const quantizedBowDraw =
      weaponType === WEAPON_TYPES.BOW ? getQuantizedBowDraw(bowDraw) : 0
    const key = [
      weaponType,
      width | 0,
      height | 0,
      color,
      isAttacking ? 1 : 0,
      Math.round(quantizedBowDraw * BOW_DRAW_TEXTURE_STEPS),
      arrowVisible ? 1 : 0,
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
