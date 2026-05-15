import type { MapTerrainData } from './terrain/TerrainTypes'
import type {
  AttackPickupKind,
  NormalAttackMovesetId,
  NpcAttackMove,
  NpcDetectionRangeLevel,
  NpcDropItemType,
  NpcPatrolMode,
  NpcType,
  WeaponType,
} from './types'

export type MapWeaponType = WeaponType

export type MapObjectKind = 'ground' | 'obstacle'

export type WeaponCategory = 'main' | 'secondary' | 'item'

export type MapEnvironmentObjectType =
  | 'tree'
  | 'hill'
  | 'house'
  | 'crate'
  | 'grass'
  | 'flower'
  | 'cloud'
  | 'custom'

export interface MapEnvironmentFlowerOptions {
  rootGrassCount?: number
  clumpWidthPercent?: number
  stemHeightPercent?: number
  stemLeanPercent?: number
  petalCount?: number
  petalLengthPercent?: number
  petalWidthPercent?: number
  petalAngleOffsetDeg?: number
  petalColor?: string
  stamenEnabled?: boolean
  stamenRadiusPercent?: number
  stamenColor?: string
}

export const MAP_TIME_PHASE_IDS = [
  'morning',
  'noon',
  'dusk',
  'night',
  'lateNight',
  'dawn',
] as const

export type MapTimePhaseId = (typeof MAP_TIME_PHASE_IDS)[number]

export const DEFAULT_MAP_TIME_PHASE: MapTimePhaseId = 'night'

export interface MapSettings {
  initialTimePhase?: MapTimePhaseId
}

export interface MapEnvironmentObject {
  type: MapEnvironmentObjectType
  x: number
  y: number
  seed: number
  renderLayer?: number
  assetId?: string
  hidden?: boolean
  rotationDeg?: number
  scaleXPermille?: number
  scaleYPermille?: number
  cellStroke?: boolean
  flowerOptions?: MapEnvironmentFlowerOptions
}

export interface MapEnvironmentAsset {
  id: string
  name: string
  mimeType: string
  width: number
  height: number
  createdAt: number
  updatedAt: number
}

export type MapLightFlickerMode = 'none' | 'candle' | 'torch'

export interface MapLightObject {
  x: number
  y: number
  radius: number
  renderLayer?: number
  color?: string
  intensity?: number
  flicker?: MapLightFlickerMode
  nightOnly?: boolean
}

export interface MapReferenceLine {
  points: number[]
  renderLayer?: number
}

export type EditorTreeObjectType =
  | 'empty'
  | 'player'
  | 'npc'
  | 'enemy'
  | 'weapon'
  | 'camera'
  | 'checkpoint'
  | 'hookAnchor'
  | 'terrain'
  | 'referenceLine'
  | 'ground'
  | 'obstacle'
  | 'sunPickupSmall'
  | 'sunPickupLarge'
  | 'expOrb'
  | 'attackPickup'
  | 'envTree'
  | 'envHill'
  | 'envHouse'
  | 'envCrate'
  | 'envGrass'
  | 'envFlower'
  | 'envCloud'
  | 'envCustom'

