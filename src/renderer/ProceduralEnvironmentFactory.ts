import type { MapEnvironmentObjectType } from '../editorMapTypes'
import { createDefaultTerrainChunkSiteJitter } from '../terrain/TerrainDataUtils'
import type { TerrainResolvedLayerView } from '../terrain/TerrainDataUtils'
import { getTerrainMaterialCodeById } from '../terrain/TerrainMaterialRegistry'
import type { VoronoiLayerBuildOptions } from '../terrain/VoronoiBuilder'
import {
  createNaturalMaterialStyle,
  createTrapezoidContourPoints,
  drawVoronoiLayer,
} from './CheckpointTreeTextureFactory'

const STANDALONE_VORONOI_OPTS: VoronoiLayerBuildOptions = {
  expandNeighbors: false,
}

const WOOD_CODE = getTerrainMaterialCodeById('wood')
const LEAVES_CODE = getTerrainMaterialCodeById('leaves')
const STONE_CODE = getTerrainMaterialCodeById('stone')
const GRASS_CODE = getTerrainMaterialCodeById('grass')
const THATCH_CODE = getTerrainMaterialCodeById('thatch')

const ENV_SEED_MIX = 0x9e3779b9 | 0

const ENV_TREE_VORONOI_SEED = 38291
const ENV_HILL_VORONOI_SEED = 52847
const ENV_HOUSE_VORONOI_SEED = 71503

type EnvironmentTreeCrownShape = 0 | 1 | 2

const ENV_TREE_CROWN_UNIT_X = [
  0, 38, 71, 92, 100, 92, 71, 38, 0, -38, -71, -92, -100, -92, -71, -38,
] as const
const ENV_TREE_CROWN_UNIT_Y = [
  -100, -92, -71, -38, 0, 38, 71, 92, 100, 92, 71, 38, 0, -38, -71, -92,
] as const
const ENV_TREE_TRIANGLE_SIDE_Y = [
  -100, -82, -62, -38, -8, 24, 54, 82, 100,
] as const
const ENV_TREE_TRIANGLE_SIDE_WIDTH = [
  0, 18, 32, 48, 66, 84, 96, 100, 70,
] as const

export interface EnvironmentTextureSource {
  canvas: HTMLCanvasElement
  originX: number
  originY: number
}

function lcgStep(seed: number): number {
  return (Math.imul(seed, 1664525) + 1013904223) | 0
}

function lcgRange(seed: number, min: number, max: number): number {
  const range = max - min + 1
  return min + ((seed >>> 0) % range)
}

function buildLayer(
  canvas: HTMLCanvasElement,
  cellSize: number,
  materialCode: number,
  contourPoints: number[],
  voronoiSeed: number,
  buildRevision: number
): TerrainResolvedLayerView {
  const chunkSize = Math.max(
    1,
    Math.ceil(Math.max(canvas.width, canvas.height) / cellSize)
  )
  const cellCount = chunkSize * chunkSize
  const cells = new Uint8Array(cellCount)
  cells.fill(materialCode)
  return {
    version: 4,
    cellSize,
    chunkSize,
    randomSeed: voronoiSeed,
    chunks: [
      {
        chunkX: 0,
        chunkY: 0,
        cells,
        materialCodes: cells,
        siteJitter: createDefaultTerrainChunkSiteJitter(
          0,
          0,
          chunkSize,
          voronoiSeed
        ),
      },
    ],
    offsetCellX: 0,
    offsetCellY: 0,
    offsetXUnits: 0,
    offsetYUnits: 0,
    renderLayer: 0,
    contourClipPoints: contourPoints,
    contourBuildRevision: buildRevision,
    buildRevision,
  }
}

// ===== TREE =====

