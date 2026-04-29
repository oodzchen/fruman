import type { MapEnvironmentObjectType } from '../editorMapTypes'
import { getRuntimeEnvironmentAsset } from '../environmentAssetRegistry'
import { createEnvironmentCrateLayout } from '../environmentCrateUtils'
import { createDefaultTerrainChunkSiteJitter } from '../terrain/TerrainDataUtils'
import type { TerrainResolvedLayerView } from '../terrain/TerrainDataUtils'
import {
  getTerrainMaterialById,
  getTerrainMaterialCodeById,
} from '../terrain/TerrainMaterialRegistry'
import type { VoronoiLayerBuildOptions } from '../terrain/VoronoiBuilder'
import {
  createNaturalMaterialStyle,
  createTrapezoidContourPoints,
  drawVoronoiLayer,
} from './CheckpointTreeTextureFactory'

const STANDALONE_VORONOI_OPTS: VoronoiLayerBuildOptions = {
  expandNeighbors: false,
}

const WOOD_MATERIAL = getTerrainMaterialById('wood')
const GRASS_MATERIAL = getTerrainMaterialById('grass')
const WOOD_CODE = getTerrainMaterialCodeById('wood')
const LEAVES_CODE = getTerrainMaterialCodeById('leaves')
const STONE_CODE = getTerrainMaterialCodeById('stone')
const GRASS_CODE = getTerrainMaterialCodeById('grass')
const THATCH_CODE = getTerrainMaterialCodeById('thatch')

const ENV_SEED_MIX = 0x9e3779b9 | 0

const ENV_TREE_VORONOI_SEED = 38291
const ENV_HILL_VORONOI_SEED = 52847
const ENV_HOUSE_VORONOI_SEED = 71503
const ENV_CLOUD_DETAIL_SEED = 91867

type CloudPuff = readonly [number, number, number]

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
const ENV_CLOUD_LARGE_PUFFS: readonly CloudPuff[] = [
  [0, 0, 24],
  [-22, 10, 18],
  [24, 8, 21],
  [-10, 22, 16],
  [15, 24, 15],
  [36, 18, 13],
  [-34, 18, 12],
] as const
const ENV_CLOUD_MEDIUM_PUFFS: readonly CloudPuff[] = [
  [0, 0, 19],
  [-18, 9, 15],
  [20, 7, 17],
  [-7, 20, 14],
  [13, 21, 13],
  [28, 15, 11],
] as const

export interface EnvironmentTextureSource {
  canvas: HTMLCanvasElement
  originX: number
  originY: number
  boundsX: number
  boundsY: number
  boundsWidth: number
  boundsHeight: number
}

export const ENVIRONMENT_GRASS_BLADE_STRIDE = 10

export const ENVIRONMENT_GRASS_BLADE_OFFSETS = {
  BASE_X: 0,
  TIP_X: 1,
  BASE_HALF_WIDTH: 2,
  INNER_HALF_WIDTH: 3,
  SHOULDER_Y: 4,
  TIP_Y: 5,
  COLOR_INDEX: 6,
  HEIGHT: 7,
  PHASE: 8,
  RESPONSE: 9,
} as const

export interface EnvironmentGrassLayout {
  bladeCount: number
  bladeValues: Int32Array
  canvasWidth: number
  canvasHeight: number
  originX: number
  originY: number
  clumpWidth: number
  maxHeight: number
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
  ppm: number,
  scaleXPermille: number = 1000,
  scaleYPermille: number = 1000,
  cellStroke = false
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
  scaleContourPoints(
    leafContour,
    0,
    trunkBottomY,
    scaleXPermille,
    scaleYPermille
  )
  scaleContourPoints(
    trunkContour,
    0,
    trunkBottomY,
    scaleXPermille,
    scaleYPermille
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
      boundsX: 0,
      boundsY: 0,
      boundsWidth: canvas.width,
      boundsHeight: canvas.height,
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
    STANDALONE_VORONOI_OPTS,
    cellStroke
  )
  drawVoronoiLayer(
    ctx,
    leafLayer,
    cellSize,
    createNaturalMaterialStyle(LEAVES_CODE),
    LEAVES_CODE,
    STANDALONE_VORONOI_OPTS,
    cellStroke
  )

  const bounds = getCanvasOpaqueBounds(canvas)
  return {
    canvas,
    originX,
    originY: originY + trunkBottomY,
    boundsX: bounds.x,
    boundsY: bounds.y,
    boundsWidth: bounds.width,
    boundsHeight: bounds.height,
  }
}

