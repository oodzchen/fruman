import {
  decomp,
  isSimple,
  makeCCW,
  quickDecomp,
  removeCollinearPoints,
  removeDuplicatePoints,
} from 'poly-decomp-es'

import {
  buildCharacterBodyLocalPoints,
  getCharacterBodyHeight,
  getCharacterBodyProfileHeight,
  getCharacterBodyProfileWidth,
  isValidCharacterBodyProfile,
} from './characterBodyProfile'
import type {
  MapCharacterBodyCollisionShape,
  MapCharacterBodyProfile,
} from './editorMapTypes'

type DecompPoint = [number, number]
type DecompPolygon = DecompPoint[]
type CollisionCanvasContext =
  | CanvasRenderingContext2D
  | OffscreenCanvasRenderingContext2D

type CollisionRasterShape =
  | {
      kind: 'circle'
      centerX: number
      centerY: number
      radiusX: number
      radiusY: number
    }
  | {
      kind: 'ellipse'
      centerX: number
      centerY: number
      radiusX: number
      radiusY: number
      rotationDeg: number
    }
  | {
      kind: 'capsule'
      centerX: number
      centerY: number
      halfWidth: number
      halfHeight: number
      radiusX: number
      radiusY: number
      rotationDeg: number
    }

interface CollisionBounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
  width: number
  height: number
}

interface CollisionRasterMapping {
  originX: number
  originY: number
  scale: number
  width: number
  height: number
}

interface CollisionRasterRowSpan {
  minX: number
  maxX: number
  centerTwice: number
  width: number
}

interface CollisionAutoShapeCandidate {
  minY: number
  maxY: number
  centerTwice: number
  width: number
  minWidth: number
  maxWidth: number
}

const DECOMP_POINT_EPSILON = 0.0001
const BOX2D_MAX_POLYGON_VERTICES = 8
const COLLISION_RASTER_PADDING = 6
const COLLISION_RASTER_MAX_SIZE = 320
const COLLISION_SIMPLIFY_BASE_EPSILON = 0.02

let sharedCollisionRasterContext: CollisionCanvasContext | null = null

function getPositiveProfileSize(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : 0
}

