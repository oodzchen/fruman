import type { RenderContext2D } from './RenderContext2D'

export type WeaponRenderType =
  | 'sword'
  | 'spear'
  | 'hammer'
  | 'bow'
  | 'grape'
  | 'arrow'
  | 'grapeShot'
  | 'hook'
  | 'bomb'

export interface WeaponRenderPalette {
  readonly body: string
  readonly bodyStroke: string
  readonly metal: string
  readonly metalStroke: string
  readonly wood: string
  readonly woodStroke: string
  readonly cord: string
  readonly cordStroke: string
  readonly stem: string
  readonly stemStroke: string
  readonly accent: string
  readonly accentStroke: string
}

const SWORD_RUNTIME_PALETTE: WeaponRenderPalette = {
  body: '#c4ccd0',
  bodyStroke: '#6d777d',
  metal: '#c4ccd0',
  metalStroke: '#6d777d',
  wood: '#6a4026',
  woodStroke: '#3f2616',
  cord: '#d8cfb4',
  cordStroke: '#9a8d6b',
  stem: '#496533',
  stemStroke: '#2b3d1f',
  accent: '#8f989e',
  accentStroke: '#555f66',
}

const SPEAR_RUNTIME_PALETTE: WeaponRenderPalette = {
  body: '#7a4f2e',
  bodyStroke: '#472d1b',
  metal: '#c7cfd2',
  metalStroke: '#68737a',
  wood: '#7a4f2e',
  woodStroke: '#472d1b',
  cord: '#d7c9a9',
  cordStroke: '#8f7d58',
  stem: '#496533',
  stemStroke: '#2b3d1f',
  accent: '#a9b2b7',
  accentStroke: '#626c72',
}

const HAMMER_RUNTIME_PALETTE: WeaponRenderPalette = {
  body: '#9aa2a6',
  bodyStroke: '#50585d',
  metal: '#9aa2a6',
  metalStroke: '#50585d',
  wood: '#6b4328',
  woodStroke: '#3b2415',
  cord: '#d8cfb4',
  cordStroke: '#9a8d6b',
  stem: '#496533',
  stemStroke: '#2b3d1f',
  accent: '#c0c7ca',
  accentStroke: '#687177',
}

const BOW_RUNTIME_PALETTE: WeaponRenderPalette = {
  body: '#8b5a34',
  bodyStroke: '#57361f',
  metal: '#c4ccd0',
  metalStroke: '#6d777d',
  wood: '#8b5a34',
  woodStroke: '#57361f',
  cord: '#e0d5ba',
  cordStroke: '#a89972',
  stem: '#496533',
  stemStroke: '#2b3d1f',
  accent: '#b98a50',
  accentStroke: '#704929',
}

const GRAPE_RUNTIME_PALETTE: WeaponRenderPalette = {
  body: '#7b3fa0',
  bodyStroke: '#3f1f58',
  metal: '#c4ccd0',
  metalStroke: '#6d777d',
  wood: '#6a4026',
  woodStroke: '#3f2616',
  cord: '#d8cfb4',
  cordStroke: '#9a8d6b',
  stem: '#4f6f2f',
  stemStroke: '#2d431c',
  accent: '#a45fc5',
  accentStroke: '#5d2d76',
}

const HOOK_RUNTIME_PALETTE: WeaponRenderPalette = {
  body: '#aab2b6',
  bodyStroke: '#586268',
  metal: '#aab2b6',
  metalStroke: '#586268',
  wood: '#6a4026',
  woodStroke: '#3f2616',
  cord: '#d8cfb4',
  cordStroke: '#9a8d6b',
  stem: '#496533',
  stemStroke: '#2b3d1f',
  accent: '#d0d5d8',
  accentStroke: '#747d83',
}

const BOMB_RUNTIME_PALETTE: WeaponRenderPalette = {
  body: '#151515',
  bodyStroke: '#3c3c3c',
  metal: '#7f8588',
  metalStroke: '#484d50',
  wood: '#6a4026',
  woodStroke: '#3f2616',
  cord: '#6a4328',
  cordStroke: '#3b2516',
  stem: '#496533',
  stemStroke: '#2b3d1f',
  accent: '#d6b06b',
  accentStroke: '#8a6530',
}

