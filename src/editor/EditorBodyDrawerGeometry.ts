import {
  isSimple,
  makeCCW,
  removeCollinearPoints,
  removeDuplicatePoints,
} from 'poly-decomp-es'

import type { DecompPoint, DecompPolygon } from './EditorBodyDrawerTypes'
import {
  DRAW_WORLD_SIZE,
  MASK_ALPHA_THRESHOLD,
  MAX_EDITOR_CONTOUR_POINTS,
  PROFILE_POINT_PRECISION,
} from './EditorBodyDrawerTypes'

export function readMaskFill(
  maskCtx: CanvasRenderingContext2D,
  size: number,
  alphaThreshold = MASK_ALPHA_THRESHOLD
): {
  filled: Uint8Array
  minX: number
  minY: number
  maxX: number
  maxY: number
} | null {
  const imageData = maskCtx.getImageData(0, 0, size, size).data
  const filled = new Uint8Array(size * size)
  let minX = size
  let minY = size
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < size; y++) {
    const rowOffset = y * size
    for (let x = 0; x < size; x++) {
      const index = rowOffset + x
      if (imageData[index * 4 + 3] < alphaThreshold) {
        continue
      }
      filled[index] = 1
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y
    }
  }

  if (maxX < minX || maxY < minY) {
    return null
  }

  return { filled, minX, minY, maxX, maxY }
}

export function buildEditorContourFromMask(
  maskCtx: CanvasRenderingContext2D,
  alphaThreshold = MASK_ALPHA_THRESHOLD
): number[] | null {
  const maskFill = readMaskFill(maskCtx, DRAW_WORLD_SIZE, alphaThreshold)
  if (!maskFill) {
    return null
  }
  const loop = pickLargestLoop(
    extractMaskLoops(maskFill.filled, DRAW_WORLD_SIZE, DRAW_WORLD_SIZE)
  )
  if (!loop || loop.length < 6) {
    return null
  }
  const limited = limitEditorLoopPoints(loop, MAX_EDITOR_CONTOUR_POINTS)
  return limited.length >= 6 ? limited : null
}

