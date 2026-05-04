import {
  drawCharacterBrowGeometry,
  drawCharacterEyeGeometry,
  getCharacterBodyProfileHeight,
  getCharacterBodyProfileWidth,
  getCharacterBrowBounds,
  getCharacterBrowGeometryFromProfile,
  getCharacterEyeBounds,
  getCharacterEyeGeometryFromProfile,
} from '../characterBodyProfile'
import type {
  MapCharacterBodyCollisionShape,
  MapCharacterBodyEyeStyle,
  MapCharacterBodyProfile,
  MapCharacterBodyVisualLayer,
} from '../editorMapTypes'
import {
  buildDefaultSkeletalBoneBoundary,
  deriveSkeletalBodyGeometry,
  getCharacterBodyTextureDataUrl,
} from '../skeletalBodyProfile'
import type { RenderContext2D } from './RenderContext2D'

type BodyPathContext =
  | RenderContext2D
  | CanvasRenderingContext2D
  | OffscreenCanvasRenderingContext2D

interface CachedBodySprite {
  canvas: HTMLCanvasElement
  drawX: number
  drawY: number
  drawWidth: number
  drawHeight: number
}

export interface BodySpriteSource {
  canvas: HTMLCanvasElement
  drawX: number
  drawY: number
  drawWidth: number
  drawHeight: number
}

interface BodyContentBounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

const bodySpriteCache = new Map<string, CachedBodySprite>()
const bodyLayerImageCache = new Map<string, HTMLImageElement>()
const BODY_EYE_PADDING = 3
const MAX_BODY_SPRITE_CACHE = 256

function touchBodySpriteCacheEntry(
  cacheKey: string,
  cached: CachedBodySprite
): CachedBodySprite {
  bodySpriteCache.delete(cacheKey)
  bodySpriteCache.set(cacheKey, cached)
  return cached
}

function pruneBodySpriteCache(): void {
  while (bodySpriteCache.size > MAX_BODY_SPRITE_CACHE) {
    const oldestKey = bodySpriteCache.keys().next().value
    if (typeof oldestKey !== 'string') {
      break
    }
    bodySpriteCache.delete(oldestKey)
  }
}

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

function isRenderableTextureSource(
  textureImage: CanvasImageSource | null
): textureImage is CanvasImageSource {
  if (!textureImage) {
    return false
  }
  if (textureImage instanceof HTMLImageElement) {
    return textureImage.complete && textureImage.naturalWidth > 0
  }
  if (textureImage instanceof HTMLVideoElement) {
    return textureImage.videoWidth > 0 && textureImage.videoHeight > 0
  }
  if (textureImage instanceof HTMLCanvasElement) {
    return textureImage.width > 0 && textureImage.height > 0
  }
  if (
    typeof ImageBitmap !== 'undefined' &&
    textureImage instanceof ImageBitmap
  ) {
    return textureImage.width > 0 && textureImage.height > 0
  }
  if (
    typeof OffscreenCanvas !== 'undefined' &&
    textureImage instanceof OffscreenCanvas
  ) {
    return textureImage.width > 0 && textureImage.height > 0
  }
  if (typeof VideoFrame !== 'undefined' && textureImage instanceof VideoFrame) {
    return textureImage.displayWidth > 0 && textureImage.displayHeight > 0
  }
  return true
}

function buildBodyCacheKey(
  radiusPx: number,
  bodyColor: string,
  pixelsPerMeter: number,
  facingDirection: number,
  bodyHeightPx: number,
  outlineColor: string,
  outlineWidthPx: number,
  bodyProfileCacheKey: string,
  textureSourceKey: string,
  showEye: boolean,
  eyeColor: string,
  fallbackEyeStyle: MapCharacterBodyEyeStyle
): string {
  return [
    radiusPx | 0,
    pixelsPerMeter | 0,
    facingDirection < 0 ? -1 : 1,
    bodyHeightPx | 0,
    outlineWidthPx | 0,
    showEye ? 1 : 0,
    bodyColor,
    outlineColor,
    eyeColor,
    fallbackEyeStyle,
    bodyProfileCacheKey,
    textureSourceKey,
  ].join('|')
}

function createBodyRenderCanvas(
  drawWidth: number,
  drawHeight: number
): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null {
  const canvas = document.createElement('canvas')
  canvas.width = drawWidth
  canvas.height = drawHeight
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    return null
  }
  return { canvas, ctx }
}

function getBodyLayerImage(dataUrl: string): HTMLImageElement | null {
  if (!dataUrl) {
    return null
  }
  const cached = bodyLayerImageCache.get(dataUrl)
  if (cached) {
    return cached
  }
  const image = new Image()
  image.src = dataUrl
  bodyLayerImageCache.set(dataUrl, image)
  return image
}