function getPointBounds(points: readonly number[]): CollisionBounds | null {
  if (points.length < 6) {
    return null
  }
  let minX = points[0]
  let maxX = points[0]
  let minY = points[1]
  let maxY = points[1]
  for (let i = 2; i < points.length; i += 2) {
    const x = points[i]
    const y = points[i + 1]
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  return {
    minX,
    minY,
    maxX,
    maxY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  }
}

function hasProfileAbsoluteSize(
  profile: MapCharacterBodyProfile | null | undefined
): boolean {
  return getPositiveProfileSize(profile?.width) > 0
}

function getProfileReferenceWidth(
  profile: MapCharacterBodyProfile | null | undefined
): number {
  if (!hasProfileAbsoluteSize(profile)) {
    return 128
  }
  return getPointBounds(profile?.points ?? [])?.width ?? 128
}

function getProfileReferenceHeight(
  profile: MapCharacterBodyProfile | null | undefined
): number {
  if (!hasProfileAbsoluteSize(profile)) {
    return 128
  }
  return getPointBounds(profile?.points ?? [])?.height ?? 128
}

function getSharedCollisionRasterContext(
  width: number,
  height: number
): CollisionCanvasContext | null {
  if (!sharedCollisionRasterContext) {
    const contextSettings: CanvasRenderingContext2DSettings = {
      willReadFrequently: true,
    }
    if (typeof OffscreenCanvas !== 'undefined') {
      const canvas = new OffscreenCanvas(width, height)
      sharedCollisionRasterContext = canvas.getContext('2d', contextSettings)
    } else if (typeof document !== 'undefined') {
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      sharedCollisionRasterContext = canvas.getContext('2d', contextSettings)
    }
  }
  if (!sharedCollisionRasterContext) {
    return null
  }
  if (
    sharedCollisionRasterContext.canvas.width !== width ||
    sharedCollisionRasterContext.canvas.height !== height
  ) {
    sharedCollisionRasterContext.canvas.width = width
    sharedCollisionRasterContext.canvas.height = height
  } else {
    sharedCollisionRasterContext.clearRect(0, 0, width, height)
  }
  return sharedCollisionRasterContext
}

function buildDecompPolygon(points: readonly number[]): DecompPolygon | null {
  if (points.length < 6) {
    return null
  }

  const polygon: DecompPolygon = []
  for (let i = 0; i < points.length; i += 2) {
    polygon.push([points[i], points[i + 1]])
  }
  removeDuplicatePoints(polygon, DECOMP_POINT_EPSILON)
  removeCollinearPoints(polygon, DECOMP_POINT_EPSILON)
  return polygon.length >= 3 ? polygon : null
}

function flattenDecompPolygon(polygon: readonly DecompPoint[]): number[] {
  const result = new Array<number>(polygon.length * 2)
  for (let i = 0; i < polygon.length; i++) {
    const offset = i * 2
    result[offset] = polygon[i][0]
    result[offset + 1] = polygon[i][1]
  }
  return result
}

function appendSplitConvexPolygon(
  polygon: readonly DecompPoint[],
  out: number[][]
): void {
  if (polygon.length < 3) {
    return
  }
  if (polygon.length <= BOX2D_MAX_POLYGON_VERTICES) {
    out.push(flattenDecompPolygon(polygon))
    return
  }

  const pointCount = polygon.length
  let startIndex = 1
  while (startIndex < pointCount - 1) {
    const endIndex = Math.min(
      pointCount - 1,
      startIndex + BOX2D_MAX_POLYGON_VERTICES - 2
    )
    const splitPolygon: DecompPolygon = [polygon[0]]
    for (let i = startIndex; i <= endIndex; i++) {
      splitPolygon.push(polygon[i])
    }
    out.push(flattenDecompPolygon(splitPolygon))
    startIndex = endIndex
  }
}

export function decomposeCharacterBodyLocalPoints(
  localPoints: readonly number[]
): number[][] | null {
  const polygon = buildDecompPolygon(localPoints)
  if (!polygon || !isSimple(polygon)) {
    return null
  }

  makeCCW(polygon)
  let convexPolygons: DecompPolygon[] | null = quickDecomp(polygon)
  if (!convexPolygons || convexPolygons.length === 0) {
    const exactPolygons = decomp(polygon)
    convexPolygons = exactPolygons === false ? null : exactPolygons
  }
  if (!convexPolygons || convexPolygons.length === 0) {
    return null
  }

  const result: number[][] = []
  for (let i = 0; i < convexPolygons.length; i++) {
    appendSplitConvexPolygon(convexPolygons[i], result)
  }
  return result.length > 0 ? result : null
}

function isFiniteCollisionNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function getCollisionRotationDeg(rotationDeg: number | undefined): number {
  return isFiniteCollisionNumber(rotationDeg) ? rotationDeg : 0
}

function getRotatedEllipseExtent(
  radiusX: number,
  radiusY: number,
  rotationDeg: number
): { x: number; y: number } {
  const rotationRad = (rotationDeg * Math.PI) / 180
  const cos = Math.cos(rotationRad)
  const sin = Math.sin(rotationRad)
  return {
    x: Math.sqrt(radiusX * radiusX * cos * cos + radiusY * radiusY * sin * sin),
    y: Math.sqrt(radiusX * radiusX * sin * sin + radiusY * radiusY * cos * cos),
  }
}

function getRotatedRectExtent(
  halfWidth: number,
  halfHeight: number,
  rotationDeg: number
): { x: number; y: number } {
  const rotationRad = (rotationDeg * Math.PI) / 180
  const cos = Math.cos(rotationRad)
  const sin = Math.sin(rotationRad)
  return {
    x: Math.abs(halfWidth * cos) + Math.abs(halfHeight * sin),
    y: Math.abs(halfWidth * sin) + Math.abs(halfHeight * cos),
  }
}

function isValidCollisionShape(
  shape: MapCharacterBodyCollisionShape | undefined
): shape is MapCharacterBodyCollisionShape {
  if (!shape || !isFiniteCollisionNumber(shape.center.x)) {
    return false
  }
  if (!isFiniteCollisionNumber(shape.center.y)) {
    return false
  }
  if (shape.kind === 'circle') {
    return isFiniteCollisionNumber(shape.radius) && shape.radius > 0
  }
  if (shape.kind === 'ellipse') {
    return (
      isFiniteCollisionNumber(shape.radiusX) &&
      isFiniteCollisionNumber(shape.radiusY) &&
      shape.radiusX > 0 &&
      shape.radiusY > 0
    )
  }
  return (
    shape.kind === 'capsule' &&
    isFiniteCollisionNumber(shape.halfWidth) &&
    isFiniteCollisionNumber(shape.halfHeight) &&
    shape.halfWidth > 0 &&
    shape.halfHeight > 0
  )
}

function buildRasterMapping(bounds: CollisionBounds): CollisionRasterMapping {
  const maxDimension = Math.max(
    1,
    Math.ceil(Math.max(bounds.width, bounds.height))
  )
  const usableSize = COLLISION_RASTER_MAX_SIZE - COLLISION_RASTER_PADDING * 2
  const scale = Math.max(1, Math.floor(usableSize / maxDimension))
  const width = Math.max(
    1,
    Math.ceil(bounds.width * scale) + COLLISION_RASTER_PADDING * 2
  )
  const height = Math.max(
    1,
    Math.ceil(bounds.height * scale) + COLLISION_RASTER_PADDING * 2
  )
  const originX = Math.round(-bounds.minX * scale) + COLLISION_RASTER_PADDING
  const originY = Math.round(-bounds.minY * scale) + COLLISION_RASTER_PADDING
  return {
    originX,
    originY,
    scale,
    width,
    height,
  }
}

function buildCollisionShapeBounds(
  shapes: readonly CollisionRasterShape[]
): CollisionBounds | null {
  if (shapes.length === 0) {
    return null
  }
  let minX = 0
  let minY = 0
  let maxX = 0
  let maxY = 0
  for (let i = 0; i < shapes.length; i++) {
    const shape = shapes[i]
    const extent =
      shape.kind === 'capsule'
        ? getRotatedRectExtent(
            shape.halfWidth,
            shape.halfHeight,
            shape.rotationDeg
          )
        : shape.kind === 'ellipse'
          ? getRotatedEllipseExtent(
              shape.radiusX,
              shape.radiusY,
              shape.rotationDeg
            )
          : { x: shape.radiusX, y: shape.radiusY }
    const shapeMinX = shape.centerX - extent.x
    const shapeMaxX = shape.centerX + extent.x
    const shapeMinY = shape.centerY - extent.y
    const shapeMaxY = shape.centerY + extent.y
    if (i === 0) {
      minX = shapeMinX
      minY = shapeMinY
      maxX = shapeMaxX
      maxY = shapeMaxY
      continue
    }
    if (shapeMinX < minX) minX = shapeMinX
    if (shapeMinY < minY) minY = shapeMinY
    if (shapeMaxX > maxX) maxX = shapeMaxX
    if (shapeMaxY > maxY) maxY = shapeMaxY
  }
  return {
    minX,
    minY,
    maxX,
    maxY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  }
}

function traceRasterPolygonPath(
  ctx: CollisionCanvasContext,
  points: readonly number[],
  mapping: CollisionRasterMapping
): void {
  ctx.beginPath()
  ctx.moveTo(
    Math.round(points[0] * mapping.scale) + mapping.originX,
    Math.round(points[1] * mapping.scale) + mapping.originY
  )
  for (let i = 2; i < points.length; i += 2) {
    ctx.lineTo(
      Math.round(points[i] * mapping.scale) + mapping.originX,
      Math.round(points[i + 1] * mapping.scale) + mapping.originY
    )
  }
  ctx.closePath()
}

function traceRasterEllipsePath(
  ctx: CollisionCanvasContext,
  shape: {
    centerX: number
    centerY: number
    radiusX: number
    radiusY: number
    rotationDeg?: number
  },
  mapping: CollisionRasterMapping
): void {
  ctx.beginPath()
  ctx.ellipse(
    Math.round(shape.centerX * mapping.scale) + mapping.originX,
    Math.round(shape.centerY * mapping.scale) + mapping.originY,
    Math.max(1, Math.round(shape.radiusX * mapping.scale)),
    Math.max(1, Math.round(shape.radiusY * mapping.scale)),
    (getCollisionRotationDeg(shape.rotationDeg) * Math.PI) / 180,
    0,
    Math.PI * 2
  )
}

function traceRasterCapsulePath(
  ctx: CollisionCanvasContext,
  shape: Extract<CollisionRasterShape, { kind: 'capsule' }>,
  mapping: CollisionRasterMapping
): void {
  const centerX = Math.round(shape.centerX * mapping.scale) + mapping.originX
  const centerY = Math.round(shape.centerY * mapping.scale) + mapping.originY
  const halfWidth = Math.max(1, Math.round(shape.halfWidth * mapping.scale))
  const halfHeight = Math.max(1, Math.round(shape.halfHeight * mapping.scale))
  const radiusX = Math.max(1, Math.round(shape.radiusX * mapping.scale))
  const radiusY = Math.max(1, Math.round(shape.radiusY * mapping.scale))
  const left = centerX - halfWidth
  const top = centerY - halfHeight
  const width = halfWidth * 2
  const height = halfHeight * 2
  ctx.save()
  ctx.translate(centerX, centerY)
  ctx.rotate((shape.rotationDeg * Math.PI) / 180)
  ctx.beginPath()
  const localLeft = -halfWidth
  const localTop = -halfHeight
  const innerLeft = localLeft + radiusX
  const innerRight = localLeft + width - radiusX
  const innerTop = localTop + radiusY
  const innerBottom = localTop + height - radiusY
  ctx.moveTo(innerLeft, localTop)
  ctx.lineTo(innerRight, localTop)
  ctx.ellipse(innerRight, innerTop, radiusX, radiusY, 0, -Math.PI / 2, 0)
  ctx.lineTo(localLeft + width, innerBottom)
  ctx.ellipse(innerRight, innerBottom, radiusX, radiusY, 0, 0, Math.PI / 2)
  ctx.lineTo(innerLeft, localTop + height)
  ctx.ellipse(innerLeft, innerBottom, radiusX, radiusY, 0, Math.PI / 2, Math.PI)
  ctx.lineTo(localLeft, innerTop)
  ctx.ellipse(innerLeft, innerTop, radiusX, radiusY, 0, Math.PI, 1.5 * Math.PI)
  ctx.closePath()
  ctx.restore()
}

function rasterizeCollisionPolygon(points: readonly number[]): {
  ctx: CollisionCanvasContext
  mapping: CollisionRasterMapping
} | null {
  const bounds = getPointBounds(points)
  if (!bounds) {
    return null
  }
  const mapping = buildRasterMapping(bounds)
  const ctx = getSharedCollisionRasterContext(mapping.width, mapping.height)
  if (!ctx) {
    return null
  }
  ctx.clearRect(0, 0, mapping.width, mapping.height)
  ctx.fillStyle = '#fff'
  traceRasterPolygonPath(ctx, points, mapping)
  ctx.fill()
  return { ctx, mapping }
}

function rasterizeCollisionShapes(shapes: readonly CollisionRasterShape[]): {
  ctx: CollisionCanvasContext
  mapping: CollisionRasterMapping
} | null {
  const bounds = buildCollisionShapeBounds(shapes)
  if (!bounds) {
    return null
  }
  const mapping = buildRasterMapping(bounds)
  const ctx = getSharedCollisionRasterContext(mapping.width, mapping.height)
  if (!ctx) {
    return null
  }
  ctx.clearRect(0, 0, mapping.width, mapping.height)
  ctx.fillStyle = '#fff'
  for (let i = 0; i < shapes.length; i++) {
    const shape = shapes[i]
    if (shape.kind === 'capsule') {
      traceRasterCapsulePath(ctx, shape, mapping)
    } else {
      traceRasterEllipsePath(ctx, shape, mapping)
    }
    ctx.fill()
  }
  return { ctx, mapping }
}

function readFilledPixels(
  ctx: CollisionCanvasContext,
  width: number,
  height: number
): Uint8Array {
  const alpha = ctx.getImageData(0, 0, width, height).data
  const filled = new Uint8Array(width * height)
  for (let i = 0; i < filled.length; i++) {
    filled[i] = alpha[i * 4 + 3] > 0 ? 1 : 0
  }
  return filled
}

function extractFilledRowSpans(
  filled: Uint8Array,
  width: number,
  height: number
): {
  rows: CollisionRasterRowSpan[]
  minY: number
  maxY: number
  minX: number
  maxX: number
  filledCount: number
} | null {
  const rows = new Array<CollisionRasterRowSpan>(height)
  let minY = height
  let maxY = -1
  let minX = width
  let maxX = -1
  let filledCount = 0
  for (let y = 0; y < height; y++) {
    const rowOffset = y * width
    let rowMinX = -1
    let rowMaxX = -1
    for (let x = 0; x < width; x++) {
      if (filled[rowOffset + x] !== 1) {
        continue
      }
      filledCount++
      if (rowMinX < 0) {
        rowMinX = x
      }
      rowMaxX = x
    }
    if (rowMinX < 0 || rowMaxX < 0) {
      rows[y] = { minX: -1, maxX: -1, centerTwice: 0, width: 0 }
      continue
    }
    rows[y] = {
      minX: rowMinX,
      maxX: rowMaxX,
      centerTwice: rowMinX + rowMaxX,
      width: rowMaxX + 1 - rowMinX,
    }
    if (y < minY) minY = y
    if (y > maxY) maxY = y
    if (rowMinX < minX) minX = rowMinX
    if (rowMaxX > maxX) maxX = rowMaxX
  }
  if (maxY < minY || maxX < minX) {
    return null
  }
  return { rows, minY, maxY, minX, maxX, filledCount }
}

function buildAutoCollisionShapeCandidates(
  rows: readonly CollisionRasterRowSpan[],
  minY: number,
  maxY: number,
  minX: number,
  maxX: number
): CollisionAutoShapeCandidate[] {
  const totalHeight = maxY + 1 - minY
  const totalWidth = maxX + 1 - minX
  let sliceCount = totalHeight > totalWidth ? 4 : 3
  if (totalHeight < 24) {
    sliceCount = 2
  }
  const candidates: CollisionAutoShapeCandidate[] = []
  for (let sliceIndex = 0; sliceIndex < sliceCount; sliceIndex++) {
    const sliceStart =
      minY + Math.floor((totalHeight * sliceIndex) / sliceCount)
    const sliceEnd =
      minY + Math.floor((totalHeight * (sliceIndex + 1)) / sliceCount) - 1
    let localMinY = -1
    let localMaxY = -1
    let minWidth = 0
    let maxWidth = 0
    let totalWidthSum = 0
    let totalCenterSum = 0
    let rowCount = 0
    for (let y = sliceStart; y <= sliceEnd; y++) {
      const row = rows[y]
      if (!row || row.width <= 0) {
        continue
      }
      if (localMinY < 0) {
        localMinY = y
        minWidth = row.width
      }
      localMaxY = y
      if (row.width < minWidth) {
        minWidth = row.width
      }
      if (row.width > maxWidth) {
        maxWidth = row.width
      }
      totalWidthSum += row.width
      totalCenterSum += row.centerTwice
      rowCount++
    }
    if (localMinY < 0 || localMaxY < localMinY || rowCount <= 0) {
      continue
    }
    const avgWidth = Math.max(1, Math.round(totalWidthSum / rowCount))
    const resolvedWidth = Math.max(
      avgWidth,
      Math.round((avgWidth + maxWidth) * 0.5)
    )
    candidates.push({
      minY: localMinY,
      maxY: localMaxY,
      centerTwice: Math.round(totalCenterSum / rowCount),
      width: resolvedWidth,
      minWidth,
      maxWidth,
    })
  }
  if (candidates.length <= 1) {
    return candidates
  }

  const merged: CollisionAutoShapeCandidate[] = []
  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i]
    const previous = merged[merged.length - 1]
    if (!previous) {
      merged.push(candidate)
      continue
    }
    const centerDelta = Math.abs(candidate.centerTwice - previous.centerTwice)
    const widthDelta = Math.abs(candidate.width - previous.width)
    const mergeThreshold = Math.max(
      6,
      Math.min(candidate.width, previous.width) / 2
    )
    if (centerDelta <= mergeThreshold && widthDelta <= mergeThreshold) {
      previous.maxY = candidate.maxY
      previous.centerTwice = Math.round(
        (previous.centerTwice + candidate.centerTwice) * 0.5
      )
      previous.width = Math.max(previous.width, candidate.width)
      previous.minWidth = Math.min(previous.minWidth, candidate.minWidth)
      previous.maxWidth = Math.max(previous.maxWidth, candidate.maxWidth)
      continue
    }
    merged.push(candidate)
  }
  return merged
}

