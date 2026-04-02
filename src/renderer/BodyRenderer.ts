import {
  getCharacterBodyProfileHeight,
  getCharacterBodyProfileWidth,
  getCharacterEyeDrawX,
  getCharacterEyeDrawY,
} from '../characterBodyProfile'
import type { MapCharacterBodyProfile } from '../editorMapTypes'

function getBodyPointReferenceSize(
  bodyProfile: MapCharacterBodyProfile | null,
  axis: 'x' | 'y'
): number {
  if (!bodyProfile || bodyProfile.points.length < 6) {
    return 128
  }
  const useBounds =
    getCharacterBodyProfileWidth(bodyProfile) > 0 ||
    getCharacterBodyProfileHeight(bodyProfile) > 0
  if (!useBounds) {
    return 128
  }
  let minValue = bodyProfile.points[axis === 'x' ? 0 : 1]
  let maxValue = minValue
  for (let i = axis === 'x' ? 0 : 1; i < bodyProfile.points.length; i += 2) {
    const value = bodyProfile.points[i]
    if (value < minValue) minValue = value
    if (value > maxValue) maxValue = value
  }
  return Math.max(1, maxValue - minValue)
}

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

  const bodyWidthPx =
    getCharacterBodyProfileWidth(bodyProfile) > 0
      ? getCharacterBodyProfileWidth(bodyProfile) * pixelsPerMeter
      : radiusPx * 2
  const bodyHeightResolvedPx =
    getCharacterBodyProfileHeight(bodyProfile) > 0
      ? getCharacterBodyProfileHeight(bodyProfile) * pixelsPerMeter
      : bodyHeightPx > 0
        ? bodyHeightPx
        : radiusPx * 2
  const bodyHalfWidthPx = bodyWidthPx * 0.5
  const bodyHalfHeightPx = bodyHeightResolvedPx * 0.5
  const profileReferenceWidth = getBodyPointReferenceSize(bodyProfile, 'x')
  const profileReferenceHeight = getBodyPointReferenceSize(bodyProfile, 'y')
  const surfaceScaleX = (bodyHalfWidthPx * 2) / profileReferenceWidth
  const surfaceScaleY = (bodyHalfHeightPx * 2) / profileReferenceHeight
  const mirrorBody = !!bodyProfile && bodyProfile.points.length >= 6
  const hasSurfaceTexture = !!bodyProfile?.surfaceDataUrl && !!textureImage
  const surfaceWidthPx =
    typeof bodyProfile?.surfaceWidth === 'number' &&
    bodyProfile.surfaceWidth > 0
      ? bodyProfile.surfaceWidth * surfaceScaleX
      : bodyWidthPx
  const surfaceHeightPx =
    typeof bodyProfile?.surfaceHeight === 'number' &&
    bodyProfile.surfaceHeight > 0
      ? bodyProfile.surfaceHeight * surfaceScaleY
      : bodyHeightResolvedPx
  const surfaceOffsetXPx =
    typeof bodyProfile?.surfaceOffsetX === 'number'
      ? bodyProfile.surfaceOffsetX * surfaceScaleX
      : 0
  const surfaceOffsetYPx =
    typeof bodyProfile?.surfaceOffsetY === 'number'
      ? bodyProfile.surfaceOffsetY * surfaceScaleY
      : 0

  ctx.save()
  if (mirrorBody && facingDirection < 0) {
    ctx.scale(-1, 1)
  }

  if (!hasSurfaceTexture) {
    ctx.fillStyle = bodyColor
    traceBodyPath(ctx, bodyHalfWidthPx, bodyHalfHeightPx, bodyProfile)
    ctx.fill()
  }

  if (textureImage) {
    if (hasSurfaceTexture) {
      ctx.drawImage(
        textureImage,
        surfaceOffsetXPx - surfaceWidthPx * 0.5,
        surfaceOffsetYPx - surfaceHeightPx * 0.5,
        surfaceWidthPx,
        surfaceHeightPx
      )
    } else {
      ctx.save()
      traceBodyPath(ctx, bodyHalfWidthPx, bodyHalfHeightPx, bodyProfile)
      ctx.clip()
      ctx.drawImage(
        textureImage,
        -bodyHalfWidthPx,
        -bodyHalfHeightPx,
        bodyWidthPx,
        bodyHeightResolvedPx
      )
      ctx.restore()
    }
  }

  if (!hasSurfaceTexture) {
    ctx.strokeStyle = bodyColor
    ctx.lineWidth = 3
    traceBodyPath(ctx, bodyHalfWidthPx, bodyHalfHeightPx, bodyProfile)
    ctx.stroke()
  }
  ctx.restore()

  if (showEye && !bodyProfile?.embeddedEye) {
    renderBodyEye(
      ctx,
      bodyHalfWidthPx,
      bodyHalfHeightPx,
      pixelsPerMeter,
      facingDirection,
      bodyProfile,
      eyeColor
    )
  }

  if (outlineWidthPx > 0 && outlineColor.length > 0) {
    ctx.strokeStyle = outlineColor
    ctx.lineWidth = outlineWidthPx
    traceBodyPath(ctx, bodyHalfWidthPx, bodyHalfHeightPx, bodyProfile)
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
  const scaleX = (radiusPx * 2) / getBodyPointReferenceSize(bodyProfile, 'x')
  const scaleY = (radiusYPx * 2) / getBodyPointReferenceSize(bodyProfile, 'y')
  const facing = facingDirection < 0 ? -1 : 1
  const eyeX = getCharacterEyeDrawX(bodyProfile) * scaleX * facing
  const eyeY = getCharacterEyeDrawY(bodyProfile) * scaleY
  const eyeRadius = 5
  const eyeWhiteRadius = 4
  const pupilRadius = 3
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

  const scaleX = (radiusPx * 2) / getBodyPointReferenceSize(bodyProfile, 'x')
  const scaleY = (radiusYPx * 2) / getBodyPointReferenceSize(bodyProfile, 'y')
  const points = bodyProfile.points
  ctx.moveTo(points[0] * scaleX, points[1] * scaleY)
  for (let i = 2; i < points.length; i += 2) {
    ctx.lineTo(points[i] * scaleX, points[i + 1] * scaleY)
  }
  ctx.closePath()
}
