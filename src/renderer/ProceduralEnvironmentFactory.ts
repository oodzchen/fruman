import type { MapEnvironmentObjectType } from '../editorMapTypes'
import { createDefaultTerrainChunkSiteJitter } from '../terrain/TerrainDataUtils'
import type { TerrainResolvedLayerView } from '../terrain/TerrainDataUtils'
import { getTerrainMaterialCodeById } from '../terrain/TerrainMaterialRegistry'
import {
  createNaturalMaterialStyle,
  createSmoothSunContourPoints,
  createTrapezoidContourPoints,
  drawVoronoiLayer,
} from './CheckpointTreeTextureFactory'

const WOOD_CODE = getTerrainMaterialCodeById('wood')
const LEAVES_CODE = getTerrainMaterialCodeById('leaves')
const STONE_CODE = getTerrainMaterialCodeById('stone')
const GRASS_CODE = getTerrainMaterialCodeById('grass')
const THATCH_CODE = getTerrainMaterialCodeById('thatch')

const ENV_SEED_MIX = 0x9e3779b9 | 0

const ENV_TREE_VORONOI_SEED = 38291
const ENV_HILL_VORONOI_SEED = 52847
const ENV_HOUSE_VORONOI_SEED = 71503

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
  const rayCount = lcgRange(s, 4, 9)
  s = lcgStep(s)
  const crownScaleNum = lcgRange(s, 90, 150)
  s = lcgStep(s)
  const trunkHeightNum = lcgRange(s, 140, 240)
  s = lcgStep(s)
  const trunkWidthNum = lcgRange(s, 55, 95)

  const baseRadius = Math.max(16, Math.round((ppm * 120) / 100))
  const leafCoreRadius = Math.max(
    18,
    Math.round((baseRadius * crownScaleNum) / 100)
  )
  const leafTipRadius = Math.max(
    leafCoreRadius + 4,
    Math.round((leafCoreRadius * 13) / 10)
  )
  const leafCenterY = -Math.round((baseRadius * 3) / 4)
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

  const padding = 8
  const localMinX = -Math.max(leafTipRadius, trunkBottomHalfWidth)
  const localMaxX = Math.max(leafTipRadius, trunkBottomHalfWidth)
  const localMinY = Math.min(leafCenterY - leafTipRadius, 0)
  const localMaxY = trunkBottomY
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
  const cellSize = Math.max(8, Math.round(baseRadius / 4))

  const leafContour = createSmoothSunContourPoints(
    originX,
    originY + leafCenterY,
    leafCoreRadius,
    leafTipRadius,
    rayCount,
    64
  )
  const trunkContour = createTrapezoidContourPoints(
    originX,
    originY + trunkTopY,
    originY + trunkBottomY,
    trunkTopHalfWidth,
    trunkBottomHalfWidth
  )

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
    WOOD_CODE
  )
  drawVoronoiLayer(
    ctx,
    leafLayer,
    cellSize,
    createNaturalMaterialStyle(LEAVES_CODE),
    LEAVES_CODE
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
  const cellSize = Math.max(8, Math.round(halfWidth / 8))

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
    GRASS_CODE
  )
  drawVoronoiLayer(
    ctx,
    stoneLayer,
    cellSize,
    createNaturalMaterialStyle(STONE_CODE),
    STONE_CODE
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

  const cellSize = Math.max(8, Math.round(wallHalfWidth >> 2))

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
    WOOD_CODE
  )
  drawVoronoiLayer(
    ctx,
    roofLayer,
    cellSize,
    createNaturalMaterialStyle(THATCH_CODE),
    THATCH_CODE
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