function tryBuildSingleEllipseShape(
  spans: {
    rows: readonly CollisionRasterRowSpan[]
    minY: number
    maxY: number
    minX: number
    maxX: number
    filledCount: number
  },
  mapping: CollisionRasterMapping
): MapCharacterBodyCollisionShape | null {
  const width = Math.max(1, spans.maxX + 1 - spans.minX)
  const height = Math.max(1, spans.maxY + 1 - spans.minY)
  if (width < 6 || height < 6) {
    return null
  }
  const boxArea = width * height
  const fillRatio = spans.filledCount / Math.max(1, boxArea)
  if (fillRatio < 0.64 || fillRatio > 0.84) {
    return null
  }
  const bboxCenterTwice = spans.minX + spans.maxX
  let centerOffsetSum = 0
  let rowCount = 0
  for (let y = spans.minY; y <= spans.maxY; y++) {
    const row = spans.rows[y]
    if (!row || row.width <= 0) {
      continue
    }
    centerOffsetSum += Math.abs(row.centerTwice - bboxCenterTwice)
    rowCount++
  }
  if (rowCount <= 0) {
    return null
  }
  const averageCenterOffset = centerOffsetSum / rowCount
  if (averageCenterOffset > Math.max(2, width * 0.18)) {
    return null
  }
  return {
    kind: 'ellipse',
    center: {
      x: fromRasterX((spans.minX + spans.maxX) * 0.5, mapping),
      y: fromRasterY((spans.minY + spans.maxY) * 0.5, mapping),
    },
    radiusX: Math.max(1 / mapping.scale, width / (mapping.scale * 2)),
    radiusY: Math.max(1 / mapping.scale, height / (mapping.scale * 2)),
  }
}