export function getRuntimeWeaponPalette(
  weaponType: WeaponRenderType
): WeaponRenderPalette {
  if (weaponType === 'spear') {
    return SPEAR_RUNTIME_PALETTE
  }
  if (weaponType === 'hammer') {
    return HAMMER_RUNTIME_PALETTE
  }
  if (weaponType === 'bow' || weaponType === 'arrow') {
    return BOW_RUNTIME_PALETTE
  }
  if (weaponType === 'grape' || weaponType === 'grapeShot') {
    return GRAPE_RUNTIME_PALETTE
  }
  if (weaponType === 'hook') {
    return HOOK_RUNTIME_PALETTE
  }
  if (weaponType === 'bomb') {
    return BOMB_RUNTIME_PALETTE
  }
  return SWORD_RUNTIME_PALETTE
}

function getAttackStrokeColor(isAttacking: boolean, color: string): string {
  return isAttacking ? '#FFFFFF' : color
}

export function renderWeapon(
  ctx: RenderContext2D,
  weaponType: WeaponRenderType,
  width: number,
  height: number,
  color: string,
  isAttacking: boolean = false,
  drawRatio: number = 0,
  bowLineWidthOverride?: number,
  stringLineWidthOverride?: number,
  palette?: WeaponRenderPalette
): void {
  if (weaponType === 'arrow') {
    renderArrow(ctx, width, height, color, isAttacking, 0, palette)
  } else if (weaponType === 'grapeShot') {
    renderGrapeShot(ctx, width, height, color, isAttacking, palette)
  } else if (weaponType === 'bow') {
    renderBow(
      ctx,
      width,
      height,
      color,
      isAttacking,
      drawRatio,
      bowLineWidthOverride,
      stringLineWidthOverride,
      palette
    )
  } else if (weaponType === 'grape') {
    renderGrape(ctx, width, height, color, isAttacking, palette)
  } else if (weaponType === 'hook') {
    renderHook(ctx, width, height, color, isAttacking, palette)
  } else if (weaponType === 'bomb') {
    renderBomb(ctx, width, height, color, drawRatio, palette)
  } else if (weaponType === 'spear') {
    renderSpear(ctx, width, height, color, isAttacking, palette)
  } else if (weaponType === 'hammer') {
    renderHammer(ctx, width, height, color, isAttacking, palette)
  } else {
    renderSword(ctx, width, height, color, isAttacking, palette)
  }
}

