import {
  decomp,
  isSimple,
  makeCCW,
  quickDecomp,
  removeCollinearPoints,
  removeDuplicatePoints,
} from 'poly-decomp-es'

import { buildCharacterBodyLocalPoints } from './characterBodyProfile'
import type { MapCharacterBodyProfile } from './editorMapTypes'

type DecompPoint = [number, number]
type DecompPolygon = DecompPoint[]

const DECOMP_POINT_EPSILON = 0.0001
const BOX2D_MAX_POLYGON_VERTICES = 8

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

export function buildCharacterBodyCollisionPolygons(
  profile: MapCharacterBodyProfile | null | undefined,
  radius: number,
  bodyHeight: number
): number[][] | null {
  const localPoints = buildCharacterBodyLocalPoints(profile, radius, bodyHeight)
  if (!localPoints || localPoints.length < 6) {
    return null
  }
  return decomposeCharacterBodyLocalPoints(localPoints)
}
