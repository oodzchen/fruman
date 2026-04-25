import type {
  BoneSegment,
  EditorMapData,
  MapCharacterBodyCollisionShape,
  MapCharacterBodyProfile,
} from './editorMapTypes'

interface SkeletalBounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
  width: number
  height: number
}

export interface SkeletalBodyGeometry {
  centerX: number
  centerY: number
  bounds: SkeletalBounds
  points: number[]
  collisionShapes: MapCharacterBodyCollisionShape[] | undefined
}

export interface SkeletalSurfaceSnapshot {
  dataUrl: string
  offsetX: number
  offsetY: number
  width: number
  height: number
}

export interface SkeletalBoneLocalTransform {
  pivotX: number
  pivotY: number
  cos: number
  sin: number
}

const DEFAULT_SKELETAL_BONE_WIDTH = 0.06
const SKELETAL_REFERENCE_SIZE = 128
const SKELETAL_SURFACE_PADDING = 2
const skeletalShapeImageCache = new Map<string, HTMLImageElement>()

const DEFAULT_SKELETAL_BONE_POSITIONS: Record<
  BoneSegment['part'],
  { pivotX: number; pivotY: number; tipX: number; tipY: number }
> = {
  body: { pivotX: 480, pivotY: 474, tipX: 480, tipY: 376 },
  head: { pivotX: 480, pivotY: 376, tipX: 480, tipY: 340 },
  upperArmR: { pivotX: 508, pivotY: 384, tipX: 548, tipY: 422 },
  forearmR: { pivotX: 548, pivotY: 422, tipX: 578, tipY: 456 },
  handR: { pivotX: 578, pivotY: 456, tipX: 592, tipY: 472 },
  upperArmL: { pivotX: 452, pivotY: 384, tipX: 412, tipY: 422 },
  forearmL: { pivotX: 412, pivotY: 422, tipX: 382, tipY: 456 },
  handL: { pivotX: 382, pivotY: 456, tipX: 368, tipY: 472 },
  thighR: { pivotX: 495, pivotY: 468, tipX: 495, tipY: 542 },
  lowerLegR: { pivotX: 495, pivotY: 542, tipX: 495, tipY: 600 },
  footR: { pivotX: 495, pivotY: 600, tipX: 518, tipY: 614 },
  thighL: { pivotX: 465, pivotY: 468, tipX: 465, tipY: 542 },
  lowerLegL: { pivotX: 465, pivotY: 542, tipX: 465, tipY: 600 },
  footL: { pivotX: 465, pivotY: 600, tipX: 442, tipY: 614 },
}

const DEFAULT_SKELETAL_BONE_PARTS: readonly BoneSegment['part'][] = [
  'body',
  'head',
  'upperArmR',
  'forearmR',
  'handR',
  'upperArmL',
  'forearmL',
  'handL',
  'thighR',
  'lowerLegR',
  'footR',
  'thighL',
  'lowerLegL',
  'footL',
]

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isPositiveNumber(value: unknown): value is number {
  return isFiniteNumber(value) && value > 0
}

export function resolveSkeletalBoneLocalTransform(
  segment: BoneSegment,
  out: SkeletalBoneLocalTransform
): boolean {
  if (
    !isFiniteNumber(segment.pivotX) ||
    !isFiniteNumber(segment.pivotY) ||
    !isFiniteNumber(segment.tipX) ||
    !isFiniteNumber(segment.tipY)
  ) {
    return false
  }
  const angleRad = Math.atan2(
    segment.tipY - segment.pivotY,
    segment.tipX - segment.pivotX
  )
  out.pivotX = segment.pivotX
  out.pivotY = segment.pivotY
  out.cos = Math.cos(angleRad)
  out.sin = Math.sin(angleRad)
  return true
}

export function writeSkeletalBoneLocalPoint(
  transform: SkeletalBoneLocalTransform,
  pointX: number,
  pointY: number,
  target: number[] | Float32Array,
  offset: number
): void {
  const dx = pointX - transform.pivotX
  const dy = pointY - transform.pivotY
  target[offset] = dx * transform.cos + dy * transform.sin
  target[offset + 1] = -dx * transform.sin + dy * transform.cos
}

