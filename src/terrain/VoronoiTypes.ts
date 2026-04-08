import type { TerrainMaterialTag } from './TerrainTypes'

export interface VoronoiRenderCell {
  cellX: number
  cellY: number
  localCellX: number
  localCellY: number
  materialCode: number
  points: number[]
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
}

export interface VoronoiPickedCell {
  cellX: number
  cellY: number
}