function fromRasterX(value: number, mapping: CollisionRasterMapping): number {
  return (value - mapping.originX) / mapping.scale
}

function fromRasterY(value: number, mapping: CollisionRasterMapping): number {
  return (value - mapping.originY) / mapping.scale
}

function buildShapeFromCandidate(
  candidate: CollisionAutoShapeCandidate,
  mapping: CollisionRasterMapping
): MapCharacterBodyCollisionShape {
  const height = Math.max(1, candidate.maxY + 1 - candidate.minY)
  const centerX = fromRasterX(candidate.centerTwice * 0.5, mapping)
  const centerY = fromRasterY(
    (candidate.minY + candidate.maxY + 1) * 0.5,
    mapping
  )
  const halfWidth = Math.max(
    1 / mapping.scale,
    candidate.width / (mapping.scale * 2)
  )
  const halfHeight = Math.max(1 / mapping.scale, height / (mapping.scale * 2))
  const widthRatio = candidate.minWidth / Math.max(1, candidate.maxWidth)
  if (height <= candidate.width || widthRatio < 0.82) {
    return {
      kind: 'ellipse',
      center: {
        x: centerX,
        y: centerY,
      },
      radiusX: halfWidth,
      radiusY: halfHeight,
    }
  }
  return {
    kind: 'capsule',
    center: {
      x: centerX,
      y: centerY,
    },
    halfWidth,
    halfHeight,
  }
}

