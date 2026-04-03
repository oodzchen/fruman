export const TERRAIN_DATA_VERSION = 2
export const TERRAIN_CHUNK_SIZE = 16
export const TERRAIN_CELL_SIZE_METERS = 0.5
export const DEFAULT_TERRAIN_RANDOM_SEED = 1

export type TerrainMaterialTag = 'ground' | 'obstacle' | 'foliage'

export type TerrainMaterialId = 'dirt' | 'grass' | 'stone' | 'wood' | 'leaves'

export type TerrainBrushId =
  | 'dirt'
  | 'grass'
  | 'stone'
  | 'wood'
  | 'leaves'
  | 'erase'

export interface TerrainMaterialDefinition {
  id: TerrainMaterialId
  code: number
  materialTag: TerrainMaterialTag
  labelKey: string
  breakable: boolean
  hardness: number
  fillPalette: readonly [string, string, string]
  strokeColor: string
}

export interface TerrainBrushDefinition {
  id: TerrainBrushId
  labelKey: string
  mode: 'fill' | 'erase'
  fillMaterialId?: TerrainMaterialId
  exposedTopMaterialId?: TerrainMaterialId
}

export interface TerrainChunkLike {
  chunkX: number
  chunkY: number
  cells: ArrayLike<number>
}

export interface TerrainLayerLike {
  offsetCellX: number
  offsetCellY: number
  materialId?: TerrainMaterialId
  renderLayer?: number
  chunks: ReadonlyArray<TerrainChunkLike>
}

export interface TerrainDataLike {
  version: number
  cellSize: number
  chunkSize: number
  randomSeed: number
  chunks: ReadonlyArray<TerrainChunkLike>
  layers?: ReadonlyArray<TerrainLayerLike>
}

export interface MapTerrainChunk {
  chunkX: number
  chunkY: number
  cells: number[]
}

export interface MapTerrainLayer extends TerrainLayerLike {
  offsetCellX: number
  offsetCellY: number
  materialId: TerrainMaterialId
  renderLayer?: number
  chunks: MapTerrainChunk[]
}

export interface MapTerrainData extends TerrainDataLike {
  version: 1 | 2
  chunks: MapTerrainChunk[]
  layers?: MapTerrainLayer[]
}

export interface TerrainCollisionRect {
  cellX: number
  cellY: number
  widthCells: number
  heightCells: number
  renderLayer: number
  materialTag: TerrainMaterialTag
}
