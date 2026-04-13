import { createDefaultTerrainChunkSiteJitter } from '../terrain/TerrainDataUtils'
import type { TerrainResolvedLayerView } from '../terrain/TerrainDataUtils'
import { getTerrainPaletteIndex } from '../terrain/TerrainGeometry'
import {
  getTerrainMaterialByCode,
  getTerrainMaterialCodeById,
} from '../terrain/TerrainMaterialRegistry'
import { getVoronoiLayerBuild } from '../terrain/VoronoiBuilder'

const CHECKPOINT_TREE_RANDOM_SEED = 17041
const LEAF_RADIUS_SCALE_NUMERATOR = 141
const LEAF_RADIUS_SCALE_DENOMINATOR = 100
const LEAF_RAY_COUNT = 8
const LEAF_CONTOUR_SEGMENTS = 64
const LEAF_TIP_RADIUS_NUMERATOR = 13
const LEAF_TIP_RADIUS_DENOMINATOR = 10
const SUN_GLOW_SIZE_NUMERATOR = 8
const SUN_GLOW_SIZE_DENOMINATOR = 5
const CHECKPOINT_GLOW_OUTER_RADIUS_OFFSET = 24
const FILL_BASE_WEIGHT = 2
const FILL_TARGET_WEIGHT = 3
const STROKE_BASE_WEIGHT = 4
const STROKE_TARGET_WEIGHT = 1
const WOOD_MATERIAL_CODE = getTerrainMaterialCodeById('wood')
const LEAVES_MATERIAL_CODE = getTerrainMaterialCodeById('leaves')

interface RgbColor {
  r: number
  g: number
  b: number
}

interface TintedMaterialStyle {
  readonly fillPalette: readonly string[]
  readonly strokeColor: string
}

export interface CheckpointTreeTextureSource {
  canvas: HTMLCanvasElement
  originX: number
  originY: number
}

export interface CheckpointTreeTextureOptions {
  radiusPx: number
  leafColor: string
  trunkColor: string
  glow: boolean
}

export function createCheckpointTreeTextureSource(
  options: CheckpointTreeTextureOptions
): CheckpointTreeTextureSource {
  const radiusPx = Math.max(16, Math.round(options.radiusPx))
  const leafCoreRadius = Math.max(
    18,
    Math.round(
      (radiusPx * LEAF_RADIUS_SCALE_NUMERATOR) / LEAF_RADIUS_SCALE_DENOMINATOR
    )
  )
  const leafTipRadius = Math.max(
    leafCoreRadius + 4,
    Math.round(
      (leafCoreRadius * LEAF_TIP_RADIUS_NUMERATOR) / LEAF_TIP_RADIUS_DENOMINATOR
    )
  )
  const leafCenterY = -Math.round((radiusPx * 3) / 4)
  const trunkTopY = 0
  const trunkBottomY = Math.round((radiusPx * 17) / 10)
  const trunkTopHalfWidth = Math.max(6, Math.round((radiusPx * 9) / 20))
  const trunkBottomHalfWidth = Math.max(
    trunkTopHalfWidth + 3,
    Math.round((radiusPx * 7) / 10)
  )
  const glowRadius = options.glow
    ? Math.ceil(
        (leafTipRadius * SUN_GLOW_SIZE_NUMERATOR) / SUN_GLOW_SIZE_DENOMINATOR
      )
    : 0
  const glowOuterRadius = options.glow
    ? leafTipRadius + CHECKPOINT_GLOW_OUTER_RADIUS_OFFSET
    : 0
  const padding = Math.max(8, glowRadius + 4, glowOuterRadius + 6)
  const localMinX = -Math.max(leafTipRadius, trunkBottomHalfWidth)
  const localMaxX = Math.max(leafTipRadius, trunkBottomHalfWidth)
  const localMinY = Math.min(leafCenterY - leafTipRadius, trunkTopY)
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
      originY: canvas.height >> 1,
    }
  }

  const originX = Math.round((canvas.width - contentWidth) / 2 - localMinX)
  const originY = padding - localMinY
  const cellSize = Math.max(8, Math.round(radiusPx / 4))
  const chunkSize = Math.max(
    1,
    Math.ceil(Math.max(canvas.width, canvas.height) / cellSize)
  )
  const leafContourPoints = createSmoothSunContourPoints(
    originX,
    originY + leafCenterY,
    leafCoreRadius,
    leafTipRadius,
    LEAF_RAY_COUNT,
    LEAF_CONTOUR_SEGMENTS
  )
  const trunkContourPoints = createTrapezoidContourPoints(
    originX,
    originY + trunkTopY,
    originY + trunkBottomY,
    trunkTopHalfWidth,
    trunkBottomHalfWidth
  )

  const trunkStyle = createTintedMaterialStyle(
    WOOD_MATERIAL_CODE,
    options.trunkColor
  )
  const leafStyle = createTintedMaterialStyle(
    LEAVES_MATERIAL_CODE,
    options.leafColor
  )
  const trunkLayer = createFilledContourLayer(
    chunkSize,
    cellSize,
    WOOD_MATERIAL_CODE,
    trunkContourPoints,
    1
  )
  const leafLayer = createFilledContourLayer(
    chunkSize,
    cellSize,
    LEAVES_MATERIAL_CODE,
    leafContourPoints,
    2
  )

  drawVoronoiLayer(ctx, trunkLayer, cellSize, trunkStyle, WOOD_MATERIAL_CODE)
  drawVoronoiLayer(ctx, leafLayer, cellSize, leafStyle, LEAVES_MATERIAL_CODE)

  if (options.glow) {
    drawCheckpointOuterGlow(
      ctx,
      originX,
      originY + leafCenterY,
      leafTipRadius,
      CHECKPOINT_GLOW_OUTER_RADIUS_OFFSET
    )
  }

  return { canvas, originX, originY }
}

