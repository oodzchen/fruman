import { Container, Sprite, type Texture } from 'pixi.js'

import { DEFAULT_PLAYER_RADIUS } from '../constants'
import type { MapEnvironmentFlowerOptions } from '../editorMapTypes'
import { getTerrainMaterialById } from '../terrain/TerrainMaterialRegistry'
import {
  FOLIAGE_DEBRIS_VARIANT_FLOWER,
  FOLIAGE_DEBRIS_VARIANT_GRASS,
} from './ParticleSystem'
import {
  ENVIRONMENT_FLOWER_PETAL_OFFSETS,
  ENVIRONMENT_FLOWER_PETAL_STRIDE,
  ENVIRONMENT_GRASS_BLADE_OFFSETS,
  ENVIRONMENT_GRASS_BLADE_STRIDE,
  type EnvironmentFoliageType,
  type EnvironmentGrassLayout,
  createEnvironmentFoliageLayout,
  isEnvironmentFlowerLayout,
} from './ProceduralEnvironmentFactory'

const GRASS_MATERIAL = getTerrainMaterialById('grass')
const DEFAULT_GRASS_DEBRIS_COLOR = 0x6f9638
const CONTACT_SHAPE_PADDING_NUM = 2
const CONTACT_SHAPE_PADDING_DEN = 10
const CONTACT_BAND_COUNT = 14
const FIXED_SHIFT = 10
const FIXED_ONE = 1 << FIXED_SHIFT
const ANGLE_UNIT_SCALE = 16
const MAX_CONTACT_ANGLE_DEG = 50
const MAX_RENDER_ANGLE_DEG = 72
const MAX_RENDER_ANGLE_UNITS = MAX_RENDER_ANGLE_DEG * ANGLE_UNIT_SCALE
const SPRITE_BEND_SKEW_MAX_PERMILLE = 520
const EXIT_RESET_MS = 90
const ENTRY_IMPULSE_MULTIPLIER = 16
const ENTRY_BEND_PERMILLE = 144
const SPRING_FORCE_PER_SECOND = 66
const DAMPING_PER_SECOND = 4
const MIN_VISIBLE_ANGLE_UNITS = 2 * ANGLE_UNIT_SCALE
const MIN_VISIBLE_VELOCITY_UNITS = 24
const CONTACT_LEAN_NUMERATOR = 1
const CONTACT_LEAN_DENOMINATOR = 1
const CUT_DEBRIS_COOLDOWN_MS = 120
const CUT_IMPULSE_MULTIPLIER = 12
const CUT_BEND_PERMILLE = 220
const GRASS_DEBRIS_LOCAL_Y_NUMERATOR = 11
const GRASS_DEBRIS_LOCAL_Y_DENOMINATOR = 20
const GRASS_DEBRIS_BAND_WIDTH_NUMERATOR = 82
const GRASS_DEBRIS_BAND_WIDTH_DENOMINATOR = 100
const GRASS_DEBRIS_COLORS = GRASS_MATERIAL.fillPalette.map((color) =>
  parseHexColorInt(color, DEFAULT_GRASS_DEBRIS_COLOR)
)

export interface InteractiveGrassDecorationOptions {
  type?: EnvironmentFoliageType
  texture: Texture
  worldX: number
  worldY: number
  renderX: number
  renderY: number
  layer: number
  rotationDeg: number
  seed: number
  ppm: number
  scaleXPermille: number
  scaleYPermille: number
  flowerOptions?: MapEnvironmentFlowerOptions | null
}

export class InteractiveGrassDecoration {
  readonly root: Container

  private readonly sprite: Sprite
  private readonly layout: EnvironmentGrassLayout
  private readonly layer: number
  private readonly worldX: number
  private readonly worldY: number
  private readonly renderX: number
  private readonly renderY: number
  private readonly localCenterX: number
  private readonly localCenterY: number
  private readonly inverseRotationCos: number
  private readonly inverseRotationSin: number
  private readonly contactTopLocalY: number
  private readonly contactBottomLocalY: number
  private readonly contactBandHeight: number
  private readonly contactMinXByBand: Int16Array
  private readonly contactMaxXByBand: Int16Array
  private readonly moveThresholdSq: number
  private readonly contactAngleUnits: number
  private readonly interactionRadiusPx: number
  private readonly debrisColor: number
  private readonly debrisVariant: number
  private readonly debrisSizePx: number
  private readonly debrisWorldX: number
  private readonly debrisWorldY: number
  private bendAngleUnits = 0
  private bendVelocityUnits = 0
  private actorInsideThisFrame = false
  private entryImpulsePending = false
  private outsideElapsedMs = EXIT_RESET_MS
  private cutDebrisCooldownMs = 0
  private lastInteractorQueryId = 0
  private runtimeIndex = -1
  private spriteSkewPermille = 0

