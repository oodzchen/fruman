import type { MapCharacterBodyPresetId } from '../editorMapTypes'
import type {
  BodyPresetBounds,
  BodyPresetConfig,
  EditorCharacterBodyPresetId,
} from './EditorBodyDrawerTypes'
import {
  BANANA_PRESET_IMAGE_SRC,
  BANANA_PRESET_POINTS,
  BODY_PRESET_IDS,
  CUSTOM_BODY_PRESET_ID,
  DRAW_WORLD_HALF,
  KIWANO_PRESET_IMAGE_SRC,
  KIWANO_PRESET_POINTS,
  PANDA_ANT_PRESET_IMAGE_SRC,
  PANDA_ANT_PRESET_POINTS,
  PINEAPPLE_PRESET_IMAGE_SRC,
  PINEAPPLE_PRESET_POINTS,
  TOMATO_PRESET_IMAGE_SRC,
  TOMATO_PRESET_POINTS,
  TRANSPARENT_BODY_COLOR,
  WATERMELON_PRESET_IMAGE_SRC,
  WATERMELON_PRESET_POINTS,
} from './EditorBodyDrawerTypes'

export function isBodyPresetId(
  value: string | undefined
): value is MapCharacterBodyPresetId {
  if (!value) {
    return false
  }
  for (let i = 0; i < BODY_PRESET_IDS.length; i++) {
    if (BODY_PRESET_IDS[i] === value) {
      return true
    }
  }
  return false
}

export function getBodyPresetConfig(
  presetId: MapCharacterBodyPresetId
): BodyPresetConfig {
  if (presetId === 'banana') {
    return {
      color: TRANSPARENT_BODY_COLOR,
      bloodColor: '#8a5424',
      eyeX: 0,
      eyeY: -5,
      points: BANANA_PRESET_POINTS,
      imageSrc: BANANA_PRESET_IMAGE_SRC,
      mirrorImageX: true,
    }
  }
  if (presetId === 'kiwano') {
    return {
      color: TRANSPARENT_BODY_COLOR,
      bloodColor: '#8e5a17',
      eyeX: 20,
      eyeY: -2,
      points: KIWANO_PRESET_POINTS,
      imageSrc: KIWANO_PRESET_IMAGE_SRC,
      mirrorImageX: true,
      imageTargetHeight: 156,
    }
  }
  if (presetId === 'pandaAnt') {
    return {
      color: TRANSPARENT_BODY_COLOR,
      bloodColor: '#2e241f',
      eyeX: 34,
      eyeY: -8,
      points: PANDA_ANT_PRESET_POINTS,
      imageSrc: PANDA_ANT_PRESET_IMAGE_SRC,
      mirrorImageX: true,
      imageTargetHeight: 120,
    }
  }
  if (presetId === 'pineapple') {
    return {
      color: TRANSPARENT_BODY_COLOR,
      bloodColor: '#7d4a18',
      eyeX: 0,
      eyeY: 52,
      points: PINEAPPLE_PRESET_POINTS,
      imageSrc: PINEAPPLE_PRESET_IMAGE_SRC,
      imageTargetHeight: 220,
    }
  }
  if (presetId === 'tomato') {
    return {
      color: TRANSPARENT_BODY_COLOR,
      bloodColor: '#8f1414',
      eyeX: 0,
      eyeY: 3,
      points: TOMATO_PRESET_POINTS,
      imageSrc: TOMATO_PRESET_IMAGE_SRC,
      mirrorImageX: true,
    }
  }
  return {
    color: TRANSPARENT_BODY_COLOR,
    bloodColor: '#9b2e22',
    eyeX: 0,
    eyeY: 1,
    points: WATERMELON_PRESET_POINTS,
    imageSrc: WATERMELON_PRESET_IMAGE_SRC,
    mirrorImageX: true,
  }
}

export function getProfilePointWidth(points: readonly number[]): number {
  if (points.length < 2) {
    return 0
  }
  let minX = points[0]
  let maxX = points[0]
  for (let i = 2; i < points.length; i += 2) {
    const pointX = points[i]
    if (pointX < minX) {
      minX = pointX
    }
    if (pointX > maxX) {
      maxX = pointX
    }
  }
  return Math.max(1, maxX - minX)
}

export function getFacingPreferredEyeX(width: number, facing: number): number {
  const offset = Math.max(1, Math.floor((Math.max(1, width) * 3 + 5) / 10))
  return facing < 0 ? -offset : offset
}

