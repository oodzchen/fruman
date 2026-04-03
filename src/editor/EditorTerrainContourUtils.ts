export interface TerrainContourBounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
  width: number
  height: number
}

export interface TerrainContourEdgeProjection {
  insertAfterIndex: number
  x: number
  y: number
}

interface TerrainEdgeProjectionInternal {
  x: number
  y: number
  distanceSq: number
  factorScaled: number
}

export function getContourBounds(
  points: readonly number[]
): TerrainContourBounds | null {
  if (points.length < 2) {
    return null
  }
  let minX = points[0]
  let maxX = points[0]
  let minY = points[1]
  let maxY = points[1]
  for (let i = 2; i < points.length; i += 2) {
    const pointX = points[i]
    const pointY = points[i + 1]
    if (pointX < minX) {
      minX = pointX
    }
    if (pointX > maxX) {
      maxX = pointX
    }
    if (pointY < minY) {
      minY = pointY
    }
    if (pointY > maxY) {
      maxY = pointY
    }
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

export function getNearestContourPointIndex(
  points: readonly number[],
  pointX: number,
  pointY: number,
  maxDistanceSq: number
): number {
  let bestIndex = -1
  let bestDistanceSq = maxDistanceSq
  for (let i = 0; i < points.length; i += 2) {
    const dx = pointX - points[i]
    const dy = pointY - points[i + 1]
    const distanceSq = dx * dx + dy * dy
    if (distanceSq > bestDistanceSq) {
      continue
    }
    bestDistanceSq = distanceSq
    bestIndex = i / 2
  }
  return bestIndex
}

export function getNearestContourEdge(
  points: readonly number[],
  pointX: number,
  pointY: number,
  maxDistanceSq: number
): TerrainContourEdgeProjection | null {
  const pointCount = points.length / 2
  if (pointCount < 2) {
    return null
  }
  let bestInsertAfterIndex = -1
  let bestDistanceSq = maxDistanceSq
  let bestX = 0
  let bestY = 0
  for (let i = 0; i < pointCount; i++) {
    const nextIndex = (i + 1) % pointCount
    const currentOffset = i * 2
    const nextOffset = nextIndex * 2
    const projection = getEdgeProjection(
      pointX,
      pointY,
      points[currentOffset],
      points[currentOffset + 1],
      points[nextOffset],
      points[nextOffset + 1]
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

export function getContourHitDistanceSq(
  viewportScale: number,
  baseDistanceSq: number
): number {
  const baseDistance = Math.max(1, Math.round(Math.sqrt(baseDistanceSq)))
  const scaledDistance = Math.max(2, Math.round(baseDistance / viewportScale))
  return scaledDistance * scaledDistance
}

export function pointInClosedContourScaled2(
  points: readonly number[],
  pointScaledX2: number,
  pointScaledY2: number
): boolean {
  const pointCount = points.length / 2
  if (pointCount < 3) {
    return false
  }
  let inside = false
  let prevX2 = points[points.length - 2] * 2
  let prevY2 = points[points.length - 1] * 2
  for (let i = 0; i < points.length; i += 2) {
    const currentX2 = points[i] * 2
    const currentY2 = points[i + 1] * 2
    const deltaY2 = prevY2 - currentY2
    const intersectsVertical =
      currentY2 > pointScaledY2 !== prevY2 > pointScaledY2
    let intersects = false
    if (intersectsVertical && deltaY2 !== 0) {
      const lhs = (pointScaledX2 - currentX2) * deltaY2
      const rhs = (prevX2 - currentX2) * (pointScaledY2 - currentY2)
      intersects = deltaY2 > 0 ? lhs < rhs : lhs > rhs
    }
    if (intersects) {
      inside = !inside
    }
    prevX2 = currentX2
    prevY2 = currentY2
  }
  return inside
}

export function extractFilledCellLoops(
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
      return
    }
    edges.set(key, [nextKey])
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

export function pickLargestContourLoop(
  loops: readonly number[][]
): number[] | null {
  let best: number[] | null = null
  let bestArea = 0
  for (let i = 0; i < loops.length; i++) {
    const area = Math.abs(computeContourArea(loops[i]))
    if (area <= bestArea) {
      continue
    }
    bestArea = area
    best = loops[i]
  }
  return best
}

export function simplifyContourLoop(points: readonly number[]): number[] {
  const pointCount = points.length / 2
  if (pointCount < 3) {
    return points.slice()
  }
  const simplified: number[] = []
  for (let i = 0; i < pointCount; i++) {
    const prevIndex = ((i + pointCount - 1) % pointCount) * 2
    const currentIndex = i * 2
    const nextIndex = ((i + 1) % pointCount) * 2
    const prevX = points[prevIndex]
    const prevY = points[prevIndex + 1]
    const currentX = points[currentIndex]
    const currentY = points[currentIndex + 1]
    const nextX = points[nextIndex]
    const nextY = points[nextIndex + 1]
    if (currentX === prevX && currentY === prevY) {
      continue
    }
    const prevDx = currentX - prevX
    const prevDy = currentY - prevY
    const nextDx = nextX - currentX
    const nextDy = nextY - currentY
    if (
      ((prevDx === 0 && nextDx === 0) || (prevDy === 0 && nextDy === 0)) &&
      !(prevDx === 0 && prevDy === 0) &&
      !(nextDx === 0 && nextDy === 0)
    ) {
      continue
    }
    simplified.push(currentX, currentY)
  }
  return simplified.length >= 6 ? simplified : points.slice()
}

function getEdgeProjection(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
): TerrainEdgeProjectionInternal {
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

function computeContourArea(points: readonly number[]): number {
  let area = 0
  const count = points.length / 2
  for (let i = 0; i < count; i++) {
    const currentIndex = i * 2
    const nextIndex = ((i + 1) % count) * 2
    area +=
      points[currentIndex] * points[nextIndex + 1] -
      points[nextIndex] * points[currentIndex + 1]
  }
  return area
}