export function buildAutoCharacterBodyCollisionShapesFromLocalPoints(
  localPoints: readonly number[]
): MapCharacterBodyCollisionShape[] | null {
  const rasterized = rasterizeCollisionPolygon(localPoints)
  if (!rasterized) {
    return null
  }
  const { ctx, mapping } = rasterized
  const filled = readFilledPixels(ctx, mapping.width, mapping.height)
  const spans = extractFilledRowSpans(filled, mapping.width, mapping.height)
  if (!spans) {
    return null
  }
  const ellipseShape = tryBuildSingleEllipseShape(spans, mapping)
  if (ellipseShape) {
    return [ellipseShape]
  }
  const candidates = buildAutoCollisionShapeCandidates(
    spans.rows,
    spans.minY,
    spans.maxY,
    spans.minX,
    spans.maxX
  )
  if (candidates.length === 0) {
    return null
  }
  const shapes = new Array<MapCharacterBodyCollisionShape>(candidates.length)
  for (let i = 0; i < candidates.length; i++) {
    shapes[i] = buildShapeFromCandidate(candidates[i], mapping)
  }
  return shapes
}

function convertCollisionShapesToRasterShapes(
  shapes: readonly MapCharacterBodyCollisionShape[],
  scaleX = 1,
  scaleY = 1
): CollisionRasterShape[] {
  const result: CollisionRasterShape[] = []
  for (let i = 0; i < shapes.length; i++) {
    const shape = shapes[i]
    if (!isValidCollisionShape(shape)) {
      continue
    }
    if (shape.kind === 'circle') {
      result.push({
        kind: 'circle',
        centerX: shape.center.x * scaleX,
        centerY: shape.center.y * scaleY,
        radiusX: shape.radius * scaleX,
        radiusY: shape.radius * scaleY,
      })
      continue
    }
    if (shape.kind === 'ellipse') {
      result.push({
        kind: 'ellipse',
        centerX: shape.center.x * scaleX,
        centerY: shape.center.y * scaleY,
        radiusX: shape.radiusX * scaleX,
        radiusY: shape.radiusY * scaleY,
        rotationDeg: getCollisionRotationDeg(shape.rotationDeg),
      })
      continue
    }
    const baseRadius = Math.min(shape.halfWidth, shape.halfHeight)
    result.push({
      kind: 'capsule',
      centerX: shape.center.x * scaleX,
      centerY: shape.center.y * scaleY,
      halfWidth: shape.halfWidth * scaleX,
      halfHeight: shape.halfHeight * scaleY,
      radiusX: baseRadius * scaleX,
      radiusY: baseRadius * scaleY,
      rotationDeg: getCollisionRotationDeg(shape.rotationDeg),
    })
  }
  return result
}

