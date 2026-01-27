export function renderBody(
  ctx: CanvasRenderingContext2D,
  radiusPx: number,
  bodyColor: string,
  pixelsPerMeter: number,
  facingDirection: number
): void {
  if (!Number.isFinite(radiusPx) || radiusPx <= 0) {
    return
  }

  ctx.fillStyle = bodyColor
  ctx.beginPath()
  ctx.arc(0, 0, radiusPx, 0, Math.PI * 2)
  ctx.fill()

  ctx.strokeStyle = bodyColor
  ctx.lineWidth = 3
  ctx.stroke()

  const eyeRadius = 0.08 * pixelsPerMeter
  const eyeOffsetX = radiusPx * 0.5
  const eyeOffsetY = -radiusPx * 0.5
  const eyeX = facingDirection < 0 ? -eyeOffsetX : eyeOffsetX
  const eyeY = eyeOffsetY

  ctx.fillStyle = '#000000'
  ctx.beginPath()
  ctx.arc(eyeX, eyeY, eyeRadius, 0, Math.PI * 2)
  ctx.fill()
}
