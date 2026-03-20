export type WeaponRenderType =
  | 'sword'
  | 'spear'
  | 'hammer'
  | 'bow'
  | 'arrow'
  | 'hook'

export function renderWeapon(
  ctx: CanvasRenderingContext2D,
  weaponType: WeaponRenderType,
  width: number,
  height: number,
  color: string,
  isAttacking: boolean = false,
  drawRatio: number = 0,
  bowLineWidthOverride?: number,
  stringLineWidthOverride?: number
): void {
  if (weaponType === 'arrow') {
    renderArrow(ctx, width, height, color, isAttacking, 0)
  } else if (weaponType === 'bow') {
    renderBow(
      ctx,
      width,
      height,
      color,
      isAttacking,
      drawRatio,
      bowLineWidthOverride,
      stringLineWidthOverride
    )
  } else if (weaponType === 'hook') {
    renderHook(ctx, width, height, color, isAttacking)
  } else if (weaponType === 'spear') {
    renderSpear(ctx, width, height, color, isAttacking)
  } else if (weaponType === 'hammer') {
    renderHammer(ctx, width, height, color, isAttacking)
  } else {
    renderSword(ctx, width, height, color, isAttacking)
  }
}

function renderSword(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  color: string,
  isAttacking: boolean
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
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  color: string,
  isAttacking: boolean,
  drawRatio: number,
  bowLineWidthOverride?: number,
  stringLineWidthOverride?: number
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

  ctx.strokeStyle = isAttacking ? '#FFFFFF' : color
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
  ctx.lineWidth = stringLineWidth
  ctx.beginPath()
  ctx.moveTo(-halfLen, 0)
  ctx.lineTo(0, pullOffset)
  ctx.lineTo(halfLen, 0)
  ctx.stroke()
}

function renderSpear(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  color: string,
  isAttacking: boolean
): void {
  const halfLen = width / 2
  const halfThick = height / 2
  const headLen = Math.max(height * 4, width * 0.1)
  const shaftLen = width - headLen
  const shaftStartX = -halfLen
  const shaftEndX = shaftStartX + shaftLen
  const headMidX = shaftEndX + headLen / 2
  const headHalfWidth = Math.max(height, halfThick * 3)

  ctx.fillStyle = color
  ctx.strokeStyle = isAttacking ? '#FFFFFF' : color
  ctx.lineWidth = 2
  ctx.lineJoin = 'round'

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

  ctx.strokeStyle = isAttacking ? '#FFFFFF' : color
  ctx.lineWidth = lineWidth

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

function renderHammer(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  color: string,
  isAttacking: boolean
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

  ctx.fillStyle = color
  ctx.strokeStyle = isAttacking ? '#FFFFFF' : color
  ctx.lineWidth = 2
  ctx.lineJoin = 'round'

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
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  color: string,
  isAttacking: boolean
): void {
  const ringRadius = Math.max(3, Math.floor(Math.min(width, height) * 0.26))
  const stroke = Math.max(2, Math.floor(ringRadius * 0.24))
  const hookRadius = Math.max(3, Math.floor(ringRadius * 0.9))
  const hookStart = Math.PI * 0.25
  const hookEnd = Math.PI * 1.85
  const stemLen = Math.max(3, Math.floor(ringRadius * 0.55))
  const barHalf = Math.max(4, Math.floor(ringRadius * 0.8))

  ctx.strokeStyle = isAttacking ? '#FFFFFF' : color
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
