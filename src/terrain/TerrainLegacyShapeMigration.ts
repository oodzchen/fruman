import type { MapPlacedShape } from '../editorMapTypes'
import {
  getDefaultShapeRenderLayer,
  normalizeRenderLayer,
} from '../renderLayers'
import { TerrainChunkGrid } from './TerrainChunkGrid'
import { getTerrainMaterialCodeById } from './TerrainMaterialRegistry'
import type {
  MapTerrainLayer,
  TerrainContourLike,
  TerrainMaterialId,
} from './TerrainTypes'
import {
  DEFAULT_TERRAIN_RANDOM_SEED,
  TERRAIN_CELL_SIZE_METERS,
  TERRAIN_CHUNK_SIZE,
} from './TerrainTypes'

const LEGACY_RECT_ROTATION_EPSILON = 0.0001
const LEGACY_CIRCLE_SEGMENT_COUNT = 16
const LEGACY_FILL_SAMPLE_COUNT = 5

export interface LegacyShapeTerrainMigrationResult {
  contours: TerrainContourLike[]
  layers: MapTerrainLayer[]
  contourIndexByShape: number[]
}

export function migrateLegacyShapesToTerrain(
  shapes: ReadonlyArray<MapPlacedShape>,
  pixelsPerMeter: number,
  startContourId: number,
  cellSize: number = TERRAIN_CELL_SIZE_METERS,
  chunkSize: number = TERRAIN_CHUNK_SIZE,
  randomSeed: number = DEFAULT_TERRAIN_RANDOM_SEED
): LegacyShapeTerrainMigrationResult {
  if (shapes.length === 0) {
    return {
      contours: [],
      layers: [],
      contourIndexByShape: [],
    }
  }
  const contours: TerrainContourLike[] = []
  const layers: MapTerrainLayer[] = []
  const contourIndexByShape = new Array<number>(shapes.length)
  contourIndexByShape.fill(-1)
  const cellSizePx = Math.max(1, Math.round(cellSize * pixelsPerMeter))
  for (let i = 0; i < shapes.length; i++) {
    const legacyShape = shapes[i]
    const contourId = startContourId + i
    const contour = buildLegacyContour(
      legacyShape,
      pixelsPerMeter,
      contourId,
      normalizeRenderLayer(
        legacyShape.renderLayer,
        getDefaultShapeRenderLayer()
      )
    )
    if (!contour) {
      continue
    }
    const layer = rasterizeContourLayer(
      contour,
      cellSizePx,
      chunkSize,
      randomSeed
    )
    if (!layer) {
      continue
    }
    contourIndexByShape[i] = contours.length
    contours.push(contour)
    layers.push(layer)
  }
  return { contours, layers, contourIndexByShape }
}

function buildLegacyContour(
  legacyShape: MapPlacedShape,
  pixelsPerMeter: number,
  contourId: number,
  renderLayer: number
): TerrainContourLike | null {
  const fillMaterialId = getLegacyShapeMaterialId(legacyShape)
  const points = buildLegacyContourPoints(legacyShape, pixelsPerMeter)
  if (points.length < 6) {
    return null
  }
  return {
    id: contourId,
    points,
    fillMaterialId,
    renderLayer,
    shapeKind: getLegacyShapeKind(legacyShape),
  }
}

function getLegacyShapeMaterialId(shape: MapPlacedShape): TerrainMaterialId {
  return shape.objectKind === 'obstacle' ? 'stone' : 'dirt'
}

function getLegacyShapeKind(
  shape: MapPlacedShape
): TerrainContourLike['shapeKind'] {
  if (shape.shape.kind === 'circle') {
    return 'circle'
  }
  if (
    shape.shape.kind === 'rect' &&
    Math.abs(shape.shape.rotationRad) <= LEGACY_RECT_ROTATION_EPSILON
  ) {
    return 'rect'
  }
  return undefined
}