export function createEnvironmentTreeTextureSource(
  seed: number,
  ppm: number
): EnvironmentTextureSource {
  let s = lcgStep(seed ^ ENV_SEED_MIX)
  const crownShape = lcgRange(s, 0, 2) as EnvironmentTreeCrownShape
  s = lcgStep(s)
  const crownHalfWidthNum =
    crownShape === 0
      ? lcgRange(s, 90, 130)
      : crownShape === 1
        ? lcgRange(s, 110, 165)
        : lcgRange(s, 95, 140)
  s = lcgStep(s)
  const crownHalfHeightNum =
    crownShape === 0
      ? lcgRange(s, 85, 125)
      : crownShape === 1
        ? lcgRange(s, 70, 105)
        : lcgRange(s, 120, 180)
  s = lcgStep(s)
  const crownCenterYNum =
    crownShape === 2 ? lcgRange(s, 90, 120) : lcgRange(s, 65, 95)
  s = lcgStep(s)
  const crownCenterXNum = lcgRange(s, -12, 12)
  s = lcgStep(s)
  const trunkHeightNum = lcgRange(s, 140, 240)
  s = lcgStep(s)
  const trunkWidthNum = lcgRange(s, 55, 95)

  const baseRadius = Math.max(16, Math.round((ppm * 120) / 100))
  const leafHalfWidth = Math.max(
    18,
    Math.round((baseRadius * crownHalfWidthNum) / 100)
  )
  const leafHalfHeight = Math.max(
    18,
    Math.round((baseRadius * crownHalfHeightNum) / 100)
  )
  const leafCenterX = roundDiv(baseRadius * crownCenterXNum, 100)
  const leafCenterY = -Math.round((baseRadius * crownCenterYNum) / 100)
  const trunkTopY = 0
  const trunkBottomY = Math.round((ppm * trunkHeightNum) / 100)
  const trunkTopHalfWidth = Math.max(
    4,
    Math.round(((ppm * trunkWidthNum) / 100) >> 2)
  )
  const trunkBottomHalfWidth = Math.max(
    trunkTopHalfWidth + 2,
    Math.round((trunkTopHalfWidth * 14) / 10)
  )

  const leafContour = createEnvironmentTreeLeafContourPoints(
    crownShape,
    leafCenterX,
    leafCenterY,
    leafHalfWidth,
    leafHalfHeight,
    s
  )
  const trunkContour = createTrapezoidContourPoints(
    0,
    trunkTopY,
    trunkBottomY,
    trunkTopHalfWidth,
    trunkBottomHalfWidth
  )
  const leafBounds = getContourBounds(leafContour)
  const trunkBounds = getContourBounds(trunkContour)
  const padding = 8
  const localMinX = Math.min(leafBounds.minX, trunkBounds.minX)
  const localMaxX = Math.max(leafBounds.maxX, trunkBounds.maxX)
  const localMinY = Math.min(leafBounds.minY, trunkBounds.minY)
  const localMaxY = Math.max(leafBounds.maxY, trunkBounds.maxY)
  const contentWidth = localMaxX - localMinX
  const contentHeight = localMaxY - localMinY
  const canvasSide = Math.max(contentWidth, contentHeight) + padding * 2

  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, canvasSide)
  canvas.height = Math.max(1, canvasSide)
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    return {
      canvas,
      originX: canvas.width >> 1,
      originY: canvas.height - padding,
    }
  }

  const originX = Math.round((canvas.width - contentWidth) / 2 - localMinX)
  const originY = padding - localMinY
  const cellSize = Math.max(16, Math.round(baseRadius / 2))
  offsetContourPoints(leafContour, originX, originY)
  offsetContourPoints(trunkContour, originX, originY)

  const trunkLayer = buildLayer(
    canvas,
    cellSize,
    WOOD_CODE,
    trunkContour,
    ENV_TREE_VORONOI_SEED,
    1
  )
  const leafLayer = buildLayer(
    canvas,
    cellSize,
    LEAVES_CODE,
    leafContour,
    ENV_TREE_VORONOI_SEED,
    2
  )

  drawVoronoiLayer(
    ctx,
    trunkLayer,
    cellSize,
    createNaturalMaterialStyle(WOOD_CODE),
    WOOD_CODE,
    STANDALONE_VORONOI_OPTS
  )
  drawVoronoiLayer(
    ctx,
    leafLayer,
    cellSize,
    createNaturalMaterialStyle(LEAVES_CODE),
    LEAVES_CODE,
    STANDALONE_VORONOI_OPTS
  )

  return { canvas, originX, originY: originY + trunkBottomY }
}

// ===== HILL =====