function renderSword(
  ctx: RenderContext2D,
  width: number,
  height: number,
  color: string,
  isAttacking: boolean,
  palette?: WeaponRenderPalette
): void {
  const halfLen = width / 2
  const halfHeight = Math.max(1, Math.floor(height / 2))
  const strokeColor = isAttacking ? '#FFFFFF' : color
  const pommelLen = Math.max(1, Math.floor((width * 8) / 100))
  const gripLen = Math.max(1, Math.floor((width * 12) / 100))
  const guardLen = Math.max(1, Math.floor((width * 4) / 100))
  const tipLen = Math.max(1, Math.floor((width * 12) / 100))
  const handleStartX = -halfLen
  const gripStartX = handleStartX + pommelLen
  const guardStartX = gripStartX + gripLen
  const bladeStartX = guardStartX + guardLen
  const bladeEndX = halfLen - tipLen
  const gripHalfWidth = Math.max(1, Math.floor((height * 12) / 100))
  const pommelHalfWidth = Math.max(
    gripHalfWidth + 1,
    Math.floor((height * 22) / 100)
  )
  const guardHalfWidth = Math.max(
    halfHeight + 2,
    Math.floor((height * 90) / 100)
  )
  const bladeHalfWidth = Math.max(1, Math.floor((height * 34) / 100))
  const guardInnerHalfWidth = Math.max(
    gripHalfWidth + 1,
    Math.floor((height * 20) / 100)
  )

  ctx.lineWidth = 2
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'

  if (palette) {
    ctx.fillStyle = palette.accent
    ctx.strokeStyle = getAttackStrokeColor(isAttacking, palette.accentStroke)
    ctx.beginPath()
    ctx.moveTo(handleStartX, -pommelHalfWidth)
    ctx.lineTo(gripStartX, -gripHalfWidth)
    ctx.lineTo(gripStartX, gripHalfWidth)
    ctx.lineTo(handleStartX, pommelHalfWidth)
    ctx.closePath()
    ctx.fill()
    ctx.stroke()

    ctx.fillStyle = palette.wood
    ctx.strokeStyle = getAttackStrokeColor(isAttacking, palette.woodStroke)
    ctx.beginPath()
    ctx.rect(gripStartX, -gripHalfWidth, gripLen, gripHalfWidth * 2)
    ctx.fill()
    ctx.stroke()

    ctx.fillStyle = palette.accent
    ctx.strokeStyle = getAttackStrokeColor(isAttacking, palette.accentStroke)
    ctx.beginPath()
    ctx.moveTo(guardStartX, -guardInnerHalfWidth)
    ctx.lineTo(guardStartX, -guardHalfWidth)
    ctx.lineTo(bladeStartX, -guardHalfWidth)
    ctx.lineTo(bladeStartX, -guardInnerHalfWidth)
    ctx.lineTo(bladeStartX, guardInnerHalfWidth)
    ctx.lineTo(bladeStartX, guardHalfWidth)
    ctx.lineTo(guardStartX, guardHalfWidth)
    ctx.lineTo(guardStartX, guardInnerHalfWidth)
    ctx.closePath()
    ctx.fill()
    ctx.stroke()

    ctx.fillStyle = palette.metal
    ctx.strokeStyle = getAttackStrokeColor(isAttacking, palette.metalStroke)
    ctx.beginPath()
    ctx.moveTo(bladeStartX, -bladeHalfWidth)
    ctx.lineTo(bladeEndX, -bladeHalfWidth)
    ctx.lineTo(halfLen, 0)
    ctx.lineTo(bladeEndX, bladeHalfWidth)
    ctx.lineTo(bladeStartX, bladeHalfWidth)
    ctx.closePath()
    ctx.fill()
    ctx.stroke()
    return
  }

  ctx.fillStyle = color
  ctx.strokeStyle = strokeColor

  ctx.beginPath()
  ctx.moveTo(handleStartX, -pommelHalfWidth)
  ctx.lineTo(gripStartX, -gripHalfWidth)
  ctx.lineTo(guardStartX, -guardInnerHalfWidth)
  ctx.lineTo(guardStartX, -guardHalfWidth)
  ctx.lineTo(bladeStartX, -guardHalfWidth)
  ctx.lineTo(bladeStartX, -guardInnerHalfWidth)
  ctx.lineTo(bladeStartX, -bladeHalfWidth)
  ctx.lineTo(bladeEndX, -bladeHalfWidth)
  ctx.lineTo(halfLen, 0)
  ctx.lineTo(bladeEndX, bladeHalfWidth)
  ctx.lineTo(bladeStartX, bladeHalfWidth)
  ctx.lineTo(bladeStartX, guardInnerHalfWidth)
  ctx.lineTo(bladeStartX, guardHalfWidth)
  ctx.lineTo(guardStartX, guardHalfWidth)
  ctx.lineTo(guardStartX, guardInnerHalfWidth)
  ctx.lineTo(gripStartX, gripHalfWidth)
  ctx.lineTo(handleStartX, pommelHalfWidth)
  ctx.closePath()
  ctx.fill()
  ctx.stroke()
}