function buildLegacyContourPoints(
  legacyShape: MapPlacedShape,
  pixelsPerMeter: number
): number[] {
  if (legacyShape.shape.kind === 'rect') {
    return buildRectContourPoints(legacyShape.shape, pixelsPerMeter)
  }
  if (legacyShape.shape.kind === 'circle') {
    return buildCircleContourPoints(legacyShape.shape, pixelsPerMeter)
  }
  return buildPolygonContourPoints(legacyShape.shape.points, pixelsPerMeter)
}

function buildRectContourPoints(
  shape: Extract<MapPlacedShape['shape'], { kind: 'rect' }>,
  pixelsPerMeter: number
): number[] {
  const centerX = Math.round(shape.center.x * pixelsPerMeter)
  const centerY = Math.round(shape.center.y * pixelsPerMeter)
  const halfWidth = Math.round(shape.halfWidth * pixelsPerMeter)
  const halfHeight = Math.round(shape.halfHeight * pixelsPerMeter)
  if (Math.abs(shape.rotationRad) <= LEGACY_RECT_ROTATION_EPSILON) {
    return [
      centerX - halfWidth,
      centerY - halfHeight,
      centerX + halfWidth,
      centerY - halfHeight,
      centerX + halfWidth,
      centerY + halfHeight,
      centerX - halfWidth,
      centerY + halfHeight,
    ]
  }
  const cos = Math.cos(shape.rotationRad)
  const sin = Math.sin(shape.rotationRad)
  const offsets: ReadonlyArray<readonly [number, number]> = [
    [-halfWidth, -halfHeight],
    [halfWidth, -halfHeight],
    [halfWidth, halfHeight],
    [-halfWidth, halfHeight],
  ]
  const points = new Array<number>(offsets.length * 2)
  for (let i = 0; i < offsets.length; i++) {
    const offset = offsets[i]
    const pointIndex = i * 2
    points[pointIndex] = centerX + Math.round(offset[0] * cos - offset[1] * sin)
    points[pointIndex + 1] =
      centerY + Math.round(offset[0] * sin + offset[1] * cos)
  }
  return points
}

function buildCircleContourPoints(
  shape: Extract<MapPlacedShape['shape'], { kind: 'circle' }>,
  pixelsPerMeter: number
): number[] {
  const centerX = Math.round(shape.center.x * pixelsPerMeter)
  const centerY = Math.round(shape.center.y * pixelsPerMeter)
  const radius = Math.max(1, Math.round(shape.radius * pixelsPerMeter))
  const points = new Array<number>(LEGACY_CIRCLE_SEGMENT_COUNT * 2)
  for (let i = 0; i < LEGACY_CIRCLE_SEGMENT_COUNT; i++) {
    const angle = (i * Math.PI * 2) / LEGACY_CIRCLE_SEGMENT_COUNT
    const pointIndex = i * 2
    points[pointIndex] = centerX + Math.round(Math.cos(angle) * radius)
    points[pointIndex + 1] = centerY + Math.round(Math.sin(angle) * radius)
  }
  return points
}

function buildPolygonContourPoints(
  pointsMeters: ReadonlyArray<number>,
  pixelsPerMeter: number
): number[] {
  const points = new Array<number>(pointsMeters.length)
  for (let i = 0; i < pointsMeters.length; i++) {
    points[i] = Math.round(pointsMeters[i] * pixelsPerMeter)
  }
  return points
}