function shouldRenderDynamicSkeletalBody(
  bodyProfile: MapCharacterBodyProfile | null
): bodyProfile is MapCharacterBodyProfile {
  return (
    !!bodyProfile &&
    bodyProfile.skeletalMode === true &&
    !!bodyProfile.boneSegments &&
    bodyProfile.boneSegments.length > 0 &&
    !bodyProfile.skeletalSurfaceDataUrl
  )
}

function traceCapsulePath(
  ctx: BodyPathContext,
  centerX: number,
  centerY: number,
  halfWidth: number,
  halfHeight: number,
  rotationDeg = 0
): void {
  const radius = Math.min(halfWidth, halfHeight)
  const left = -halfWidth
  const top = -halfHeight
  const width = halfWidth * 2
  const height = halfHeight * 2
  ctx.save()
  ctx.translate(centerX, centerY)
  if (rotationDeg !== 0) {
    ctx.rotate((rotationDeg * Math.PI) / 180)
  }
  ctx.beginPath()
  ctx.moveTo(left + radius, top)
  ctx.lineTo(left + width - radius, top)
  ctx.arc(left + width - radius, top + radius, radius, -Math.PI / 2, 0)
  ctx.lineTo(left + width, top + height - radius)
  ctx.arc(left + width - radius, top + height - radius, radius, 0, Math.PI / 2)
  ctx.lineTo(left + radius, top + height)
  ctx.arc(left + radius, top + height - radius, radius, Math.PI / 2, Math.PI)
  ctx.lineTo(left, top + radius)
  ctx.arc(left + radius, top + radius, radius, Math.PI, Math.PI * 1.5)
  ctx.closePath()
  ctx.restore()
}

function traceCollisionShapePath(
  ctx: BodyPathContext,
  shape: MapCharacterBodyCollisionShape
): void {
  if (shape.kind === 'circle') {
    ctx.beginPath()
    ctx.arc(shape.center.x, shape.center.y, shape.radius, 0, Math.PI * 2)
    return
  }
  if (shape.kind === 'ellipse') {
    ctx.beginPath()
    ctx.ellipse(
      shape.center.x,
      shape.center.y,
      shape.radiusX,
      shape.radiusY,
      ((shape.rotationDeg ?? 0) * Math.PI) / 180,
      0,
      Math.PI * 2
    )
    return
  }
  traceCapsulePath(
    ctx,
    shape.center.x,
    shape.center.y,
    shape.halfWidth,
    shape.halfHeight,
    shape.rotationDeg ?? 0
  )
}

function drawDynamicSkeletalBody(
  ctx: BodyPathContext,
  bodyProfile: MapCharacterBodyProfile,
  bodyColor: string,
  bodyWidthPx: number,
  bodyHeightPx: number
): boolean {
  const boneSegments = bodyProfile.boneSegments
  if (!boneSegments || boneSegments.length === 0) {
    return false
  }
  const geometry = deriveSkeletalBodyGeometry(boneSegments)
  if (!geometry) {
    return false
  }
  const referenceWidth = Math.max(1, geometry.bounds.width)
  const referenceHeight = Math.max(1, geometry.bounds.height)
  const scaleX = bodyWidthPx / referenceWidth
  const scaleY = bodyHeightPx / referenceHeight
  ctx.save()
  ctx.scale(scaleX, scaleY)
  for (let i = 0; i < boneSegments.length; i++) {
    const segment = boneSegments[i]
    if (
      segment.shapeDataUrl &&
      typeof segment.shapeOffsetX === 'number' &&
      typeof segment.shapeOffsetY === 'number' &&
      typeof segment.shapeWidth === 'number' &&
      segment.shapeWidth > 0 &&
      typeof segment.shapeHeight === 'number' &&
      segment.shapeHeight > 0
    ) {
      const image = getBodyLayerImage(segment.shapeDataUrl)
      if (isRenderableTextureSource(image)) {
        ctx.drawImage(
          image,
          segment.shapeOffsetX - geometry.centerX,
          segment.shapeOffsetY - geometry.centerY,
          segment.shapeWidth,
          segment.shapeHeight
        )
        continue
      }
    }
    const sourceShapes =
      segment.boundaryShapes && segment.boundaryShapes.length > 0
        ? segment.boundaryShapes
        : (() => {
            const fallbackShape = buildDefaultSkeletalBoneBoundary(segment)
            return fallbackShape ? [fallbackShape] : []
          })()
    if (sourceShapes.length === 0) {
      continue
    }
    ctx.fillStyle = bodyColor
    for (let j = 0; j < sourceShapes.length; j++) {
      const sourceShape = sourceShapes[j]
      traceCollisionShapePath(ctx, {
        ...sourceShape,
        center: {
          x: sourceShape.center.x - geometry.centerX,
          y: sourceShape.center.y - geometry.centerY,
        },
      })
      ctx.fill()
    }
  }
  ctx.restore()
  return true
}