export function createDefaultSkeletalBoneSegments(): BoneSegment[] {
  const segments = new Array<BoneSegment>(DEFAULT_SKELETAL_BONE_PARTS.length)
  for (let i = 0; i < DEFAULT_SKELETAL_BONE_PARTS.length; i++) {
    const part = DEFAULT_SKELETAL_BONE_PARTS[i]
    const position = DEFAULT_SKELETAL_BONE_POSITIONS[part]
    const dx = position.tipX - position.pivotX
    const dy = position.tipY - position.pivotY
    const length =
      Math.round(
        (Math.sqrt(dx * dx + dy * dy) / SKELETAL_REFERENCE_SIZE) * 100
      ) / 100
    segments[i] = {
      part,
      length: Math.max(0.01, length),
      width: DEFAULT_SKELETAL_BONE_WIDTH,
      pivotX: position.pivotX,
      pivotY: position.pivotY,
      tipX: position.tipX,
      tipY: position.tipY,
    }
  }
  return segments
}

function createBounds(
  minX: number,
  minY: number,
  maxX: number,
  maxY: number
): SkeletalBounds {
  return {
    minX,
    minY,
    maxX,
    maxY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  }
}

function expandBounds(
  bounds: SkeletalBounds | null,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number
): SkeletalBounds {
  if (!bounds) {
    return createBounds(minX, minY, maxX, maxY)
  }
  if (minX < bounds.minX) bounds.minX = minX
  if (minY < bounds.minY) bounds.minY = minY
  if (maxX > bounds.maxX) bounds.maxX = maxX
  if (maxY > bounds.maxY) bounds.maxY = maxY
  bounds.width = Math.max(1, bounds.maxX - bounds.minX)
  bounds.height = Math.max(1, bounds.maxY - bounds.minY)
  return bounds
}

function getCollisionShapeBounds(
  shape: MapCharacterBodyCollisionShape
): SkeletalBounds | null {
  if (shape.kind === 'circle') {
    return createBounds(
      shape.center.x - shape.radius,
      shape.center.y - shape.radius,
      shape.center.x + shape.radius,
      shape.center.y + shape.radius
    )
  }
  if (shape.kind === 'ellipse') {
    const rotationRad = ((shape.rotationDeg ?? 0) * Math.PI) / 180
    const cos = Math.cos(rotationRad)
    const sin = Math.sin(rotationRad)
    const extentX = Math.sqrt(
      shape.radiusX * shape.radiusX * cos * cos +
        shape.radiusY * shape.radiusY * sin * sin
    )
    const extentY = Math.sqrt(
      shape.radiusX * shape.radiusX * sin * sin +
        shape.radiusY * shape.radiusY * cos * cos
    )
    return createBounds(
      shape.center.x - extentX,
      shape.center.y - extentY,
      shape.center.x + extentX,
      shape.center.y + extentY
    )
  }
  const rotationRad = ((shape.rotationDeg ?? 0) * Math.PI) / 180
  const cos = Math.cos(rotationRad)
  const sin = Math.sin(rotationRad)
  const extentX =
    Math.abs(shape.halfWidth * cos) + Math.abs(shape.halfHeight * sin)
  const extentY =
    Math.abs(shape.halfWidth * sin) + Math.abs(shape.halfHeight * cos)
  return createBounds(
    shape.center.x - extentX,
    shape.center.y - extentY,
    shape.center.x + extentX,
    shape.center.y + extentY
  )
}

function getDefaultBoneBoundaryHalfWidth(
  segment: BoneSegment,
  referenceSize: number
): number {
  const baseWidthPx =
    (isPositiveNumber(segment.width)
      ? segment.width
      : DEFAULT_SKELETAL_BONE_WIDTH) * referenceSize
  const baseHalfWidth = Math.max(1, baseWidthPx * 0.5)
  if (segment.part === 'body') {
    return baseHalfWidth * 3
  }
  if (segment.part === 'head') {
    return baseHalfWidth
  }
  return baseHalfWidth * 2
}