function addRasterEdge(
  edges: Map<string, string[]>,
  x1: number,
  y1: number,
  x2: number,
  y2: number
): void {
  const key = `${x1},${y1}`
  const nextKey = `${x2},${y2}`
  const list = edges.get(key)
  if (list) {
    list.push(nextKey)
    return
  }
  edges.set(key, [nextKey])
}

function extractRasterLoops(
  filled: Uint8Array,
  width: number,
  height: number
): number[][] {
  const edges = new Map<string, string[]>()
  const isFilled = (x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x >= width || y >= height) {
      return false
    }
    return filled[y * width + x] === 1
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!isFilled(x, y)) {
        continue
      }
      if (!isFilled(x, y - 1)) {
        addRasterEdge(edges, x, y, x + 1, y)
      }
      if (!isFilled(x + 1, y)) {
        addRasterEdge(edges, x + 1, y, x + 1, y + 1)
      }
      if (!isFilled(x, y + 1)) {
        addRasterEdge(edges, x + 1, y + 1, x, y + 1)
      }
      if (!isFilled(x - 1, y)) {
        addRasterEdge(edges, x, y + 1, x, y)
      }
    }
  }

  const loops: number[][] = []
  for (const [startKey, list] of edges.entries()) {
    while (list.length > 0) {
      const loop: number[] = []
      let currentKey = startKey
      while (true) {
        const splitIndex = currentKey.indexOf(',')
        const x = Number.parseInt(currentKey.slice(0, splitIndex), 10)
        const y = Number.parseInt(currentKey.slice(splitIndex + 1), 10)
        loop.push(x, y)
        const nextList = edges.get(currentKey)
        if (!nextList || nextList.length === 0) {
          break
        }
        currentKey = nextList.pop() as string
        if (currentKey === startKey) {
          break
        }
      }
      if (loop.length >= 6) {
        loops.push(loop)
      }
    }
  }
  return loops
}

function computeLoopArea(points: readonly number[]): number {
  let area = 0
  const count = points.length / 2
  for (let i = 0; i < count; i++) {
    const currentOffset = i * 2
    const nextOffset = ((i + 1) % count) * 2
    area +=
      points[currentOffset] * points[nextOffset + 1] -
      points[nextOffset] * points[currentOffset + 1]
  }
  return area * 0.5
}