  constructor(options: InteractiveGrassDecorationOptions) {
    this.layout = createEnvironmentFoliageLayout(
      options.type ?? 'grass',
      options.seed,
      options.ppm,
      options.scaleXPermille,
      options.scaleYPermille,
      options.flowerOptions
    )
    this.layer = options.layer
    this.worldX = options.worldX
    this.worldY = options.worldY
    this.renderX = Math.round(options.worldX)
    this.renderY = Math.round(options.worldY)
    this.localCenterX = 0
    this.localCenterY = 0
    const playerRadiusPx = Math.max(
      1,
      Math.round(DEFAULT_PLAYER_RADIUS * options.ppm)
    )
    const contactPaddingPx = Math.max(
      1,
      roundDiv(
        options.ppm * CONTACT_SHAPE_PADDING_NUM,
        CONTACT_SHAPE_PADDING_DEN
      )
    )
    const inverseRadians = (-options.rotationDeg * Math.PI) / 180
    this.inverseRotationCos = Math.round(Math.cos(inverseRadians) * FIXED_ONE)
    this.inverseRotationSin = Math.round(Math.sin(inverseRadians) * FIXED_ONE)
    const contactProfile = createGrassContactProfile(
      this.layout,
      this.localCenterX,
      this.localCenterY,
      playerRadiusPx,
      contactPaddingPx
    )
    this.contactTopLocalY = contactProfile.topLocalY
    this.contactBottomLocalY = contactProfile.bottomLocalY
    this.contactBandHeight = contactProfile.bandHeight
    this.contactMinXByBand = contactProfile.minXByBand
    this.contactMaxXByBand = contactProfile.maxXByBand
    this.interactionRadiusPx = contactProfile.radiusPx
    this.contactAngleUnits =
      roundDiv(
        MAX_CONTACT_ANGLE_DEG * ANGLE_UNIT_SCALE * CONTACT_LEAN_NUMERATOR,
        CONTACT_LEAN_DENOMINATOR
      ) | 0
    const moveThresholdPx = Math.max(1, roundDiv(options.ppm * 12, 100))
    this.moveThresholdSq = moveThresholdPx * moveThresholdPx
    this.debrisColor = resolveFoliageDebrisColor(this.layout)
    this.debrisVariant = isEnvironmentFlowerLayout(this.layout)
      ? FOLIAGE_DEBRIS_VARIANT_FLOWER
      : FOLIAGE_DEBRIS_VARIANT_GRASS
    this.debrisSizePx =
      this.debrisVariant === FOLIAGE_DEBRIS_VARIANT_GRASS
        ? Math.max(
            1,
            roundDiv(
              this.layout.clumpWidth * GRASS_DEBRIS_BAND_WIDTH_NUMERATOR,
              GRASS_DEBRIS_BAND_WIDTH_DENOMINATOR
            )
          )
        : 0
    const debrisLocalX = resolveFoliageDebrisLocalX(this.layout)
    const debrisLocalY = resolveFoliageDebrisLocalY(this.layout)
    this.debrisWorldX =
      this.renderX +
      roundDiv(
        debrisLocalX * this.inverseRotationCos +
          debrisLocalY * this.inverseRotationSin,
        FIXED_ONE
      )
    this.debrisWorldY =
      this.renderY +
      roundDiv(
        debrisLocalY * this.inverseRotationCos -
          debrisLocalX * this.inverseRotationSin,
        FIXED_ONE
      )

    const root = new Container()
    root.position.set(this.renderX, this.renderY)
    root.angle = options.rotationDeg
    root.zIndex = this.renderY
    this.root = root

    const sprite = new Sprite(options.texture)
    sprite.anchor.set(
      this.layout.originX / Math.max(1, this.layout.canvasWidth),
      this.layout.originY / Math.max(1, this.layout.canvasHeight)
    )
    root.addChild(sprite)
    this.sprite = sprite
  }

