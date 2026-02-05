import type { EnemyPatrolMode, EnemyType, WeaponType } from './types'

export type MapObjectKind = 'ground' | 'obstacle'

export type WeaponCategory = 'main' | 'secondary' | 'item'

export type EditorTreeObjectType =
  | 'group'
  | 'player'
  | 'enemy'
  | 'weapon'
  | 'camera'
  | 'checkpoint'
  | 'hookAnchor'
  | 'ground'
  | 'obstacle'

export interface EditorTreeNode {
  type: EditorTreeObjectType
  index?: number
  objectKind?: MapObjectKind
  name?: string
}

export interface EditorTreeData {
  nodes: EditorTreeNode[]
  parents: number[]
}

export interface EditorMapMeta {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  isDefault?: boolean
  thumbnail?: string
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

export interface MapEnemyWeapon {
  weaponType: WeaponType
  sizeLevel: number
  attackDamage: number
  postureDamage: number
  toughnessDamage: number
  bowAmmo?: number
}

export interface MapEnemy {
  x: number
  y: number
  enemyType: EnemyType
  radius?: number
  moveSpeed?: number
  attackDesire?: number
  parryProficiency?: number
  initialPatrolMode?: EnemyPatrolMode
  maxHealth?: number
  maxPosture?: number
  maxToughness?: number
  color?: string
  facing?: number
  debugNoDamage?: boolean
  debugNoDeath?: boolean
  equipWeapon?: boolean
  mainWeapon?: MapEnemyWeapon
  secondaryWeapon?: MapEnemyWeapon
}

export interface MapCheckpoint {
  x: number
  y: number
}

export interface MapHookAnchor {
  x: number
  y: number
}

export interface MapWeapon {
  x: number
  y: number
  weaponType: WeaponType
  category: WeaponCategory
  sizeLevel: number
  attackDamage?: number
  postureDamage?: number
  toughnessDamage?: number
  bowAmmo?: number
}

export interface MapCamera {
  x: number
  y: number
  zoom: number
}

export interface MapPlayerProperties {
  radius?: number
  moveSpeed?: number
  facing?: number
  maxHealth?: number
  maxPosture?: number
  maxToughness?: number
  color?: string
  debugNoDamage?: boolean
  debugNoDeath?: boolean
  mainWeapon?: MapEnemyWeapon
  secondaryWeapon?: MapEnemyWeapon
}

export interface EditorViewportState {
  zoomScaled: number
  offsetX: number
  offsetY: number
}

export interface EditorMapData {
  version: 1
  canvasWidth: number
  canvasHeight: number
  pixelsPerMeter: number
  playerSpawn: MapVector2
  player?: MapPlayerProperties
  camera: MapCamera
  shapes: MapPlacedShape[]
  enemies: MapEnemy[]
  weapons?: MapWeapon[]
  checkpoints?: MapCheckpoint[]
  hookAnchors?: MapHookAnchor[]
  editorTree?: EditorTreeData
}

export interface StoredEditorMap {
  meta: EditorMapMeta
  data: EditorMapData
}