function renderBow(
  ctx: RenderContext2D,
  width: number,
  height: number,
  color: string,
  isAttacking: boolean,
  drawRatio: number,
  bowLineWidthOverride?: number,
  stringLineWidthOverride?: number,
  palette?: WeaponRenderPalette
): void {
  const halfLen = width / 2
  const clampedDraw = Math.max(0, Math.min(1, drawRatio))
  const drawScale = 1000
  const drawScaled = Math.round(clampedDraw * drawScale)
  const arcBase = 2400
  const arcExtra = 1200
  const arcScaled = arcBase + Math.round((arcExtra * drawScaled) / drawScale)
  const arcDepth = Math.max(1, Math.floor((height * arcScaled) / drawScale))
  const baseBowLineWidth = Math.max(1, Math.floor((height * 35) / 100))
  const bowLineWidth =
    bowLineWidthOverride !== undefined && bowLineWidthOverride > 0
      ? bowLineWidthOverride
      : baseBowLineWidth
  const stringLineWidth =
    stringLineWidthOverride !== undefined && stringLineWidthOverride > 0
      ? stringLineWidthOverride
      : 2

  ctx.strokeStyle = palette
    ? getAttackStrokeColor(isAttacking, palette.wood)
    : isAttacking
      ? '#FFFFFF'
      : color
  ctx.lineWidth = bowLineWidth
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  // Bow body arc
  ctx.beginPath()
  ctx.moveTo(-halfLen, 0)
  ctx.quadraticCurveTo(0, -arcDepth, halfLen, 0)
  ctx.stroke()

  // Bow string
  const pullOffset = clampedDraw * halfLen * 0.5
  if (palette) {
    ctx.strokeStyle = getAttackStrokeColor(isAttacking, palette.cord)
  }
  ctx.lineWidth = stringLineWidth
  ctx.beginPath()
  ctx.moveTo(-halfLen, 0)
  ctx.lineTo(0, pullOffset)
  ctx.lineTo(halfLen, 0)
  ctx.stroke()
}

function renderSpear(
  ctx: RenderContext2D,
  width: number,
  height: number,
  color: string,
  isAttacking: boolean,
  palette?: WeaponRenderPalette
): void {
  const halfLen = width / 2
  const halfThick = height / 2
  const headLen = Math.max(height * 4, width * 0.1)
  const shaftLen = width - headLen
  const shaftStartX = -halfLen
  const shaftEndX = shaftStartX + shaftLen
  const headMidX = shaftEndX + headLen / 2
  const headHalfWidth = Math.max(height, halfThick * 3)

  ctx.lineWidth = 2
  ctx.lineJoin = 'round'

  if (palette) {
    ctx.fillStyle = palette.wood
    ctx.strokeStyle = getAttackStrokeColor(isAttacking, palette.woodStroke)
    ctx.beginPath()
    ctx.rect(shaftStartX, -halfThick, shaftLen, height)
    ctx.fill()
    ctx.stroke()

    ctx.fillStyle = palette.metal
    ctx.strokeStyle = getAttackStrokeColor(isAttacking, palette.metalStroke)
    ctx.beginPath()
    ctx.moveTo(shaftEndX, 0)
    ctx.lineTo(headMidX, -headHalfWidth)
    ctx.lineTo(halfLen, 0)
    ctx.lineTo(headMidX, headHalfWidth)
    ctx.closePath()
    ctx.fill()
    ctx.stroke()
    return
  }

  ctx.fillStyle = color
  ctx.strokeStyle = isAttacking ? '#FFFFFF' : color

  ctx.beginPath()
  ctx.rect(shaftStartX, -halfThick, shaftLen, height)
  ctx.fill()
  ctx.stroke()

  ctx.beginPath()
  ctx.moveTo(shaftEndX, 0)
  ctx.lineTo(headMidX, -headHalfWidth)
  ctx.lineTo(halfLen, 0)
  ctx.lineTo(headMidX, headHalfWidth)
  ctx.closePath()
  ctx.fill()
  ctx.stroke()
}