  beginFrame(): void {
    this.actorInsideThisFrame = false
  }

  getLayer(): number {
    return this.layer
  }

  getInteractionRadiusPx(): number {
    return this.interactionRadiusPx
  }

  getRuntimeIndex(): number {
    return this.runtimeIndex
  }

  setRuntimeIndex(index: number): void {
    this.runtimeIndex = index
  }

  tryMarkInteractorQuery(queryId: number): boolean {
    if (this.lastInteractorQueryId === queryId) {
      return false
    }
    this.lastInteractorQueryId = queryId
    return true
  }

  interact(
    actorX: number,
    actorY: number,
    actorLayer: number,
    actorDeltaX: number,
    actorDeltaY: number
  ): boolean {
    if (actorLayer !== this.layer) {
      return false
    }

    const localActorX = toLocalX(
      actorX - this.renderX,
      actorY - this.renderY,
      this.inverseRotationCos,
      this.inverseRotationSin
    )
    const localActorY = toLocalY(
      actorX - this.renderX,
      actorY - this.renderY,
      this.inverseRotationCos,
      this.inverseRotationSin
    )

    if (
      isInsideContactProfile(
        localActorX,
        localActorY,
        this.contactTopLocalY,
        this.contactBottomLocalY,
        this.contactBandHeight,
        this.contactMinXByBand,
        this.contactMaxXByBand
      )
    ) {
      const isNewOccupancy =
        !this.actorInsideThisFrame && this.outsideElapsedMs >= EXIT_RESET_MS
      this.actorInsideThisFrame = true
      if (isNewOccupancy) {
        this.entryImpulsePending = true
      }

      const movedSq = actorDeltaX * actorDeltaX + actorDeltaY * actorDeltaY
      if (movedSq < this.moveThresholdSq || !this.entryImpulsePending) {
        return false
      }

      const localDeltaX = toLocalX(
        actorDeltaX,
        actorDeltaY,
        this.inverseRotationCos,
        this.inverseRotationSin
      )
      const localDeltaY = toLocalY(
        actorDeltaX,
        actorDeltaY,
        this.inverseRotationCos,
        this.inverseRotationSin
      )
      const direction = resolveContactDirection(
        localDeltaX,
        localDeltaY,
        localActorX,
        this.bendAngleUnits
      )
      const entryVelocityUnits =
        this.contactAngleUnits * ENTRY_IMPULSE_MULTIPLIER * direction
      const entryAngleUnits =
        roundDiv(this.contactAngleUnits * ENTRY_BEND_PERMILLE, 1000) * direction
      if (
        (direction > 0 && this.bendAngleUnits < 0) ||
        (direction < 0 && this.bendAngleUnits > 0)
      ) {
        this.bendAngleUnits = 0
      }
      this.bendAngleUnits = clamp(
        this.bendAngleUnits + entryAngleUnits,
        -MAX_RENDER_ANGLE_UNITS,
        MAX_RENDER_ANGLE_UNITS
      )
      this.bendVelocityUnits = entryVelocityUnits
      this.entryImpulsePending = false
      return true
    }
    return false
  }

