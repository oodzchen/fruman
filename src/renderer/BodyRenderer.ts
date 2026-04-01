import {
  CHARACTER_BODY_DRAW_SIZE,
  getCharacterEyeDrawX,
  getCharacterEyeDrawY,
} from '../characterBodyProfile'
import type { MapCharacterBodyProfile } from '../editorMapTypes'

export function renderBody(
  ctx: CanvasRenderingContext2D,
  radiusPx: number,
  bodyColor: string,
  pixelsPerMeter: number,
  facingDirection: number,
  bodyHeightPx = 0,
  outlineColor = '',
  outlineWidthPx = 0,
  bodyProfile: MapCharacterBodyProfile | null = null,
  textureImage: CanvasImageSource | null = null,
  showEye = true,
  eyeColor = '#000000'
): void {
  if (!Number.isFinite(radiusPx) || radiusPx <= 0) {
    return
  }

  const radiusYPx = bodyHeightPx > 0 ? bodyHeightPx / 2 : radiusPx
  const mirrorBody = !!bodyProfile && bodyProfile.points.length >= 6
  const hasSurfaceTexture = !!bodyProfile?.surfaceDataUrl && !!textureImage

  ctx.save()
  if (mirrorBody && facingDirection < 0) {
    ctx.scale(-1, 1)
  }

  if (!hasSurfaceTexture) {
    ctx.fillStyle = bodyColor
    traceBodyPath(ctx, radiusPx, radiusYPx, bodyProfile)
    ctx.fill()
  }

  if (textureImage) {
    ctx.save()
    traceBodyPath(ctx, radiusPx, radiusYPx, bodyProfile)
    ctx.clip()
    ctx.drawImage(
      textureImage,
      -radiusPx,
      -radiusYPx,
      radiusPx * 2,
      radiusYPx * 2
    )
    ctx.restore()
  }

  if (!hasSurfaceTexture) {
    ctx.strokeStyle = bodyColor
    ctx.lineWidth = 3
    traceBodyPath(ctx, radiusPx, radiusYPx, bodyProfile)
    ctx.stroke()
  }
  ctx.restore()

  if (showEye) {
    renderBodyEye(
      ctx,
      radiusPx,
      radiusYPx,
      pixelsPerMeter,
      facingDirection,
      bodyProfile,
      eyeColor
    )
  }

  if (outlineWidthPx > 0 && outlineColor.length > 0) {
    ctx.strokeStyle = outlineColor
    ctx.lineWidth = outlineWidthPx
    traceBodyPath(ctx, radiusPx, radiusYPx, bodyProfile)
    ctx.stroke()
  }
}

export function renderBodyEye(
  ctx: CanvasRenderingContext2D,
  radiusPx: number,
  radiusYPx: number,
  _pixelsPerMeter: number,
  facingDirection: number,
  bodyProfile: MapCharacterBodyProfile | null = null,
  pupilColor = '#14110d'
): void {
  const scaleX = (radiusPx * 2) / CHARACTER_BODY_DRAW_SIZE
  const scaleY = (radiusYPx * 2) / CHARACTER_BODY_DRAW_SIZE
  const facing = facingDirection < 0 ? -1 : 1
  const eyeX = getCharacterEyeDrawX(bodyProfile) * scaleX * facing
  const eyeY = getCharacterEyeDrawY(bodyProfile) * scaleY
  const baseRadius = Math.max(4, Math.min(radiusPx, radiusYPx) * 0.18)
  const eyeRadius = Math.max(5, Math.round(baseRadius))
  const eyeWhiteRadius = Math.max(3.5, eyeRadius - 0.5)
  const pupilRadius = Math.max(2.5, eyeWhiteRadius - 0.5)
  const highlightRadius = Math.max(1.5, Math.round(pupilRadius * 0.4))
  const highlightX = -Math.max(1, Math.round(pupilRadius * 0.28))
  const highlightY = -Math.max(1, Math.round(pupilRadius * 0.32))

  ctx.save()
  ctx.translate(eyeX, eyeY)

  ctx.fillStyle = '#201710'
  ctx.beginPath()
  ctx.arc(0, 0, eyeRadius, 0, Math.PI * 2)
  ctx.fill()

  ctx.fillStyle = '#f4ecdc'
  ctx.beginPath()
  ctx.arc(0, 0, eyeWhiteRadius, 0, Math.PI * 2)
  ctx.fill()

  ctx.fillStyle = pupilColor
  ctx.beginPath()
  ctx.arc(0, 0, pupilRadius, 0, Math.PI * 2)
  ctx.fill()

  ctx.fillStyle = 'rgba(255,255,255,0.95)'
  ctx.beginPath()
  ctx.arc(highlightX, highlightY, highlightRadius, 0, Math.PI * 2)
  ctx.fill()

  ctx.restore()
}

function traceBodyPath(
  ctx: CanvasRenderingContext2D,
  radiusPx: number,
  radiusYPx: number,
  bodyProfile: MapCharacterBodyProfile | null
): void {
  ctx.beginPath()
  if (!bodyProfile || bodyProfile.points.length < 6) {
    if (radiusYPx === radiusPx) {
      ctx.arc(0, 0, radiusPx, 0, Math.PI * 2)
      return
    }
    ctx.ellipse(0, 0, radiusPx, radiusYPx, 0, 0, Math.PI * 2)
    return
  }

  const scaleX = (radiusPx * 2) / CHARACTER_BODY_DRAW_SIZE
  const scaleY = (radiusYPx * 2) / CHARACTER_BODY_DRAW_SIZE
  const points = bodyProfile.points
  ctx.moveTo(points[0] * scaleX, points[1] * scaleY)
  for (let i = 2; i < points.length; i += 2) {
    ctx.lineTo(points[i] * scaleX, points[i + 1] * scaleY)
  }
  ctx.closePath()
}