function removeCollinearLoopPoints(points: readonly number[]): number[] {
  const count = points.length / 2
  const result: number[] = []
  for (let i = 0; i < count; i++) {
    const prevOffset = ((i - 1 + count) % count) * 2
    const currentOffset = i * 2
    const nextOffset = ((i + 1) % count) * 2
    const ax = points[currentOffset] - points[prevOffset]
    const ay = points[currentOffset + 1] - points[prevOffset + 1]
    const bx = points[nextOffset] - points[currentOffset]
    const by = points[nextOffset + 1] - points[currentOffset + 1]
    if (Math.abs(ax * by - ay * bx) <= DECOMP_POINT_EPSILON) {
      continue
    }
    result.push(points[currentOffset], points[currentOffset + 1])
  }
  return result
}

function simplifyOpenPolyline(
  points: readonly number[],
  epsilon: number
): number[] {
  const pointCount = points.length / 2
  if (pointCount <= 2) {
    return points.slice()
  }
  const keep = new Uint8Array(pointCount)
  keep[0] = 1
  keep[pointCount - 1] = 1
  const markDouglasPeucker = (startIndex: number, endIndex: number) => {
    if (endIndex - startIndex <= 1) {
      return
    }
    const startX = points[startIndex * 2]
    const startY = points[startIndex * 2 + 1]
    const endX = points[endIndex * 2]
    const endY = points[endIndex * 2 + 1]
    let maxDistanceSq = 0
    let splitIndex = -1
    for (let i = startIndex + 1; i < endIndex; i++) {
      const pointX = points[i * 2]
      const pointY = points[i * 2 + 1]
      const dx = endX - startX
      const dy = endY - startY
      let distanceSq = 0
      if (dx === 0 && dy === 0) {
        const rx = pointX - startX
        const ry = pointY - startY
        distanceSq = rx * rx + ry * ry
      } else {
        const factor =
          ((pointX - startX) * dx + (pointY - startY) * dy) /
          (dx * dx + dy * dy)
        const clampedFactor = factor < 0 ? 0 : factor > 1 ? 1 : factor
        const closestX = startX + dx * clampedFactor
        const closestY = startY + dy * clampedFactor
        const rx = pointX - closestX
        const ry = pointY - closestY
        distanceSq = rx * rx + ry * ry
      }
      if (distanceSq > maxDistanceSq) {
        maxDistanceSq = distanceSq
        splitIndex = i
      }
    }
    if (splitIndex < 0 || maxDistanceSq <= epsilon * epsilon) {
      return
    }
    keep[splitIndex] = 1
    markDouglasPeucker(startIndex, splitIndex)
    markDouglasPeucker(splitIndex, endIndex)
  }
  markDouglasPeucker(0, pointCount - 1)
  const result: number[] = []
  for (let i = 0; i < pointCount; i++) {
    if (keep[i] !== 1) {
      continue
    }
    result.push(points[i * 2], points[i * 2 + 1])
  }
  return result
}

function simplifyClosedLoop(
  points: readonly number[],
  epsilon: number
): number[] {
  const openPoints = points.slice()
  openPoints.push(points[0], points[1])
  const simplified = simplifyOpenPolyline(openPoints, epsilon)
  simplified.splice(simplified.length - 2, 2)
  return removeCollinearLoopPoints(simplified)
}

function normalizeLoop(points: readonly number[]): number[] | null {
  const polygon = buildDecompPolygon(points)
  if (!polygon || !isSimple(polygon)) {
    return null
  }
  makeCCW(polygon)
  return flattenDecompPolygon(polygon)
}

function extractCollisionOutlineLoopsFromRaster(
  filled: Uint8Array,
  mapping: CollisionRasterMapping
): number[][] | null {
  const loops = extractRasterLoops(filled, mapping.width, mapping.height)
  if (loops.length === 0) {
    return null
  }
  const result: number[][] = []
  for (let i = 0; i < loops.length; i++) {
    const loop = loops[i]
    const worldLoop = new Array<number>(loop.length)
    for (let j = 0; j < loop.length; j += 2) {
      worldLoop[j] = fromRasterX(loop[j], mapping)
      worldLoop[j + 1] = fromRasterY(loop[j + 1], mapping)
    }
    const bounds = getPointBounds(worldLoop)
    const epsilon = bounds
      ? Math.max(
          COLLISION_SIMPLIFY_BASE_EPSILON,
          Math.max(bounds.width, bounds.height) / 48
        )
      : COLLISION_SIMPLIFY_BASE_EPSILON
    const simplified = simplifyClosedLoop(worldLoop, epsilon)
    const normalized = normalizeLoop(simplified)
    if (normalized && normalized.length >= 6) {
      result.push(normalized)
    }
  }
  if (result.length === 0) {
    return null
  }
  result.sort(
    (a, b) => Math.abs(computeLoopArea(b)) - Math.abs(computeLoopArea(a))
  )
  return result
}