// ===== HILL =====

export function createEnvironmentHillTextureSource(
  seed: number,
  ppm: number,
  scaleXPermille: number = 1000,
  scaleYPermille: number = 1000,
  cellStroke = false
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
  const outerContour = createHillContourPoints(
    0,
    0,
    halfWidth,
    height,
    peakOffsetX
  )
  const innerContour = createHillContourPoints(
    0,
    0,
    Math.round((halfWidth * 80) / 100),
    Math.round((height * 85) / 100),
    peakOffsetX
  )
  scaleContourPoints(outerContour, 0, 0, scaleXPermille, scaleYPermille)
  scaleContourPoints(innerContour, 0, 0, scaleXPermille, scaleYPermille)
  const outerBounds = getContourBounds(outerContour)
  const innerBounds = getContourBounds(innerContour)

  const padding = 8
  const localMinX = Math.min(outerBounds.minX, innerBounds.minX)
  const localMaxX = Math.max(outerBounds.maxX, innerBounds.maxX)
  const localMinY = Math.min(outerBounds.minY, innerBounds.minY)
  const localMaxY = Math.max(outerBounds.maxY, innerBounds.maxY)
  const canvasW = localMaxX - localMinX + padding * 2
  const canvasH = localMaxY - localMinY + padding * 2

  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, canvasW)
  canvas.height = Math.max(1, canvasH)
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    return {
      canvas,
      originX: canvas.width >> 1,
      originY: canvas.height - padding,
      boundsX: 0,
      boundsY: 0,
      boundsWidth: canvas.width,
      boundsHeight: canvas.height,
    }
  }

  const cellSize = Math.max(16, Math.round(halfWidth / 4))
  const centerX = padding - localMinX
  const bottomY = padding - localMinY
  offsetContourPoints(outerContour, centerX, bottomY)
  offsetContourPoints(innerContour, centerX, bottomY)

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
    STANDALONE_VORONOI_OPTS,
    cellStroke
  )
  drawVoronoiLayer(
    ctx,
    stoneLayer,
    cellSize,
    createNaturalMaterialStyle(STONE_CODE),
    STONE_CODE,
    STANDALONE_VORONOI_OPTS,
    cellStroke
  )

  const bounds = getCanvasOpaqueBounds(canvas)
  return {
    canvas,
    originX: centerX,
    originY: bottomY,
    boundsX: bounds.x,
    boundsY: bounds.y,
    boundsWidth: bounds.width,
    boundsHeight: bounds.height,
  }
}

// ===== HOUSE =====

export function createEnvironmentHouseTextureSource(
  seed: number,
  ppm: number,
  scaleXPermille: number = 1000,
  scaleYPermille: number = 1000,
  cellStroke = false
): EnvironmentTextureSource {
  let s = lcgStep(seed ^ ENV_SEED_MIX)
  const wallWidthNum = lcgRange(s, 100, 180)
  s = lcgStep(s)
  const wallHeightNum = lcgRange(s, 80, 140)
  s = lcgStep(s)
  const roofPitchNum = lcgRange(s, 60, 130)
  s = lcgStep(s)
  const hasWindow = (s & 1) === 1

  const baseWallHalfWidth = Math.round((ppm * wallWidthNum) / 100)
  const baseWallHeight = Math.round((ppm * wallHeightNum) / 100)
  const baseRoofHeight = Math.round(
    (baseWallHalfWidth * 2 * roofPitchNum) / 100
  )
  const baseRoofOverhang = Math.round((baseWallHalfWidth * 12) / 100)
  const wallHalfWidth = scaleByPermille(baseWallHalfWidth, scaleXPermille)
  const wallHeight = scaleByPermille(baseWallHeight, scaleYPermille)
  const roofHeight = scaleByPermille(baseRoofHeight, scaleYPermille)
  const roofOverhang = scaleByPermille(baseRoofOverhang, scaleXPermille)

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
      boundsX: 0,
      boundsY: 0,
      boundsWidth: canvas.width,
      boundsHeight: canvas.height,
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

  const cellSize = Math.max(16, Math.round(baseWallHalfWidth >> 1))

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
    STANDALONE_VORONOI_OPTS,
    cellStroke
  )
  drawVoronoiLayer(
    ctx,
    roofLayer,
    cellSize,
    createNaturalMaterialStyle(THATCH_CODE),
    THATCH_CODE,
    STANDALONE_VORONOI_OPTS,
    cellStroke
  )

  const doorW = Math.max(4, Math.round((wallHalfWidth * 35) / 100))
  const doorH = Math.max(6, Math.round((wallHeight * 55) / 100))
  ctx.fillStyle = '#1a0e06'
  ctx.fillRect(ox - (doorW >> 1), oy - doorH, doorW, doorH)

  if (hasWindow) {
    const winWidth = Math.max(4, Math.round((wallHalfWidth * 25) / 100))
    const winHeight = Math.max(4, Math.round((wallHeight * 25) / 100))
    const winX = ox + Math.round((wallHalfWidth * 52) / 100) - (winWidth >> 1)
    const winY = oy - Math.round((wallHeight * 62) / 100) - (winHeight >> 1)
    ctx.fillStyle = '#c8a830'
    ctx.fillRect(winX, winY, winWidth, winHeight)
    ctx.strokeStyle = '#5c3810'
    ctx.lineWidth = 1
    ctx.strokeRect(winX, winY, winWidth, winHeight)
  }

  const bounds = getCanvasOpaqueBounds(canvas)
  return {
    canvas,
    originX: ox,
    originY: oy,
    boundsX: bounds.x,
    boundsY: bounds.y,
    boundsWidth: bounds.width,
    boundsHeight: bounds.height,
  }
}