function renderArrow(
  ctx: RenderContext2D,
  lengthPx: number,
  thicknessPx: number,
  color: string,
  isAttacking: boolean,
  baseOffsetY: number,
  palette?: WeaponRenderPalette
): void {
  const lineWidth = Math.max(1, thicknessPx * 0.9)
  const headLen = Math.max(4, lengthPx * 0.18)
  const headWidth = Math.max(4, thicknessPx * 1.6)
  const tipY = baseOffsetY - lengthPx

  ctx.lineWidth = lineWidth

  if (palette) {
    ctx.strokeStyle = getAttackStrokeColor(isAttacking, palette.wood)
    ctx.beginPath()
    ctx.moveTo(0, baseOffsetY)
    ctx.lineTo(0, tipY)
    ctx.stroke()

    ctx.strokeStyle = getAttackStrokeColor(isAttacking, palette.metal)
    ctx.beginPath()
    ctx.moveTo(0, tipY)
    ctx.lineTo(-headWidth / 2, tipY + headLen)
    ctx.moveTo(0, tipY)
    ctx.lineTo(headWidth / 2, tipY + headLen)
    ctx.stroke()
    return
  }

  ctx.strokeStyle = isAttacking ? '#FFFFFF' : color

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

function renderGrapeShot(
  ctx: RenderContext2D,
  width: number,
  height: number,
  color: string,
  isAttacking: boolean,
  palette?: WeaponRenderPalette
): void {
  const radius = Math.max(2, Math.min(width, height) * 0.5)

  ctx.fillStyle = palette ? palette.body : color
  ctx.strokeStyle = palette
    ? getAttackStrokeColor(isAttacking, palette.bodyStroke)
    : isAttacking
      ? '#FFFFFF'
      : color
  ctx.lineWidth = 2

  ctx.beginPath()
  ctx.arc(0, 0, radius, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()
}

function renderGrape(
  ctx: RenderContext2D,
  width: number,
  height: number,
  color: string,
  isAttacking: boolean,
  palette?: WeaponRenderPalette
): void {
  const radius = Math.max(2, Math.min(width, height) * 0.16)
  const stemWidth = Math.max(2, radius * 0.7)
  const stemHeight = Math.max(4, radius * 1.2)
  const stemTop = -height * 0.5
  const centerY = stemTop + stemHeight + radius * 1.1
  const leftX = -radius * 1.3
  const rightX = radius * 1.3
  const lowerY = centerY + radius * 1.7
  const bottomY = lowerY + radius * 1.7

  ctx.lineWidth = 2
  ctx.lineJoin = 'round'

  if (palette) {
    ctx.fillStyle = palette.stem
    ctx.strokeStyle = getAttackStrokeColor(isAttacking, palette.stemStroke)
    ctx.beginPath()
    ctx.rect(-stemWidth * 0.5, stemTop, stemWidth, stemHeight)
    ctx.fill()
    ctx.stroke()

    ctx.fillStyle = palette.body
    ctx.strokeStyle = getAttackStrokeColor(isAttacking, palette.bodyStroke)
    fillGrapeCircle(ctx, 0, centerY - radius * 1.2, radius)
    fillGrapeCircle(ctx, leftX, centerY, radius)
    fillGrapeCircle(ctx, rightX, centerY, radius)
    fillGrapeCircle(ctx, 0, centerY, radius)
    fillGrapeCircle(ctx, -radius * 0.7, lowerY, radius)
    fillGrapeCircle(ctx, radius * 0.7, lowerY, radius)
    fillGrapeCircle(ctx, 0, bottomY, radius)
    return
  }

  ctx.fillStyle = color
  ctx.strokeStyle = isAttacking ? '#FFFFFF' : color

  ctx.beginPath()
  ctx.rect(-stemWidth * 0.5, stemTop, stemWidth, stemHeight)
  ctx.fill()
  ctx.stroke()

  fillGrapeCircle(ctx, 0, centerY - radius * 1.2, radius)
  fillGrapeCircle(ctx, leftX, centerY, radius)
  fillGrapeCircle(ctx, rightX, centerY, radius)
  fillGrapeCircle(ctx, 0, centerY, radius)
  fillGrapeCircle(ctx, -radius * 0.7, lowerY, radius)
  fillGrapeCircle(ctx, radius * 0.7, lowerY, radius)
  fillGrapeCircle(ctx, 0, bottomY, radius)
}

function fillGrapeCircle(
  ctx: RenderContext2D,
  x: number,
  y: number,
  radius: number
): void {
  ctx.beginPath()
  ctx.arc(x, y, radius, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()
}

function renderHammer(
  ctx: RenderContext2D,
  width: number,
  height: number,
  color: string,
  isAttacking: boolean,
  palette?: WeaponRenderPalette
): void {
  const halfLen = width / 2
  const halfThick = height / 2
  const handleLen = width * 0.62
  const handleStartX = -halfLen
  const handleHalfHeight = Math.max(height * 0.16, halfThick * 0.32)
  const handleEndX = handleStartX + handleLen
  const headWidth = width - handleLen
  const headInset = Math.max(height * 0.08, headWidth * 0.08)
  const headHeight = height * 1.5
  const headTop = -headHeight / 2

  ctx.lineWidth = 2
  ctx.lineJoin = 'round'

  if (palette) {
    ctx.fillStyle = palette.wood
    ctx.strokeStyle = getAttackStrokeColor(isAttacking, palette.woodStroke)
    ctx.beginPath()
    ctx.rect(handleStartX, -handleHalfHeight, handleLen, handleHalfHeight * 2)
    ctx.fill()
    ctx.stroke()

    ctx.fillStyle = palette.metal
    ctx.strokeStyle = getAttackStrokeColor(isAttacking, palette.metalStroke)
    ctx.beginPath()
    ctx.rect(handleEndX - headInset, headTop, headWidth + headInset, headHeight)
    ctx.fill()
    ctx.stroke()
    return
  }

  ctx.fillStyle = color
  ctx.strokeStyle = isAttacking ? '#FFFFFF' : color

  ctx.beginPath()
  ctx.rect(handleStartX, -handleHalfHeight, handleLen, handleHalfHeight * 2)
  ctx.fill()
  ctx.stroke()

  ctx.beginPath()
  ctx.rect(handleEndX - headInset, headTop, headWidth + headInset, headHeight)
  ctx.fill()
  ctx.stroke()
}

function renderHook(
  ctx: RenderContext2D,
  width: number,
  height: number,
  color: string,
  isAttacking: boolean,
  palette?: WeaponRenderPalette
): void {
  const ringRadius = Math.max(3, Math.floor(Math.min(width, height) * 0.26))
  const stroke = Math.max(2, Math.floor(ringRadius * 0.24))
  const hookRadius = Math.max(3, Math.floor(ringRadius * 0.9))
  const hookStart = Math.PI * 0.25
  const hookEnd = Math.PI * 1.85
  const stemLen = Math.max(3, Math.floor(ringRadius * 0.55))
  const barHalf = Math.max(4, Math.floor(ringRadius * 0.8))

  ctx.strokeStyle = palette
    ? getAttackStrokeColor(isAttacking, palette.metal)
    : isAttacking
      ? '#FFFFFF'
      : color
  ctx.lineWidth = stroke
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  // C-shape hook (close to a circle)
  ctx.beginPath()
  ctx.arc(0, 0, hookRadius, hookStart, hookEnd, false)
  ctx.stroke()

  // Stem down to hook top
  ctx.beginPath()
  ctx.moveTo(0, -hookRadius - stemLen)
  ctx.lineTo(0, -hookRadius)
  ctx.stroke()

  // Top bar
  ctx.beginPath()
  ctx.moveTo(-barHalf, -hookRadius - stemLen)
  ctx.lineTo(barHalf, -hookRadius - stemLen)
  ctx.stroke()
}

function renderBomb(
  ctx: RenderContext2D,
  width: number,
  height: number,
  color: string,
  fuseProgress: number,
  palette?: WeaponRenderPalette
): void {
  const radius = Math.max(3, Math.min(width, height) * 0.34)
  const lit = fuseProgress > 0
  const fuseStartX = radius * 0.1
  const fuseStartY = -radius * 0.92
  const fuseControlX = radius * 0.95
  const fuseControlY = -radius * 1.65
  const fuseEndX = radius * 1.42
  const fuseEndY = -radius * 1.2

  ctx.lineWidth = 2
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'

  ctx.fillStyle = palette ? palette.body : color
  ctx.strokeStyle = palette ? palette.bodyStroke : lit ? '#fff2c8' : color
  ctx.beginPath()
  ctx.arc(0, 0, radius, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()

  if (palette) {
    ctx.strokeStyle = lit ? '#fff2c8' : palette.cord
  }
  ctx.beginPath()
  ctx.moveTo(fuseStartX, fuseStartY)
  ctx.quadraticCurveTo(fuseControlX, fuseControlY, fuseEndX, fuseEndY)
  ctx.stroke()

  if (!lit) {
    return
  }

  const sparkOffset = Math.max(0, Math.min(1, fuseProgress))
  const sparkX =
    fuseStartX +
    (fuseControlX - fuseStartX) * sparkOffset +
    (fuseEndX - fuseControlX) * sparkOffset * sparkOffset
  const sparkY =
    fuseStartY +
    (fuseControlY - fuseStartY) * sparkOffset +
    (fuseEndY - fuseControlY) * sparkOffset * sparkOffset
  const glowRadius = Math.max(2, radius * 0.32)
  const coreRadius = Math.max(1.5, radius * 0.18)
  const flashThreshold = 0.92
  const igniteFlash =
    fuseProgress > flashThreshold
      ? Math.min(1, (fuseProgress - flashThreshold) / (1 - flashThreshold))
      : 0

  if (igniteFlash > 0) {
    const flashGlowRadius = Math.max(glowRadius, radius * (0.65 + igniteFlash))
    const flashCoreRadius = Math.max(
      coreRadius,
      radius * (0.26 + igniteFlash * 0.14)
    )

    ctx.fillStyle = `rgba(255, 214, 96, ${0.42 * igniteFlash})`
    ctx.beginPath()
    ctx.arc(sparkX, sparkY, flashGlowRadius, 0, Math.PI * 2)
    ctx.fill()

    ctx.fillStyle = `rgba(255, 247, 204, ${0.82 * igniteFlash})`
    ctx.beginPath()
    ctx.arc(sparkX, sparkY, flashCoreRadius, 0, Math.PI * 2)
    ctx.fill()

    ctx.strokeStyle = `rgba(255, 238, 168, ${0.9 * igniteFlash})`
    ctx.lineWidth = Math.max(1, radius * 0.08)
    ctx.beginPath()
    ctx.moveTo(sparkX - flashGlowRadius, sparkY)
    ctx.lineTo(sparkX + flashGlowRadius, sparkY)
    ctx.moveTo(sparkX, sparkY - flashGlowRadius)
    ctx.lineTo(sparkX, sparkY + flashGlowRadius)
    ctx.moveTo(sparkX - flashGlowRadius * 0.7, sparkY - flashGlowRadius * 0.7)
    ctx.lineTo(sparkX + flashGlowRadius * 0.7, sparkY + flashGlowRadius * 0.7)
    ctx.moveTo(sparkX - flashGlowRadius * 0.7, sparkY + flashGlowRadius * 0.7)
    ctx.lineTo(sparkX + flashGlowRadius * 0.7, sparkY - flashGlowRadius * 0.7)
    ctx.stroke()
  }

  ctx.fillStyle = 'rgba(255, 196, 72, 0.45)'
  ctx.beginPath()
  ctx.arc(sparkX, sparkY, glowRadius, 0, Math.PI * 2)
  ctx.fill()

  ctx.fillStyle = '#fff5cc'
  ctx.beginPath()
  ctx.arc(sparkX, sparkY, coreRadius, 0, Math.PI * 2)
  ctx.fill()

  ctx.strokeStyle = '#ff9f2e'
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(sparkX - glowRadius, sparkY)
  ctx.lineTo(sparkX + glowRadius, sparkY)
  ctx.moveTo(sparkX, sparkY - glowRadius)
  ctx.lineTo(sparkX, sparkY + glowRadius)
  ctx.stroke()
}