  tryCutFoliage(
    actorX: number,
    actorY: number,
    actorLayer: number,
    weaponX: number,
    weaponY: number
  ): boolean {
    if (actorLayer !== this.layer || this.cutDebrisCooldownMs > 0) {
      return false
    }

    let localCutX = toLocalX(
      actorX - this.renderX,
      actorY - this.renderY,
      this.inverseRotationCos,
      this.inverseRotationSin
    )
    let localCutY = toLocalY(
      actorX - this.renderX,
      actorY - this.renderY,
      this.inverseRotationCos,
      this.inverseRotationSin
    )
    let insideContact = isInsideContactProfile(
      localCutX,
      localCutY,
      this.contactTopLocalY,
      this.contactBottomLocalY,
      this.contactBandHeight,
      this.contactMinXByBand,
      this.contactMaxXByBand
    )

    if (!insideContact) {
      localCutX = toLocalX(
        weaponX - this.renderX,
        weaponY - this.renderY,
        this.inverseRotationCos,
        this.inverseRotationSin
      )
      localCutY = toLocalY(
        weaponX - this.renderX,
        weaponY - this.renderY,
        this.inverseRotationCos,
        this.inverseRotationSin
      )
      insideContact = isInsideContactProfile(
        localCutX,
        localCutY,
        this.contactTopLocalY,
        this.contactBottomLocalY,
        this.contactBandHeight,
        this.contactMinXByBand,
        this.contactMaxXByBand
      )
    }

    if (!insideContact) {
      return false
    }

    const localDeltaX = toLocalX(
      weaponX - actorX,
      weaponY - actorY,
      this.inverseRotationCos,
      this.inverseRotationSin
    )
    const localDeltaY = toLocalY(
      weaponX - actorX,
      weaponY - actorY,
      this.inverseRotationCos,
      this.inverseRotationSin
    )
    const direction = resolveContactDirection(
      localDeltaX,
      localDeltaY,
      localCutX,
      this.bendAngleUnits
    )
    const cutVelocityUnits =
      this.contactAngleUnits * CUT_IMPULSE_MULTIPLIER * direction
    const cutAngleUnits =
      roundDiv(this.contactAngleUnits * CUT_BEND_PERMILLE, 1000) * direction
    if (
      (direction > 0 && this.bendAngleUnits < 0) ||
      (direction < 0 && this.bendAngleUnits > 0)
    ) {
      this.bendAngleUnits = 0
    }
    this.actorInsideThisFrame = true
    this.entryImpulsePending = false
    this.bendAngleUnits = clamp(
      this.bendAngleUnits + cutAngleUnits,
      -MAX_RENDER_ANGLE_UNITS,
      MAX_RENDER_ANGLE_UNITS
    )
    this.bendVelocityUnits = cutVelocityUnits
    this.cutDebrisCooldownMs = CUT_DEBRIS_COOLDOWN_MS
    return true
  }

  finishFrame(deltaMs: number, dynamicInView: boolean): boolean {
    if (this.cutDebrisCooldownMs > 0) {
      this.cutDebrisCooldownMs = Math.max(0, this.cutDebrisCooldownMs - deltaMs)
    }

    if (!dynamicInView && !this.actorInsideThisFrame) {
      this.outsideElapsedMs = EXIT_RESET_MS
      this.entryImpulsePending = false
      this.cutDebrisCooldownMs = 0
      this.bendAngleUnits = 0
      this.bendVelocityUnits = 0
      this.showStaticSprite()
      return false
    }

    if (
      deltaMs > 0 &&
      (this.bendAngleUnits !== 0 || this.bendVelocityUnits !== 0)
    ) {
      this.bendVelocityUnits -= roundDiv(
        this.bendAngleUnits * SPRING_FORCE_PER_SECOND * deltaMs,
        1000
      )
      const damping = Math.max(0, 1000 - DAMPING_PER_SECOND * deltaMs)
      this.bendVelocityUnits = roundDiv(this.bendVelocityUnits * damping, 1000)
      this.bendAngleUnits = clamp(
        this.bendAngleUnits + roundDiv(this.bendVelocityUnits * deltaMs, 1000),
        -MAX_RENDER_ANGLE_UNITS,
        MAX_RENDER_ANGLE_UNITS
      )
    }

    if (this.actorInsideThisFrame) {
      this.outsideElapsedMs = 0
    } else {
      this.outsideElapsedMs = Math.min(
        EXIT_RESET_MS,
        this.outsideElapsedMs + deltaMs
      )
      if (this.outsideElapsedMs >= EXIT_RESET_MS) {
        this.entryImpulsePending = false
      }
    }
    const isActive =
      Math.abs(this.bendAngleUnits) >= MIN_VISIBLE_ANGLE_UNITS ||
      Math.abs(this.bendVelocityUnits) >= MIN_VISIBLE_VELOCITY_UNITS

    if (!isActive) {
      this.showStaticSprite()
      return false
    }

    this.sprite.visible = true
    this.applySpriteBend()
    return true
  }

  getAudioPan(playerX: number): number {
    const halfWidth = this.layout.clumpWidth >> 1
    if (halfWidth <= 0) {
      return 0
    }
    const pan = (this.worldX - playerX) / halfWidth
    if (pan <= -1) {
      return -1
    }
    if (pan >= 1) {
      return 1
    }
    return pan
  }

  getWorldX(): number {
    return this.worldX
  }

  getWorldY(): number {
    return this.worldY
  }

  getDebrisWorldX(): number {
    return this.debrisWorldX
  }

  getDebrisWorldY(): number {
    return this.debrisWorldY
  }

  getDebrisColor(): number {
    return this.debrisColor
  }

