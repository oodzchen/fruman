import { Delaunay } from 'd3-delaunay'

import type { TerrainResolvedLayerView } from './TerrainDataUtils'
import {
  getTerrainChunkMaterialCodes,
  getTerrainChunkSiteJitter,
  getVoronoiSiteJitterValue,
} from './TerrainDataUtils'
import { VORONOI_SITE_JITTER_SCALE } from './TerrainTypes'
import type { VoronoiPickedCell, VoronoiRenderCell } from './VoronoiTypes'

interface CachedVoronoiLayerBuild {
  build: VoronoiLayerBuild
  signature: number
}

export interface VoronoiLayerBuild {
  cells: readonly VoronoiRenderCell[]
  pickCellAt: (x: number, y: number) => VoronoiPickedCell | null
}

const layerBuildCache = new WeakMap<object, CachedVoronoiLayerBuild>()

export function getVoronoiLayerBuild(
  layer: TerrainResolvedLayerView,
  cellSizeUnits: number
): VoronoiLayerBuild {
  const cacheKey = layer.sourceLayer ?? layer
  const signature = computeLayerSignature(layer)
  const cached = layerBuildCache.get(cacheKey)
  if (cached && cached.signature === signature) {
    return cached.build
  }
  const build = buildVoronoiLayer(layer, cellSizeUnits)
  layerBuildCache.set(cacheKey, { build, signature })
  return build
}

function buildVoronoiLayer(
  layer: TerrainResolvedLayerView,
  cellSizeUnits: number
): VoronoiLayerBuild {
  const chunkSize = layer.chunkSize | 0
  if (chunkSize <= 0 || layer.chunks.length === 0) {
    return EMPTY_VORONOI_LAYER_BUILD
  }

  const chunkMap = new Map<string, (typeof layer.chunks)[number]>()
  const includedChunkKeys = new Set<string>()
  let minChunkX = layer.chunks[0].chunkX | 0
  let minChunkY = layer.chunks[0].chunkY | 0
  let maxChunkX = minChunkX
  let maxChunkY = minChunkY

  for (let chunkIndex = 0; chunkIndex < layer.chunks.length; chunkIndex++) {
    const chunk = layer.chunks[chunkIndex]
    const chunkX = chunk.chunkX | 0
    const chunkY = chunk.chunkY | 0
    chunkMap.set(getChunkKey(chunkX, chunkY), chunk)
    if (chunkX < minChunkX) minChunkX = chunkX
    if (chunkY < minChunkY) minChunkY = chunkY
    if (chunkX > maxChunkX) maxChunkX = chunkX
    if (chunkY > maxChunkY) maxChunkY = chunkY
    for (let offsetY = -1; offsetY <= 1; offsetY++) {
      for (let offsetX = -1; offsetX <= 1; offsetX++) {
        includedChunkKeys.add(getChunkKey(chunkX + offsetX, chunkY + offsetY))
      }
    }
  }

  const includedChunkEntries = Array.from(includedChunkKeys)
  const siteCount = includedChunkEntries.length * chunkSize * chunkSize
  const coords = new Float64Array(siteCount * 2)
  const siteCellX = new Int32Array(siteCount)
  const siteCellY = new Int32Array(siteCount)
  const siteMaterialCode = new Int16Array(siteCount)

  let siteIndex = 0
  for (
    let includedIndex = 0;
    includedIndex < includedChunkEntries.length;
    includedIndex++
  ) {
    const chunkKey = includedChunkEntries[includedIndex]
    const separatorIndex = chunkKey.indexOf(':')
    const chunkX = Number.parseInt(chunkKey.slice(0, separatorIndex), 10) | 0
    const chunkY = Number.parseInt(chunkKey.slice(separatorIndex + 1), 10) | 0
    const sourceChunk = chunkMap.get(chunkKey) ?? null
    const sourceCells = sourceChunk
      ? getTerrainChunkMaterialCodes(sourceChunk)
      : null
    const sourceJitter = sourceChunk
      ? getTerrainChunkSiteJitter(sourceChunk, chunkSize, layer.randomSeed)
      : null

    for (let localY = 0; localY < chunkSize; localY++) {
      for (let localX = 0; localX < chunkSize; localX++) {
        const cellIndex = localY * chunkSize + localX
        const worldCellX = layer.offsetCellX + chunkX * chunkSize + localX
        const worldCellY = layer.offsetCellY + chunkY * chunkSize + localY
        const jitterX = sourceJitter
          ? sourceJitter[cellIndex * 2] | 0
          : getVoronoiSiteJitterValue(
              layer.randomSeed,
              worldCellX,
              worldCellY,
              0
            )
        const jitterY = sourceJitter
          ? sourceJitter[cellIndex * 2 + 1] | 0
          : getVoronoiSiteJitterValue(
              layer.randomSeed,
              worldCellX,
              worldCellY,
              1
            )
        coords[siteIndex * 2] =
          ((worldCellX * VORONOI_SITE_JITTER_SCALE +
            (VORONOI_SITE_JITTER_SCALE >> 1) +
            jitterX) *
            cellSizeUnits) /
          VORONOI_SITE_JITTER_SCALE
        coords[siteIndex * 2 + 1] =
          ((worldCellY * VORONOI_SITE_JITTER_SCALE +
            (VORONOI_SITE_JITTER_SCALE >> 1) +
            jitterY) *
            cellSizeUnits) /
          VORONOI_SITE_JITTER_SCALE
        siteCellX[siteIndex] = worldCellX
        siteCellY[siteIndex] = worldCellY
        siteMaterialCode[siteIndex] = sourceCells
          ? sourceCells[cellIndex] | 0
          : 0
        siteIndex += 1
      }
    }
  }

  const minWorldCellX = layer.offsetCellX + minChunkX * chunkSize - 1
  const minWorldCellY = layer.offsetCellY + minChunkY * chunkSize - 1
  const maxWorldCellX = layer.offsetCellX + (maxChunkX + 1) * chunkSize
  const maxWorldCellY = layer.offsetCellY + (maxChunkY + 1) * chunkSize
  const bounds: [number, number, number, number] = [
    minWorldCellX * cellSizeUnits,
    minWorldCellY * cellSizeUnits,
    maxWorldCellX * cellSizeUnits,
    maxWorldCellY * cellSizeUnits,
  ]

  const delaunay = new Delaunay(coords)
  const voronoi = delaunay.voronoi(bounds)
  const cells: VoronoiRenderCell[] = []
  for (let i = 0; i < siteCount; i++) {
    const materialCode = siteMaterialCode[i] | 0
    if (materialCode <= 0) {
      continue
    }
    const polygon = voronoi.cellPolygon(i)
    if (!polygon || polygon.length < 4) {
      continue
    }
    const flattenedPoints = flattenCellPolygon(polygon)
    if (flattenedPoints.length < 6) {
      continue
    }
    cells.push({
      cellX: siteCellX[i],
      cellY: siteCellY[i],
      localCellX: siteCellX[i] - layer.offsetCellX,
      localCellY: siteCellY[i] - layer.offsetCellY,
      materialCode,
      points: flattenedPoints,
    })
  }

  return {
    cells,
    pickCellAt: (x: number, y: number): VoronoiPickedCell | null => {
      const index = delaunay.find(x, y)
      if (index < 0 || index >= siteCount) {
        return null
      }
      return {
        cellX: siteCellX[index],
        cellY: siteCellY[index],
      }
    },
  }
}