function shouldRenderProceduralEye(
  bodyProfile: MapCharacterBodyProfile | null,
  showEye: boolean
): boolean {
  if (!showEye) {
    return false
  }
  if (!bodyProfile) {
    return true
  }
  if (
    bodyProfile.textureDataUrl ||
    (bodyProfile.layers && bodyProfile.layers.length > 0)
  ) {
    return true
  }
  return !bodyProfile.embeddedEye
}

function getBodyLayerScaleX(
  bodyHalfWidthPx: number,
  bodyProfile: MapCharacterBodyProfile | null
): number {
  return (bodyHalfWidthPx * 2) / getBodyPointReferenceSize(bodyProfile, 'x')
}

function getBodyLayerScaleY(
  bodyHalfHeightPx: number,
  bodyProfile: MapCharacterBodyProfile | null
): number {
  return (bodyHalfHeightPx * 2) / getBodyPointReferenceSize(bodyProfile, 'y')
}

function drawBodyVisualLayers(
  ctx: BodyPathContext,
  bodyHalfWidthPx: number,
  bodyHalfHeightPx: number,
  bodyProfile: MapCharacterBodyProfile | null,
  facingDirection: number,
  mirrorBody: boolean
): void {
  if (!bodyProfile?.layers || bodyProfile.layers.length === 0) {
    return
  }
  const scaleX = getBodyLayerScaleX(bodyHalfWidthPx, bodyProfile)
  const scaleY = getBodyLayerScaleY(bodyHalfHeightPx, bodyProfile)
  const facing = facingDirection < 0 ? -1 : 1
  for (let i = 0; i < bodyProfile.layers.length; i++) {
    const layer = bodyProfile.layers[i]
    if (layer.kind !== 'brow' && layer.kind !== 'paint') {
      continue
    }
    const image = getBodyLayerImage(layer.dataUrl)
    if (!isRenderableTextureSource(image)) {
      continue
    }
    const widthPx = Math.max(1, layer.width * scaleX)
    const heightPx = Math.max(1, layer.height * scaleY)
    const offsetXPx = layer.offsetX * scaleX * (mirrorBody ? 1 : facing)
    const offsetYPx = layer.offsetY * scaleY
    if (!mirrorBody && facing < 0) {
      ctx.save()
      ctx.translate(offsetXPx, offsetYPx)
      ctx.scale(-1, 1)
      ctx.drawImage(image, -widthPx * 0.5, -heightPx * 0.5, widthPx, heightPx)
      ctx.restore()
      continue
    }
    ctx.drawImage(
      image,
      offsetXPx - widthPx * 0.5,
      offsetYPx - heightPx * 0.5,
      widthPx,
      heightPx
    )
  }
}

function extendBoundsWithBrowStyle(
  bounds: BodyContentBounds,
  bodyHalfWidthPx: number,
  bodyHalfHeightPx: number,
  bodyProfile: MapCharacterBodyProfile | null,
  facingDirection: number,
  fallbackEyeStyle: MapCharacterBodyEyeStyle
): void {
  const scaleX = getBodyLayerScaleX(bodyHalfWidthPx, bodyProfile)
  const scaleY = getBodyLayerScaleY(bodyHalfHeightPx, bodyProfile)
  const eyeGeometry = getCharacterEyeGeometryFromProfile(
    bodyProfile,
    facingDirection,
    scaleX,
    scaleY,
    fallbackEyeStyle
  )
  const browGeometry = getCharacterBrowGeometryFromProfile(
    bodyProfile,
    eyeGeometry,
    facingDirection,
    scaleX,
    scaleY
  )
  if (!browGeometry) {
    return
  }
  const browBounds = getCharacterBrowBounds(browGeometry)
  const browMinX = browBounds.minX
  const browMaxX = browBounds.maxX
  const browMinY = browBounds.minY
  const browMaxY = browBounds.maxY
  if (browMinX < bounds.minX) bounds.minX = browMinX
  if (browMaxX > bounds.maxX) bounds.maxX = browMaxX
  if (browMinY < bounds.minY) bounds.minY = browMinY
  if (browMaxY > bounds.maxY) bounds.maxY = browMaxY
}