export function getPresetPreferredEyeX(
  preset: BodyPresetConfig,
  contourWidth: number,
  facing: number
): number {
  if (preset.eyeX !== 0) {
    return preset.eyeX * facing
  }
  return getFacingPreferredEyeX(contourWidth, facing)
}

export function shouldMirrorPresetImage(
  preset: BodyPresetConfig,
  editorFacing: number
): boolean {
  return editorFacing < 0 !== (preset.mirrorImageX === true)
}

export function getBodyPresetImageSrc(
  presetId: EditorCharacterBodyPresetId | undefined
): string | null {
  if (!isBodyPresetId(presetId)) {
    return null
  }
  const imageSrc = getBodyPresetConfig(presetId).imageSrc
  return typeof imageSrc === 'string' && imageSrc.length > 0 ? imageSrc : null
}

export function mirrorLocalPoints(points: number[]): number[] {
  const mirrored = new Array<number>(points.length)
  for (let i = 0; i < points.length; i += 2) {
    mirrored[i] = -points[i]
    mirrored[i + 1] = points[i + 1]
  }
  return mirrored
}

export function buildPresetContourPoints(
  points: readonly number[],
  facing: number
): number[] {
  const contourPoints = new Array<number>(points.length)
  for (let i = 0; i < points.length; i += 2) {
    contourPoints[i] = DRAW_WORLD_HALF + points[i] * facing
    contourPoints[i + 1] = DRAW_WORLD_HALF + points[i + 1]
  }
  return contourPoints
}

export function drawImageToRect(
  ctx: CanvasRenderingContext2D,
  image: CanvasImageSource,
  x: number,
  y: number,
  width: number,
  height: number,
  mirrorHorizontally: boolean
) {
  if (!mirrorHorizontally) {
    ctx.drawImage(image, x, y, width, height)
    return
  }
  ctx.save()
  ctx.translate(x + width, y)
  ctx.scale(-1, 1)
  ctx.drawImage(image, 0, 0, width, height)
  ctx.restore()
}

export function fillPresetPolygon(
  ctx: CanvasRenderingContext2D,
  points: readonly number[]
) {
  if (points.length < 6) {
    return
  }
  ctx.beginPath()
  ctx.moveTo(points[0], points[1])
  for (let i = 2; i < points.length; i += 2) {
    ctx.lineTo(points[i], points[i + 1])
  }
  ctx.closePath()
  ctx.fill()
}