export function createEnvironmentHillTextureSource(
  seed: number,
  ppm: number
): EnvironmentTextureSource {
  let s = lcgStep(seed ^ ENV_SEED_MIX)
  const halfWidthNum = lcgRange(s, 150, 300)
  s = lcgStep(s)
  const heightNum = lcgRange(s, 80, 160)
  s = lcgStep(s)
  const peakOffsetNum = lcgRange(s, -20, 20)

  const halfWidth = Math.round((ppm * halfWidthNum) / 100)
  const height = Math.round((ppm * heightNum) / 100)
  const peakOffsetX = Math.round((halfWidth * peakOffsetNum) / 100)

  const padding = 8
  const canvasW = halfWidth * 2 + Math.abs(peakOffsetX) * 2 + padding * 2
  const canvasH = height + padding * 2

  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, canvasW)
  canvas.height = Math.max(1, canvasH)
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    return {
      canvas,
      originX: canvas.width >> 1,
      originY: canvas.height - padding,
    }
  }

  const centerX = canvas.width >> 1
  const bottomY = canvas.height - padding
  const cellSize = Math.max(16, Math.round(halfWidth / 4))

  const outerContour = createHillContourPoints(
    centerX,
    bottomY,
    halfWidth,
    height,
    peakOffsetX
  )
  const innerContour = createHillContourPoints(
    centerX,
    bottomY,
    Math.round((halfWidth * 80) / 100),
    Math.round((height * 85) / 100),
    peakOffsetX
  )

  const grassLayer = buildLayer(
    canvas,
    cellSize,
    GRASS_CODE,
    outerContour,
    ENV_HILL_VORONOI_SEED,
    1
  )
  const stoneLayer = buildLayer(
    canvas,
    cellSize,
    STONE_CODE,
    innerContour,
    ENV_HILL_VORONOI_SEED,
    2
  )

  drawVoronoiLayer(
    ctx,
    grassLayer,
    cellSize,
    createNaturalMaterialStyle(GRASS_CODE),
    GRASS_CODE,
    STANDALONE_VORONOI_OPTS
  )
  drawVoronoiLayer(
    ctx,
    stoneLayer,
    cellSize,
    createNaturalMaterialStyle(STONE_CODE),
    STONE_CODE,
    STANDALONE_VORONOI_OPTS
  )

  return { canvas, originX: centerX, originY: bottomY }
}

// ===== HOUSE =====

export function createEnvironmentHouseTextureSource(
  seed: number,
  ppm: number
): EnvironmentTextureSource {
  let s = lcgStep(seed ^ ENV_SEED_MIX)
  const wallWidthNum = lcgRange(s, 100, 180)
  s = lcgStep(s)
  const wallHeightNum = lcgRange(s, 80, 140)
  s = lcgStep(s)
  const roofPitchNum = lcgRange(s, 60, 130)
  s = lcgStep(s)
  const hasWindow = (s & 1) === 1

  const wallHalfWidth = Math.round((ppm * wallWidthNum) / 100)
  const wallHeight = Math.round((ppm * wallHeightNum) / 100)
  const roofHeight = Math.round((wallHalfWidth * 2 * roofPitchNum) / 100)
  const roofOverhang = Math.round((wallHalfWidth * 12) / 100)

  const padding = 12
  const canvasW = wallHalfWidth * 2 + roofOverhang * 2 + padding * 2
  const canvasH = wallHeight + roofHeight + padding * 2

  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, canvasW)
  canvas.height = Math.max(1, canvasH)
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    return {
      canvas,
      originX: canvas.width >> 1,
      originY: canvas.height - padding,
    }
  }

  const ox = canvas.width >> 1
  const oy = canvas.height - padding

  const wallContour = [
    ox - wallHalfWidth,
    oy - wallHeight,
    ox + wallHalfWidth,
    oy - wallHeight,
    ox + wallHalfWidth,
    oy,
    ox - wallHalfWidth,
    oy,
  ]
  const roofContour = [
    ox - wallHalfWidth - roofOverhang,
    oy - wallHeight,
    ox,
    oy - wallHeight - roofHeight,
    ox + wallHalfWidth + roofOverhang,
    oy - wallHeight,
  ]

  const cellSize = Math.max(16, Math.round(wallHalfWidth >> 1))

  const wallLayer = buildLayer(
    canvas,
    cellSize,
    WOOD_CODE,
    wallContour,
    ENV_HOUSE_VORONOI_SEED,
    1
  )
  const roofLayer = buildLayer(
    canvas,
    cellSize,
    THATCH_CODE,
    roofContour,
    ENV_HOUSE_VORONOI_SEED,
    2
  )

  drawVoronoiLayer(
    ctx,
    wallLayer,
    cellSize,
    createNaturalMaterialStyle(WOOD_CODE),
    WOOD_CODE,
    STANDALONE_VORONOI_OPTS
  )
  drawVoronoiLayer(
    ctx,
    roofLayer,
    cellSize,
    createNaturalMaterialStyle(THATCH_CODE),
    THATCH_CODE,
    STANDALONE_VORONOI_OPTS
  )

  const doorW = Math.max(4, Math.round((wallHalfWidth * 35) / 100))
  const doorH = Math.max(6, Math.round((wallHeight * 55) / 100))
  ctx.fillStyle = '#1a0e06'
  ctx.fillRect(ox - (doorW >> 1), oy - doorH, doorW, doorH)

  if (hasWindow) {
    const winSize = Math.max(4, Math.round((wallHalfWidth * 25) / 100))
    const winX = ox + Math.round((wallHalfWidth * 52) / 100) - (winSize >> 1)
    const winY = oy - Math.round((wallHeight * 62) / 100) - (winSize >> 1)
    ctx.fillStyle = '#c8a830'
    ctx.fillRect(winX, winY, winSize, winSize)
    ctx.strokeStyle = '#5c3810'
    ctx.lineWidth = 1
    ctx.strokeRect(winX, winY, winSize, winSize)
  }

  return { canvas, originX: ox, originY: oy }
}