function drawBodyBrow(
  ctx: BodyPathContext,
  bodyHalfWidthPx: number,
  bodyHalfHeightPx: number,
  facingDirection: number,
  bodyProfile: MapCharacterBodyProfile | null,
  fallbackEyeStyle: MapCharacterBodyEyeStyle
): void {
  const scaleX = getBodyLayerScaleX(bodyHalfWidthPx, bodyProfile)
  const scaleY = getBodyLayerScaleY(bodyHalfHeightPx, bodyProfile)
  const eyeGeometry = getCharacterEyeGeometryFromProfile(
    bodyProfile,
    facingDirection,
    scaleX,
    scaleY,
    fallbackEyeStyle
  )
  const browGeometry = getCharacterBrowGeometryFromProfile(
    bodyProfile,
    eyeGeometry,
    facingDirection,
    scaleX,
    scaleY
  )
  if (!browGeometry) {
    return
  }
  drawCharacterBrowGeometry(ctx, browGeometry, '#231711')
}

function extendBoundsWithLayer(
  bounds: BodyContentBounds,
  layer: MapCharacterBodyVisualLayer,
  scaleX: number,
  scaleY: number,
  facingDirection: number
): void {
  const widthPx = Math.max(1, layer.width * scaleX)
  const heightPx = Math.max(1, layer.height * scaleY)
  const facing = facingDirection < 0 ? -1 : 1
  const offsetXPx = layer.offsetX * scaleX * facing
  const offsetYPx = layer.offsetY * scaleY
  const layerMinX = offsetXPx - widthPx * 0.5
  const layerMaxX = offsetXPx + widthPx * 0.5
  const layerMinY = offsetYPx - heightPx * 0.5
  const layerMaxY = offsetYPx + heightPx * 0.5
  if (layerMinX < bounds.minX) bounds.minX = layerMinX
  if (layerMaxX > bounds.maxX) bounds.maxX = layerMaxX
  if (layerMinY < bounds.minY) bounds.minY = layerMinY
  if (layerMaxY > bounds.maxY) bounds.maxY = layerMaxY
}

function areBodyVisualAssetsReady(
  bodyProfile: MapCharacterBodyProfile | null,
  textureImage: CanvasImageSource | null
): boolean {
  if (!bodyProfile) {
    return true
  }
  if (
    getCharacterBodyTextureDataUrl(bodyProfile).length > 0 &&
    !isRenderableTextureSource(textureImage)
  ) {
    return false
  }
  if (!bodyProfile.layers || bodyProfile.layers.length === 0) {
    if (!shouldRenderDynamicSkeletalBody(bodyProfile)) {
      return true
    }
  } else {
    for (let i = 0; i < bodyProfile.layers.length; i++) {
      const layer = bodyProfile.layers[i]
      if (layer.kind !== 'brow' && layer.kind !== 'paint') {
        continue
      }
      const image = getBodyLayerImage(layer.dataUrl)
      if (!isRenderableTextureSource(image)) {
        return false
      }
    }
  }

  if (shouldRenderDynamicSkeletalBody(bodyProfile)) {
    const boneSegments = bodyProfile.boneSegments ?? []
    for (let i = 0; i < boneSegments.length; i++) {
      const dataUrl = boneSegments[i].shapeDataUrl
      if (!dataUrl) {
        continue
      }
      const image = getBodyLayerImage(dataUrl)
      if (!isRenderableTextureSource(image)) {
        return false
      }
    }
  }
  return true
}

export function isBodyVisualAssetsReady(
  bodyProfile: MapCharacterBodyProfile | null,
  textureImage: CanvasImageSource | null
): boolean {
  return areBodyVisualAssetsReady(bodyProfile, textureImage)
}