export function buildDefaultSkeletalBoneBoundary(
  segment: BoneSegment
): MapCharacterBodyCollisionShape | null {
  if (
    !isFiniteNumber(segment.pivotX) ||
    !isFiniteNumber(segment.pivotY) ||
    !isFiniteNumber(segment.tipX) ||
    !isFiniteNumber(segment.tipY)
  ) {
    return null
  }
  const dx = segment.tipX - segment.pivotX
  const dy = segment.tipY - segment.pivotY
  const centerX = (segment.pivotX + segment.tipX) * 0.5
  const centerY = (segment.pivotY + segment.tipY) * 0.5
  const halfHeight = Math.max(1, Math.sqrt(dx * dx + dy * dy) * 0.5)
  const halfWidth = getDefaultBoneBoundaryHalfWidth(
    segment,
    SKELETAL_REFERENCE_SIZE
  )
  if (segment.part === 'head') {
    const radius = Math.max(halfWidth, halfHeight)
    return {
      kind: 'circle',
      center: {
        x: centerX,
        y: centerY,
      },
      radius,
    }
  }
  const rotationDeg =
    dx === 0 && dy === 0 ? 0 : (Math.atan2(-dx, dy) * 180) / Math.PI
  return {
    kind: 'capsule',
    center: {
      x: centerX,
      y: centerY,
    },
    halfWidth,
    halfHeight,
    rotationDeg,
  }
}

function cloneAbsoluteCollisionShape(
  shape: MapCharacterBodyCollisionShape
): MapCharacterBodyCollisionShape {
  if (shape.kind === 'circle') {
    return {
      kind: 'circle',
      center: {
        x: shape.center.x,
        y: shape.center.y,
      },
      radius: shape.radius,
    }
  }
  if (shape.kind === 'ellipse') {
    return {
      kind: 'ellipse',
      center: {
        x: shape.center.x,
        y: shape.center.y,
      },
      radiusX: shape.radiusX,
      radiusY: shape.radiusY,
      rotationDeg: shape.rotationDeg,
    }
  }
  return {
    kind: 'capsule',
    center: {
      x: shape.center.x,
      y: shape.center.y,
    },
    halfWidth: shape.halfWidth,
    halfHeight: shape.halfHeight,
    rotationDeg: shape.rotationDeg,
  }
}

function buildAbsoluteCollisionShapes(
  boneSegments: readonly BoneSegment[]
): MapCharacterBodyCollisionShape[] {
  const shapes: MapCharacterBodyCollisionShape[] = []
  for (let i = 0; i < boneSegments.length; i++) {
    const segment = boneSegments[i]
    const boundaryShapes = segment.boundaryShapes
    if (boundaryShapes && boundaryShapes.length > 0) {
      for (let j = 0; j < boundaryShapes.length; j++) {
        shapes.push(cloneAbsoluteCollisionShape(boundaryShapes[j]))
      }
      continue
    }
    const fallbackShape = buildDefaultSkeletalBoneBoundary(segment)
    if (fallbackShape) {
      shapes.push(fallbackShape)
    }
  }
  return shapes
}

function buildReferenceBounds(
  boneSegments: readonly BoneSegment[],
  collisionShapes: readonly MapCharacterBodyCollisionShape[]
): SkeletalBounds | null {
  let bounds: SkeletalBounds | null = null
  for (let i = 0; i < boneSegments.length; i++) {
    const segment = boneSegments[i]
    if (
      isFiniteNumber(segment.shapeOffsetX) &&
      isFiniteNumber(segment.shapeOffsetY) &&
      isPositiveNumber(segment.shapeWidth) &&
      isPositiveNumber(segment.shapeHeight)
    ) {
      bounds = expandBounds(
        bounds,
        segment.shapeOffsetX,
        segment.shapeOffsetY,
        segment.shapeOffsetX + segment.shapeWidth,
        segment.shapeOffsetY + segment.shapeHeight
      )
    }
  }
  for (let i = 0; i < collisionShapes.length; i++) {
    const shapeBounds = getCollisionShapeBounds(collisionShapes[i])
    if (!shapeBounds) {
      continue
    }
    bounds = expandBounds(
      bounds,
      shapeBounds.minX,
      shapeBounds.minY,
      shapeBounds.maxX,
      shapeBounds.maxY
    )
  }
  if (bounds) {
    return bounds
  }
  for (let i = 0; i < boneSegments.length; i++) {
    const segment = boneSegments[i]
    if (
      !isFiniteNumber(segment.pivotX) ||
      !isFiniteNumber(segment.pivotY) ||
      !isFiniteNumber(segment.tipX) ||
      !isFiniteNumber(segment.tipY)
    ) {
      continue
    }
    bounds = expandBounds(
      bounds,
      Math.min(segment.pivotX, segment.tipX),
      Math.min(segment.pivotY, segment.tipY),
      Math.max(segment.pivotX, segment.tipX),
      Math.max(segment.pivotY, segment.tipY)
    )
  }
  return bounds
}

