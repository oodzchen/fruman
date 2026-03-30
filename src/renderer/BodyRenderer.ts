export function renderBody(
  ctx: CanvasRenderingContext2D,
  radiusPx: number,
  bodyColor: string,
  pixelsPerMeter: number,
  facingDirection: number,
  bodyHeightPx = 0,
  outlineColor = '',
  outlineWidthPx = 0
): void {
  if (!Number.isFinite(radiusPx) || radiusPx <= 0) {
    return
  }

  const radiusYPx = bodyHeightPx > 0 ? bodyHeightPx / 2 : radiusPx

  ctx.fillStyle = bodyColor
  traceBodyPath(ctx, radiusPx, radiusYPx)
  ctx.fill()

  ctx.strokeStyle = bodyColor
  ctx.lineWidth = 3
  traceBodyPath(ctx, radiusPx, radiusYPx)
  ctx.stroke()

  const eyeRadius = 0.08 * pixelsPerMeter
  const eyeOffsetX = radiusPx * 0.5
  const eyeOffsetY = -radiusYPx * 0.5
  const eyeX = facingDirection < 0 ? -eyeOffsetX : eyeOffsetX
  const eyeY = eyeOffsetY

  ctx.fillStyle = '#000000'
  ctx.beginPath()
  ctx.arc(eyeX, eyeY, eyeRadius, 0, Math.PI * 2)
  ctx.fill()

  if (outlineWidthPx > 0 && outlineColor.length > 0) {
    ctx.strokeStyle = outlineColor
    ctx.lineWidth = outlineWidthPx
    traceBodyPath(ctx, radiusPx, radiusYPx)
    ctx.stroke()
  }
}

function traceBodyPath(
  ctx: CanvasRenderingContext2D,
  radiusPx: number,
  radiusYPx: number
): void {
  ctx.beginPath()
  if (radiusYPx === radiusPx) {
    ctx.arc(0, 0, radiusPx, 0, Math.PI * 2)
    return
  }
  ctx.ellipse(0, 0, radiusPx, radiusYPx, 0, 0, Math.PI * 2)
}