function getBodyContentBounds(
  radiusPx: number,
  pixelsPerMeter: number,
  facingDirection: number,
  bodyHeightPx: number,
  outlineWidthPx: number,
  bodyProfile: MapCharacterBodyProfile | null,
  textureImage: CanvasImageSource | null,
  showEye: boolean,
  fallbackEyeStyle: MapCharacterBodyEyeStyle
): BodyContentBounds {
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
  const scaleX =
    (bodyHalfWidthPx * 2) / getBodyPointReferenceSize(bodyProfile, 'x')
  const scaleY =
    (bodyHalfHeightPx * 2) / getBodyPointReferenceSize(bodyProfile, 'y')
  const facing = facingDirection < 0 ? -1 : 1
  const bounds: BodyContentBounds = {
    minX: -bodyHalfWidthPx,
    maxX: bodyHalfWidthPx,
    minY: -bodyHalfHeightPx,
    maxY: bodyHalfHeightPx,
  }

  if (bodyProfile && bodyProfile.points.length >= 6) {
    const points = bodyProfile.points
    bounds.minX = points[0] * scaleX * facing
    bounds.maxX = bounds.minX
    bounds.minY = points[1] * scaleY
    bounds.maxY = bounds.minY
    for (let i = 2; i < points.length; i += 2) {
      const x = points[i] * scaleX * facing
      const y = points[i + 1] * scaleY
      if (x < bounds.minX) bounds.minX = x
      if (x > bounds.maxX) bounds.maxX = x
      if (y < bounds.minY) bounds.minY = y
      if (y > bounds.maxY) bounds.maxY = y
    }
  }

  const canRenderTexture = isRenderableTextureSource(textureImage)
  const hasDynamicSkeletalSurface = shouldRenderDynamicSkeletalBody(bodyProfile)
  const hasSkeletalSurface =
    !!bodyProfile?.skeletalMode &&
    !!bodyProfile?.skeletalSurfaceDataUrl &&
    canRenderTexture
  const hasLayeredTexture = !!bodyProfile?.textureDataUrl && canRenderTexture
  const hasLegacySurfaceTexture =
    !hasSkeletalSurface &&
    !hasLayeredTexture &&
    !!bodyProfile?.surfaceDataUrl &&
    canRenderTexture
  if (hasDynamicSkeletalSurface) {
    const halfWidthPx = bodyWidthPx * 0.5
    const halfHeightPx = bodyHeightResolvedPx * 0.5
    if (-halfWidthPx < bounds.minX) bounds.minX = -halfWidthPx
    if (halfWidthPx > bounds.maxX) bounds.maxX = halfWidthPx
    if (-halfHeightPx < bounds.minY) bounds.minY = -halfHeightPx
    if (halfHeightPx > bounds.maxY) bounds.maxY = halfHeightPx
  }
  if (hasSkeletalSurface && bodyProfile) {
    const surfaceWidthPx =
      typeof bodyProfile.skeletalSurfaceWidth === 'number' &&
      bodyProfile.skeletalSurfaceWidth > 0
        ? bodyProfile.skeletalSurfaceWidth * bodyWidthPx
        : bodyWidthPx
    const surfaceHeightPx =
      typeof bodyProfile.skeletalSurfaceHeight === 'number' &&
      bodyProfile.skeletalSurfaceHeight > 0
        ? bodyProfile.skeletalSurfaceHeight * bodyHeightResolvedPx
        : bodyHeightResolvedPx
    const surfaceOffsetXPx =
      typeof bodyProfile.skeletalSurfaceOffsetX === 'number'
        ? bodyProfile.skeletalSurfaceOffsetX * bodyWidthPx * facing
        : 0
    const surfaceOffsetYPx =
      typeof bodyProfile.skeletalSurfaceOffsetY === 'number'
        ? bodyProfile.skeletalSurfaceOffsetY * bodyHeightResolvedPx
        : 0
    const surfaceMinX = surfaceOffsetXPx - surfaceWidthPx * 0.5
    const surfaceMaxX = surfaceOffsetXPx + surfaceWidthPx * 0.5
    const surfaceMinY = surfaceOffsetYPx - surfaceHeightPx * 0.5
    const surfaceMaxY = surfaceOffsetYPx + surfaceHeightPx * 0.5
    if (surfaceMinX < bounds.minX) bounds.minX = surfaceMinX
    if (surfaceMaxX > bounds.maxX) bounds.maxX = surfaceMaxX
    if (surfaceMinY < bounds.minY) bounds.minY = surfaceMinY
    if (surfaceMaxY > bounds.maxY) bounds.maxY = surfaceMaxY
  }
  if (hasLegacySurfaceTexture) {
    const surfaceWidthPx =
      typeof bodyProfile?.surfaceWidth === 'number' &&
      bodyProfile.surfaceWidth > 0
        ? bodyProfile.surfaceWidth * scaleX
        : bodyWidthPx
    const surfaceHeightPx =
      typeof bodyProfile?.surfaceHeight === 'number' &&
      bodyProfile.surfaceHeight > 0
        ? bodyProfile.surfaceHeight * scaleY
        : bodyHeightResolvedPx
    const surfaceOffsetXPx =
      typeof bodyProfile?.surfaceOffsetX === 'number'
        ? bodyProfile.surfaceOffsetX * scaleX * facing
        : 0
    const surfaceOffsetYPx =
      typeof bodyProfile?.surfaceOffsetY === 'number'
        ? bodyProfile.surfaceOffsetY * scaleY
        : 0
    const surfaceMinX = surfaceOffsetXPx - surfaceWidthPx * 0.5
    const surfaceMaxX = surfaceOffsetXPx + surfaceWidthPx * 0.5
    const surfaceMinY = surfaceOffsetYPx - surfaceHeightPx * 0.5
    const surfaceMaxY = surfaceOffsetYPx + surfaceHeightPx * 0.5
    if (surfaceMinX < bounds.minX) bounds.minX = surfaceMinX
    if (surfaceMaxX > bounds.maxX) bounds.maxX = surfaceMaxX
    if (surfaceMinY < bounds.minY) bounds.minY = surfaceMinY
    if (surfaceMaxY > bounds.maxY) bounds.maxY = surfaceMaxY
  }

  if (bodyProfile?.layers && bodyProfile.layers.length > 0) {
    for (let i = 0; i < bodyProfile.layers.length; i++) {
      const layer = bodyProfile.layers[i]
      if (layer.kind !== 'brow' && layer.kind !== 'paint') {
        continue
      }
      extendBoundsWithLayer(bounds, layer, scaleX, scaleY, facingDirection)
    }
  }

  extendBoundsWithBrowStyle(
    bounds,
    bodyHalfWidthPx,
    bodyHalfHeightPx,
    bodyProfile,
    facingDirection,
    fallbackEyeStyle
  )

  if (shouldRenderProceduralEye(bodyProfile, showEye)) {
    const eyeGeometry = getCharacterEyeGeometryFromProfile(
      bodyProfile,
      facingDirection,
      scaleX,
      scaleY,
      fallbackEyeStyle
    )
    const eyeBounds = getCharacterEyeBounds(eyeGeometry)
    const eyeMinX = eyeBounds.minX
    const eyeMaxX = eyeBounds.maxX
    const eyeMinY = eyeBounds.minY
    const eyeMaxY = eyeBounds.maxY
    if (eyeMinX < bounds.minX) bounds.minX = eyeMinX
    if (eyeMaxX > bounds.maxX) bounds.maxX = eyeMaxX
    if (eyeMinY < bounds.minY) bounds.minY = eyeMinY
    if (eyeMaxY > bounds.maxY) bounds.maxY = eyeMaxY
  }

  const outerPadding = Math.max(
    BODY_EYE_PADDING,
    ((outlineWidthPx + 1) >> 1) + 3,
    4
  )
  return {
    minX: Math.floor(bounds.minX) - outerPadding,
    minY: Math.floor(bounds.minY) - outerPadding,
    maxX: Math.ceil(bounds.maxX) + outerPadding,
    maxY: Math.ceil(bounds.maxY) + outerPadding,
  }
}