// ===== CRATE =====

export function createEnvironmentCrateTextureSource(
  seed: number,
  ppm: number,
  scaleXPermille: number = 1000,
  scaleYPermille: number = 1000
): EnvironmentTextureSource {
  const layout = createEnvironmentCrateLayout(seed, ppm)
  const crateWidth = scaleByPermille(layout.width, scaleXPermille)
  const crateHeight = scaleByPermille(layout.height, scaleYPermille)
  const halfWidth = crateWidth >> 1
  const frameInset = Math.max(
    1,
    scaleByPermille(layout.frameInset, Math.min(scaleXPermille, scaleYPermille))
  )
  const plankGap = Math.max(1, scaleByPermille(layout.plankGap, scaleXPermille))
  const padding = Math.max(8, roundDiv(ppm * 12, 10))
  const canvasW = crateWidth + padding * 2
  const canvasH = crateHeight + padding * 2

  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, canvasW)
  canvas.height = Math.max(1, canvasH)
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    return {
      canvas,
      originX: canvas.width >> 1,
      originY: canvas.height - padding,
      boundsX: 0,
      boundsY: 0,
      boundsWidth: canvas.width,
      boundsHeight: canvas.height,
    }
  }

  const ox = canvas.width >> 1
  const oy = canvas.height - padding
  const topY = oy - crateHeight
  const leftX = ox - halfWidth
  const rightX = leftX + crateWidth
  const bodyColor = WOOD_MATERIAL.fillPalette[1]
  const frameColor = WOOD_MATERIAL.fillPalette[2]
  const plankColor = WOOD_MATERIAL.fillPalette[0]
  const strokeColor = WOOD_MATERIAL.strokeColor
  const innerLeftX = leftX + frameInset
  const innerTopY = topY + frameInset
  const innerWidth = Math.max(4, crateWidth - frameInset * 2)
  const innerHeight = Math.max(4, crateHeight - frameInset * 2)

  ctx.fillStyle = bodyColor
  ctx.fillRect(leftX, topY, crateWidth, crateHeight)

  ctx.fillStyle = plankColor
  ctx.fillRect(innerLeftX, innerTopY, innerWidth, innerHeight)

  const seamX = innerLeftX + (innerWidth >> 1)
  const seamWidth = Math.max(1, plankGap >> 2)
  ctx.fillStyle = bodyColor
  ctx.fillRect(seamX - (seamWidth >> 1), innerTopY, seamWidth, innerHeight)

  for (let i = 0; i < layout.planks.length; i++) {
    const plank = layout.planks[i]
    const plankWidth = Math.max(1, scaleByPermille(plank.width, scaleXPermille))
    const plankHeight = Math.max(
      1,
      scaleByPermille(plank.height, scaleYPermille)
    )
    const plankLeft =
      ox +
      scaleByPermille(plank.localCenterX, scaleXPermille) -
      (plankWidth >> 1)
    const plankTop =
      oy +
      scaleByPermille(plank.localCenterY, scaleYPermille) -
      (plankHeight >> 1)
    ctx.fillStyle = plank.role === 'frame' ? frameColor : plankColor
    ctx.fillRect(plankLeft, plankTop, plankWidth, plankHeight)
    ctx.strokeStyle = strokeColor
    ctx.lineWidth = 1
    ctx.strokeRect(
      plankLeft + 1,
      plankTop + 1,
      Math.max(1, plankWidth - 2),
      Math.max(1, plankHeight - 2)
    )
  }

  ctx.strokeStyle = strokeColor
  ctx.lineWidth = 2
  ctx.strokeRect(
    leftX + 1,
    topY + 1,
    Math.max(1, crateWidth - 2),
    Math.max(1, crateHeight - 2)
  )

  ctx.strokeStyle = strokeColor
  ctx.lineWidth = 1
  ctx.strokeRect(innerLeftX, innerTopY, innerWidth, innerHeight)

  ctx.beginPath()
  ctx.moveTo(seamX, innerTopY)
  ctx.lineTo(seamX, innerTopY + innerHeight)
  ctx.stroke()

  ctx.beginPath()
  ctx.moveTo(innerLeftX, innerTopY)
  ctx.lineTo(seamX, innerTopY + innerHeight)
  ctx.moveTo(innerLeftX, innerTopY + innerHeight)
  ctx.lineTo(seamX, innerTopY)
  ctx.moveTo(seamX, innerTopY)
  ctx.lineTo(innerLeftX + innerWidth, innerTopY + innerHeight)
  ctx.moveTo(seamX, innerTopY + innerHeight)
  ctx.lineTo(innerLeftX + innerWidth, innerTopY)
  ctx.stroke()

  ctx.strokeStyle = bodyColor
  ctx.beginPath()
  ctx.moveTo(leftX + 2, topY + 2)
  ctx.lineTo(rightX - 2, topY + 2)
  ctx.moveTo(leftX + 2, topY + 3)
  ctx.lineTo(leftX + 2, oy - 2)
  ctx.stroke()

  const nailSize = Math.max(1, roundDiv(frameInset, 2))
  ctx.fillStyle = strokeColor
  ctx.fillRect(innerLeftX + nailSize, innerTopY + nailSize, nailSize, nailSize)
  ctx.fillRect(
    innerLeftX + innerWidth - nailSize * 2,
    innerTopY + nailSize,
    nailSize,
    nailSize
  )
  ctx.fillRect(
    innerLeftX + nailSize,
    innerTopY + innerHeight - nailSize * 2,
    nailSize,
    nailSize
  )
  ctx.fillRect(
    innerLeftX + innerWidth - nailSize * 2,
    innerTopY + innerHeight - nailSize * 2,
    nailSize,
    nailSize
  )

  const bounds = getCanvasOpaqueBounds(canvas)
  return {
    canvas,
    originX: ox,
    originY: oy,
    boundsX: bounds.x,
    boundsY: bounds.y,
    boundsWidth: bounds.width,
    boundsHeight: bounds.height,
  }
}

