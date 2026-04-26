import type { EditorCanvasBounds } from './EditorBodyDrawerTypes'
import {
  DEFAULT_CONTOUR_SEGMENTS,
  DRAW_WORLD_HALF,
} from './EditorBodyDrawerTypes'

export interface EditorContourBounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
  width: number
  height: number
  centerX: number
  centerY: number
}

export interface EditorContourEdgeProjection {
  x: number
  y: number
  distanceSq: number
  factorScaled: number
}

export interface EditorContourEdgeHit {
  insertAfterIndex: number
  x: number
  y: number
}

export function getContourPointCount(contourPoints: readonly number[]): number {
  return contourPoints.length / 2
}

export function getContourBounds(
  contourPoints: readonly number[]
): EditorContourBounds | null {
  if (contourPoints.length < 2) {
    return null
  }
  let minX = contourPoints[0]
  let maxX = contourPoints[0]
  let minY = contourPoints[1]
  let maxY = contourPoints[1]
  for (let i = 2; i < contourPoints.length; i += 2) {
    const pointX = contourPoints[i]
    const pointY = contourPoints[i + 1]
    if (pointX < minX) minX = pointX
    if (pointX > maxX) maxX = pointX
    if (pointY < minY) minY = pointY
    if (pointY > maxY) maxY = pointY
  }
  const width = Math.max(1, maxX - minX)
  const height = Math.max(1, maxY - minY)
  return {
    minX,
    minY,
    maxX,
    maxY,
    width,
    height,
    centerX: Math.round((minX + maxX) * 0.5),
    centerY: Math.round((minY + maxY) * 0.5),
  }
}

export function buildDefaultContourPoints(
  defaultBodyWidth: number | undefined,
  defaultBodyHeight: number | undefined
): number[] {
  const safeWidth =
    defaultBodyWidth && defaultBodyWidth > 0 ? defaultBodyWidth : 1
  const safeHeight =
    defaultBodyHeight && defaultBodyHeight > 0 ? defaultBodyHeight : safeWidth
  const baseRadius = 52
  let radiusX = baseRadius
  let radiusY = Math.round((baseRadius * safeHeight) / safeWidth)
  if (radiusY > baseRadius) {
    radiusY = baseRadius
    radiusX = Math.round((baseRadius * safeWidth) / safeHeight)
  }
  radiusX = Math.max(8, radiusX)
  radiusY = Math.max(8, radiusY)
  const points = new Array<number>(DEFAULT_CONTOUR_SEGMENTS * 2)
  for (let i = 0; i < DEFAULT_CONTOUR_SEGMENTS; i++) {
    const angle = (Math.PI * 2 * i) / DEFAULT_CONTOUR_SEGMENTS - Math.PI * 0.5
    const offset = i * 2
    points[offset] = DRAW_WORLD_HALF + Math.round(Math.cos(angle) * radiusX)
    points[offset + 1] = DRAW_WORLD_HALF + Math.round(Math.sin(angle) * radiusY)
  }
  return points
}

export function scaleContourPointsFromBounds(
  sourcePoints: readonly number[],
  sourceBounds: EditorCanvasBounds,
  targetBounds: EditorCanvasBounds
): number[] {
  const sourceSpanX = Math.max(1, sourceBounds.maxX - sourceBounds.minX)
  const sourceSpanY = Math.max(1, sourceBounds.maxY - sourceBounds.minY)
  const targetSpanX = Math.max(1, targetBounds.maxX - targetBounds.minX)
  const targetSpanY = Math.max(1, targetBounds.maxY - targetBounds.minY)
  const nextPoints = new Array<number>(sourcePoints.length)
  for (let i = 0; i < sourcePoints.length; i += 2) {
    nextPoints[i] =
      targetBounds.minX +
      Math.round(
        ((sourcePoints[i] - sourceBounds.minX) * targetSpanX) / sourceSpanX
      )
    nextPoints[i + 1] =
      targetBounds.minY +
      Math.round(
        ((sourcePoints[i + 1] - sourceBounds.minY) * targetSpanY) / sourceSpanY
      )
  }
  return nextPoints
}

