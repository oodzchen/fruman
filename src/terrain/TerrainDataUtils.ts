import { getTerrainMaterialByCode } from './TerrainMaterialRegistry'
import type {
  TerrainChunkLike,
  TerrainContourLike,
  TerrainDataLike,
  TerrainLayerLike,
  TerrainMaterialId,
} from './TerrainTypes'
import { VORONOI_SITE_JITTER_SCALE } from './TerrainTypes'

export interface TerrainResolvedLayerView extends TerrainDataLike {
  offsetCellX: number
  offsetCellY: number
  offsetXUnits: number
  offsetYUnits: number
  materialId?: TerrainMaterialId
  renderLayer?: number
  buildRevision?: number
  cellStroke?: boolean
  edgeProtection: boolean
  sourceLayer?: TerrainLayerLike
  layers?: undefined
  contourClipPoints?: readonly number[]
  contourBuildRevision?: number
}

export function hasTerrainContent(
  terrain: TerrainDataLike | null | undefined
): boolean {
  if (!terrain) {
    return false
  }
  if (terrain.layers && terrain.layers.length > 0) {
    for (let i = 0; i < terrain.layers.length; i++) {
      if (terrain.layers[i].chunks.length > 0) {
        return true
      }
    }
  }
  return terrain.chunks.length > 0
}

export function getTerrainLayerViews(
  terrain: TerrainDataLike
): TerrainResolvedLayerView[] {
  if (terrain.layers && terrain.layers.length > 0) {
    let contourMap: Map<number, TerrainContourLike> | null = null
    if (terrain.contours && terrain.contours.length > 0) {
      contourMap = new Map()
      for (let i = 0; i < terrain.contours.length; i++) {
        const c = terrain.contours[i]
        contourMap.set(c.id, c)
      }
    }
    const layers = new Array<TerrainResolvedLayerView>(terrain.layers.length)
    for (let i = 0; i < terrain.layers.length; i++) {
      const layer = terrain.layers[i]
      let contour: TerrainContourLike | undefined
      let contourClipPoints: readonly number[] | undefined
      let contourBuildRevision: number | undefined
      if (layer.contourId && contourMap) {
        contour = contourMap.get(layer.contourId)
        const useStraightEdge =
          contour?.straightEdge !== false &&
          (contour?.straightEdge === true || contour?.shapeKind != null)
        if (useStraightEdge && contour && contour.points.length >= 6) {
          contourClipPoints = contour.points
          contourBuildRevision = contour.buildRevision
        }
      }
      layers[i] = createLayerView(
        terrain,
        layer,
        contourClipPoints,
        contourBuildRevision,
        contour
      )
    }
    return layers
  }
  if (terrain.chunks.length === 0) {
    return []
  }
  return [
    {
      version: terrain.version,
      cellSize: terrain.cellSize,
      chunkSize: terrain.chunkSize,
      randomSeed: terrain.randomSeed,
      chunks: terrain.chunks,
      offsetCellX: 0,
      offsetCellY: 0,
      offsetXUnits: 0,
      offsetYUnits: 0,
      renderLayer: 0,
      edgeProtection: true,
    },
  ]
}

export function inferTerrainMaterialId(
  chunks: ReadonlyArray<{ cells: ArrayLike<number> }>
): TerrainMaterialId {
  const counts = new Map<TerrainMaterialId, number>()
  let bestMaterialId: TerrainMaterialId = 'dirt'
  let bestCount = 0
  for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
    const cells = getTerrainChunkMaterialCodes(chunks[chunkIndex])
    for (let cellIndex = 0; cellIndex < cells.length; cellIndex++) {
      const code = cells[cellIndex] | 0
      if (code <= 0) {
        continue
      }
      const material = getTerrainMaterialByCode(code)
      if (!material) {
        continue
      }
      const nextCount = (counts.get(material.id) ?? 0) + 1
      counts.set(material.id, nextCount)
      if (nextCount > bestCount) {
        bestCount = nextCount
        bestMaterialId = material.id
      }
    }
  }
  return bestMaterialId
}