function drawBodyInternal(
  ctx: BodyPathContext,
  radiusPx: number,
  bodyColor: string,
  pixelsPerMeter: number,
  facingDirection: number,
  bodyHeightPx: number,
  outlineColor: string,
  outlineWidthPx: number,
  bodyProfile: MapCharacterBodyProfile | null,
  textureImage: CanvasImageSource | null,
  showEye: boolean,
  eyeColor: string,
  fallbackEyeStyle: MapCharacterBodyEyeStyle
): void {
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
  const canRenderTexture = isRenderableTextureSource(textureImage)
  const hasDynamicSkeletalSurface = shouldRenderDynamicSkeletalBody(bodyProfile)
  const hasSkeletalSurface =
    !!bodyProfile?.skeletalMode &&
    !!bodyProfile?.skeletalSurfaceDataUrl &&
    canRenderTexture
  const hasLayeredTexture =
    !hasSkeletalSurface && !!bodyProfile?.textureDataUrl && canRenderTexture
  const hasLegacySurfaceTexture =
    !hasSkeletalSurface &&
    !hasLayeredTexture &&
    !!bodyProfile?.surfaceDataUrl &&
    canRenderTexture
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
  const featureFacingDirection =
    mirrorBody && facingDirection < 0 ? 1 : facingDirection

  ctx.save()
  if (mirrorBody && facingDirection < 0) {
    ctx.scale(-1, 1)
  }

  if (
    hasDynamicSkeletalSurface &&
    bodyProfile &&
    drawDynamicSkeletalBody(
      ctx,
      bodyProfile,
      bodyColor,
      bodyWidthPx,
      bodyHeightResolvedPx
    )
  ) {
    ctx.restore()
    return
  }

  // Skeletal mode: render bone shape composite, skip static body shape
  if (hasSkeletalSurface && bodyProfile) {
    const skW = bodyProfile.skeletalSurfaceWidth
      ? bodyProfile.skeletalSurfaceWidth * bodyWidthPx
      : bodyWidthPx
    const skH = bodyProfile.skeletalSurfaceHeight
      ? bodyProfile.skeletalSurfaceHeight * bodyHeightResolvedPx
      : bodyHeightResolvedPx
    const skOX = bodyProfile.skeletalSurfaceOffsetX
      ? bodyProfile.skeletalSurfaceOffsetX * bodyWidthPx
      : 0
    const skOY = bodyProfile.skeletalSurfaceOffsetY
      ? bodyProfile.skeletalSurfaceOffsetY * bodyHeightResolvedPx
      : 0
    ctx.drawImage(textureImage, skOX - skW * 0.5, skOY - skH * 0.5, skW, skH)
    ctx.restore()
    return
  }

  if (!hasLegacySurfaceTexture) {
    ctx.fillStyle = bodyColor
    traceBodyPath(ctx, bodyHalfWidthPx, bodyHalfHeightPx, bodyProfile)
    ctx.fill()
  }

  if (canRenderTexture) {
    if (hasLegacySurfaceTexture) {
      ctx.drawImage(
        textureImage,
        surfaceOffsetXPx - surfaceWidthPx * 0.5,
        surfaceOffsetYPx - surfaceHeightPx * 0.5,
        surfaceWidthPx,
        surfaceHeightPx
      )
    } else if (hasLayeredTexture) {
      ctx.drawImage(
        textureImage,
        -bodyHalfWidthPx,
        -bodyHalfHeightPx,
        bodyWidthPx,
        bodyHeightResolvedPx
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

  drawBodyVisualLayers(
    ctx,
    bodyHalfWidthPx,
    bodyHalfHeightPx,
    bodyProfile,
    facingDirection,
    mirrorBody
  )
  drawBodyBrow(
    ctx,
    bodyHalfWidthPx,
    bodyHalfHeightPx,
    featureFacingDirection,
    bodyProfile,
    fallbackEyeStyle
  )

  if (!hasLegacySurfaceTexture) {
    ctx.strokeStyle = bodyColor
    ctx.lineWidth = 3
    traceBodyPath(ctx, bodyHalfWidthPx, bodyHalfHeightPx, bodyProfile)
    ctx.stroke()
  }

  if (shouldRenderProceduralEye(bodyProfile, showEye)) {
    renderBodyEye(
      ctx as RenderContext2D,
      bodyHalfWidthPx,
      bodyHalfHeightPx,
      pixelsPerMeter,
      featureFacingDirection,
      bodyProfile,
      eyeColor,
      fallbackEyeStyle
    )
  }

  ctx.restore()

  if (outlineWidthPx > 0 && outlineColor.length > 0) {
    ctx.strokeStyle = outlineColor
    ctx.lineWidth = outlineWidthPx
    traceBodyPath(ctx, bodyHalfWidthPx, bodyHalfHeightPx, bodyProfile)
    ctx.stroke()
  }
}

function getCachedBodySprite(
  radiusPx: number,
  bodyColor: string,
  pixelsPerMeter: number,
  facingDirection: number,
  bodyHeightPx: number,
  outlineColor: string,
  outlineWidthPx: number,
  bodyProfile: MapCharacterBodyProfile | null,
  textureImage: CanvasImageSource | null,
  showEye: boolean,
  eyeColor: string,
  fallbackEyeStyle: MapCharacterBodyEyeStyle,
  bodyProfileCacheKey: string,
  textureSourceKey: string
): CachedBodySprite | null {
  const cacheKey = buildBodyCacheKey(
    radiusPx,
    bodyColor,
    pixelsPerMeter,
    facingDirection,
    bodyHeightPx,
    outlineColor,
    outlineWidthPx,
    bodyProfileCacheKey,
    textureSourceKey,
    showEye,
    eyeColor,
    fallbackEyeStyle
  )
  const cached = bodySpriteCache.get(cacheKey)
  if (cached) {
    return touchBodySpriteCacheEntry(cacheKey, cached)
  }

  const bounds = getBodyContentBounds(
    radiusPx,
    pixelsPerMeter,
    facingDirection,
    bodyHeightPx,
    outlineWidthPx,
    bodyProfile,
    textureImage,
    showEye,
    fallbackEyeStyle
  )
  const drawX = bounds.minX | 0
  const drawY = bounds.minY | 0
  const drawWidth = Math.max(1, (bounds.maxX - bounds.minX) | 0)
  const drawHeight = Math.max(1, (bounds.maxY - bounds.minY) | 0)
  const created = createBodyRenderCanvas(drawWidth, drawHeight)
  if (!created) {
    return null
  }

  created.ctx.translate(-drawX, -drawY)
  drawBodyInternal(
    created.ctx,
    radiusPx,
    bodyColor,
    pixelsPerMeter,
    facingDirection,
    bodyHeightPx,
    outlineColor,
    outlineWidthPx,
    bodyProfile,
    textureImage,
    showEye,
    eyeColor,
    fallbackEyeStyle
  )

  const bodySprite = {
    canvas: created.canvas,
    drawX,
    drawY,
    drawWidth,
    drawHeight,
  }
  bodySpriteCache.set(cacheKey, bodySprite)
  pruneBodySpriteCache()
  return bodySprite
}

export function getBodySpriteSource(
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
  eyeColor = '#000000',
  bodyProfileCacheKey = '',
  textureSourceKey = '',
  fallbackEyeStyle: MapCharacterBodyEyeStyle = 'standard'
): BodySpriteSource | null {
  if (!Number.isFinite(radiusPx) || radiusPx <= 0) {
    return null
  }

  return getCachedBodySprite(
    radiusPx,
    bodyColor,
    pixelsPerMeter,
    facingDirection,
    bodyHeightPx,
    outlineColor,
    outlineWidthPx,
    bodyProfile,
    textureImage,
    showEye,
    eyeColor,
    fallbackEyeStyle,
    bodyProfileCacheKey,
    textureSourceKey
  )
}

export function renderBody(
  ctx: RenderContext2D,
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
  eyeColor = '#000000',
  fallbackEyeStyle: MapCharacterBodyEyeStyle = 'standard'
): void {
  if (!Number.isFinite(radiusPx) || radiusPx <= 0) {
    return
  }
  drawBodyInternal(
    ctx,
    radiusPx,
    bodyColor,
    pixelsPerMeter,
    facingDirection,
    bodyHeightPx,
    outlineColor,
    outlineWidthPx,
    bodyProfile,
    textureImage,
    showEye,
    eyeColor,
    fallbackEyeStyle
  )
}

export function renderBodyCached(
  ctx: RenderContext2D,
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
  eyeColor = '#000000',
  bodyProfileCacheKey = '',
  textureSourceKey = '',
  fallbackEyeStyle: MapCharacterBodyEyeStyle = 'standard'
): void {
  if (!Number.isFinite(radiusPx) || radiusPx <= 0) {
    return
  }

  if (!areBodyVisualAssetsReady(bodyProfile, textureImage)) {
    renderBody(
      ctx,
      radiusPx,
      bodyColor,
      pixelsPerMeter,
      facingDirection,
      bodyHeightPx,
      outlineColor,
      outlineWidthPx,
      bodyProfile,
      textureImage,
      showEye,
      eyeColor,
      fallbackEyeStyle
    )
    return
  }

  const bodySprite = getCachedBodySprite(
    radiusPx,
    bodyColor,
    pixelsPerMeter,
    facingDirection,
    bodyHeightPx,
    outlineColor,
    outlineWidthPx,
    bodyProfile,
    textureImage,
    showEye,
    eyeColor,
    fallbackEyeStyle,
    bodyProfileCacheKey,
    textureSourceKey
  )
  if (!bodySprite) {
    renderBody(
      ctx,
      radiusPx,
      bodyColor,
      pixelsPerMeter,
      facingDirection,
      bodyHeightPx,
      outlineColor,
      outlineWidthPx,
      bodyProfile,
      textureImage,
      showEye,
      eyeColor,
      fallbackEyeStyle
    )
    return
  }

  ctx.drawImage(
    bodySprite.canvas,
    bodySprite.drawX,
    bodySprite.drawY,
    bodySprite.drawWidth,
    bodySprite.drawHeight
  )
}

export function renderBodyEye(
  ctx: RenderContext2D,
  radiusPx: number,
  radiusYPx: number,
  _pixelsPerMeter: number,
  facingDirection: number,
  bodyProfile: MapCharacterBodyProfile | null = null,
  pupilColor = '#14110d',
  fallbackEyeStyle: MapCharacterBodyEyeStyle = 'standard'
): void {
  const scaleX = (radiusPx * 2) / getBodyPointReferenceSize(bodyProfile, 'x')
  const scaleY = (radiusYPx * 2) / getBodyPointReferenceSize(bodyProfile, 'y')
  drawCharacterEyeGeometry(
    ctx,
    getCharacterEyeGeometryFromProfile(
      bodyProfile,
      facingDirection,
      scaleX,
      scaleY,
      fallbackEyeStyle
    ),
    pupilColor
  )
}

function traceBodyPath(
  ctx: BodyPathContext,
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