export function rotateContourPoints(
  sourcePoints: readonly number[],
  centerX: number,
  centerY: number,
  rotationDeg: number
): number[] {
  const nextPoints = new Array<number>(sourcePoints.length)
  const rotationRad = (rotationDeg * Math.PI) / 180
  const cos = Math.cos(rotationRad)
  const sin = Math.sin(rotationRad)
  for (let i = 0; i < sourcePoints.length; i += 2) {
    const dx = sourcePoints[i] - centerX
    const dy = sourcePoints[i + 1] - centerY
    nextPoints[i] = Math.round(centerX + dx * cos - dy * sin)
    nextPoints[i + 1] = Math.round(centerY + dx * sin + dy * cos)
  }
  return nextPoints
}

export function traceContourPath(
  ctx: CanvasRenderingContext2D,
  contourPoints: readonly number[]
) {
  ctx.beginPath()
  ctx.moveTo(contourPoints[0], contourPoints[1])
  for (let i = 2; i < contourPoints.length; i += 2) {
    ctx.lineTo(contourPoints[i], contourPoints[i + 1])
  }
  ctx.closePath()
}

export function getContourHitDistanceSq(
  baseDistanceSq: number,
  viewportScale: number
): number {
  const baseDistance = Math.max(1, Math.round(Math.sqrt(baseDistanceSq)))
  const scaledDistance = Math.max(2, Math.round(baseDistance / viewportScale))
  return scaledDistance * scaledDistance
}

export function getNearestContourPointIndex(
  contourPoints: readonly number[],
  pointX: number,
  pointY: number,
  maxDistanceSq: number
): number {
  let bestIndex = -1
  let bestDistanceSq = maxDistanceSq
  for (let i = 0; i < contourPoints.length; i += 2) {
    const dx = pointX - contourPoints[i]
    const dy = pointY - contourPoints[i + 1]
    const distanceSq = dx * dx + dy * dy
    if (distanceSq > bestDistanceSq) {
      continue
    }
    bestDistanceSq = distanceSq
    bestIndex = i / 2
  }
  return bestIndex
}

export function getEdgeProjection(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
): EditorContourEdgeProjection {
  const dx = bx - ax
  const dy = by - ay
  if (dx === 0 && dy === 0) {
    const rx = px - ax
    const ry = py - ay
    return {
      x: ax,
      y: ay,
      distanceSq: rx * rx + ry * ry,
      factorScaled: 0,
    }
  }
  const lengthSq = dx * dx + dy * dy
  let factorScaled = Math.round(
    (((px - ax) * dx + (py - ay) * dy) * 1024) / lengthSq
  )
  if (factorScaled < 0) {
    factorScaled = 0
  } else if (factorScaled > 1024) {
    factorScaled = 1024
  }
  const projectedX = ax + Math.round((dx * factorScaled) / 1024)
  const projectedY = ay + Math.round((dy * factorScaled) / 1024)
  const rx = px - projectedX
  const ry = py - projectedY
  return {
    x: projectedX,
    y: projectedY,
    distanceSq: rx * rx + ry * ry,
    factorScaled,
  }
}

export function getNearestContourEdge(
  contourPoints: readonly number[],
  contourClosed: boolean,
  pointX: number,
  pointY: number,
  maxDistanceSq: number
): EditorContourEdgeHit | null {
  const pointCount = getContourPointCount(contourPoints)
  if (pointCount < 2) {
    return null
  }
  const edgeCount = contourClosed ? pointCount : pointCount - 1
  let bestInsertAfterIndex = -1
  let bestDistanceSq = maxDistanceSq
  let bestX = 0
  let bestY = 0
  for (let i = 0; i < edgeCount; i++) {
    const nextIndex = (i + 1) % pointCount
    const currentOffset = i * 2
    const nextOffset = nextIndex * 2
    const projection = getEdgeProjection(
      pointX,
      pointY,
      contourPoints[currentOffset],
      contourPoints[currentOffset + 1],
      contourPoints[nextOffset],
      contourPoints[nextOffset + 1]
    )
    if (
      projection.distanceSq > bestDistanceSq ||
      projection.factorScaled <= 0 ||
      projection.factorScaled >= 1024
    ) {
      continue
    }
    bestDistanceSq = projection.distanceSq
    bestInsertAfterIndex = i
    bestX = projection.x
    bestY = projection.y
  }
  if (bestInsertAfterIndex < 0) {
    return null
  }
  return {
    insertAfterIndex: bestInsertAfterIndex,
    x: bestX,
    y: bestY,
  }
}
