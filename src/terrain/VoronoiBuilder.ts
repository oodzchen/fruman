import { Delaunay } from 'd3-delaunay'

import type { TerrainResolvedLayerView } from './TerrainDataUtils'
import {
  getTerrainChunkMaterialCodes,
  getTerrainChunkSiteJitter,
  getVoronoiSiteJitterValue,
} from './TerrainDataUtils'
import { intersectFlatPolygon } from './TerrainPolygonUtils'
import { VORONOI_SITE_JITTER_SCALE } from './TerrainTypes'
import type { VoronoiPickedCell, VoronoiRenderCell } from './VoronoiTypes'

type TerrainChunkView = TerrainResolvedLayerView['chunks'][number]
type ChunkLookup<T> = Map<number, Map<number, T>>

interface VoronoiInternal {
  _cell(i: number): number[] | null
  _clip(i: number): number[] | null
  vectors: Float64Array
  xmin: number
  ymin: number
  xmax: number
  ymax: number
}

interface CachedVoronoiLayerBuild {
  build: VoronoiLayerBuild
  signature: number
}

export interface VoronoiLayerBuildOptions {
  clipContour?: boolean
  /** 为 false 时跳过邻居 chunk 扩展，独立精灵（非地形拼接）专用，可大幅减少 Delaunay 输入点数 */
  expandNeighbors?: boolean
}