// ===== GRASS =====

export function createEnvironmentGrassLayout(
  seed: number,
  ppm: number,
  scaleXPermille: number = 1000,
  scaleYPermille: number = 1000
): EnvironmentGrassLayout {
  let s = lcgStep(seed ^ ENV_SEED_MIX)
  const bladeCount = lcgRange(s, 1, 36)
  s = lcgStep(s)
  const widthNum = 30 + bladeCount * 5 + lcgRange(s, 0, 36)
  s = lcgStep(s)
  const heightNum = lcgRange(s, 30, 88)

  const baseClumpWidth = Math.max(14, roundDiv(ppm * widthNum, 100))
  const baseMaxHeight = Math.max(10, roundDiv(ppm * heightNum, 100))
  const clumpWidth = Math.max(
    14,
    scaleByPermille(baseClumpWidth, scaleXPermille)
  )
  const maxHeight = Math.max(10, scaleByPermille(baseMaxHeight, scaleYPermille))
  const padding = Math.max(8, roundDiv(ppm * 12, 10))
  const canvasWidth = clumpWidth + padding * 2
  const canvasHeight = maxHeight + padding * 2
  const originX = canvasWidth >> 1
  const originY = canvasHeight - padding
  const bladeValues = new Int32Array(
    bladeCount * ENVIRONMENT_GRASS_BLADE_STRIDE
  )

  let writeIndex = 0
  for (let i = 0; i < bladeCount; i++) {
    s = lcgStep(s ^ Math.imul(i + 1, 0x45d9f3b))
    const baseOffsetPercent = lcgRange(s, -48, 48)
    s = lcgStep(s)
    const bladeHeightPercent = lcgRange(s, 55, 112)
    s = lcgStep(s)
    const leanPercent = lcgRange(s, -36, 36)
    s = lcgStep(s)
    const baseWidthPercent = lcgRange(s, 6, 16)
    s = lcgStep(s)
    const colorIndex = lcgRange(s, 0, GRASS_MATERIAL.fillPalette.length - 1)
    s = lcgStep(s)
    const phase = lcgRange(s, 0, 255)
    s = lcgStep(s)
    const response = lcgRange(s, 72, 136)

    const baseXUnscaled = roundDiv(baseClumpWidth * baseOffsetPercent, 100)
    const bladeHeightUnscaled = Math.max(
      6,
      roundDiv(baseMaxHeight * bladeHeightPercent, 100)
    )
    const tipXUnscaled =
      baseXUnscaled + roundDiv(bladeHeightUnscaled * leanPercent, 100)
    const baseX = scaleByPermille(baseXUnscaled, scaleXPermille)
    const bladeHeight = Math.max(
      6,
      scaleByPermille(bladeHeightUnscaled, scaleYPermille)
    )
    const tipX = scaleByPermille(tipXUnscaled, scaleXPermille)
    const baseHalfWidth = Math.max(
      1,
      scaleByPermille(
        Math.max(1, roundDiv(ppm * baseWidthPercent, 100)),
        scaleXPermille
      )
    )
    const shoulderY = -roundDiv(bladeHeight * 45, 100)

    bladeValues[writeIndex + ENVIRONMENT_GRASS_BLADE_OFFSETS.BASE_X] = baseX
    bladeValues[writeIndex + ENVIRONMENT_GRASS_BLADE_OFFSETS.TIP_X] = tipX
    bladeValues[writeIndex + ENVIRONMENT_GRASS_BLADE_OFFSETS.BASE_HALF_WIDTH] =
      baseHalfWidth
    bladeValues[writeIndex + ENVIRONMENT_GRASS_BLADE_OFFSETS.INNER_HALF_WIDTH] =
      Math.max(1, baseHalfWidth >> 1)
    bladeValues[writeIndex + ENVIRONMENT_GRASS_BLADE_OFFSETS.SHOULDER_Y] =
      shoulderY
    bladeValues[writeIndex + ENVIRONMENT_GRASS_BLADE_OFFSETS.TIP_Y] =
      -bladeHeight
    bladeValues[writeIndex + ENVIRONMENT_GRASS_BLADE_OFFSETS.COLOR_INDEX] =
      colorIndex
    bladeValues[writeIndex + ENVIRONMENT_GRASS_BLADE_OFFSETS.HEIGHT] =
      bladeHeight
    bladeValues[writeIndex + ENVIRONMENT_GRASS_BLADE_OFFSETS.PHASE] = phase
    bladeValues[writeIndex + ENVIRONMENT_GRASS_BLADE_OFFSETS.RESPONSE] =
      response
    writeIndex += ENVIRONMENT_GRASS_BLADE_STRIDE
  }

  return {
    bladeCount,
    bladeValues,
    canvasWidth,
    canvasHeight,
    originX,
    originY,
    clumpWidth,
    maxHeight,
  }
}