export function getTerrainChunkMaterialCodes(
  chunk: Pick<TerrainChunkLike, 'cells' | 'materialCodes'>
): ArrayLike<number> {
  return chunk.materialCodes ?? chunk.cells
}

export function getTerrainChunkSiteJitter(
  chunk: Pick<TerrainChunkLike, 'chunkX' | 'chunkY' | 'siteJitter'>,
  chunkSize: number,
  randomSeed: number
): ArrayLike<number> {
  const requiredLength = chunkSize * chunkSize * 2
  const siteJitter = chunk.siteJitter
  if (siteJitter && siteJitter.length === requiredLength) {
    return siteJitter
  }
  return createDefaultTerrainChunkSiteJitter(
    chunk.chunkX,
    chunk.chunkY,
    chunkSize,
    randomSeed
  )
}

export function createDefaultTerrainChunkSiteJitter(
  chunkX: number,
  chunkY: number,
  chunkSize: number,
  randomSeed: number
): Int16Array {
  const cellCount = chunkSize * chunkSize
  const jitter = new Int16Array(cellCount * 2)
  let writeIndex = 0
  for (let localY = 0; localY < chunkSize; localY++) {
    for (let localX = 0; localX < chunkSize; localX++) {
      const cellX = chunkX * chunkSize + localX
      const cellY = chunkY * chunkSize + localY
      jitter[writeIndex] = getVoronoiSiteJitterValue(
        randomSeed,
        cellX,
        cellY,
        0
      )
      jitter[writeIndex + 1] = getVoronoiSiteJitterValue(
        randomSeed,
        cellX,
        cellY,
        1
      )
      writeIndex += 2
    }
  }
  return jitter
}

export function getVoronoiSiteJitterValue(
  randomSeed: number,
  cellX: number,
  cellY: number,
  axis: 0 | 1
): number {
  const span = VORONOI_SITE_JITTER_SCALE >> 2
  return hashOffset(randomSeed, cellX, cellY, axis + 11, span)
}

function createLayerView(
  terrain: TerrainDataLike,
  layer: TerrainLayerLike,
  contourClipPoints?: readonly number[],
  contourBuildRevision?: number,
  contour?: TerrainContourLike
): TerrainResolvedLayerView {
  return {
    version: terrain.version,
    cellSize: terrain.cellSize,
    chunkSize: terrain.chunkSize,
    randomSeed: terrain.randomSeed,
    chunks: layer.chunks,
    offsetCellX: layer.offsetCellX | 0,
    offsetCellY: layer.offsetCellY | 0,
    offsetXUnits: layer.offsetXUnits ? Math.round(layer.offsetXUnits) : 0,
    offsetYUnits: layer.offsetYUnits ? Math.round(layer.offsetYUnits) : 0,
    materialId: layer.materialId,
    renderLayer: layer.renderLayer,
    buildRevision: layer.buildRevision,
    cellStroke: contour?.cellStroke === true || layer.cellStroke === true,
    edgeProtection: contour
      ? contour.edgeProtection !== false
      : layer.edgeProtection !== false,
    sourceLayer: layer,
    contourClipPoints,
    contourBuildRevision,
  }
}

function mixHash(value: number): number {
  let v = value | 0
  v = Math.imul(v ^ (v >>> 16), 0x45d9f3b)
  v = Math.imul(v ^ (v >>> 16), 0x45d9f3b)
  return (v ^ (v >>> 16)) >>> 0
}

function hash3(seed: number, a: number, b: number, c: number): number {
  const mixed =
    mixHash(seed) ^
    Math.imul(mixHash(a), 0x9e3779b1) ^
    Math.imul(mixHash(b), 0x85ebca6b) ^
    Math.imul(mixHash(c), 0xc2b2ae35)
  return mixHash(mixed)
}

function hashOffset(
  seed: number,
  a: number,
  b: number,
  c: number,
  span: number
): number {
  if (span <= 0) {
    return 0
  }
  const value = hash3(seed, a, b, c)
  const max = span * 2 + 1
  return (value % max) - span
}