// ===== DISPATCH =====

const textureCache = new Map<string, EnvironmentTextureSource>()

export function createEnvironmentTextureSource(
  type: MapEnvironmentObjectType,
  seed: number,
  ppm: number
): EnvironmentTextureSource {
  const key = `${type}_${seed}_${ppm}`
  const cached = textureCache.get(key)
  if (cached) {
    return cached
  }

  let source: EnvironmentTextureSource
  if (type === 'tree') {
    source = createEnvironmentTreeTextureSource(seed, ppm)
  } else if (type === 'hill') {
    source = createEnvironmentHillTextureSource(seed, ppm)
  } else {
    source = createEnvironmentHouseTextureSource(seed, ppm)
  }

  textureCache.set(key, source)
  return source
}

// ===== SHARED HELPERS =====

function roundDiv(numerator: number, denominator: number): number {
  if (denominator === 0) {
    return 0
  }
  if (numerator < 0) {
    return -(((-numerator + (denominator >> 1)) / denominator) | 0)
  }
  return ((numerator + (denominator >> 1)) / denominator) | 0
}

function createEnvironmentTreeLeafContourPoints(
  shape: EnvironmentTreeCrownShape,
  centerX: number,
  centerY: number,
  halfWidth: number,
  halfHeight: number,
  seed: number
): number[] {
  if (shape === 2) {
    return createOrganicTriangleContourPoints(
      centerX,
      centerY,
      halfWidth,
      halfHeight,
      seed
    )
  }

  let s = lcgStep(seed)
  const leanPercent = lcgRange(s, -10, 10)
  s = lcgStep(s)
  const edgeVariancePercent =
    shape === 0 ? lcgRange(s, 4, 10) : lcgRange(s, 6, 14)
  s = lcgStep(s)
  const bottomDroopPercent =
    shape === 0 ? lcgRange(s, 8, 16) : lcgRange(s, 12, 22)
  return createOrganicEllipseContourPoints(
    centerX,
    centerY,
    halfWidth,
    halfHeight,
    edgeVariancePercent,
    bottomDroopPercent,
    leanPercent,
    s
  )
}

