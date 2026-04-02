import type {
  EnemyDetectionRangeLevel,
  EnemyPatrolMode,
  EnemyType,
  NormalAttackMovesetId,
  WeaponType,
} from './types'

export type MapWeaponType = WeaponType

export type MapObjectKind = 'ground' | 'obstacle'

export type WeaponCategory = 'main' | 'secondary' | 'item'

export type EditorTreeObjectType =
  | 'empty'
  | 'player'
  | 'enemy'
  | 'weapon'
  | 'camera'
  | 'checkpoint'
  | 'hookAnchor'
  | 'ground'
  | 'obstacle'
  | 'sunPickupSmall'
  | 'sunPickupLarge'

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

export interface MapCharacterBodyProfile {
  points: number[]
  width?: number
  height?: number
  color?: string
  bloodColor?: string
  eyeX?: number
  eyeY?: number
  surfaceDataUrl?: string
  textureDataUrl?: string
}

export type MapShape = MapRectShape | MapCircleShape | MapPolygonShape

export interface MapPlacedShape {
  objectKind: MapObjectKind
  shape: MapShape
}

export interface MapEnemyWeapon {
  weaponType: MapWeaponType
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
  bodyHeight?: number
  bodyProfile?: MapCharacterBodyProfile
  moveSpeed?: number
  attackDesire?: number
  parryProficiency?: number
  initialPatrolMode?: EnemyPatrolMode
  detectionRangeLevel?: EnemyDetectionRangeLevel
  maxHealth?: number
  maxPosture?: number
  maxToughness?: number
  color?: string
  facing?: number
  initialNormalMovesetId?: NormalAttackMovesetId
  debugNoDamage?: boolean
  debugNoDeath?: boolean
  redTapeEnabled?: boolean
  retreatEnabled?: boolean
  retreatDelaySec?: number
  canBeFollower?: boolean
  equipWeapon?: boolean
  mainWeapon?: MapEnemyWeapon
  secondaryWeapon?: MapEnemyWeapon
  factionId?: string
  enemyFactions?: string[]
  allyFactions?: string[]
}

export interface MapCheckpoint {
  x: number
  y: number
}

export interface MapHookAnchor {
  x: number
  y: number
}

export interface MapSunPickup {
  x: number
  y: number
  isLarge: boolean
}

export interface MapWeapon {
  x: number
  y: number
  weaponType: MapWeaponType
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
  bodyHeight?: number
  bodyProfile?: MapCharacterBodyProfile
  moveSpeed?: number
  facing?: number
  maxHealth?: number
  maxPosture?: number
  maxToughness?: number
  color?: string
  debugNoDamage?: boolean
  debugNoDeath?: boolean
  initialNormalMovesetId?: NormalAttackMovesetId
  mainWeapon?: MapEnemyWeapon
  secondaryWeapon?: MapEnemyWeapon
  factionId?: string
  enemyFactions?: string[]
  allyFactions?: string[]
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
  sunPickups?: MapSunPickup[]
  editorTree?: EditorTreeData
  factions?: string[]
}

export interface StoredEditorMap {
  meta: EditorMapMeta
  data: EditorMapData
}