export function extractMaskLoops(
  filled: Uint8Array,
  width: number,
  height: number
): number[][] {
  const edges = new Map<string, string[]>()
  const addEdge = (x1: number, y1: number, x2: number, y2: number) => {
    const key = `${x1},${y1}`
    const nextKey = `${x2},${y2}`
    const list = edges.get(key)
    if (list) {
      list.push(nextKey)
    } else {
      edges.set(key, [nextKey])
    }
  }
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
        addEdge(x, y, x + 1, y)
      }
      if (!isFilled(x + 1, y)) {
        addEdge(x + 1, y, x + 1, y + 1)
      }
      if (!isFilled(x, y + 1)) {
        addEdge(x + 1, y + 1, x, y + 1)
      }
      if (!isFilled(x - 1, y)) {
        addEdge(x, y + 1, x, y)
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

export function pickLargestLoop(loops: number[][]): number[] | null {
  let best: number[] | null = null
  let bestArea = 0
  for (let i = 0; i < loops.length; i++) {
    const area = Math.abs(computeLoopArea(loops[i]))
    if (area > bestArea) {
      bestArea = area
      best = loops[i]
    }
  }
  return best
}

export function computeLoopArea(points: number[]): number {
  let area = 0
  const count = points.length / 2
  for (let i = 0; i < count; i++) {
    const currentIndex = i * 2
    const nextIndex = ((i + 1) % count) * 2
    area +=
      points[currentIndex] * points[nextIndex + 1] -
      points[nextIndex] * points[currentIndex + 1]
  }
  return area * 0.5
}

export function centerLoop(
  points: number[],
  centerX: number,
  centerY: number
): number[] {
  const normalized = new Array<number>(points.length)
  for (let i = 0; i < points.length; i += 2) {
    normalized[i] = points[i] - centerX
    normalized[i + 1] = points[i + 1] - centerY
  }
  return normalized
}

export function limitLoopPoints(points: number[], maxPoints: number): number[] {
  const normalized = normalizeProfileLoop(points)
  if (!normalized) {
    return []
  }
  if (normalized.length / 2 <= maxPoints) {
    return normalized
  }

  const source = normalized.slice()
  let bestValid = source
  let epsilon = 0.5
  while (epsilon <= 16) {
    const simplified = normalizeProfileLoop(simplifyClosedLoop(source, epsilon))
    if (simplified && simplified.length >= 6) {
      if (simplified.length < bestValid.length) {
        bestValid = simplified
      }
      if (simplified.length / 2 <= maxPoints) {
        return simplified
      }
    }
    epsilon *= 2
  }

  const step = Math.ceil(bestValid.length / 2 / maxPoints)
  const sampled: number[] = []
  for (let i = 0; i < bestValid.length; i += step * 2) {
    sampled.push(bestValid[i], bestValid[i + 1])
  }
  const normalizedSampled = normalizeProfileLoop(sampled)
  if (normalizedSampled && normalizedSampled.length / 2 <= maxPoints) {
    return normalizedSampled
  }

  return bestValid
}

export function limitEditorLoopPoints(
  points: number[],
  maxPoints: number
): number[] {
  const normalized = normalizeProfileLoop(points)
  if (!normalized) {
    return []
  }
  if (normalized.length / 2 <= maxPoints) {
    return normalized
  }

  const source = normalized.slice()
  let bestValid = source
  let epsilon = 1
  while (epsilon <= 32) {
    const simplified = normalizeProfileLoop(simplifyClosedLoop(source, epsilon))
    if (simplified && simplified.length >= 6) {
      if (simplified.length < bestValid.length) {
        bestValid = simplified
      }
      if (simplified.length / 2 <= maxPoints) {
        return simplified
      }
    }
    epsilon *= 2
  }

  const step = Math.ceil(bestValid.length / 2 / maxPoints)
  const sampled: number[] = []
  for (let i = 0; i < bestValid.length; i += step * 2) {
    sampled.push(bestValid[i], bestValid[i + 1])
  }
  const normalizedSampled = normalizeProfileLoop(sampled)
  if (normalizedSampled && normalizedSampled.length / 2 <= maxPoints) {
    return normalizedSampled
  }

  return bestValid
}

export function normalizeProfileLoop(points: number[]): number[] | null {
  const polygon = buildDecompPolygon(points)
  if (!polygon || !isSimple(polygon)) {
    return null
  }
  makeCCW(polygon)
  return flattenDecompPolygon(polygon)
}

export function buildDecompPolygon(points: number[]): DecompPolygon | null {
  if (points.length < 6) {
    return null
  }

  const polygon: DecompPolygon = []
  for (let i = 0; i < points.length; i += 2) {
    polygon.push([points[i], points[i + 1]] as DecompPoint)
  }
  removeDuplicatePoints(polygon, PROFILE_POINT_PRECISION)
  removeCollinearPoints(polygon, PROFILE_POINT_PRECISION)
  return polygon.length >= 3 ? polygon : null
}

export function flattenDecompPolygon(polygon: DecompPolygon): number[] {
  const result = new Array<number>(polygon.length * 2)
  for (let i = 0; i < polygon.length; i++) {
    const offset = i * 2
    result[offset] = polygon[i][0]
    result[offset + 1] = polygon[i][1]
  }
  return result
}

export function removeCollinearLoopPoints(points: number[]): number[] {
  const result: number[] = []
  const count = points.length / 2
  for (let i = 0; i < count; i++) {
    const prevIndex = ((i - 1 + count) % count) * 2
    const currentIndex = i * 2
    const nextIndex = ((i + 1) % count) * 2
    const ax = points[currentIndex] - points[prevIndex]
    const ay = points[currentIndex + 1] - points[prevIndex + 1]
    const bx = points[nextIndex] - points[currentIndex]
    const by = points[nextIndex + 1] - points[currentIndex + 1]
    if (ax * by - ay * bx === 0) {
      continue
    }
    result.push(points[currentIndex], points[currentIndex + 1])
  }
  return result
}

export function simplifyClosedLoop(
  points: number[],
  epsilon: number
): number[] {
  const openPoints = points.slice()
  openPoints.push(points[0], points[1])
  const simplified = simplifyOpenPolyline(openPoints, epsilon)
  simplified.splice(simplified.length - 2, 2)
  return removeCollinearLoopPoints(simplified)
}

export function simplifyOpenPolyline(
  points: number[],
  epsilon: number
): number[] {
  const pointCount = points.length / 2
  if (pointCount <= 2) {
    return points.slice()
  }
  const keep = new Uint8Array(pointCount)
  keep[0] = 1
  keep[pointCount - 1] = 1
  markDouglasPeucker(points, 0, pointCount - 1, epsilon, keep)
  const result: number[] = []
  for (let i = 0; i < pointCount; i++) {
    if (keep[i] !== 1) {
      continue
    }
    result.push(points[i * 2], points[i * 2 + 1])
  }
  return result
}

export function markDouglasPeucker(
  points: number[],
  startIndex: number,
  endIndex: number,
  epsilon: number,
  keep: Uint8Array
): void {
  if (endIndex - startIndex <= 1) {
    return
  }
  const startX = points[startIndex * 2]
  const startY = points[startIndex * 2 + 1]
  const endX = points[endIndex * 2]
  const endY = points[endIndex * 2 + 1]
  let maxDistance = 0
  let splitIndex = -1
  for (let i = startIndex + 1; i < endIndex; i++) {
    const x = points[i * 2]
    const y = points[i * 2 + 1]
    const distance = distanceToSegmentSquared(x, y, startX, startY, endX, endY)
    if (distance > maxDistance) {
      maxDistance = distance
      splitIndex = i
    }
  }
  if (splitIndex === -1 || maxDistance <= epsilon * epsilon) {
    return
  }
  keep[splitIndex] = 1
  markDouglasPeucker(points, startIndex, splitIndex, epsilon, keep)
  markDouglasPeucker(points, splitIndex, endIndex, epsilon, keep)
}

export function distanceToSegmentSquared(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number
): number {
  const dx = x2 - x1
  const dy = y2 - y1
  if (dx === 0 && dy === 0) {
    const rx = px - x1
    const ry = py - y1
    return rx * rx + ry * ry
  }
  const t = ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)
  const clamped = t < 0 ? 0 : t > 1 ? 1 : t
  const cx = x1 + dx * clamped
  const cy = y1 + dy * clamped
  const rx = px - cx
  const ry = py - cy
  return rx * rx + ry * ry
}

export function readAlphaBounds(
  ctx: CanvasRenderingContext2D,
  size: number
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  const imageData = ctx.getImageData(0, 0, size, size).data
  let minX = size
  let minY = size
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < size; y++) {
    const rowOffset = y * size
    for (let x = 0; x < size; x++) {
      if (imageData[(rowOffset + x) * 4 + 3] < MASK_ALPHA_THRESHOLD) {
        continue
      }
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y
    }
  }
  return maxX >= minX && maxY >= minY ? { minX, minY, maxX, maxY } : null
}
