import type {
  MainModule as ClipperModule,
  PathD,
  PathsD,
} from 'clipper2-wasm/dist/clipper2z'
import Clipper2ZFactory from 'clipper2-wasm/dist/es/clipper2z.js'

export interface FlatPolygonBounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export type FlatMultiPolygon = number[][]

const CLIPPER_DECIMAL_PRECISION = 4
const FLAT_POLYGON_AREA_EPSILON = 0.000001

let clipperModule: ClipperModule | null = null
let clipperModulePromise: Promise<ClipperModule> | null = null

export async function initializeTerrainPolygonUtils(): Promise<void> {
  if (clipperModule) {
    return
  }
  if (!clipperModulePromise) {
    clipperModulePromise = Clipper2ZFactory()
  }
  clipperModule = await clipperModulePromise
}

export function computeFlatPolygonBounds(
  points: readonly number[]
): FlatPolygonBounds | null {
  if (points.length < 6) {
    return null
  }
  let minX = points[0]
  let minY = points[1]
  let maxX = minX
  let maxY = minY
  for (let i = 2; i < points.length; i += 2) {
    const x = points[i]
    const y = points[i + 1]
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  return { minX, minY, maxX, maxY }
}

export function intersectFlatPolygon(
  subject: readonly number[],
  clip: readonly number[]
): number[][] {
  if (subject.length < 6 || clip.length < 6) {
    return []
  }
  try {
    return executeClipperBoolean([subject], [clip], requireClipper().IntersectD)
  } catch {
    return subject.length >= 6 ? [subject.slice()] : []
  }
}

export function unionFlatPolygons(
  polygons: ReadonlyArray<readonly number[]>
): FlatMultiPolygon {
  if (polygons.length === 0) {
    return []
  }
  try {
    return executeClipperUnion(polygons)
  } catch {
    const fallback: FlatMultiPolygon = new Array<number[]>(polygons.length)
    for (let i = 0; i < polygons.length; i++) {
      fallback[i] = polygons[i].slice()
    }
    return fallback
  }
}

export function intersectMultiPolygonWithFlatPolygon(
  subject: FlatMultiPolygon,
  clip: readonly number[]
): FlatMultiPolygon {
  if (subject.length === 0 || clip.length < 6) {
    return []
  }
  try {
    return executeClipperBoolean(subject, [clip], requireClipper().IntersectD)
  } catch {
    const fallback: FlatMultiPolygon = new Array<number[]>(subject.length)
    for (let i = 0; i < subject.length; i++) {
      fallback[i] = subject[i].slice()
    }
    return fallback
  }
}

export function multiPolygonToFlatPolygons(
  multiPolygon: FlatMultiPolygon
): number[][] {
  if (!multiPolygon || multiPolygon.length === 0) {
    return []
  }
  const polygons: number[][] = []
  for (
    let polygonIndex = 0;
    polygonIndex < multiPolygon.length;
    polygonIndex++
  ) {
    const flat = multiPolygon[polygonIndex]
    if (
      !flat ||
      flat.length < 6 ||
      Math.abs(computeFlatPolygonSignedArea(flat)) <= FLAT_POLYGON_AREA_EPSILON
    ) {
      continue
    }
    polygons.push(flat.slice())
  }
  return polygons
}

function requireClipper(): ClipperModule {
  if (!clipperModule) {
    throw new Error('Terrain polygon utils not initialized')
  }
  return clipperModule
}

function executeClipperUnion(
  polygons: ReadonlyArray<readonly number[]>
): FlatMultiPolygon {
  const module = requireClipper()
  const subjectPaths = createPathsD(module, polygons)
  try {
    const resultPaths = module.UnionSelfD(
      subjectPaths,
      module.FillRule.EvenOdd,
      CLIPPER_DECIMAL_PRECISION
    )
    try {
      return readPathsD(resultPaths)
    } finally {
      resultPaths.delete()
    }
  } finally {
    subjectPaths.delete()
  }
}

function executeClipperBoolean(
  subject: ReadonlyArray<readonly number[]>,
  clip: ReadonlyArray<readonly number[]>,
  operation: (
    subjectPaths: PathsD,
    clipPaths: PathsD,
    fillRule: ClipperModule['FillRule']['EvenOdd'],
    precision: number
  ) => PathsD
): FlatMultiPolygon {
  const module = requireClipper()
  const subjectPaths = createPathsD(module, subject)
  const clipPaths = createPathsD(module, clip)
  try {
    const resultPaths = operation(
      subjectPaths,
      clipPaths,
      module.FillRule.EvenOdd,
      CLIPPER_DECIMAL_PRECISION
    )
    try {
      return readPathsD(resultPaths)
    } finally {
      resultPaths.delete()
    }
  } finally {
    clipPaths.delete()
    subjectPaths.delete()
  }
}

function createPathsD(
  module: ClipperModule,
  polygons: ReadonlyArray<readonly number[]>
): PathsD {
  const paths = new module.PathsD()
  for (let i = 0; i < polygons.length; i++) {
    const points = polygons[i]
    if (points.length < 6) {
      continue
    }
    const path = module.MakePathD(closeFlatPath(points))
    paths.push_back(path)
    path.delete()
  }
  return paths
}

function readPathsD(paths: PathsD): FlatMultiPolygon {
  const polygons: FlatMultiPolygon = []
  const pathCount = paths.size()
  for (let pathIndex = 0; pathIndex < pathCount; pathIndex++) {
    const path = paths.get(pathIndex)
    try {
      const flat = readPathD(path)
      if (
        flat.length >= 6 &&
        Math.abs(computeFlatPolygonSignedArea(flat)) > FLAT_POLYGON_AREA_EPSILON
      ) {
        polygons.push(flat)
      }
    } finally {
      path.delete()
    }
  }
  return polygons
}

function readPathD(path: PathD): number[] {
  let pointCount = path.size()
  if (pointCount <= 0) {
    return []
  }
  let closesPath = false
  if (pointCount > 1) {
    const firstPoint = path.get(0)
    const lastPoint = path.get(pointCount - 1)
    closesPath = firstPoint.x === lastPoint.x && firstPoint.y === lastPoint.y
    firstPoint.delete()
    lastPoint.delete()
  }
  if (closesPath) {
    pointCount -= 1
  }
  const flat = new Array<number>(pointCount * 2)
  for (let pointIndex = 0; pointIndex < pointCount; pointIndex++) {
    const point = path.get(pointIndex)
    try {
      const offset = pointIndex * 2
      flat[offset] = point.x
      flat[offset + 1] = point.y
    } finally {
      point.delete()
    }
  }
  return flat
}

function closeFlatPath(points: readonly number[]): number[] {
  const closed = new Array<number>(points.length + 2)
  for (let i = 0; i < points.length; i++) {
    closed[i] = points[i]
  }
  closed[points.length] = points[0]
  closed[points.length + 1] = points[1]
  return closed
}

function computeFlatPolygonSignedArea(points: readonly number[]): number {
  if (points.length < 6) {
    return 0
  }
  let area = 0
  let prevX = points[points.length - 2]
  let prevY = points[points.length - 1]
  for (let i = 0; i < points.length; i += 2) {
    const x = points[i]
    const y = points[i + 1]
    area += prevX * y - x * prevY
    prevX = x
    prevY = y
  }
  return area * 0.5
}