function drawEnvironmentGrassLayout(
  ctx: CanvasRenderingContext2D,
  layout: EnvironmentGrassLayout
): void {
  const bladeValues = layout.bladeValues
  const tallBladeThreshold = roundDiv(layout.maxHeight * 78, 100)

  for (let pass = 0; pass < 2; pass++) {
    for (
      let i = 0;
      i < bladeValues.length;
      i += ENVIRONMENT_GRASS_BLADE_STRIDE
    ) {
      const bladeHeight =
        bladeValues[i + ENVIRONMENT_GRASS_BLADE_OFFSETS.HEIGHT]
      if (bladeHeight >= tallBladeThreshold !== (pass === 1)) {
        continue
      }

      const baseX =
        layout.originX + bladeValues[i + ENVIRONMENT_GRASS_BLADE_OFFSETS.BASE_X]
      const tipX =
        layout.originX + bladeValues[i + ENVIRONMENT_GRASS_BLADE_OFFSETS.TIP_X]
      const baseHalfWidth =
        bladeValues[i + ENVIRONMENT_GRASS_BLADE_OFFSETS.BASE_HALF_WIDTH]
      const innerHalfWidth =
        bladeValues[i + ENVIRONMENT_GRASS_BLADE_OFFSETS.INNER_HALF_WIDTH]
      const shoulderY =
        layout.originY +
        bladeValues[i + ENVIRONMENT_GRASS_BLADE_OFFSETS.SHOULDER_Y]
      const tipY =
        layout.originY + bladeValues[i + ENVIRONMENT_GRASS_BLADE_OFFSETS.TIP_Y]

      ctx.beginPath()
      ctx.moveTo(baseX - baseHalfWidth, layout.originY)
      ctx.lineTo(baseX - innerHalfWidth, shoulderY)
      ctx.lineTo(tipX, tipY)
      ctx.lineTo(baseX + innerHalfWidth, shoulderY)
      ctx.lineTo(baseX + baseHalfWidth, layout.originY)
      ctx.closePath()
      ctx.fillStyle =
        GRASS_MATERIAL.fillPalette[
          bladeValues[i + ENVIRONMENT_GRASS_BLADE_OFFSETS.COLOR_INDEX]
        ]
      ctx.fill()
    }
  }

  ctx.fillStyle =
    GRASS_MATERIAL.fillPalette[GRASS_MATERIAL.fillPalette.length - 1]
  ctx.fillRect(
    layout.originX - (layout.clumpWidth >> 1),
    layout.originY - 1,
    layout.clumpWidth,
    2
  )
}