  getDebrisVariant(): number {
    return this.debrisVariant
  }

  getDebrisSizePx(): number {
    return this.debrisSizePx
  }

  destroy(): void {
    if (this.root.parent) {
      this.root.parent.removeChild(this.root)
    }
    this.root.destroy({ children: true })
  }

  getRenderX(): number {
    return this.renderX
  }

  getRenderY(): number {
    return this.renderY
  }

  private showStaticSprite(): void {
    if (this.spriteSkewPermille !== 0) {
      this.spriteSkewPermille = 0
      this.sprite.skew.x = 0
    }
    this.sprite.visible = true
  }

  private applySpriteBend(): void {
    const skewPermille = clamp(
      roundDiv(
        this.bendAngleUnits * SPRITE_BEND_SKEW_MAX_PERMILLE,
        MAX_RENDER_ANGLE_UNITS
      ),
      -SPRITE_BEND_SKEW_MAX_PERMILLE,
      SPRITE_BEND_SKEW_MAX_PERMILLE
    )
    if (skewPermille !== this.spriteSkewPermille) {
      this.spriteSkewPermille = skewPermille
      this.sprite.skew.x = -skewPermille / 1000
    }
  }
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) {
    return min
  }
  if (value > max) {
    return max
  }
  return value
}

function roundDiv(numerator: number, denominator: number): number {
  if (denominator === 0) {
    return 0
  }
  if (numerator < 0) {
    return -(((-numerator + (denominator >> 1)) / denominator) | 0)
  }
  return ((numerator + (denominator >> 1)) / denominator) | 0
}

function resolveContactDirection(
  playerDeltaX: number,
  playerDeltaY: number,
  distanceX: number,
  bendAngleUnits: number
): number {
  if (playerDeltaX !== 0) {
    return playerDeltaX > 0 ? 1 : -1
  }
  if (distanceX !== 0) {
    return distanceX > 0 ? 1 : -1
  }
  if (playerDeltaY !== 0) {
    return playerDeltaY > 0 ? 1 : -1
  }
  if (bendAngleUnits !== 0) {
    return bendAngleUnits > 0 ? 1 : -1
  }
  return 1
}

interface GrassContactProfile {
  topLocalY: number
  bottomLocalY: number
  bandHeight: number
  minXByBand: Int16Array
  maxXByBand: Int16Array
  radiusPx: number
}