export interface EditorTreeNode {
  type: EditorTreeObjectType
  index?: number
  objectKind?: MapObjectKind
  name?: string
  renderLayer?: number
  isGroupContainer?: boolean
  isLocked?: boolean
  isVisible?: boolean
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
  source?: 'builtInDefault' | 'publicMapData'
  sourceDataHash?: string
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

export interface MapCharacterBodyCollisionCircleShape {
  kind: 'circle'
  center: MapVector2
  radius: number
}

export interface MapCharacterBodyCollisionEllipseShape {
  kind: 'ellipse'
  center: MapVector2
  radiusX: number
  radiusY: number
  rotationDeg?: number
}

export interface MapCharacterBodyCollisionCapsuleShape {
  kind: 'capsule'
  center: MapVector2
  halfWidth: number
  halfHeight: number
  rotationDeg?: number
}

export type MapCharacterBodyCollisionShape =
  | MapCharacterBodyCollisionCircleShape
  | MapCharacterBodyCollisionEllipseShape
  | MapCharacterBodyCollisionCapsuleShape

export interface MapCharacterBodyProfile {
  points: number[]
  collisionShapes?: MapCharacterBodyCollisionShape[]
  presetId?: MapCharacterBodyPresetId
  width?: number
  height?: number
  color?: string
  bloodColor?: string
  eyeX?: number
  eyeY?: number
  eyeScaleX?: number
  eyeScaleY?: number
  eyeRotationDeg?: number
  eyeStyle?: MapCharacterBodyEyeStyle
  browStyle?: MapCharacterBodyBrowStyle
  browOffsetX?: number
  browOffsetY?: number
  browScaleX?: number
  browScaleY?: number
  browRotationDeg?: number
  embeddedEye?: boolean
  surfaceOffsetX?: number
  surfaceOffsetY?: number
  surfaceWidth?: number
  surfaceHeight?: number
  layerOrder?: number[]
  layers?: MapCharacterBodyVisualLayer[]
  surfaceDataUrl?: string
  textureDataUrl?: string
  spineKey?: string
  spineAtlasKey?: string
  spineAnimationName?: string
  spineScale?: number
  spineMode?: 'replace' | 'overlay'
  spineSegmentedCollision?: boolean
  skeletalMode?: boolean
  boneSegments?: BoneSegment[]
  skeletalSurfaceDataUrl?: string
  skeletalSurfaceOffsetX?: number
  skeletalSurfaceOffsetY?: number
  skeletalSurfaceWidth?: number
  skeletalSurfaceHeight?: number
}

export type BonePart =
  | 'body'
  | 'head'
  | 'upperArmR'
  | 'forearmR'
  | 'handR'
  | 'upperArmL'
  | 'forearmL'
  | 'handL'
  | 'thighR'
  | 'lowerLegR'
  | 'footR'
  | 'thighL'
  | 'lowerLegL'
  | 'footL'

export interface BoneSegment {
  part: BonePart
  length: number
  width: number
  shapeDataUrl?: string
  shapeOffsetX?: number
  shapeOffsetY?: number
  shapeWidth?: number
  shapeHeight?: number
  pivotX?: number
  pivotY?: number
  tipX?: number
  tipY?: number
  boundaryShapes?: MapCharacterBodyCollisionShape[]
}

export type MapCharacterBodyPresetId =
  | 'banana'
  | 'kiwano'
  | 'pandaAnt'
  | 'pineapple'
  | 'tomato'
  | 'watermelon'

export type MapCharacterBodyEyeStyle =
  | 'standard'
  | 'noOutline'
  | 'pupilOnly'
  | 'cute'
  | 'transparent'

export type MapCharacterBodyBrowStyle =
  | 'none'
  | 'custom'
  | 'thick'
  | 'thin'
  | 'straight'

export interface MapCharacterBodyVisualLayer {
  id: number
  name: string
  kind: 'brow' | 'paint'
  offsetX: number
  offsetY: number
  width: number
  height: number
  dataUrl: string
}

export type MapShape = MapRectShape | MapCircleShape | MapPolygonShape

export interface MapPlacedShape {
  objectKind: MapObjectKind
  renderLayer?: number
  shape: MapShape
}

export interface MapNpcWeapon {
  weaponType: MapWeaponType
  sizeLevel: number
  attackDamage: number
  postureDamage: number
  toughnessDamage: number
  bowAmmo?: number
}

export interface MapNpcDropItem {
  itemType: NpcDropItemType
  chance: number
  count: number
}

export interface MapNpcConfig {
  npcType: NpcType
  enemyType?: NpcType
  radius?: number
  bodyHeight?: number
  bodyProfile?: MapCharacterBodyProfile
  moveSpeed?: number
  attackDesire?: number
  parryProficiency?: number
  initialPatrolMode?: NpcPatrolMode
  detectionRangeLevel?: NpcDetectionRangeLevel
  maxHealth?: number
  maxPosture?: number
  maxToughness?: number
  color?: string
  facing?: number
  initialNormalMovesetId?: NormalAttackMovesetId
  attackMoves?: NpcAttackMove[]
  debugNoDamage?: boolean
  debugNoDeath?: boolean
  redTapeEnabled?: boolean
  retreatEnabled?: boolean
  retreatDelaySec?: number
  canBeFollower?: boolean
  equipWeapon?: boolean
  mainWeapon?: MapNpcWeapon
  secondaryWeapon?: MapNpcWeapon
  drops?: MapNpcDropItem[]
  factionId?: string
  npcFactions?: string[]
  enemyFactions?: string[]
  allyFactions?: string[]
}

export interface MapNpc extends MapNpcConfig {
  x: number
  y: number
}

export interface MapNpcTemplate extends MapNpcConfig {
  id: string
  name: string
}

export interface MapCheckpoint {
  x: number
  y: number
  cellStroke?: boolean
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

export interface MapExpOrb {
  x: number
  y: number
}

export interface MapAttackPickup {
  x: number
  y: number
  weaponType: MapWeaponType
  kind: AttackPickupKind
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
  mainWeapon?: MapNpcWeapon
  secondaryWeapon?: MapNpcWeapon
  factionId?: string
  npcFactions?: string[]
  enemyFactions?: string[]
  allyFactions?: string[]
}

export interface EditorViewportState {
  zoomScaled: number
  offsetX: number
  offsetY: number
}

export interface EditorMapData {
  version: 1 | 2 | 3
  canvasWidth: number
  canvasHeight: number
  pixelsPerMeter: number
  playerSpawn: MapVector2
  settings?: MapSettings
  player?: MapPlayerProperties
  camera: MapCamera
  shapes: MapPlacedShape[]
  npcs: MapNpc[]
  enemies?: MapNpc[]
  weapons?: MapWeapon[]
  checkpoints?: MapCheckpoint[]
  hookAnchors?: MapHookAnchor[]
  sunPickups?: MapSunPickup[]
  expOrbs?: MapExpOrb[]
  attackPickups?: MapAttackPickup[]
  terrain?: MapTerrainData
  referenceLines?: MapReferenceLine[]
  npcTemplates?: MapNpcTemplate[]
  editorTree?: EditorTreeData
  factions?: string[]
  environmentObjects?: MapEnvironmentObject[]
  lights?: MapLightObject[]
}

export interface StoredEditorMap {
  meta: EditorMapMeta
  data: EditorMapData
}