export function createEnvironmentGrassTextureSource(
  seed: number,
  ppm: number,
  scaleXPermille: number = 1000,
  scaleYPermille: number = 1000
): EnvironmentTextureSource {
  const layout = createEnvironmentGrassLayout(
    seed,
    ppm,
    scaleXPermille,
    scaleYPermille
  )
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, layout.canvasWidth)
  canvas.height = Math.max(1, layout.canvasHeight)
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    return {
      canvas,
      originX: layout.originX,
      originY: layout.originY,
      boundsX: 0,
      boundsY: 0,
      boundsWidth: canvas.width,
      boundsHeight: canvas.height,
    }
  }

  drawEnvironmentGrassLayout(ctx, layout)

  const bounds = getCanvasOpaqueBounds(canvas)
  return {
    canvas,
    originX: layout.originX,
    originY: layout.originY,
    boundsX: bounds.x,
    boundsY: bounds.y,
    boundsWidth: bounds.width,
    boundsHeight: bounds.height,
  }
}

// ===== CLOUD =====

export function createEnvironmentCloudTextureSource(
  seed: number,
  ppm: number,
  scaleXPermille: number = 1000,
  scaleYPermille: number = 1000
): EnvironmentTextureSource {
  let s = lcgStep(seed ^ ENV_SEED_MIX)
  const basePuffs =
    (s & 1) === 0 ? ENV_CLOUD_LARGE_PUFFS : ENV_CLOUD_MEDIUM_PUFFS
  s = lcgStep(s)
  const scaleXNum = lcgRange(s, 92, 126)
  s = lcgStep(s)
  const scaleYNum = lcgRange(s, 90, 118)
  s = lcgStep(s)
  const radiusNum = lcgRange(s, 92, 122)
  const puffValues = new Array<number>(basePuffs.length * 4)
  let minX = 0
  let maxX = 0
  let minY = 0
  let maxY = 0

  for (let i = 0; i < basePuffs.length; i++) {
    const puff = basePuffs[i]
    s = lcgStep(s ^ Math.imul(i + 1, ENV_CLOUD_DETAIL_SEED))
    const jitterX = roundDiv(ppm * lcgRange(s, -10, 10), 100)
    s = lcgStep(s)
    const jitterY = roundDiv(ppm * lcgRange(s, -8, 8), 100)
    s = lcgStep(s)
    const puffScaleNum = lcgRange(s, 92, 112)

    const dx = roundDiv(ppm * puff[0] * scaleXNum, 5000) + jitterX
    const dy = roundDiv(ppm * puff[1] * scaleYNum, 5000) + jitterY
    const radius = Math.max(
      8,
      roundDiv(ppm * puff[2] * radiusNum * puffScaleNum, 500000)
    )
    const radiusX = Math.max(8, scaleByPermille(radius, scaleXPermille))
    const radiusY = Math.max(8, scaleByPermille(radius, scaleYPermille))
    const baseIndex = i * 4
    puffValues[baseIndex] = scaleByPermille(dx, scaleXPermille)
    puffValues[baseIndex + 1] = scaleByPermille(dy, scaleYPermille)
    puffValues[baseIndex + 2] = radiusX
    puffValues[baseIndex + 3] = radiusY

    const puffMinX = puffValues[baseIndex] - radiusX
    const puffMaxX = puffValues[baseIndex] + radiusX
    const puffMinY = puffValues[baseIndex + 1] - radiusY
    const puffMaxY = puffValues[baseIndex + 1] + radiusY
    if (i === 0 || puffMinX < minX) {
      minX = puffMinX
    }
    if (i === 0 || puffMaxX > maxX) {
      maxX = puffMaxX
    }
    if (i === 0 || puffMinY < minY) {
      minY = puffMinY
    }
    if (i === 0 || puffMaxY > maxY) {
      maxY = puffMaxY
    }
  }

  const padding = Math.max(10, roundDiv(ppm * 18, 10))
  const canvasW = maxX - minX + padding * 2
  const canvasH = maxY - minY + padding * 2

  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, canvasW)
  canvas.height = Math.max(1, canvasH)
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    return {
      canvas,
      originX: canvas.width >> 1,
      originY: canvas.height >> 1,
      boundsX: 0,
      boundsY: 0,
      boundsWidth: canvas.width,
      boundsHeight: canvas.height,
    }
  }

  const originX = padding - minX
  const originY = padding - minY
  ctx.fillStyle = '#ffffff'
  for (let i = 0; i < puffValues.length; i += 4) {
    ctx.beginPath()
    ctx.ellipse(
      originX + puffValues[i],
      originY + puffValues[i + 1],
      puffValues[i + 2],
      puffValues[i + 3],
      0,
      0,
      Math.PI * 2
    )
    ctx.fill()
  }

  const bounds = getCanvasOpaqueBounds(canvas)
  return {
    canvas,
    originX,
    originY,
    boundsX: bounds.x,
    boundsY: bounds.y,
    boundsWidth: bounds.width,
    boundsHeight: bounds.height,
  }
}

