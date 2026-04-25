import { Container, Graphics, Sprite, type Texture } from 'pixi.js'

import { DEFAULT_PLAYER_RADIUS } from '../constants'
import { getTerrainMaterialById } from '../terrain/TerrainMaterialRegistry'
import {
  ENVIRONMENT_GRASS_BLADE_OFFSETS,
  ENVIRONMENT_GRASS_BLADE_STRIDE,
  type EnvironmentGrassLayout,
  createEnvironmentGrassLayout,
} from './ProceduralEnvironmentFactory'

const GRASS_MATERIAL = getTerrainMaterialById('grass')
const GRASS_FILL_COLORS = GRASS_MATERIAL.fillPalette.map((color) =>
  Number.parseInt(color.slice(1), 16)
)

const CONTACT_SHAPE_PADDING_NUM = 2
const CONTACT_SHAPE_PADDING_DEN = 10
const CONTACT_BAND_COUNT = 14
const FIXED_SHIFT = 10
const FIXED_ONE = 1 << FIXED_SHIFT
const ANGLE_UNIT_SCALE = 16
const MAX_CONTACT_ANGLE_DEG = 50
const MAX_RENDER_ANGLE_DEG = 72
const MAX_RENDER_ANGLE_UNITS = MAX_RENDER_ANGLE_DEG * ANGLE_UNIT_SCALE
const EXIT_RESET_MS = 90
const ENTRY_IMPULSE_MULTIPLIER = 16
const ENTRY_BEND_PERMILLE = 144
const SPRING_FORCE_PER_SECOND = 66
const DAMPING_PER_SECOND = 4
const MIN_VISIBLE_ANGLE_UNITS = 2 * ANGLE_UNIT_SCALE
const MIN_VISIBLE_VELOCITY_UNITS = 24
const CONTACT_LEAN_NUMERATOR = 1
const CONTACT_LEAN_DENOMINATOR = 1
const RESPONSE_CENTER_PERCENT = 100
const RESPONSE_SCALE_PER_PERCENT = 5
const RESPONSE_MIN_PERMILLE = 820
const RESPONSE_MAX_PERMILLE = 1260
const LOWER_SEGMENT_ANGLE_NUMERATOR = 7
const LOWER_SEGMENT_ANGLE_DENOMINATOR = 32
const MID_LOWER_SEGMENT_ANGLE_NUMERATOR = 15
const MID_LOWER_SEGMENT_ANGLE_DENOMINATOR = 32
const MID_UPPER_SEGMENT_ANGLE_NUMERATOR = 25
const MID_UPPER_SEGMENT_ANGLE_DENOMINATOR = 32
const TIP_SEGMENT_ANGLE_NUMERATOR = 9
const TIP_SEGMENT_ANGLE_DENOMINATOR = 8
const MID_LOWER_Y_NUMERATOR = 11
const MID_LOWER_Y_DENOMINATOR = 20
const MID_UPPER_Y_NUMERATOR = 4
const MID_UPPER_Y_DENOMINATOR = 5
const MID_LOWER_TIP_X_NUMERATOR = 3
const MID_LOWER_TIP_X_DENOMINATOR = 10
const MID_UPPER_TIP_X_NUMERATOR = 7
const MID_UPPER_TIP_X_DENOMINATOR = 10
const MID_LOWER_HALF_WIDTH_NUMERATOR = 5
const MID_LOWER_HALF_WIDTH_DENOMINATOR = 8
const MID_UPPER_HALF_WIDTH_NUMERATOR = 3
const MID_UPPER_HALF_WIDTH_DENOMINATOR = 8
const PHASE_CENTER = 128
const PHASE_VELOCITY_DIVISOR = 8192
const ANGLE_TABLE_SIZE = MAX_RENDER_ANGLE_DEG + 1

const COS_TABLE = new Int16Array(ANGLE_TABLE_SIZE)
const SIN_TABLE = new Int16Array(ANGLE_TABLE_SIZE)
for (let i = 0; i < ANGLE_TABLE_SIZE; i++) {
  const radians = (i * Math.PI) / 180
  COS_TABLE[i] = Math.round(Math.cos(radians) * FIXED_ONE)
  SIN_TABLE[i] = Math.round(Math.sin(radians) * FIXED_ONE)
}

export interface InteractiveGrassDecorationOptions {
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
}

export class InteractiveGrassDecoration {
  readonly root: Container

  private readonly sprite: Sprite
  private readonly graphics: Graphics
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
  private bendAngleUnits = 0
  private bendVelocityUnits = 0
  private actorInsideThisFrame = false
  private entryImpulsePending = false
  private outsideElapsedMs = EXIT_RESET_MS