function buildRelativeCollisionShape(
  shape: MapCharacterBodyCollisionShape,
  centerX: number,
  centerY: number
): MapCharacterBodyCollisionShape {
  if (shape.kind === 'circle') {
    return {
      kind: 'circle',
      center: {
        x: shape.center.x - centerX,
        y: shape.center.y - centerY,
      },
      radius: shape.radius,
    }
  }
  if (shape.kind === 'ellipse') {
    return {
      kind: 'ellipse',
      center: {
        x: shape.center.x - centerX,
        y: shape.center.y - centerY,
      },
      radiusX: shape.radiusX,
      radiusY: shape.radiusY,
      rotationDeg: shape.rotationDeg,
    }
  }
  return {
    kind: 'capsule',
    center: {
      x: shape.center.x - centerX,
      y: shape.center.y - centerY,
    },
    halfWidth: shape.halfWidth,
    halfHeight: shape.halfHeight,
    rotationDeg: shape.rotationDeg,
  }
}

function roundProfileValue(value: number): number {
  return Math.round(value * 1000) / 1000
}

function getSkeletalShapeImage(
  dataUrl: string
): Promise<HTMLImageElement | null> {
  if (!dataUrl) {
    return Promise.resolve(null)
  }
  const cached = skeletalShapeImageCache.get(dataUrl)
  if (cached) {
    if (
      cached.complete &&
      cached.naturalWidth > 0 &&
      cached.naturalHeight > 0
    ) {
      return Promise.resolve(cached)
    }
    return new Promise((resolve) => {
      const handleLoad = () => resolve(cached)
      const handleError = () => resolve(null)
      cached.addEventListener('load', handleLoad, { once: true })
      cached.addEventListener('error', handleError, { once: true })
    })
  }
  const image = new Image()
  skeletalShapeImageCache.set(dataUrl, image)
  return new Promise((resolve) => {
    image.onload = () => resolve(image)
    image.onerror = () => resolve(null)
    image.src = dataUrl
  })
}

function traceSkeletalCapsulePath(
  ctx: CanvasRenderingContext2D,
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

function traceSkeletalCollisionShapePath(
  ctx: CanvasRenderingContext2D,
  shape: MapCharacterBodyCollisionShape,
  originX: number,
  originY: number
): void {
  if (shape.kind === 'circle') {
    ctx.beginPath()
    ctx.arc(
      shape.center.x - originX,
      shape.center.y - originY,
      shape.radius,
      0,
      Math.PI * 2
    )
    return
  }
  if (shape.kind === 'ellipse') {
    ctx.beginPath()
    ctx.ellipse(
      shape.center.x - originX,
      shape.center.y - originY,
      shape.radiusX,
      shape.radiusY,
      ((shape.rotationDeg ?? 0) * Math.PI) / 180,
      0,
      Math.PI * 2
    )
    return
  }
  traceSkeletalCapsulePath(
    ctx,
    shape.center.x - originX,
    shape.center.y - originY,
    shape.halfWidth,
    shape.halfHeight,
    shape.rotationDeg ?? 0
  )
}

function readCanvasAlphaBounds(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number
): SkeletalBounds | null {
  const alpha = ctx.getImageData(0, 0, width, height).data
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < height; y++) {
    const rowOffset = y * width * 4
    for (let x = 0; x < width; x++) {
      if (alpha[rowOffset + x * 4 + 3] === 0) {
        continue
      }
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y
    }
  }
  if (maxX < minX || maxY < minY) {
    return null
  }
  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX + 1 - minX,
    height: maxY + 1 - minY,
  }
}