function createOrganicEllipseContourPoints(
  centerX: number,
  centerY: number,
  radiusX: number,
  radiusY: number,
  edgeVariancePercent: number,
  bottomDroopPercent: number,
  leanPercent: number,
  seed: number
): number[] {
  const points = new Array<number>(ENV_TREE_CROWN_UNIT_X.length * 2)
  let s = seed
  let writeIndex = 0

  for (let i = 0; i < ENV_TREE_CROWN_UNIT_X.length; i++) {
    const unitX = ENV_TREE_CROWN_UNIT_X[i]
    const unitY = ENV_TREE_CROWN_UNIT_Y[i]
    s = lcgStep(s)
    const variancePercent = lcgRange(
      s,
      -edgeVariancePercent,
      edgeVariancePercent
    )
    const radiusPercent = 100 + variancePercent
    const droopPercent =
      unitY > 0 ? roundDiv(unitY * bottomDroopPercent, 100) : 0
    const leanOffsetX = roundDiv(unitY * leanPercent * radiusX, 10000)
    points[writeIndex] =
      centerX + roundDiv(unitX * radiusX * radiusPercent, 10000) + leanOffsetX
    points[writeIndex + 1] =
      centerY +
      roundDiv(unitY * radiusY * (radiusPercent + droopPercent), 10000)
    writeIndex += 2
  }

  return points
}

function createOrganicTriangleContourPoints(
  centerX: number,
  centerY: number,
  halfWidth: number,
  halfHeight: number,
  seed: number
): number[] {
  const sidePointCount = ENV_TREE_TRIANGLE_SIDE_Y.length
  const points = new Array<number>((sidePointCount * 2 - 1) * 2)
  let s = lcgStep(seed)
  const bendPercent = lcgRange(s, -12, 12)
  let writeIndex = 0

  for (let i = 0; i < sidePointCount; i++) {
    const unitY = ENV_TREE_TRIANGLE_SIDE_Y[i]
    const baseWidthPercent = ENV_TREE_TRIANGLE_SIDE_WIDTH[i]
    s = lcgStep(s)
    const widthVariance = i === 0 ? 0 : lcgRange(s, -8, 8)
    const widthPercent = Math.max(0, baseWidthPercent + widthVariance)
    const bendOffsetX =
      unitY > 0 ? roundDiv(unitY * bendPercent * halfWidth, 10000) : 0
    points[writeIndex] =
      centerX - roundDiv(halfWidth * widthPercent, 100) + bendOffsetX
    points[writeIndex + 1] = centerY + roundDiv(halfHeight * unitY, 100)
    writeIndex += 2
  }

  for (let i = sidePointCount - 1; i >= 1; i--) {
    const unitY = ENV_TREE_TRIANGLE_SIDE_Y[i]
    const baseWidthPercent = ENV_TREE_TRIANGLE_SIDE_WIDTH[i]
    s = lcgStep(s)
    const widthVariance =
      i === sidePointCount - 1 ? lcgRange(s, -4, 10) : lcgRange(s, -8, 8)
    const widthPercent = Math.max(0, baseWidthPercent + widthVariance)
    const bendOffsetX =
      unitY > 0 ? roundDiv(unitY * bendPercent * halfWidth, 10000) : 0
    points[writeIndex] =
      centerX + roundDiv(halfWidth * widthPercent, 100) + bendOffsetX
    points[writeIndex + 1] = centerY + roundDiv(halfHeight * unitY, 100)
    writeIndex += 2
  }

  return points
}

function getContourBounds(points: readonly number[]): {
  minX: number
  minY: number
  maxX: number
  maxY: number
} {
  let minX = points[0] ?? 0
  let maxX = minX
  let minY = points[1] ?? 0
  let maxY = minY

  for (let i = 2; i < points.length; i += 2) {
    const x = points[i]
    const y = points[i + 1]
    if (x < minX) {
      minX = x
    } else if (x > maxX) {
      maxX = x
    }
    if (y < minY) {
      minY = y
    } else if (y > maxY) {
      maxY = y
    }
  }

  return { minX, minY, maxX, maxY }
}

function offsetContourPoints(
  points: number[],
  offsetX: number,
  offsetY: number
): void {
  for (let i = 0; i < points.length; i += 2) {
    points[i] += offsetX
    points[i + 1] += offsetY
  }
}

function createHillContourPoints(
  centerX: number,
  bottomY: number,
  halfWidth: number,
  height: number,
  peakOffsetX: number,
  segments: number = 32
): number[] {
  const points: number[] = []
  for (let i = 0; i <= segments; i++) {
    const t = i / segments
    const angle = Math.PI * t
    const sinA = Math.sin(angle)
    const cosA = Math.cos(angle)
    const x = Math.round(centerX + peakOffsetX * sinA - halfWidth * cosA)
    const y = Math.round(bottomY - height * sinA)
    points.push(x, y)
  }
  return points
}
