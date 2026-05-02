import {
  decomp,
  isSimple,
  makeCCW,
  quickDecomp,
  removeCollinearPoints,
  removeDuplicatePoints,
} from 'poly-decomp-es'

import type { MainModule, b2BodyId, b2ShapeId } from '../types'

const BOX2D_MAX_POLYGON_VERTICES = 8
const DECOMP_POINT_EPSILON = 0.0001
const DECOMP_TRIANGLE_AREA_EPSILON = 0.000001

export type DecompPoint = [number, number]
export type DecompPolygon = DecompPoint[]

export interface DecompScratch {
  pointPool: DecompPoint[]
  polygon: DecompPolygon
}

export function createDecompScratch(): DecompScratch {
  return {
    pointPool: [],
    polygon: [],
  }
}

function acquireDecompPoint(
  scratch: DecompScratch,
  x: number,
  y: number
): DecompPoint {
  const point = scratch.pointPool.pop() ?? [0, 0]
  point[0] = x
  point[1] = y
  return point
}

export function resetDecompScratchPolygon(scratch: DecompScratch): void {
  const polygon = scratch.polygon
  for (let i = 0; i < polygon.length; i++) {
    scratch.pointPool.push(polygon[i])
  }
  polygon.length = 0
}

export function fillDecompScratchPolygon(
  scratch: DecompScratch,
  points: readonly number[],
  centerX: number,
  centerY: number
): DecompPolygon {
  resetDecompScratchPolygon(scratch)
  const polygon = scratch.polygon
  for (let i = 0; i < points.length; i += 2) {
    polygon.push(
      acquireDecompPoint(scratch, points[i] - centerX, points[i + 1] - centerY)
    )
  }
  removeDuplicatePoints(polygon, DECOMP_POINT_EPSILON)
  removeCollinearPoints(polygon, DECOMP_POINT_EPSILON)
  return polygon
}

export function decomposeStaticTerrainPolygon(
  polygon: DecompPolygon,
  preferExactDecomp: boolean
): DecompPolygon[] | null {
  if (!isSimple(polygon)) {
    return null
  }
  makeCCW(polygon)
  const primary = preferExactDecomp
    ? runExactDecomp(polygon)
    : runQuickDecomp(polygon)
  if (primary && primary.length > 0) {
    return primary
  }
  const secondary = preferExactDecomp
    ? runQuickDecomp(polygon)
    : runExactDecomp(polygon)
  if (secondary && secondary.length > 0) {
    return secondary
  }
  return triangulateSimplePolygon(polygon)
}

function runQuickDecomp(polygon: DecompPolygon): DecompPolygon[] | null {
  const convexPolygons = quickDecomp(polygon)
  return convexPolygons && convexPolygons.length > 0 ? convexPolygons : null
}

function runExactDecomp(polygon: DecompPolygon): DecompPolygon[] | null {
  const convexPolygons = decomp(polygon)
  return convexPolygons !== false && convexPolygons.length > 0
    ? convexPolygons
    : null
}

function triangulateSimplePolygon(
  polygon: DecompPolygon
): DecompPolygon[] | null {
  if (polygon.length < 3) {
    return null
  }
  if (polygon.length === 3) {
    return [polygon]
  }
  const remaining = new Array<number>(polygon.length)
  for (let i = 0; i < polygon.length; i++) {
    remaining[i] = i
  }
  const triangles: DecompPolygon[] = []
  let remainingCount = remaining.length
  let guard = remainingCount * remainingCount
  while (remainingCount > 3 && guard > 0) {
    let earFound = false
    for (let i = 0; i < remainingCount; i++) {
      const previousIndex = remaining[(i + remainingCount - 1) % remainingCount]
      const currentIndex = remaining[i]
      const nextIndex = remaining[(i + 1) % remainingCount]
      if (
        !isEarTriangle(
          polygon,
          remaining,
          remainingCount,
          previousIndex,
          currentIndex,
          nextIndex
        )
      ) {
        continue
      }
      triangles.push([
        polygon[previousIndex],
        polygon[currentIndex],
        polygon[nextIndex],
      ])
      remaining.splice(i, 1)
      remainingCount -= 1
      earFound = true
      break
    }
    if (!earFound) {
      return null
    }
    guard -= 1
  }
  if (remainingCount === 3) {
    triangles.push([
      polygon[remaining[0]],
      polygon[remaining[1]],
      polygon[remaining[2]],
    ])
  }
  return triangles.length > 0 ? triangles : null
}