  constructor(options: InteractiveGrassDecorationOptions) {
    this.layout = createEnvironmentGrassLayout(
      options.seed,
      options.ppm,
      options.scaleXPermille,
      options.scaleYPermille
    )
    this.layer = options.layer
    this.worldX = options.worldX
    this.worldY = options.worldY
    this.renderX = Math.round(options.renderX)
    this.renderY = Math.round(options.renderY)
    this.localCenterX = this.layout.originX - (this.layout.canvasWidth >> 1)
    this.localCenterY = this.layout.originY - (this.layout.canvasHeight >> 1)
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
    this.contactAngleUnits =
      roundDiv(
        MAX_CONTACT_ANGLE_DEG * ANGLE_UNIT_SCALE * CONTACT_LEAN_NUMERATOR,
        CONTACT_LEAN_DENOMINATOR
      ) | 0
    const moveThresholdPx = Math.max(1, roundDiv(options.ppm * 12, 100))
    this.moveThresholdSq = moveThresholdPx * moveThresholdPx

    const root = new Container()
    root.position.set(options.renderX, options.renderY)
    root.angle = options.rotationDeg
    root.zIndex = options.renderY
    this.root = root

    const sprite = new Sprite(options.texture)
    sprite.anchor.set(0.5, 0.5)
    root.addChild(sprite)
    this.sprite = sprite

    const graphics = new Graphics()
    graphics.visible = false
    root.addChild(graphics)
    this.graphics = graphics
  }