export async function buildSkeletalSurfaceSnapshot(
  boneSegments: readonly BoneSegment[] | undefined,
  fillColor: string
): Promise<SkeletalSurfaceSnapshot | null> {
  if (
    typeof document === 'undefined' ||
    !boneSegments ||
    boneSegments.length === 0
  ) {
    return null
  }
  const geometry = deriveSkeletalBodyGeometry(boneSegments)
  if (!geometry) {
    return null
  }
  const drawMinX = Math.floor(geometry.bounds.minX) - SKELETAL_SURFACE_PADDING
  const drawMinY = Math.floor(geometry.bounds.minY) - SKELETAL_SURFACE_PADDING
  const drawMaxX = Math.ceil(geometry.bounds.maxX) + SKELETAL_SURFACE_PADDING
  const drawMaxY = Math.ceil(geometry.bounds.maxY) + SKELETAL_SURFACE_PADDING
  const canvasWidth = Math.max(1, drawMaxX - drawMinX)
  const canvasHeight = Math.max(1, drawMaxY - drawMinY)
  const canvas = document.createElement('canvas')
  canvas.width = canvasWidth
  canvas.height = canvasHeight
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    return null
  }
  for (let i = 0; i < boneSegments.length; i++) {
    const segment = boneSegments[i]
    let imageDrawn = false
    if (
      segment.shapeDataUrl &&
      isFiniteNumber(segment.shapeOffsetX) &&
      isFiniteNumber(segment.shapeOffsetY) &&
      isPositiveNumber(segment.shapeWidth) &&
      isPositiveNumber(segment.shapeHeight)
    ) {
      const image = await getSkeletalShapeImage(segment.shapeDataUrl)
      if (image && image.naturalWidth > 0 && image.naturalHeight > 0) {
        ctx.drawImage(
          image,
          segment.shapeOffsetX - drawMinX,
          segment.shapeOffsetY - drawMinY,
          segment.shapeWidth,
          segment.shapeHeight
        )
        imageDrawn = true
      }
    }
    if (imageDrawn) {
      continue
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
    ctx.save()
    ctx.fillStyle = fillColor
    for (let j = 0; j < sourceShapes.length; j++) {
      traceSkeletalCollisionShapePath(ctx, sourceShapes[j], drawMinX, drawMinY)
      ctx.fill()
    }
    ctx.restore()
  }
  const alphaBounds = readCanvasAlphaBounds(ctx, canvasWidth, canvasHeight)
  if (!alphaBounds) {
    return null
  }
  const cropCanvas = document.createElement('canvas')
  cropCanvas.width = alphaBounds.width
  cropCanvas.height = alphaBounds.height
  const cropCtx = cropCanvas.getContext('2d')
  if (!cropCtx) {
    return null
  }
  cropCtx.drawImage(
    canvas,
    alphaBounds.minX,
    alphaBounds.minY,
    alphaBounds.width,
    alphaBounds.height,
    0,
    0,
    alphaBounds.width,
    alphaBounds.height
  )
  const centerX =
    drawMinX +
    alphaBounds.minX +
    (alphaBounds.maxX + 1 - alphaBounds.minX) * 0.5
  const centerY =
    drawMinY +
    alphaBounds.minY +
    (alphaBounds.maxY + 1 - alphaBounds.minY) * 0.5
  const referenceWidth = Math.max(1, geometry.bounds.width)
  const referenceHeight = Math.max(1, geometry.bounds.height)
  return {
    dataUrl: cropCanvas.toDataURL(),
    offsetX: roundProfileValue((centerX - geometry.centerX) / referenceWidth),
    offsetY: roundProfileValue((centerY - geometry.centerY) / referenceHeight),
    width: roundProfileValue(alphaBounds.width / referenceWidth),
    height: roundProfileValue(alphaBounds.height / referenceHeight),
  }
}

export function getCharacterBodyTextureDataUrl(
  profile: MapCharacterBodyProfile | null | undefined
): string {
  if (profile?.skeletalMode && profile.skeletalSurfaceDataUrl) {
    return profile.skeletalSurfaceDataUrl
  }
  return profile?.textureDataUrl ?? profile?.surfaceDataUrl ?? ''
}

