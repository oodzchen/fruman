import type { EnemyType } from './types'

export type MapObjectKind = 'ground' | 'obstacle'

export interface EditorMapMeta {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  isDefault?: boolean
}

export interface MapVector2 {
  x: number
  y: number
}

export interface MapRectShape {
  kind: 'rect'
  center: MapVector2
  halfWidth: number
  halfHeight: number
  rotationRad: number
}

export interface MapCircleShape {
  kind: 'circle'
  center: MapVector2
  radius: number
}

// Polygon points are stored as a flat [x0, y0, x1, y1, ...] array in meters.
// This keeps the serialized payload compact and avoids nested temporary objects.
export interface MapPolygonShape {
  kind: 'polygon'
  center: MapVector2
  points: number[]
}

export type MapShape = MapRectShape | MapCircleShape | MapPolygonShape

export interface MapPlacedShape {
  objectKind: MapObjectKind
  shape: MapShape
}

export interface MapEnemy {
  x: number
  y: number
  enemyType: EnemyType
}

export interface MapCamera {
  x: number
  y: number
  zoom: number
}

export interface EditorMapData {
  version: 1
  canvasWidth: number
  canvasHeight: number
  pixelsPerMeter: number
  playerSpawn: MapVector2
  camera: MapCamera
  shapes: MapPlacedShape[]
  enemies: MapEnemy[]
}

export interface StoredEditorMap {
  meta: EditorMapMeta
  data: EditorMapData
}