function createFilledContourLayer(
  chunkSize: number,
  cellSize: number,
  materialCode: number,
  contourClipPoints: readonly number[],
  buildRevision: number
): TerrainResolvedLayerView {
  const cellCount = chunkSize * chunkSize
  const cells = new Uint8Array(cellCount)
  cells.fill(materialCode)

  return {
    version: 4,
    cellSize,
    chunkSize,
    randomSeed: CHECKPOINT_TREE_RANDOM_SEED,
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
          CHECKPOINT_TREE_RANDOM_SEED
        ),
      },
    ],
    offsetCellX: 0,
    offsetCellY: 0,
    offsetXUnits: 0,
    offsetYUnits: 0,
    renderLayer: 0,
    contourClipPoints,
    contourBuildRevision: buildRevision,
    buildRevision,
  }
}

function drawVoronoiLayer(
  ctx: CanvasRenderingContext2D,
  layer: TerrainResolvedLayerView,
  cellSize: number,
  style: TintedMaterialStyle,
  materialCode: number
): void {
  const build = getVoronoiLayerBuild(layer, cellSize)
  for (let cellIndex = 0; cellIndex < build.cells.length; cellIndex++) {
    const cell = build.cells[cellIndex]
    if (cell.materialCode !== materialCode || cell.points.length < 6) {
      continue
    }
    const paletteIndex = getTerrainPaletteIndex(
      CHECKPOINT_TREE_RANDOM_SEED,
      cell.localCellX,
      cell.localCellY,
      cell.materialCode,
      style.fillPalette.length
    )
    ctx.beginPath()
    ctx.moveTo(cell.points[0], cell.points[1])
    for (let pointIndex = 2; pointIndex < cell.points.length; pointIndex += 2) {
      ctx.lineTo(cell.points[pointIndex], cell.points[pointIndex + 1])
    }
    ctx.closePath()
    ctx.fillStyle = style.fillPalette[paletteIndex]
    ctx.fill()
    ctx.strokeStyle = style.strokeColor
    ctx.lineWidth = 1
    ctx.stroke()
  }
}

function createSmoothSunContourPoints(
  centerX: number,
  centerY: number,
  coreRadius: number,
  tipRadius: number,
  rayCount: number,
  segments: number
): number[] {
  const points = new Array<number>(segments * 2)
  const angleStep = (Math.PI * 2) / segments
  const waveFrequency = rayCount
  let writeIndex = 0

  for (let i = 0; i < segments; i++) {
    const angle = angleStep * i - Math.PI / 2
    const wave = (Math.cos(angle * waveFrequency) + 1) * 0.5
    const radius = coreRadius + Math.round((tipRadius - coreRadius) * wave)
    points[writeIndex] = centerX + Math.round(Math.cos(angle) * radius)
    points[writeIndex + 1] = centerY + Math.round(Math.sin(angle) * radius)
    writeIndex += 2
  }

  return points
}

