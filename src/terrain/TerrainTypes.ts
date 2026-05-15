export const TERRAIN_DATA_VERSION = 5
export const TERRAIN_CHUNK_SIZE = 16
export const LEGACY_TERRAIN_CELL_SIZE_METERS = 0.5
export const TERRAIN_CELL_SIZE_METERS = 1
export const DEFAULT_TERRAIN_RANDOM_SEED = 1
export const VORONOI_SITE_JITTER_SCALE = 256

export type TerrainMaterialTag = 'ground' | 'obstacle' | 'foliage'

export type TerrainMaterialId =
  | 'dirt'
  | 'grass'
  | 'stone'
  | 'wood'
  | 'leaves'
  | 'thatch'

export type TerrainBrushId =
  | 'dirt'
  | 'grass'
  | 'stone'
  | 'wood'
  | 'leaves'
  | 'thatch'
  | 'contour'
  | 'erase'

export type TerrainContourShapeKind = 'rect' | 'triangle' | 'circle' | 'polygon'
export type TerrainMaterialPalette = readonly [string, string, string]

export interface TerrainMaterialDefinition {
  id: TerrainMaterialId
  code: number
  materialTag: TerrainMaterialTag
  labelKey: string
  breakable: boolean
  hardness: number
  fillPalette: TerrainMaterialPalette
  strokeColor: string
  subsurfacePalette?: TerrainMaterialPalette
  subsurfaceStrokeColor?: string
}

export interface TerrainBrushDefinition {
  id: TerrainBrushId
  labelKey: string
  mode: 'fill' | 'erase' | 'contour'
  fillMaterialId?: TerrainMaterialId
}

export interface TerrainContourLike {
  id: number
  points: number[]
  fillMaterialId?: TerrainMaterialId
  renderLayer?: number
  shapeKind?: TerrainContourShapeKind
  straightEdge?: boolean
  cellStroke?: boolean
  buildRevision?: number
}

export interface TerrainChunkLike {
  chunkX: number
  chunkY: number
  cells: ArrayLike<number>
  materialCodes?: ArrayLike<number>
  siteJitter?: ArrayLike<number>
}

export interface TerrainLayerLike {
  offsetCellX: number
  offsetCellY: number
  offsetXUnits?: number
  offsetYUnits?: number
  materialId?: TerrainMaterialId
  renderLayer?: number
  contourId?: number
  cellStroke?: boolean
  buildRevision?: number
  chunks: ReadonlyArray<TerrainChunkLike>
}

export interface TerrainDataLike {
  version: number
  cellSize: number
  chunkSize: number
  randomSeed: number
  chunks: ReadonlyArray<TerrainChunkLike>
  layers?: ReadonlyArray<TerrainLayerLike>
  contours?: ReadonlyArray<TerrainContourLike>
}

export interface MapTerrainChunk {
  chunkX: number
  chunkY: number
  cells: number[]
  materialCodes?: number[]
  siteJitter?: number[]
}

export interface MapTerrainLayer extends TerrainLayerLike {
  offsetCellX: number
  offsetCellY: number
  offsetXUnits?: number
  offsetYUnits?: number
  materialId: TerrainMaterialId
  renderLayer?: number
  contourId?: number
  chunks: MapTerrainChunk[]
}

export interface MapTerrainData extends TerrainDataLike {
  version: 1 | 2 | 3 | 4 | 5
  chunks: MapTerrainChunk[]
  layers?: MapTerrainLayer[]
  contours?: TerrainContourLike[]
}

export interface TerrainCollisionRect {
  cellX: number
  cellY: number
  widthCells: number
  heightCells: number
  renderLayer: number
  materialId: TerrainMaterialId
  materialTag: TerrainMaterialTag
}