export function buildCharacterBodyCollisionOutlineLoopsFromLocalPoints(
  localPoints: readonly number[]
): number[][] | null {
  const rasterized = rasterizeCollisionPolygon(localPoints)
  if (!rasterized) {
    return null
  }
  const filled = readFilledPixels(
    rasterized.ctx,
    rasterized.mapping.width,
    rasterized.mapping.height
  )
  const loops = extractCollisionOutlineLoopsFromRaster(
    filled,
    rasterized.mapping
  )
  if (!loops || loops.length === 0) {
    return null
  }
  return [loops[0]]
}

export function buildCollisionOutlineLoopsFromShapes(
  shapes: readonly MapCharacterBodyCollisionShape[]
): number[][] | null {
  const rasterShapes = convertCollisionShapesToRasterShapes(shapes)
  if (rasterShapes.length === 0) {
    return null
  }
  const rasterized = rasterizeCollisionShapes(rasterShapes)
  if (!rasterized) {
    return null
  }
  const filled = readFilledPixels(
    rasterized.ctx,
    rasterized.mapping.width,
    rasterized.mapping.height
  )
  return extractCollisionOutlineLoopsFromRaster(filled, rasterized.mapping)
}

function buildScaledProfileCollisionShapes(
  profile: MapCharacterBodyProfile
): MapCharacterBodyCollisionShape[] | null {
  const sourceShapes = profile.collisionShapes
  if (!sourceShapes || sourceShapes.length === 0) {
    return null
  }
  const result: MapCharacterBodyCollisionShape[] = []
  for (let i = 0; i < sourceShapes.length; i++) {
    const shape = sourceShapes[i]
    if (!isValidCollisionShape(shape)) {
      continue
    }
    if (shape.kind === 'circle') {
      result.push({
        kind: 'circle',
        center: {
          x: shape.center.x,
          y: shape.center.y,
        },
        radius: shape.radius,
      })
      continue
    }
    if (shape.kind === 'ellipse') {
      result.push({
        kind: 'ellipse',
        center: {
          x: shape.center.x,
          y: shape.center.y,
        },
        radiusX: shape.radiusX,
        radiusY: shape.radiusY,
        rotationDeg: getCollisionRotationDeg(shape.rotationDeg),
      })
      continue
    }
    result.push({
      kind: 'capsule',
      center: {
        x: shape.center.x,
        y: shape.center.y,
      },
      halfWidth: shape.halfWidth,
      halfHeight: shape.halfHeight,
      rotationDeg: getCollisionRotationDeg(shape.rotationDeg),
    })
  }
  return result.length > 0 ? result : null
}

function buildCollisionOutlineLoopsFromProfile(
  profile: MapCharacterBodyProfile,
  radius: number,
  bodyHeight: number
): number[][] | null {
  const localPoints = buildCharacterBodyLocalPoints(profile, radius, bodyHeight)
  if (!localPoints || localPoints.length < 6) {
    return null
  }

  const scaledShapes = buildScaledProfileCollisionShapes(profile)
  if (scaledShapes && scaledShapes.length > 0 && !profile.presetId) {
    const bodyWidth = getCharacterBodyProfileWidth(profile) || radius * 2
    const resolvedBodyHeight =
      getCharacterBodyProfileHeight(profile) ||
      getCharacterBodyHeight(bodyHeight, radius)
    const scaleX = bodyWidth / getProfileReferenceWidth(profile)
    const scaleY = resolvedBodyHeight / getProfileReferenceHeight(profile)
    const rasterShapes = convertCollisionShapesToRasterShapes(
      scaledShapes,
      scaleX,
      scaleY
    )
    const rasterized = rasterizeCollisionShapes(rasterShapes)
    if (!rasterized) {
      return null
    }
    const filled = readFilledPixels(
      rasterized.ctx,
      rasterized.mapping.width,
      rasterized.mapping.height
    )
    return extractCollisionOutlineLoopsFromRaster(filled, rasterized.mapping)
  }

  return buildCharacterBodyCollisionOutlineLoopsFromLocalPoints(localPoints)
}

export function buildCharacterBodyCollisionPolygons(
  profile: MapCharacterBodyProfile | null | undefined,
  radius: number,
  bodyHeight: number
): number[][] | null {
  if (!profile) {
    return null
  }
  const loops = isValidCharacterBodyProfile(profile)
    ? buildCollisionOutlineLoopsFromProfile(profile, radius, bodyHeight)
    : null
  if (!loops || loops.length === 0) {
    return null
  }
  const result: number[][] = []
  for (let i = 0; i < loops.length; i++) {
    const polygons = decomposeCharacterBodyLocalPoints(loops[i])
    if (!polygons || polygons.length === 0) {
      continue
    }
    for (let j = 0; j < polygons.length; j++) {
      result.push(polygons[j])
    }
  }
  return result.length > 0 ? result : null
}