function createGrassContactProfile(
  layout: EnvironmentGrassLayout,
  localCenterX: number,
  localCenterY: number,
  playerRadiusPx: number,
  contactPaddingPx: number
): GrassContactProfile {
  const bladeValues = layout.bladeValues
  let topLocalY =
    localCenterY - layout.maxHeight - playerRadiusPx - contactPaddingPx
  const bottomLocalY = localCenterY + playerRadiusPx + contactPaddingPx

  for (let i = 0; i < bladeValues.length; i += ENVIRONMENT_GRASS_BLADE_STRIDE) {
    const tipLocalY =
      localCenterY + bladeValues[i + ENVIRONMENT_GRASS_BLADE_OFFSETS.TIP_Y]
    if (tipLocalY < topLocalY) {
      topLocalY = tipLocalY
    }
  }

  topLocalY -= contactPaddingPx
  const bandHeight = Math.max(
    1,
    ceilDiv(bottomLocalY - topLocalY + 1, CONTACT_BAND_COUNT)
  )
  const minXByBand = new Int16Array(CONTACT_BAND_COUNT)
  const maxXByBand = new Int16Array(CONTACT_BAND_COUNT)

  for (let i = 0; i < CONTACT_BAND_COUNT; i++) {
    minXByBand[i] = 32767
    maxXByBand[i] = -32768
  }

  const inflateX = playerRadiusPx + contactPaddingPx

  for (let i = 0; i < bladeValues.length; i += ENVIRONMENT_GRASS_BLADE_STRIDE) {
    const baseX =
      localCenterX + bladeValues[i + ENVIRONMENT_GRASS_BLADE_OFFSETS.BASE_X]
    const baseTipX =
      bladeValues[i + ENVIRONMENT_GRASS_BLADE_OFFSETS.TIP_X] -
      bladeValues[i + ENVIRONMENT_GRASS_BLADE_OFFSETS.BASE_X]
    const baseHalfWidth =
      bladeValues[i + ENVIRONMENT_GRASS_BLADE_OFFSETS.BASE_HALF_WIDTH]
    const innerHalfWidth =
      bladeValues[i + ENVIRONMENT_GRASS_BLADE_OFFSETS.INNER_HALF_WIDTH]
    const shoulderLocalY =
      localCenterY + bladeValues[i + ENVIRONMENT_GRASS_BLADE_OFFSETS.SHOULDER_Y]
    const tipLocalY =
      localCenterY + bladeValues[i + ENVIRONMENT_GRASS_BLADE_OFFSETS.TIP_Y]

    for (let band = 0; band < CONTACT_BAND_COUNT; band++) {
      const sampleY = topLocalY + band * bandHeight + (bandHeight >> 1)
      if (sampleY < tipLocalY - inflateX || sampleY > localCenterY + inflateX) {
        continue
      }

      let centerX = baseX
      let halfWidth = baseHalfWidth

      if (sampleY < shoulderLocalY) {
        const tipSpan = shoulderLocalY - tipLocalY
        const tipProgress =
          tipSpan > 0
            ? clamp(
                roundDiv((shoulderLocalY - sampleY) * 1000, tipSpan),
                0,
                1000
              )
            : 1000
        centerX = baseX + roundDiv(baseTipX * tipProgress, 1000)
        halfWidth =
          innerHalfWidth - roundDiv(innerHalfWidth * tipProgress, 1000)
      } else {
        const lowerSpan = localCenterY - shoulderLocalY
        const lowerProgress =
          lowerSpan > 0
            ? clamp(
                roundDiv((sampleY - shoulderLocalY) * 1000, lowerSpan),
                0,
                1000
              )
            : 1000
        halfWidth =
          innerHalfWidth +
          roundDiv((baseHalfWidth - innerHalfWidth) * lowerProgress, 1000)
      }

      const minX = clampToInt16(centerX - halfWidth - inflateX)
      const maxX = clampToInt16(centerX + halfWidth + inflateX)
      if (minX < minXByBand[band]) {
        minXByBand[band] = minX
      }
      if (maxX > maxXByBand[band]) {
        maxXByBand[band] = maxX
      }
    }
  }

  let lastMinX = 0
  let lastMaxX = 0
  let hasLast = false
  for (let i = 0; i < CONTACT_BAND_COUNT; i++) {
    if (minXByBand[i] <= maxXByBand[i]) {
      lastMinX = minXByBand[i]
      lastMaxX = maxXByBand[i]
      hasLast = true
      continue
    }
    if (hasLast) {
      minXByBand[i] = lastMinX
      maxXByBand[i] = lastMaxX
    }
  }
  for (let i = CONTACT_BAND_COUNT - 1; i >= 0; i--) {
    if (minXByBand[i] <= maxXByBand[i]) {
      lastMinX = minXByBand[i]
      lastMaxX = maxXByBand[i]
      continue
    }
    minXByBand[i] = lastMinX
    maxXByBand[i] = lastMaxX
  }

  let maxAbsX = 1
  for (let i = 0; i < CONTACT_BAND_COUNT; i++) {
    const minAbsX = Math.abs(minXByBand[i])
    const maxAbsBandX = Math.abs(maxXByBand[i])
    if (minAbsX > maxAbsX) {
      maxAbsX = minAbsX
    }
    if (maxAbsBandX > maxAbsX) {
      maxAbsX = maxAbsBandX
    }
  }
  const maxAbsY = Math.max(Math.abs(topLocalY), Math.abs(bottomLocalY))

  return {
    topLocalY,
    bottomLocalY,
    bandHeight,
    minXByBand,
    maxXByBand,
    radiusPx: Math.max(maxAbsX, maxAbsY),
  }
}

function isInsideContactProfile(
  localX: number,
  localY: number,
  topLocalY: number,
  bottomLocalY: number,
  bandHeight: number,
  minXByBand: Int16Array,
  maxXByBand: Int16Array
): boolean {
  if (localY < topLocalY || localY > bottomLocalY || bandHeight <= 0) {
    return false
  }
  const band = clamp(
    ((localY - topLocalY) / bandHeight) | 0,
    0,
    minXByBand.length - 1
  )
  return localX >= minXByBand[band] && localX <= maxXByBand[band]
}

function ceilDiv(numerator: number, denominator: number): number {
  if (denominator <= 0) {
    return 0
  }
  return ((numerator + denominator - 1) / denominator) | 0
}