interface FlatPolygonBoundsValues {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export interface VoronoiLayerBuild {
  cells: readonly VoronoiRenderCell[]
  minX: number
  minY: number
  maxX: number
  maxY: number
  siteCount: number
  pickCellAt: (x: number, y: number) => VoronoiPickedCell | null
}

export interface VoronoiBuildPerfSnapshot {
  buildTimeUs: number
  sourceChunkCount: number
  includedChunkCount: number
  siteCount: number
  renderCellCount: number
  clippedPolygonCount: number
}

const clippedLayerBuildCache = new WeakMap<object, CachedVoronoiLayerBuild>()
const unclippedLayerBuildCache = new WeakMap<object, CachedVoronoiLayerBuild>()
const noExpandClippedCache = new WeakMap<object, CachedVoronoiLayerBuild>()
const noExpandUnclippedCache = new WeakMap<object, CachedVoronoiLayerBuild>()
const voronoiBuildPerfSnapshot: VoronoiBuildPerfSnapshot = {
  buildTimeUs: 0,
  sourceChunkCount: 0,
  includedChunkCount: 0,
  siteCount: 0,
  renderCellCount: 0,
  clippedPolygonCount: 0,
}

export function getVoronoiBuildPerfSnapshot(): Readonly<VoronoiBuildPerfSnapshot> {
  return voronoiBuildPerfSnapshot
}

export function getVoronoiLayerBuild(
  layer: TerrainResolvedLayerView,
  cellSizeUnits: number,
  options: VoronoiLayerBuildOptions = {}
): VoronoiLayerBuild {
  const clipContour = options.clipContour !== false
  const expandNeighbors = options.expandNeighbors !== false
  const cacheKey = layer.sourceLayer ?? layer
  const signature = computeLayerSignature(layer, clipContour)
  const cache = expandNeighbors
    ? clipContour
      ? clippedLayerBuildCache
      : unclippedLayerBuildCache
    : clipContour
      ? noExpandClippedCache
      : noExpandUnclippedCache
  const cached = cache.get(cacheKey)
  if (cached && cached.signature === signature) {
    return cached.build
  }
  const build = buildVoronoiLayer(
    layer,
    cellSizeUnits,
    clipContour,
    expandNeighbors
  )
  cache.set(cacheKey, { build, signature })
  return build
}

function buildVoronoiLayer(
  layer: TerrainResolvedLayerView,
  cellSizeUnits: number,
  clipContour: boolean,
  expandNeighbors: boolean
): VoronoiLayerBuild {
  const buildStartMs = performance.now()
  const chunkSize = layer.chunkSize | 0
  if (chunkSize <= 0 || layer.chunks.length === 0) {
    return EMPTY_VORONOI_LAYER_BUILD
  }

  const chunkMap: ChunkLookup<TerrainChunkView> = new Map()
  const includedChunkRows: ChunkLookup<boolean> = new Map()
  const includedChunkCoords: number[] = []
  let minChunkX = layer.chunks[0].chunkX | 0
  let minChunkY = layer.chunks[0].chunkY | 0
  let maxChunkX = minChunkX
  let maxChunkY = minChunkY

  for (let chunkIndex = 0; chunkIndex < layer.chunks.length; chunkIndex++) {
    const chunk = layer.chunks[chunkIndex]
    const chunkX = chunk.chunkX | 0
    const chunkY = chunk.chunkY | 0
    setChunkLookupValue(chunkMap, chunkX, chunkY, chunk)
    if (chunkX < minChunkX) minChunkX = chunkX
    if (chunkY < minChunkY) minChunkY = chunkY
    if (chunkX > maxChunkX) maxChunkX = chunkX
    if (chunkY > maxChunkY) maxChunkY = chunkY
    if (expandNeighbors) {
      for (let offsetY = -1; offsetY <= 1; offsetY++) {
        for (let offsetX = -1; offsetX <= 1; offsetX++) {
          const includedChunkX = chunkX + offsetX
          const includedChunkY = chunkY + offsetY
          appendIncludedChunk(
            includedChunkRows,
            includedChunkCoords,
            includedChunkX,
            includedChunkY
          )
        }
      }
    } else {
      appendIncludedChunk(
        includedChunkRows,
        includedChunkCoords,
        chunkX,
        chunkY
      )
    }
  }

  const includedChunkCount = includedChunkCoords.length >> 1
  const siteCount = includedChunkCount * chunkSize * chunkSize
  const coords = new Float64Array(siteCount * 2)
  const siteCellX = new Int32Array(siteCount)
  const siteCellY = new Int32Array(siteCount)
  const siteMaterialCode = new Int16Array(siteCount)
  const siteAboveMaterialCode = new Int16Array(siteCount)

  let siteIndex = 0
  for (
    let includedIndex = 0;
    includedIndex < includedChunkCoords.length;
    includedIndex += 2
  ) {
    const chunkX = includedChunkCoords[includedIndex]
    const chunkY = includedChunkCoords[includedIndex + 1]
    const sourceChunk = getChunkLookupValue(chunkMap, chunkX, chunkY) ?? null
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
            VORONOI_SITE_JITTER_SCALE +
          layer.offsetXUnits
        coords[siteIndex * 2 + 1] =
          ((worldCellY * VORONOI_SITE_JITTER_SCALE +
            (VORONOI_SITE_JITTER_SCALE >> 1) +
            jitterY) *
            cellSizeUnits) /
            VORONOI_SITE_JITTER_SCALE +
          layer.offsetYUnits
        siteCellX[siteIndex] = worldCellX
        siteCellY[siteIndex] = worldCellY
        const materialCode = sourceCells ? sourceCells[cellIndex] | 0 : 0
        siteMaterialCode[siteIndex] = materialCode
        siteAboveMaterialCode[siteIndex] =
          sourceCells && materialCode > 0
            ? getAboveSourceMaterialCode(
                chunkMap,
                sourceCells,
                chunkX,
                chunkY,
                localX,
                localY,
                chunkSize
              )
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
    minWorldCellX * cellSizeUnits + layer.offsetXUnits,
    minWorldCellY * cellSizeUnits + layer.offsetYUnits,
    maxWorldCellX * cellSizeUnits + layer.offsetXUnits,
    maxWorldCellY * cellSizeUnits + layer.offsetYUnits,
  ]

  const delaunay = new Delaunay(coords)
  const voronoi = delaunay.voronoi(bounds)
  const contourClipPoints = clipContour ? layer.contourClipPoints : undefined
  const shouldClipContour =
    !!contourClipPoints && contourClipPoints.length >= 6 && clipContour
  const contourClipBounds =
    shouldClipContour && contourClipPoints
      ? computeFlatPolygonBoundsValues(contourClipPoints)
      : null
  const cells: VoronoiRenderCell[] = []
  let buildMinX = Infinity
  let buildMinY = Infinity
  let buildMaxX = -Infinity
  let buildMaxY = -Infinity
  let clippedPolygonCount = 0

  // Bulk-extract cell polygons using Voronoi internals to avoid
  // per-cell object allocation from cellPolygon/Polygon class.
  // voronoi._clip(i) returns a flat number[] directly (or null),
  // skipping the Polygon wrapper and its [x,y] sub-arrays.
  const voronoiAny = voronoi as unknown as VoronoiInternal
  for (let i = 0; i < siteCount; i++) {
    const materialCode = siteMaterialCode[i] | 0
    if (materialCode <= 0) {
      continue
    }
    const clippedCell = voronoiAny._clip(i)
    if (!clippedCell || clippedCell.length < 6) {
      continue
    }
    // _clip returns flat [x,y,x,y,...] already — deduplicate closing point
    let flatLen = clippedCell.length
    if (
      flatLen >= 4 &&
      clippedCell[0] === clippedCell[flatLen - 2] &&
      clippedCell[1] === clippedCell[flatLen - 1]
    ) {
      flatLen -= 2
    }
    if (flatLen !== clippedCell.length) {
      clippedCell.length = flatLen
    }
    const flattenedPoints = clippedCell
    const unclippedBounds = computeFlatPolygonBoundsValues(flattenedPoints)
    if (!unclippedBounds) {
      continue
    }

    if (!shouldClipContour || !contourClipBounds || !contourClipPoints) {
      appendVoronoiRenderCell(
        cells,
        layer,
        siteCellX[i],
        siteCellY[i],
        materialCode,
        siteAboveMaterialCode[i],
        flattenedPoints,
        unclippedBounds,
        cellSizeUnits
      )
      if (unclippedBounds.minX < buildMinX) {
        buildMinX = unclippedBounds.minX
      }
      if (unclippedBounds.minY < buildMinY) {
        buildMinY = unclippedBounds.minY
      }
      if (unclippedBounds.maxX > buildMaxX) {
        buildMaxX = unclippedBounds.maxX
      }
      if (unclippedBounds.maxY > buildMaxY) {
        buildMaxY = unclippedBounds.maxY
      }
      continue
    }

    if (!doFlatPolygonBoundsIntersect(unclippedBounds, contourClipBounds)) {
      continue
    }
    if (
      isFlatPolygonBoundsInside(unclippedBounds, contourClipBounds) &&
      isFlatPolygonInsideFlatPolygon(flattenedPoints, contourClipPoints)
    ) {
      appendVoronoiRenderCell(
        cells,
        layer,
        siteCellX[i],
        siteCellY[i],
        materialCode,
        siteAboveMaterialCode[i],
        flattenedPoints,
        unclippedBounds,
        cellSizeUnits
      )
      if (unclippedBounds.minX < buildMinX) {
        buildMinX = unclippedBounds.minX
      }
      if (unclippedBounds.minY < buildMinY) {
        buildMinY = unclippedBounds.minY
      }
      if (unclippedBounds.maxX > buildMaxX) {
        buildMaxX = unclippedBounds.maxX
      }
      if (unclippedBounds.maxY > buildMaxY) {
        buildMaxY = unclippedBounds.maxY
      }
      continue
    }

    const clippedPolygons = shouldClipContour
      ? intersectFlatPolygon(flattenedPoints, contourClipPoints)
      : []
    for (
      let polygonIndex = 0;
      polygonIndex < clippedPolygons.length;
      polygonIndex++
    ) {
      const clippedPolygon = clippedPolygons[polygonIndex]
      const clippedBounds = computeFlatPolygonBoundsValues(clippedPolygon)
      if (!clippedBounds) {
        continue
      }
      appendVoronoiRenderCell(
        cells,
        layer,
        siteCellX[i],
        siteCellY[i],
        materialCode,
        siteAboveMaterialCode[i],
        clippedPolygon,
        clippedBounds,
        cellSizeUnits
      )
      clippedPolygonCount++
      if (clippedBounds.minX < buildMinX) {
        buildMinX = clippedBounds.minX
      }
      if (clippedBounds.minY < buildMinY) {
        buildMinY = clippedBounds.minY
      }
      if (clippedBounds.maxX > buildMaxX) {
        buildMaxX = clippedBounds.maxX
      }
      if (clippedBounds.maxY > buildMaxY) {
        buildMaxY = clippedBounds.maxY
      }
    }
  }
  const build: VoronoiLayerBuild = {
    cells,
    minX: Number.isFinite(buildMinX) ? buildMinX : 0,
    minY: Number.isFinite(buildMinY) ? buildMinY : 0,
    maxX: Number.isFinite(buildMaxX) ? buildMaxX : 0,
    maxY: Number.isFinite(buildMaxY) ? buildMaxY : 0,
    siteCount,
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
  voronoiBuildPerfSnapshot.buildTimeUs = Math.round(
    (performance.now() - buildStartMs) * 1000
  )
  voronoiBuildPerfSnapshot.sourceChunkCount = layer.chunks.length
  voronoiBuildPerfSnapshot.includedChunkCount = includedChunkCount
  voronoiBuildPerfSnapshot.siteCount = siteCount
  voronoiBuildPerfSnapshot.renderCellCount = cells.length
  voronoiBuildPerfSnapshot.clippedPolygonCount = clippedPolygonCount
  return build
}

function appendVoronoiRenderCell(
  cells: VoronoiRenderCell[],
  layer: TerrainResolvedLayerView,
  cellX: number,
  cellY: number,
  materialCode: number,
  aboveMaterialCode: number,
  points: number[],
  bounds: FlatPolygonBoundsValues,
  cellSizeUnits: number
): void {
  cells.push(
    createVoronoiRenderCellFromBounds(
      layer,
      cellX,
      cellY,
      materialCode,
      aboveMaterialCode,
      points,
      bounds,
      cellSizeUnits
    )
  )
}

function createVoronoiRenderCellFromBounds(
  layer: TerrainResolvedLayerView,
  cellX: number,
  cellY: number,
  materialCode: number,
  aboveMaterialCode: number,
  points: number[],
  bounds: FlatPolygonBoundsValues,
  cellSizeUnits: number
): VoronoiRenderCell {
  return {
    cellX,
    cellY,
    localCellX: cellX - layer.offsetCellX,
    localCellY: cellY - layer.offsetCellY,
    materialCode,
    aboveMaterialCode,
    points,
    minX: bounds.minX,
    minY: bounds.minY,
    maxX: bounds.maxX,
    maxY: bounds.maxY,
    minCellX: Math.floor(bounds.minX / cellSizeUnits),
    minCellY: Math.floor(bounds.minY / cellSizeUnits),
    maxCellX: Math.ceil(bounds.maxX / cellSizeUnits),
    maxCellY: Math.ceil(bounds.maxY / cellSizeUnits),
  }
}

function getAboveSourceMaterialCode(
  chunkMap: ChunkLookup<TerrainChunkView>,
  sourceCells: ArrayLike<number>,
  chunkX: number,
  chunkY: number,
  localX: number,
  localY: number,
  chunkSize: number
): number {
  if (localY > 0) {
    return sourceCells[(localY - 1) * chunkSize + localX] | 0
  }
  const aboveChunk = getChunkLookupValue(chunkMap, chunkX, chunkY - 1)
  if (!aboveChunk) {
    return 0
  }
  const aboveCells = getTerrainChunkMaterialCodes(aboveChunk)
  return aboveCells[(chunkSize - 1) * chunkSize + localX] | 0
}

function setChunkLookupValue<T>(
  lookup: ChunkLookup<T>,
  chunkX: number,
  chunkY: number,
  value: T
): void {
  let row = lookup.get(chunkX)
  if (!row) {
    row = new Map<number, T>()
    lookup.set(chunkX, row)
  }
  row.set(chunkY, value)
}

function getChunkLookupValue<T>(
  lookup: ChunkLookup<T>,
  chunkX: number,
  chunkY: number
): T | undefined {
  return lookup.get(chunkX)?.get(chunkY)
}

function appendIncludedChunk(
  includedChunkRows: ChunkLookup<boolean>,
  includedChunkCoords: number[],
  chunkX: number,
  chunkY: number
): void {
  if (getChunkLookupValue(includedChunkRows, chunkX, chunkY) === true) {
    return
  }
  setChunkLookupValue(includedChunkRows, chunkX, chunkY, true)
  includedChunkCoords.push(chunkX, chunkY)
}

function computeFlatPolygonBoundsValues(
  points: readonly number[]
): FlatPolygonBoundsValues | null {
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

function doFlatPolygonBoundsIntersect(
  a: FlatPolygonBoundsValues,
  b: FlatPolygonBoundsValues
): boolean {
  return !(
    a.minX > b.maxX ||
    a.minY > b.maxY ||
    a.maxX < b.minX ||
    a.maxY < b.minY
  )
}

function isFlatPolygonBoundsInside(
  inner: FlatPolygonBoundsValues,
  outer: FlatPolygonBoundsValues
): boolean {
  return (
    inner.minX >= outer.minX &&
    inner.minY >= outer.minY &&
    inner.maxX <= outer.maxX &&
    inner.maxY <= outer.maxY
  )
}

function isFlatPolygonInsideFlatPolygon(
  subject: readonly number[],
  clip: readonly number[]
): boolean {
  for (let i = 0; i < subject.length; i += 2) {
    if (!isPointInFlatPolygon(subject[i], subject[i + 1], clip)) {
      return false
    }
  }
  return !doFlatPolygonsIntersect(subject, clip)
}

function isPointInFlatPolygon(
  x: number,
  y: number,
  polygon: readonly number[]
): boolean {
  let inside = false
  let prevX = polygon[polygon.length - 2]
  let prevY = polygon[polygon.length - 1]
  for (let i = 0; i < polygon.length; i += 2) {
    const nextX = polygon[i]
    const nextY = polygon[i + 1]
    const intersects = nextY > y !== prevY > y
    if (
      intersects &&
      x < ((prevX - nextX) * (y - nextY)) / (prevY - nextY) + nextX
    ) {
      inside = !inside
    }
    prevX = nextX
    prevY = nextY
  }
  return inside
}

function doFlatPolygonsIntersect(
  a: readonly number[],
  b: readonly number[]
): boolean {
  let aPrevX = a[a.length - 2]
  let aPrevY = a[a.length - 1]
  for (let ai = 0; ai < a.length; ai += 2) {
    const aNextX = a[ai]
    const aNextY = a[ai + 1]
    let bPrevX = b[b.length - 2]
    let bPrevY = b[b.length - 1]
    for (let bi = 0; bi < b.length; bi += 2) {
      const bNextX = b[bi]
      const bNextY = b[bi + 1]
      if (
        doLineSegmentsIntersect(
          aPrevX,
          aPrevY,
          aNextX,
          aNextY,
          bPrevX,
          bPrevY,
          bNextX,
          bNextY
        )
      ) {
        return true
      }
      bPrevX = bNextX
      bPrevY = bNextY
    }
    aPrevX = aNextX
    aPrevY = aNextY
  }
  return false
}

function doLineSegmentsIntersect(
  ax0: number,
  ay0: number,
  ax1: number,
  ay1: number,
  bx0: number,
  by0: number,
  bx1: number,
  by1: number
): boolean {
  const a1 = computeOrientation(ax0, ay0, ax1, ay1, bx0, by0)
  const a2 = computeOrientation(ax0, ay0, ax1, ay1, bx1, by1)
  const b1 = computeOrientation(bx0, by0, bx1, by1, ax0, ay0)
  const b2 = computeOrientation(bx0, by0, bx1, by1, ax1, ay1)
  return a1 * a2 < 0 && b1 * b2 < 0
}

function computeOrientation(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number
): number {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)
}

function computeLayerSignature(
  layer: TerrainResolvedLayerView,
  clipContour: boolean
): number {
  let hash = mixHash(layer.version | 0)
  hash = mixHash(hash ^ Math.imul(layer.chunkSize | 0, 0x9e3779b1))
  hash = mixHash(hash ^ Math.imul(layer.randomSeed | 0, 0x85ebca6b))
  hash = mixHash(hash ^ Math.imul(layer.offsetCellX | 0, 0xc2b2ae35))
  hash = mixHash(hash ^ Math.imul(layer.offsetCellY | 0, 0x27d4eb2d))
  hash = mixHash(hash ^ Math.imul(layer.offsetXUnits | 0, 0x165667b1))
  hash = mixHash(hash ^ Math.imul(layer.offsetYUnits | 0, 0xd3a2646c))
  if (typeof layer.buildRevision === 'number') {
    hash = mixHash(hash ^ Math.imul(layer.buildRevision | 0, 0x165667b1))
    if (clipContour && typeof layer.contourBuildRevision === 'number') {
      hash = mixHash(
        hash ^ Math.imul(layer.contourBuildRevision | 0, 0xd3a2646c)
      )
    }
    return hash
  }

  // Fast fallback if buildRevision is missing: hash chunk positions instead of every cell
  hash = mixHash(hash ^ Math.imul(layer.chunks.length | 0, 0x165667b1))
  for (let chunkIndex = 0; chunkIndex < layer.chunks.length; chunkIndex++) {
    const chunk = layer.chunks[chunkIndex]
    hash = mixHash(hash ^ Math.imul(chunk.chunkX | 0, 0x165667b1))
    hash = mixHash(hash ^ Math.imul(chunk.chunkY | 0, 0xd3a2646c))
    // We can also hash the first cell as a small heuristic
    const materialCodes = getTerrainChunkMaterialCodes(chunk)
    if (materialCodes.length > 0) {
      hash = mixHash(hash ^ (materialCodes[0] | 0))
    }
  }
  const clipPoints = clipContour ? layer.contourClipPoints : undefined
  if (clipPoints) {
    hash = mixHash(hash ^ Math.imul(clipPoints.length, 0x4b3cd7a1))
    for (let i = 0; i < clipPoints.length; i++) {
      hash = mixHash(hash ^ Math.imul((clipPoints[i] | 0) + i, 0x9e3779b1))
    }
  }
  return hash
}

function mixHash(value: number): number {
  let v = value | 0
  v = Math.imul(v ^ (v >>> 16), 0x45d9f3b)
  v = Math.imul(v ^ (v >>> 16), 0x45d9f3b)
  return (v ^ (v >>> 16)) >>> 0
}

const EMPTY_VORONOI_LAYER_BUILD: VoronoiLayerBuild = {
  cells: [],
  minX: 0,
  minY: 0,
  maxX: 0,
  maxY: 0,
  siteCount: 0,
  pickCellAt: () => null,
}
