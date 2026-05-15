import type { TerrainMaterialTag } from './TerrainTypes'

export interface VoronoiRenderCell {
  cellX: number
  cellY: number
  localCellX: number
  localCellY: number
  materialCode: number
  aboveMaterialCode: number
  points: number[]
  minX: number
  minY: number
  maxX: number
  maxY: number
  minCellX: number
  minCellY: number
  maxCellX: number
  maxCellY: number
}

export interface VoronoiCollisionPolygon {
  materialTag: TerrainMaterialTag
  renderLayer: number
  materialCode: number
  centerX: number
  centerY: number
  halfWidth: number
  halfHeight: number
  points: number[]
  preferExactDecomp?: boolean
}

export interface VoronoiPickedCell {
  cellX: number
  cellY: number
}