// ===== DISPATCH =====

const textureCache = new Map<string, EnvironmentTextureSource>()
const ENVIRONMENT_TEXTURE_SOURCE_CACHE_LIMIT = 96

export function isEnvironmentCellStrokeSupported(
  type: MapEnvironmentObjectType
): boolean {
  return type === 'tree' || type === 'hill' || type === 'house'
}

export function buildEnvironmentTextureCacheKey(
  type: MapEnvironmentObjectType,
  seed: number,
  ppm: number,
  scaleXPermille: number = 1000,
  scaleYPermille: number = 1000,
  cellStroke = false
): string {
  const strokeCode =
    isEnvironmentCellStrokeSupported(type) && cellStroke ? 1 : 0
  return `${type}_${seed}_${ppm}_${scaleXPermille}_${scaleYPermille}_${strokeCode}`
}

export function buildCustomEnvironmentTextureCacheKey(
  assetId: string | undefined,
  ppm: number,
  scaleXPermille: number = 1000,
  scaleYPermille: number = 1000
): string {
  const assetVersion = getRuntimeEnvironmentAsset(assetId)?.meta.updatedAt ?? 0
  return `custom_${assetId ?? ''}_${assetVersion}_${ppm}_${scaleXPermille}_${scaleYPermille}`
}

export function createCustomEnvironmentTextureSource(
  assetId: string | undefined,
  ppm: number,
  scaleXPermille: number = 1000,
  scaleYPermille: number = 1000
): EnvironmentTextureSource {
  const key = buildCustomEnvironmentTextureCacheKey(
    assetId,
    ppm,
    scaleXPermille,
    scaleYPermille
  )
  const cached = textureCache.get(key)
  if (cached) {
    textureCache.delete(key)
    textureCache.set(key, cached)
    return cached
  }

  const asset = getRuntimeEnvironmentAsset(assetId)
  const sourceCanvas = asset?.canvas ?? createMissingEnvironmentAssetCanvas()
  const width = Math.max(
    1,
    Math.floor((sourceCanvas.width * scaleXPermille) / 1000)
  )
  const height = Math.max(
    1,
    Math.floor((sourceCanvas.height * scaleYPermille) / 1000)
  )
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (ctx) {
    ctx.clearRect(0, 0, width, height)
    ctx.drawImage(sourceCanvas, 0, 0, width, height)
  }
  const source: EnvironmentTextureSource = {
    canvas,
    originX: width >> 1,
    originY: height,
    boundsX: 0,
    boundsY: 0,
    boundsWidth: width,
    boundsHeight: height,
  }
  textureCache.set(key, source)
  return source
}

function createMissingEnvironmentAssetCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = 64
  canvas.height = 64
  const ctx = canvas.getContext('2d')
  if (ctx) {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.08)'
    ctx.fillRect(0, 0, 64, 64)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.42)'
    ctx.lineWidth = 2
    ctx.strokeRect(1, 1, 62, 62)
    ctx.beginPath()
    ctx.moveTo(14, 14)
    ctx.lineTo(50, 50)
    ctx.moveTo(50, 14)
    ctx.lineTo(14, 50)
    ctx.stroke()
  }
  return canvas
}

export function createEnvironmentTextureSource(
  type: MapEnvironmentObjectType,
  seed: number,
  ppm: number,
  scaleXPermille: number = 1000,
  scaleYPermille: number = 1000,
  cellStroke = false
): EnvironmentTextureSource {
  const drawCellStroke = isEnvironmentCellStrokeSupported(type) && cellStroke
  const key = buildEnvironmentTextureCacheKey(
    type,
    seed,
    ppm,
    scaleXPermille,
    scaleYPermille,
    drawCellStroke
  )
  const cached = textureCache.get(key)
  if (cached) {
    textureCache.delete(key)
    textureCache.set(key, cached)
    return cached
  }

  let source: EnvironmentTextureSource
  if (type === 'tree') {
    source = createEnvironmentTreeTextureSource(
      seed,
      ppm,
      scaleXPermille,
      scaleYPermille,
      drawCellStroke
    )
  } else if (type === 'hill') {
    source = createEnvironmentHillTextureSource(
      seed,
      ppm,
      scaleXPermille,
      scaleYPermille,
      drawCellStroke
    )
  } else if (type === 'house') {
    source = createEnvironmentHouseTextureSource(
      seed,
      ppm,
      scaleXPermille,
      scaleYPermille,
      drawCellStroke
    )
  } else if (type === 'crate') {
    source = createEnvironmentCrateTextureSource(
      seed,
      ppm,
      scaleXPermille,
      scaleYPermille
    )
  } else if (type === 'grass') {
    source = createEnvironmentGrassTextureSource(
      seed,
      ppm,
      scaleXPermille,
      scaleYPermille
    )
  } else if (type === 'cloud') {
    source = createEnvironmentCloudTextureSource(
      seed,
      ppm,
      scaleXPermille,
      scaleYPermille
    )
  } else {
    source = createEnvironmentHouseTextureSource(
      seed,
      ppm,
      scaleXPermille,
      scaleYPermille,
      drawCellStroke
    )
  }

  textureCache.set(key, source)
  return source
}

export function pruneEnvironmentTextureSourceCache(
  activeKeys?: ReadonlySet<string>,
  maxEntries: number = ENVIRONMENT_TEXTURE_SOURCE_CACHE_LIMIT
): void {
  for (const [key] of textureCache) {
    if (activeKeys?.has(key)) {
      continue
    }
    if (textureCache.size <= maxEntries && activeKeys) {
      break
    }
    textureCache.delete(key)
  }
}

export function clearEnvironmentTextureSourceCache(): void {
  textureCache.clear()
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

function scaleByPermille(value: number, scalePermille: number): number {
  return roundDiv(value * scalePermille, 1000)
}

function scaleContourPoints(
  points: number[],
  anchorX: number,
  anchorY: number,
  scaleXPermille: number,
  scaleYPermille: number
): void {
  for (let i = 0; i < points.length; i += 2) {
    points[i] = anchorX + scaleByPermille(points[i] - anchorX, scaleXPermille)
    points[i + 1] =
      anchorY + scaleByPermille(points[i + 1] - anchorY, scaleYPermille)
  }
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

function getCanvasOpaqueBounds(canvas: HTMLCanvasElement): {
  x: number
  y: number
  width: number
  height: number
} {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) {
    return { x: 0, y: 0, width: canvas.width, height: canvas.height }
  }
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const pixels = image.data
  let minX = canvas.width
  let minY = canvas.height
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < canvas.height; y++) {
    const rowOffset = y * canvas.width * 4
    for (let x = 0; x < canvas.width; x++) {
      if (pixels[rowOffset + x * 4 + 3] === 0) {
        continue
      }
      if (x < minX) {
        minX = x
      }
      if (x > maxX) {
        maxX = x
      }
      if (y < minY) {
        minY = y
      }
      if (y > maxY) {
        maxY = y
      }
    }
  }
  if (maxX < minX || maxY < minY) {
    return { x: 0, y: 0, width: canvas.width, height: canvas.height }
  }
  return {
    x: minX,
    y: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  }
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