function isEarTriangle(
  polygon: DecompPolygon,
  remaining: readonly number[],
  remainingCount: number,
  previousIndex: number,
  currentIndex: number,
  nextIndex: number
): boolean {
  const previousPoint = polygon[previousIndex]
  const currentPoint = polygon[currentIndex]
  const nextPoint = polygon[nextIndex]
  if (
    computeSignedTriangleArea(
      previousPoint[0],
      previousPoint[1],
      currentPoint[0],
      currentPoint[1],
      nextPoint[0],
      nextPoint[1]
    ) <= DECOMP_TRIANGLE_AREA_EPSILON
  ) {
    return false
  }
  for (let i = 0; i < remainingCount; i++) {
    const testIndex = remaining[i]
    if (
      testIndex === previousIndex ||
      testIndex === currentIndex ||
      testIndex === nextIndex
    ) {
      continue
    }
    const testPoint = polygon[testIndex]
    if (
      isPointInsideTriangle(
        testPoint[0],
        testPoint[1],
        previousPoint[0],
        previousPoint[1],
        currentPoint[0],
        currentPoint[1],
        nextPoint[0],
        nextPoint[1]
      )
    ) {
      return false
    }
  }
  return true
}

function isPointInsideTriangle(
  pointX: number,
  pointY: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number
): boolean {
  const ab = computeSignedTriangleArea(ax, ay, bx, by, pointX, pointY)
  const bc = computeSignedTriangleArea(bx, by, cx, cy, pointX, pointY)
  const ca = computeSignedTriangleArea(cx, cy, ax, ay, pointX, pointY)
  return (
    ab >= -DECOMP_TRIANGLE_AREA_EPSILON &&
    bc >= -DECOMP_TRIANGLE_AREA_EPSILON &&
    ca >= -DECOMP_TRIANGLE_AREA_EPSILON
  )
}

function computeSignedTriangleArea(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number
): number {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)
}

export function appendConvexPolygonBodyShapes(
  box2dModule: MainModule,
  bodyId: b2BodyId,
  shapeDef: ReturnType<MainModule['b2DefaultShapeDef']>,
  convexPolygon: DecompPolygon,
  outShapeIds: b2ShapeId[]
): void {
  if (convexPolygon.length < 3) {
    return
  }
  if (convexPolygon.length <= BOX2D_MAX_POLYGON_VERTICES) {
    appendPolygonBodyShape(
      box2dModule,
      bodyId,
      shapeDef,
      convexPolygon,
      outShapeIds
    )
    return
  }
  const pointCount = convexPolygon.length
  let startIndex = 1
  while (startIndex < pointCount - 1) {
    const endIndex = Math.min(
      pointCount - 1,
      startIndex + BOX2D_MAX_POLYGON_VERTICES - 2
    )
    const splitPolygon: DecompPolygon = [convexPolygon[0]]
    for (let i = startIndex; i <= endIndex; i++) {
      splitPolygon.push(convexPolygon[i])
    }
    appendPolygonBodyShape(
      box2dModule,
      bodyId,
      shapeDef,
      splitPolygon,
      outShapeIds
    )
    startIndex = endIndex
  }
}

function appendPolygonBodyShape(
  box2dModule: MainModule,
  bodyId: b2BodyId,
  shapeDef: ReturnType<MainModule['b2DefaultShapeDef']>,
  polygonPoints: DecompPolygon,
  outShapeIds: b2ShapeId[]
): void {
  if (polygonPoints.length < 3) {
    return
  }
  const { b2CreatePolygonShape, b2ComputeHull, b2MakePolygon, b2Vec2 } =
    box2dModule
  const localPoints: InstanceType<MainModule['b2Vec2']>[] = []
  for (let i = 0; i < polygonPoints.length; i++) {
    localPoints.push(new b2Vec2(polygonPoints[i][0], polygonPoints[i][1]))
  }
  const hull = b2ComputeHull(localPoints)
  const polygon = b2MakePolygon(hull, 0)
  outShapeIds.push(b2CreatePolygonShape(bodyId, shapeDef, polygon))
  hull.delete()
  polygon.delete()
  for (let i = 0; i < localPoints.length; i++) {
    localPoints[i].delete()
  }
}