  beginFrame(): void {
    this.actorInsideThisFrame = false
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

  finishFrame(deltaMs: number, dynamicInView: boolean): void {
    if (!dynamicInView && !this.actorInsideThisFrame) {
      this.outsideElapsedMs = EXIT_RESET_MS
      this.entryImpulsePending = false
      this.bendAngleUnits = 0
      this.bendVelocityUnits = 0
      this.showStaticSprite()
      return
    }

    if (deltaMs > 0) {
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
      dynamicInView ||
      Math.abs(this.bendAngleUnits) >= MIN_VISIBLE_ANGLE_UNITS ||
      Math.abs(this.bendVelocityUnits) >= MIN_VISIBLE_VELOCITY_UNITS

    if (!isActive) {
      this.showStaticSprite()
      return
    }

    this.sprite.visible = false
    this.graphics.visible = true
    this.redraw()
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

  destroy(): void {
    if (this.root.parent) {
      this.root.parent.removeChild(this.root)
    }
    this.root.destroy({ children: true })
  }

  getRenderX(): number {
    return Math.round(this.root.x)
  }

  getRenderY(): number {
    return Math.round(this.root.y)
  }

  private showStaticSprite(): void {
    if (!this.sprite.visible) {
      this.sprite.visible = true
      this.graphics.visible = false
      this.graphics.clear()
    }
  }

  private redraw(): void {
    const graphics = this.graphics
    const bladeValues = this.layout.bladeValues
    const tallBladeThreshold = roundDiv(this.layout.maxHeight * 78, 100)
    const baseY = this.localCenterY

    graphics.clear()

    for (let pass = 0; pass < 2; pass++) {
      for (
        let i = 0;
        i < bladeValues.length;
        i += ENVIRONMENT_GRASS_BLADE_STRIDE
      ) {
        const bladeHeight =
          bladeValues[i + ENVIRONMENT_GRASS_BLADE_OFFSETS.HEIGHT]
        if (bladeHeight >= tallBladeThreshold !== (pass === 1)) {
          continue
        }

        const responsePercent =
          bladeValues[i + ENVIRONMENT_GRASS_BLADE_OFFSETS.RESPONSE]
        const responsePermille = clamp(
          1000 +
            (responsePercent - RESPONSE_CENTER_PERCENT) *
              RESPONSE_SCALE_PER_PERCENT,
          RESPONSE_MIN_PERMILLE,
          RESPONSE_MAX_PERMILLE
        )
        const phase =
          bladeValues[i + ENVIRONMENT_GRASS_BLADE_OFFSETS.PHASE] - PHASE_CENTER
        const phaseAngleUnits = roundDiv(
          this.bendVelocityUnits * phase,
          PHASE_VELOCITY_DIVISOR
        )
        const bladeAngleUnits = remapRenderAngleUnits(
          clamp(
            roundDiv(this.bendAngleUnits * responsePermille, 1000) +
              phaseAngleUnits,
            -MAX_RENDER_ANGLE_UNITS,
            MAX_RENDER_ANGLE_UNITS
          )
        )
        const tipAngleUnits = clamp(
          roundDiv(
            bladeAngleUnits * TIP_SEGMENT_ANGLE_NUMERATOR,
            TIP_SEGMENT_ANGLE_DENOMINATOR
          ),
          -MAX_RENDER_ANGLE_UNITS,
          MAX_RENDER_ANGLE_UNITS
        )
        const baseX =
          this.localCenterX +
          bladeValues[i + ENVIRONMENT_GRASS_BLADE_OFFSETS.BASE_X]
        const baseTipX =
          bladeValues[i + ENVIRONMENT_GRASS_BLADE_OFFSETS.TIP_X] -
          bladeValues[i + ENVIRONMENT_GRASS_BLADE_OFFSETS.BASE_X]
        const baseHalfWidth =
          bladeValues[i + ENVIRONMENT_GRASS_BLADE_OFFSETS.BASE_HALF_WIDTH]
        const innerHalfWidth =
          bladeValues[i + ENVIRONMENT_GRASS_BLADE_OFFSETS.INNER_HALF_WIDTH]
        const baseShoulderY =
          bladeValues[i + ENVIRONMENT_GRASS_BLADE_OFFSETS.SHOULDER_Y]
        const baseTipY = bladeValues[i + ENVIRONMENT_GRASS_BLADE_OFFSETS.TIP_Y]
        const midLowerY =
          baseShoulderY +
          roundDiv(
            (baseTipY - baseShoulderY) * MID_LOWER_Y_NUMERATOR,
            MID_LOWER_Y_DENOMINATOR
          )
        const midUpperY =
          baseShoulderY +
          roundDiv(
            (baseTipY - baseShoulderY) * MID_UPPER_Y_NUMERATOR,
            MID_UPPER_Y_DENOMINATOR
          )
        const midLowerTipX = roundDiv(
          baseTipX * MID_LOWER_TIP_X_NUMERATOR,
          MID_LOWER_TIP_X_DENOMINATOR
        )
        const midUpperTipX = roundDiv(
          baseTipX * MID_UPPER_TIP_X_NUMERATOR,
          MID_UPPER_TIP_X_DENOMINATOR
        )
        const shoulderAngleUnits = roundDiv(
          bladeAngleUnits * LOWER_SEGMENT_ANGLE_NUMERATOR,
          LOWER_SEGMENT_ANGLE_DENOMINATOR
        )
        const midLowerAngleUnits = roundDiv(
          bladeAngleUnits * MID_LOWER_SEGMENT_ANGLE_NUMERATOR,
          MID_LOWER_SEGMENT_ANGLE_DENOMINATOR
        )
        const midUpperAngleUnits = roundDiv(
          bladeAngleUnits * MID_UPPER_SEGMENT_ANGLE_NUMERATOR,
          MID_UPPER_SEGMENT_ANGLE_DENOMINATOR
        )
        const shoulderCenterX =
          baseX + rotateX(0, baseShoulderY, shoulderAngleUnits)
        const shoulderCenterY =
          baseY + rotateY(0, baseShoulderY, shoulderAngleUnits)
        const midLowerCenterX =
          shoulderCenterX +
          rotateX(midLowerTipX, midLowerY - baseShoulderY, midLowerAngleUnits)
        const midLowerCenterY =
          shoulderCenterY +
          rotateY(midLowerTipX, midLowerY - baseShoulderY, midLowerAngleUnits)
        const midUpperCenterX =
          midLowerCenterX +
          rotateX(
            midUpperTipX - midLowerTipX,
            midUpperY - midLowerY,
            midUpperAngleUnits
          )
        const midUpperCenterY =
          midLowerCenterY +
          rotateY(
            midUpperTipX - midLowerTipX,
            midUpperY - midLowerY,
            midUpperAngleUnits
          )
        const shoulderLeftX =
          shoulderCenterX + rotateX(-innerHalfWidth, 0, shoulderAngleUnits)
        const shoulderLeftY =
          shoulderCenterY + rotateY(-innerHalfWidth, 0, shoulderAngleUnits)
        const shoulderRightX =
          shoulderCenterX + rotateX(innerHalfWidth, 0, shoulderAngleUnits)
        const shoulderRightY =
          shoulderCenterY + rotateY(innerHalfWidth, 0, shoulderAngleUnits)
        const midLowerHalfWidth = Math.max(
          1,
          roundDiv(
            innerHalfWidth * MID_LOWER_HALF_WIDTH_NUMERATOR,
            MID_LOWER_HALF_WIDTH_DENOMINATOR
          )
        )
        const midLowerLeftX =
          midLowerCenterX + rotateX(-midLowerHalfWidth, 0, midLowerAngleUnits)
        const midLowerLeftY =
          midLowerCenterY + rotateY(-midLowerHalfWidth, 0, midLowerAngleUnits)
        const midLowerRightX =
          midLowerCenterX + rotateX(midLowerHalfWidth, 0, midLowerAngleUnits)
        const midLowerRightY =
          midLowerCenterY + rotateY(midLowerHalfWidth, 0, midLowerAngleUnits)
        const midUpperHalfWidth = Math.max(
          1,
          roundDiv(
            innerHalfWidth * MID_UPPER_HALF_WIDTH_NUMERATOR,
            MID_UPPER_HALF_WIDTH_DENOMINATOR
          )
        )
        const midUpperLeftX =
          midUpperCenterX + rotateX(-midUpperHalfWidth, 0, midUpperAngleUnits)
        const midUpperLeftY =
          midUpperCenterY + rotateY(-midUpperHalfWidth, 0, midUpperAngleUnits)
        const midUpperRightX =
          midUpperCenterX + rotateX(midUpperHalfWidth, 0, midUpperAngleUnits)
        const midUpperRightY =
          midUpperCenterY + rotateY(midUpperHalfWidth, 0, midUpperAngleUnits)
        const tipX =
          midUpperCenterX +
          rotateX(baseTipX - midUpperTipX, baseTipY - midUpperY, tipAngleUnits)
        const tipY =
          midUpperCenterY +
          rotateY(baseTipX - midUpperTipX, baseTipY - midUpperY, tipAngleUnits)

        graphics.moveTo(baseX - baseHalfWidth, baseY)
        graphics.quadraticCurveTo(
          shoulderLeftX,
          shoulderLeftY,
          midLowerLeftX,
          midLowerLeftY
        )
        graphics.quadraticCurveTo(midUpperLeftX, midUpperLeftY, tipX, tipY)
        graphics.quadraticCurveTo(
          midUpperRightX,
          midUpperRightY,
          midLowerRightX,
          midLowerRightY
        )
        graphics.quadraticCurveTo(
          shoulderRightX,
          shoulderRightY,
          baseX + baseHalfWidth,
          baseY
        )
        graphics.closePath()
        graphics.fill(
          GRASS_FILL_COLORS[
            bladeValues[i + ENVIRONMENT_GRASS_BLADE_OFFSETS.COLOR_INDEX]
          ]
        )
      }
    }

    graphics
      .rect(
        this.localCenterX - (this.layout.clumpWidth >> 1),
        baseY - 1,
        this.layout.clumpWidth,
        2
      )
      .fill(GRASS_FILL_COLORS[GRASS_FILL_COLORS.length - 1])
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

  return {
    topLocalY,
    bottomLocalY,
    bandHeight,
    minXByBand,
    maxXByBand,
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

function remapRenderAngleUnits(angleUnits: number): number {
  if (angleUnits === 0) {
    return 0
  }
  const sign = angleUnits < 0 ? -1 : 1
  const magnitude = angleUnits < 0 ? -angleUnits : angleUnits
  const progressPermille = clamp(
    roundDiv(magnitude * 1000, MAX_RENDER_ANGLE_UNITS),
    0,
    1000
  )
  const remainPermille = 1000 - progressPermille
  const easedPermille = 1000 - roundDiv(remainPermille * remainPermille, 1000)
  const remappedMagnitude = roundDiv(
    MAX_RENDER_ANGLE_UNITS * easedPermille,
    1000
  )
  return remappedMagnitude * sign
}

function getTrigIndex(angleUnits: number): number {
  const deg = Math.min(
    MAX_RENDER_ANGLE_DEG,
    Math.max(0, roundDiv(Math.abs(angleUnits), ANGLE_UNIT_SCALE))
  )
  return deg | 0
}

function rotateX(x: number, y: number, angleUnits: number): number {
  const sign = angleUnits < 0 ? -1 : 1
  const index = getTrigIndex(angleUnits)
  const cosValue = COS_TABLE[index]
  const sinValue = SIN_TABLE[index] * sign
  return roundDiv(x * cosValue - y * sinValue, FIXED_ONE)
}

function rotateY(x: number, y: number, angleUnits: number): number {
  const sign = angleUnits < 0 ? -1 : 1
  const index = getTrigIndex(angleUnits)
  const cosValue = COS_TABLE[index]
  const sinValue = SIN_TABLE[index] * sign
  return roundDiv(x * sinValue + y * cosValue, FIXED_ONE)
}