export function deriveSkeletalBodyGeometry(
  boneSegments: readonly BoneSegment[] | undefined
): SkeletalBodyGeometry | null {
  if (!boneSegments || boneSegments.length === 0) {
    return null
  }
  const collisionShapes = buildAbsoluteCollisionShapes(boneSegments)
  const bounds = buildReferenceBounds(boneSegments, collisionShapes)
  if (!bounds) {
    return null
  }
  const centerX = Math.round((bounds.minX + bounds.maxX) * 0.5)
  const centerY = Math.round((bounds.minY + bounds.maxY) * 0.5)
  const points = [
    roundProfileValue(bounds.minX - centerX),
    roundProfileValue(bounds.minY - centerY),
    roundProfileValue(bounds.maxX - centerX),
    roundProfileValue(bounds.minY - centerY),
    roundProfileValue(bounds.maxX - centerX),
    roundProfileValue(bounds.maxY - centerY),
    roundProfileValue(bounds.minX - centerX),
    roundProfileValue(bounds.maxY - centerY),
  ]
  const relativeCollisionShapes =
    collisionShapes.length > 0
      ? collisionShapes.map((shape) =>
          buildRelativeCollisionShape(shape, centerX, centerY)
        )
      : undefined
  return {
    centerX,
    centerY,
    bounds,
    points,
    collisionShapes: relativeCollisionShapes,
  }
}

export function normalizeSkeletalBodyProfile(
  profile: MapCharacterBodyProfile | undefined
): MapCharacterBodyProfile | undefined {
  if (!profile?.skeletalMode || !profile.boneSegments?.length) {
    return profile
  }
  const geometry = deriveSkeletalBodyGeometry(profile.boneSegments)
  if (!geometry) {
    return profile
  }
  const nextWidth = isPositiveNumber(profile.width)
    ? profile.width
    : profile.points.length >= 6
      ? undefined
      : roundProfileValue(geometry.bounds.width / SKELETAL_REFERENCE_SIZE)
  const nextHeight = isPositiveNumber(profile.height)
    ? profile.height
    : profile.points.length >= 6
      ? undefined
      : roundProfileValue(geometry.bounds.height / SKELETAL_REFERENCE_SIZE)
  return {
    ...profile,
    width: nextWidth ?? profile.width,
    height: nextHeight ?? profile.height,
    skeletalSurfaceOffsetX:
      typeof profile.skeletalSurfaceOffsetX === 'number'
        ? profile.skeletalSurfaceOffsetX
        : profile.skeletalSurfaceDataUrl
          ? 0
          : undefined,
    skeletalSurfaceOffsetY:
      typeof profile.skeletalSurfaceOffsetY === 'number'
        ? profile.skeletalSurfaceOffsetY
        : profile.skeletalSurfaceDataUrl
          ? 0
          : undefined,
    skeletalSurfaceWidth:
      typeof profile.skeletalSurfaceWidth === 'number'
        ? profile.skeletalSurfaceWidth
        : profile.skeletalSurfaceDataUrl
          ? 1
          : undefined,
    skeletalSurfaceHeight:
      typeof profile.skeletalSurfaceHeight === 'number'
        ? profile.skeletalSurfaceHeight
        : profile.skeletalSurfaceDataUrl
          ? 1
          : undefined,
  }
}

export function normalizeCharacterBodyMapProfiles(
  map: EditorMapData | null
): EditorMapData | null {
  if (!map) {
    return null
  }
  const nextPlayer = map.player
    ? {
        ...map.player,
        bodyProfile: normalizeSkeletalBodyProfile(map.player.bodyProfile),
      }
    : undefined
  const nextNpcs =
    map.npcs.length > 0
      ? map.npcs.map((npc) => ({
          ...npc,
          bodyProfile: normalizeSkeletalBodyProfile(npc.bodyProfile),
        }))
      : map.npcs
  const nextTemplates =
    map.npcTemplates && map.npcTemplates.length > 0
      ? map.npcTemplates.map((template) => ({
          ...template,
          bodyProfile: normalizeSkeletalBodyProfile(template.bodyProfile),
        }))
      : map.npcTemplates
  return {
    ...map,
    player: nextPlayer,
    npcs: nextNpcs,
    npcTemplates: nextTemplates,
  }
}