function flattenCellPolygon(
  polygon: ReadonlyArray<readonly [number, number]>
): number[] {
  let pointCount = polygon.length
  if (pointCount > 1) {
    const firstPoint = polygon[0]
    const lastPoint = polygon[pointCount - 1]
    if (firstPoint[0] === lastPoint[0] && firstPoint[1] === lastPoint[1]) {
      pointCount -= 1
    }
  }
  const points = new Array<number>(pointCount * 2)
  let writeIndex = 0
  for (let i = 0; i < pointCount; i++) {
    points[writeIndex] = polygon[i][0]
    points[writeIndex + 1] = polygon[i][1]
    writeIndex += 2
  }
  return points
}

function computeLayerSignature(layer: TerrainResolvedLayerView): number {
  let hash = mixHash(layer.version | 0)
  hash = mixHash(hash ^ Math.imul(layer.chunkSize | 0, 0x9e3779b1))
  hash = mixHash(hash ^ Math.imul(layer.randomSeed | 0, 0x85ebca6b))
  hash = mixHash(hash ^ Math.imul(layer.offsetCellX | 0, 0xc2b2ae35))
  hash = mixHash(hash ^ Math.imul(layer.offsetCellY | 0, 0x27d4eb2d))
  for (let chunkIndex = 0; chunkIndex < layer.chunks.length; chunkIndex++) {
    const chunk = layer.chunks[chunkIndex]
    hash = mixHash(hash ^ Math.imul(chunk.chunkX | 0, 0x165667b1))
    hash = mixHash(hash ^ Math.imul(chunk.chunkY | 0, 0xd3a2646c))
    const materialCodes = getTerrainChunkMaterialCodes(chunk)
    for (let cellIndex = 0; cellIndex < materialCodes.length; cellIndex++) {
      hash = mixHash(hash ^ ((materialCodes[cellIndex] | 0) + cellIndex))
    }
    const siteJitter = getTerrainChunkSiteJitter(
      chunk,
      layer.chunkSize,
      layer.randomSeed
    )
    for (let jitterIndex = 0; jitterIndex < siteJitter.length; jitterIndex++) {
      hash = mixHash(hash ^ ((siteJitter[jitterIndex] | 0) + jitterIndex))
    }
  }
  return hash
}

function getChunkKey(chunkX: number, chunkY: number): string {
  return `${chunkX}:${chunkY}`
}

function mixHash(value: number): number {
  let v = value | 0
  v = Math.imul(v ^ (v >>> 16), 0x45d9f3b)
  v = Math.imul(v ^ (v >>> 16), 0x45d9f3b)
  return (v ^ (v >>> 16)) >>> 0
}

const EMPTY_VORONOI_LAYER_BUILD: VoronoiLayerBuild = {
  cells: [],
  pickCellAt: () => null,
}