export function drawBodyPresetTexture(
  ctx: CanvasRenderingContext2D,
  presetId: MapCharacterBodyPresetId,
  bounds: BodyPresetBounds
) {
  const bandWidth = Math.max(6, Math.round(bounds.width / 10))
  const stripeWidth = Math.max(8, Math.round(bounds.width / 9))
  const stripeThinWidth = Math.max(4, Math.round(bounds.width / 16))
  const topBandY = bounds.minY + Math.round(bounds.height / 3)
  if (presetId === 'banana') {
    ctx.save()
    ctx.lineCap = 'round'
    ctx.strokeStyle = 'rgba(196,160,38,0.55)'
    ctx.lineWidth = bandWidth
    for (let i = -1; i <= 1; i++) {
      const offsetY = i * Math.max(10, Math.round(bounds.height / 7))
      ctx.beginPath()
      ctx.moveTo(bounds.minX + 14, bounds.centerY + offsetY + 10)
      ctx.quadraticCurveTo(
        bounds.centerX,
        bounds.centerY + offsetY - 14,
        bounds.maxX - 10,
        bounds.centerY + offsetY - 4
      )
      ctx.stroke()
    }
    ctx.fillStyle = '#7b4a1f'
    ctx.beginPath()
    ctx.arc(bounds.minX + 12, bounds.centerY + 16, 8, 0, Math.PI * 2)
    ctx.fill()
    ctx.beginPath()
    ctx.arc(bounds.maxX - 8, bounds.centerY - 6, 8, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
    return
  }
  if (presetId === 'pineapple') {
    ctx.save()
    ctx.strokeStyle = 'rgba(110,72,18,0.55)'
    ctx.lineWidth = Math.max(4, Math.round(bounds.width / 18))
    for (let x = bounds.minX - bounds.height; x <= bounds.maxX; x += 20) {
      ctx.beginPath()
      ctx.moveTo(x, topBandY)
      ctx.lineTo(x + bounds.height, bounds.maxY)
      ctx.stroke()
    }
    for (let x = bounds.minX; x <= bounds.maxX + bounds.height; x += 20) {
      ctx.beginPath()
      ctx.moveTo(x, topBandY)
      ctx.lineTo(x - bounds.height, bounds.maxY)
      ctx.stroke()
    }
    ctx.fillStyle = '#4e8d2c'
    fillPresetPolygon(ctx, [
      bounds.centerX - 22,
      bounds.minY + 18,
      bounds.centerX - 6,
      bounds.minY - 30,
      bounds.centerX + 2,
      bounds.minY + 10,
    ])
    fillPresetPolygon(ctx, [
      bounds.centerX - 6,
      bounds.minY + 12,
      bounds.centerX + 10,
      bounds.minY - 40,
      bounds.centerX + 18,
      bounds.minY + 10,
    ])
    fillPresetPolygon(ctx, [
      bounds.centerX + 8,
      bounds.minY + 18,
      bounds.centerX + 30,
      bounds.minY - 18,
      bounds.centerX + 20,
      bounds.minY + 20,
    ])
    ctx.restore()
    return
  }
  if (presetId === 'tomato') {
    ctx.save()
    ctx.lineCap = 'round'
    ctx.strokeStyle = 'rgba(133,22,18,0.3)'
    ctx.lineWidth = stripeWidth
    for (let i = -1; i <= 1; i++) {
      const offsetX = i * Math.max(12, Math.round(bounds.width / 5))
      ctx.beginPath()
      ctx.moveTo(bounds.centerX + offsetX, bounds.minY + 6)
      ctx.quadraticCurveTo(
        bounds.centerX + offsetX,
        bounds.centerY,
        bounds.centerX + offsetX,
        bounds.maxY - 10
      )
      ctx.stroke()
    }
    ctx.fillStyle = 'rgba(255,216,216,0.2)'
    ctx.beginPath()
    ctx.arc(
      bounds.centerX - Math.round(bounds.width / 5),
      bounds.centerY - Math.round(bounds.height / 6),
      Math.max(8, Math.round(bounds.width / 8)),
      0,
      Math.PI * 2
    )
    ctx.fill()
    ctx.fillStyle = '#4f972e'
    fillPresetPolygon(ctx, [
      bounds.centerX - 6,
      bounds.minY + 8,
      bounds.centerX - 26,
      bounds.minY - 2,
      bounds.centerX - 10,
      bounds.minY + 20,
    ])
    fillPresetPolygon(ctx, [
      bounds.centerX + 2,
      bounds.minY + 4,
      bounds.centerX,
      bounds.minY - 18,
      bounds.centerX + 8,
      bounds.minY + 16,
    ])
    fillPresetPolygon(ctx, [
      bounds.centerX + 8,
      bounds.minY + 8,
      bounds.centerX + 28,
      bounds.minY - 2,
      bounds.centerX + 12,
      bounds.minY + 20,
    ])
    ctx.restore()
    return
  }
  ctx.save()
  ctx.lineCap = 'round'
  ctx.strokeStyle = 'rgba(35,104,35,0.46)'
  ctx.lineWidth = stripeWidth
  for (let i = -2; i <= 2; i++) {
    const offsetX = i * Math.max(12, Math.round(bounds.width / 5))
    ctx.beginPath()
    ctx.moveTo(bounds.centerX + offsetX, bounds.minY + 4)
    ctx.quadraticCurveTo(
      bounds.centerX + offsetX + (i % 2 === 0 ? 8 : -8),
      bounds.centerY,
      bounds.centerX + offsetX,
      bounds.maxY - 6
    )
    ctx.stroke()
  }
  ctx.strokeStyle = 'rgba(158,212,118,0.4)'
  ctx.lineWidth = stripeThinWidth
  for (let i = -1; i <= 1; i++) {
    const offsetX = i * Math.max(16, Math.round(bounds.width / 4))
    ctx.beginPath()
    ctx.moveTo(bounds.centerX + offsetX, bounds.minY + 8)
    ctx.quadraticCurveTo(
      bounds.centerX + offsetX - 6,
      bounds.centerY,
      bounds.centerX + offsetX,
      bounds.maxY - 8
    )
    ctx.stroke()
  }
  ctx.restore()
}

export async function loadImage(url: string): Promise<HTMLImageElement | null> {
  return await new Promise((resolve) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => resolve(null)
    image.src = url
  })
}

export { CUSTOM_BODY_PRESET_ID }
