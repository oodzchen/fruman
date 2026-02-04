export type WeaponRenderType = 'sword' | 'bow' | 'arrow' | 'hook'

export function renderWeapon(
  ctx: CanvasRenderingContext2D,
  weaponType: WeaponRenderType,
  width: number,
  height: number,
  color: string,
  isAttacking: boolean = false,
  drawRatio: number = 0
): void {
  if (weaponType === 'arrow') {
    renderArrow(ctx, width, height, color, isAttacking, 0)
  } else if (weaponType === 'bow') {
    renderBow(ctx, width, height, color, isAttacking, drawRatio)
  } else if (weaponType === 'hook') {
    renderHook(ctx, width, height, color, isAttacking)
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
  ctx.beginPath()
  const halfLen = width / 2
  const halfThick = height / 2

  // Draw custom shape: Flat base (left), Round tip (right)
  ctx.moveTo(-halfLen, -halfThick)
  ctx.lineTo(halfLen - halfThick, -halfThick)
  ctx.arc(halfLen - halfThick, 0, halfThick, -Math.PI / 2, Math.PI / 2)
  ctx.lineTo(-halfLen, halfThick)
  ctx.closePath()

  ctx.fillStyle = color
  ctx.strokeStyle = isAttacking ? '#FFFFFF' : color
  ctx.lineWidth = 2
  ctx.fill()
  ctx.stroke()
}

function renderBow(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  color: string,
  isAttacking: boolean,
  drawRatio: number
): void {
  const halfLen = width / 2
  const clampedDraw = Math.max(0, Math.min(1, drawRatio))
  const drawScale = 1000
  const drawScaled = Math.round(clampedDraw * drawScale)
  const arcBase = 2400
  const arcExtra = 1200
  const arcScaled = arcBase + Math.round((arcExtra * drawScaled) / drawScale)
  const arcDepth = Math.max(1, Math.floor((height * arcScaled) / drawScale))
  const bowLineWidth = Math.max(1, Math.floor((height * 35) / 100))
  const stringLineWidth = 2

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