function clampToInt16(value: number): number {
  return clamp(value, -32768, 32767)
}

function resolveFoliageDebrisColor(layout: EnvironmentGrassLayout): number {
  if (isEnvironmentFlowerLayout(layout) && layout.petalValues.length > 0) {
    return averageFlowerPetalColor(layout.petalValues)
  }
  return averageGrassBladeColor(layout.bladeValues)
}

function averageFlowerPetalColor(petalValues: Int32Array): number {
  let red = 0
  let green = 0
  let blue = 0
  let count = 0
  for (
    let i = 0;
    i < petalValues.length;
    i += ENVIRONMENT_FLOWER_PETAL_STRIDE
  ) {
    const color =
      petalValues[i + ENVIRONMENT_FLOWER_PETAL_OFFSETS.COLOR] & 0xffffff
    red += (color >> 16) & 0xff
    green += (color >> 8) & 0xff
    blue += color & 0xff
    count++
  }
  return composeAverageColor(red, green, blue, count)
}

function averageGrassBladeColor(bladeValues: Int32Array): number {
  let red = 0
  let green = 0
  let blue = 0
  let count = 0
  for (let i = 0; i < bladeValues.length; i += ENVIRONMENT_GRASS_BLADE_STRIDE) {
    const color = getGrassDebrisColor(
      bladeValues[i + ENVIRONMENT_GRASS_BLADE_OFFSETS.COLOR_INDEX]
    )
    red += (color >> 16) & 0xff
    green += (color >> 8) & 0xff
    blue += color & 0xff
    count++
  }
  return composeAverageColor(red, green, blue, count)
}

function composeAverageColor(
  red: number,
  green: number,
  blue: number,
  count: number
): number {
  if (count <= 0) {
    return DEFAULT_GRASS_DEBRIS_COLOR
  }
  return (
    (roundDiv(red, count) << 16) |
    (roundDiv(green, count) << 8) |
    roundDiv(blue, count)
  )
}

function getGrassDebrisColor(colorIndex: number): number {
  if (GRASS_DEBRIS_COLORS.length === 0) {
    return DEFAULT_GRASS_DEBRIS_COLOR
  }
  return GRASS_DEBRIS_COLORS[
    clamp(colorIndex, 0, GRASS_DEBRIS_COLORS.length - 1)
  ]
}

function parseHexColorInt(color: string, fallback: number): number {
  if (color.length !== 7 || color.charCodeAt(0) !== 35) {
    return fallback
  }
  for (let i = 1; i < color.length; i++) {
    const code = color.charCodeAt(i)
    if (
      !(
        (code >= 48 && code <= 57) ||
        (code >= 65 && code <= 70) ||
        (code >= 97 && code <= 102)
      )
    ) {
      return fallback
    }
  }
  return Number.parseInt(color.slice(1), 16) & 0xffffff
}

function resolveFoliageDebrisLocalX(layout: EnvironmentGrassLayout): number {
  if (isEnvironmentFlowerLayout(layout)) {
    const stemOffset = layout.flowerStemBladeOffset
    return layout.bladeValues[
      stemOffset + ENVIRONMENT_GRASS_BLADE_OFFSETS.TIP_X
    ]
  }
  return 0
}

function resolveFoliageDebrisLocalY(layout: EnvironmentGrassLayout): number {
  if (isEnvironmentFlowerLayout(layout)) {
    const stemOffset = layout.flowerStemBladeOffset
    return layout.bladeValues[
      stemOffset + ENVIRONMENT_GRASS_BLADE_OFFSETS.TIP_Y
    ]
  }
  return -roundDiv(
    layout.maxHeight * GRASS_DEBRIS_LOCAL_Y_NUMERATOR,
    GRASS_DEBRIS_LOCAL_Y_DENOMINATOR
  )
}

function toLocalX(
  worldDeltaX: number,
  worldDeltaY: number,
  inverseCos: number,
  inverseSin: number
): number {
  return roundDiv(
    worldDeltaX * inverseCos + worldDeltaY * inverseSin,
    FIXED_ONE
  )
}

function toLocalY(
  worldDeltaX: number,
  worldDeltaY: number,
  inverseCos: number,
  inverseSin: number
): number {
  return roundDiv(
    -worldDeltaX * inverseSin + worldDeltaY * inverseCos,
    FIXED_ONE
  )
}