function createTrapezoidContourPoints(
  centerX: number,
  topY: number,
  bottomY: number,
  topHalfWidth: number,
  bottomHalfWidth: number
): number[] {
  return [
    centerX - topHalfWidth,
    topY,
    centerX + topHalfWidth,
    topY,
    centerX + bottomHalfWidth,
    bottomY,
    centerX - bottomHalfWidth,
    bottomY,
  ]
}

function drawCheckpointOuterGlow(
  ctx: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  leafOuterRadius: number,
  glowOuterOffset: number
): void {
  const outerRadius = leafOuterRadius + glowOuterOffset
  const coreStop = Math.min(0.78, leafOuterRadius / outerRadius)
  const midStop = Math.min(0.9, coreStop + 0.12)
  ctx.save()
  ctx.globalCompositeOperation = 'destination-over'
  const glow = ctx.createRadialGradient(
    centerX,
    centerY,
    0,
    centerX,
    centerY,
    outerRadius
  )
  glow.addColorStop(0, 'rgba(255,236,120,0.58)')
  glow.addColorStop(Math.max(0.45, coreStop - 0.2), 'rgba(255,228,92,0.5)')
  glow.addColorStop(coreStop, 'rgba(255,218,64,0.36)')
  glow.addColorStop(midStop, 'rgba(255,205,32,0.16)')
  glow.addColorStop(1, 'rgba(255,195,24,0)')
  ctx.fillStyle = glow
  ctx.beginPath()
  ctx.arc(centerX, centerY, outerRadius, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

function createTintedMaterialStyle(
  materialCode: number,
  targetColor: string
): TintedMaterialStyle {
  const material = getTerrainMaterialByCode(materialCode)
  if (!material) {
    return {
      fillPalette: [targetColor, targetColor, targetColor],
      strokeColor: targetColor,
    }
  }

  return {
    fillPalette: material.fillPalette.map((color) =>
      blendHexColors(color, targetColor, FILL_BASE_WEIGHT, FILL_TARGET_WEIGHT)
    ),
    strokeColor: blendHexColors(
      material.strokeColor,
      targetColor,
      STROKE_BASE_WEIGHT,
      STROKE_TARGET_WEIGHT
    ),
  }
}

function blendHexColors(
  baseHex: string,
  targetHex: string,
  baseWeight: number,
  targetWeight: number
): string {
  const base = parseHexColor(baseHex)
  const target = parseHexColor(targetHex)
  const totalWeight = baseWeight + targetWeight
  return rgbToHex({
    r: blendColorChannel(
      base.r,
      target.r,
      baseWeight,
      targetWeight,
      totalWeight
    ),
    g: blendColorChannel(
      base.g,
      target.g,
      baseWeight,
      targetWeight,
      totalWeight
    ),
    b: blendColorChannel(
      base.b,
      target.b,
      baseWeight,
      targetWeight,
      totalWeight
    ),
  })
}

function blendColorChannel(
  base: number,
  target: number,
  baseWeight: number,
  targetWeight: number,
  totalWeight: number
): number {
  return Math.max(
    0,
    Math.min(
      255,
      ((base * baseWeight + target * targetWeight + (totalWeight >> 1)) /
        totalWeight) |
        0
    )
  )
}

function parseHexColor(hexColor: string): RgbColor {
  const normalized = hexColor.startsWith('#') ? hexColor.slice(1) : hexColor
  const value =
    normalized.length === 3
      ? parseInt(
          normalized[0] +
            normalized[0] +
            normalized[1] +
            normalized[1] +
            normalized[2] +
            normalized[2],
          16
        )
      : parseInt(normalized.padStart(6, '0').slice(0, 6), 16)
  return {
    r: (value >> 16) & 0xff,
    g: (value >> 8) & 0xff,
    b: value & 0xff,
  }
}

function rgbToHex(color: RgbColor): string {
  return `#${color.r.toString(16).padStart(2, '0')}${color.g
    .toString(16)
    .padStart(2, '0')}${color.b.toString(16).padStart(2, '0')}`
}