function rasterizeContourLayer(
  contour: TerrainContourLike,
  cellSizePx: number,
  chunkSize: number,
  randomSeed: number
): MapTerrainLayer | null {
  const bounds = getContourBounds(contour.points)
  if (!bounds) {
    return null
  }
  const fillMaterialId = contour.fillMaterialId ?? 'dirt'
  const fillCode = getTerrainMaterialCodeById(fillMaterialId)
  const grid = new TerrainChunkGrid(chunkSize, randomSeed)
  const startCellX = Math.floor(bounds.minX / cellSizePx)
  const endCellX = Math.floor(bounds.maxX / cellSizePx)
  const startCellY = Math.floor(bounds.minY / cellSizePx)
  const endCellY = Math.floor(bounds.maxY / cellSizePx)
  for (let cellY = startCellY; cellY <= endCellY; cellY++) {
    for (let cellX = startCellX; cellX <= endCellX; cellX++) {
      if (!isContourCellFilled(contour.points, cellX, cellY, cellSizePx)) {
        continue
      }
      grid.setCellMaterialCode(cellX, cellY, fillCode)
    }
  }
  const chunks = grid.serializeChunks()
  if (chunks.length === 0) {
    return null
  }
  return {
    materialId: fillMaterialId,
    offsetCellX: 0,
    offsetCellY: 0,
    renderLayer: contour.renderLayer,
    contourId: contour.id,
    chunks,
  }
}

function isContourCellFilled(
  points: readonly number[],
  cellX: number,
  cellY: number,
  cellSizePx: number
): boolean {
  const baseX = cellX * cellSizePx
  const baseY = cellY * cellSizePx
  if (
    !pointInClosedContourScaled2(
      points,
      baseX * 2 + cellSizePx,
      baseY * 2 + cellSizePx
    )
  ) {
    return false
  }
  const totalSamples = LEGACY_FILL_SAMPLE_COUNT * LEGACY_FILL_SAMPLE_COUNT
  const requiredSamples = Math.floor(totalSamples / 2) + 1
  const remainingFailLimit = totalSamples - requiredSamples
  let insideSamples = 0
  for (let sampleY = 0; sampleY < LEGACY_FILL_SAMPLE_COUNT; sampleY++) {
    const samplePointY =
      baseY +
      Math.floor(
        ((sampleY * 2 + 1) * cellSizePx) / (LEGACY_FILL_SAMPLE_COUNT * 2)
      )
    for (let sampleX = 0; sampleX < LEGACY_FILL_SAMPLE_COUNT; sampleX++) {
      const samplePointX =
        baseX +
        Math.floor(
          ((sampleX * 2 + 1) * cellSizePx) / (LEGACY_FILL_SAMPLE_COUNT * 2)
        )
      if (
        pointInClosedContourScaled2(points, samplePointX * 2, samplePointY * 2)
      ) {
        insideSamples += 1
        if (insideSamples >= requiredSamples) {
          return true
        }
        continue
      }
      const outsideSamples =
        sampleY * LEGACY_FILL_SAMPLE_COUNT + sampleX + 1 - insideSamples
      if (outsideSamples > remainingFailLimit) {
        return false
      }
    }
  }
  return insideSamples >= requiredSamples
}

function getContourBounds(points: readonly number[]): {
  minX: number
  minY: number
  maxX: number
  maxY: number
} | null {
  if (points.length < 2) {
    return null
  }
  let minX = points[0]
  let minY = points[1]
  let maxX = minX
  let maxY = minY
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
  return { minX, minY, maxX, maxY }
}

function pointInClosedContourScaled2(
  points: readonly number[],
  pointScaledX2: number,
  pointScaledY2: number
): boolean {
  const pointCount = points.length / 2
  if (pointCount < 3) {
    return false
  }
  let inside = false
  let previousX2 = points[points.length - 2] * 2
  let previousY2 = points[points.length - 1] * 2
  for (let i = 0; i < points.length; i += 2) {
    const currentX2 = points[i] * 2
    const currentY2 = points[i + 1] * 2
    const deltaY2 = previousY2 - currentY2
    const intersectsVertical =
      currentY2 > pointScaledY2 !== previousY2 > pointScaledY2
    let intersects = false
    if (intersectsVertical && deltaY2 !== 0) {
      const lhs = (pointScaledX2 - currentX2) * deltaY2
      const rhs = (previousX2 - currentX2) * (pointScaledY2 - currentY2)
      intersects = deltaY2 > 0 ? lhs < rhs : lhs > rhs
    }
    if (intersects) {
      inside = !inside
    }
    previousX2 = currentX2
    previousY2 = currentY2
  }
  return inside
}
