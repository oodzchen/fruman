import * as fabric from 'fabric'

import type {
  MapCharacterBodyEyeStyle,
  MapCharacterBodyProfile,
  MapEnvironmentFlowerOptions,
  MapEnvironmentKeyVariant,
  MapEnvironmentObjectType,
  MapNpcDropItem,
  MapNpcWeapon,
  WeaponCategory,
} from '../editorMapTypes'
import type { TerrainMaterialId } from '../terrain/TerrainTypes'
import type {
  AttackPickupKind,
  CharacterAttackSpeedLevel,
  NormalAttackMovesetId,
  NpcAttackMove,
  NpcDetectionRangeLevel,
  NpcPatrolMode,
  NpcType,
  WeaponType,
} from '../types'

export enum ObjectType {
  Empty = 'empty',
  Player = 'player',
  Npc = 'npc',
  Weapon = 'weapon',
  Camera = 'camera',
  Checkpoint = 'checkpoint',
  HookAnchor = 'hookAnchor',
  Ground = 'ground',
  Obstacle = 'obstacle',
  Terrain = 'terrain',
  ReferenceLine = 'referenceLine',
  SunPickupSmall = 'sunPickupSmall',
  SunPickupLarge = 'sunPickupLarge',
  ExpOrb = 'expOrb',
  AttackPickup = 'attackPickup',
  EnvTree = 'envTree',
  EnvHill = 'envHill',
  EnvHouse = 'envHouse',
  EnvCrate = 'envCrate',
  EnvGrass = 'envGrass',
  EnvFlower = 'envFlower',
  EnvCloud = 'envCloud',
  EnvKey = 'envKey',
  EnvCustom = 'envCustom',
}

export type GroundShapeType = 'rect' | 'triangle' | 'circle' | 'polygon'

export type CameraFrame = fabric.Rect & {
  editorShape: 'camera-frame'
}

export type EditorEmptyObject = fabric.Group & {
  editorShape: 'editor-empty'
  isGroupContainer: boolean
}

export type PlayerMarker = fabric.Group & {
  editorShape: 'player-marker'
  radius: number
  bodyHeight: number
  bodyProfile?: MapCharacterBodyProfile
  maxHealth: number
  maxPosture: number
  maxToughness: number
  color: string
  facing: number
  initialNormalMovesetId: NormalAttackMovesetId
  attackSpeedLevel: CharacterAttackSpeedLevel
  maxComboCount: number
  debugNoDamage: boolean
  debugNoDeath: boolean
  factionId: string
  npcFactions: string[]
  allyFactions: string[]
  weaponBackShape?: WeaponShape
  weaponFrontShape?: WeaponShape
}

export type NpcMarker = fabric.Object & {
  editorShape: 'npc-marker'
  npcType: NpcType
  radius: number
  bodyHeight: number
  bodyProfile?: MapCharacterBodyProfile
  moveSpeed: number
  attackDesire: number
  parryProficiency: number
  initialPatrolMode: NpcPatrolMode
  detectionRangeLevel: NpcDetectionRangeLevel
  maxHealth: number
  maxPosture: number
  maxToughness: number
  color: string
  facing: number // 1 for right, -1 for left
  initialNormalMovesetId: NormalAttackMovesetId
  attackMoves: NpcAttackMove[]
  attackSpeedLevel: CharacterAttackSpeedLevel
  maxComboCount: number
  debugNoDamage: boolean
  debugNoDeath: boolean
  redTapeEnabled: boolean
  retreatEnabled: boolean
  retreatDelaySec: number
  canBeFollower: boolean
  equipWeapon: boolean
  factionId: string
  npcFactions: string[]
  allyFactions: string[]
  drops: MapNpcDropItem[]
  mainWeapon?: WeaponType
  secondaryWeapon?: WeaponType
  bodyRadiusXPx: number
  bodyRadiusYPx: number
  bodyTextureImage: HTMLImageElement | null
  eyeColor: string
  weaponVisible: boolean
  weaponWidthPx: number
  weaponHeightPx: number
  weaponBoundingWidthPx: number
  weaponBoundingHeightPx: number
  weaponRenderType: WeaponShape['weaponRenderType']
  weaponLeft: number
  weaponTop: number
  weaponAngle: number
  weaponDrawBehind: boolean
}

export type WeaponMarker = fabric.Group & {
  editorShape: 'weapon-marker'
  weaponType: WeaponType
  category: WeaponCategory
  sizeLevel: number
  attackDamage: number
  postureDamage: number
  toughnessDamage: number
  bowAmmo?: number
}

export type CheckpointMarker = fabric.Object & {
  editorShape: 'checkpoint-marker'
  cellStroke: boolean
}

export type HookAnchorMarker = fabric.Group & {
  editorShape: 'hook-anchor-marker'
}

export type TerrainRegionProxy = fabric.Group & {
  editorShape: 'terrain-region-proxy'
  terrainLayerId: number
  terrainMaterialId: TerrainMaterialId
  terrainCellKeys: number[]
  terrainAnchorLeft: number
  terrainAnchorTop: number
}

export type TerrainContourProxy = fabric.FabricObject & {
  editorShape: 'terrain-contour-proxy'
  terrainContourId: number
  terrainContourAnchorLeft: number
  terrainContourAnchorTop: number
  terrainContourWidth: number
  terrainContourHeight: number
}

export type EditorLayeredObject = fabric.Object & {
  renderLayer?: number
}

export type WeaponShape = fabric.Object & {
  weaponWidthPx: number
  weaponHeightPx: number
  weaponBoundingWidthPx: number
  weaponBoundingHeightPx: number
  weaponRenderType:
    | 'sword'
    | 'spear'
    | 'hammer'
    | 'bow'
    | 'grape'
    | 'hook'
    | 'bomb'
}

export type CharacterBodyShapeObject = fabric.Object & {
  bodyRadiusXPx: number
  bodyRadiusYPx: number
  bodyColor: string
  bodyFacing: number
  eyeColor: string
  defaultEyeStyle: MapCharacterBodyEyeStyle
  bodyProfile: MapCharacterBodyProfile | null
  bodyTextureImage: HTMLImageElement | null
}

export type ShapeResetData =
  | { kind: 'rect'; width: number; height: number }
  | { kind: 'circle'; radius: number }
  | { kind: 'triangle'; points: ReadonlyArray<readonly [number, number]> }
  | { kind: 'polygon'; points: ReadonlyArray<readonly [number, number]> }

export interface CameraViewData {
  frame: CameraFrame
  icon: fabric.Group
  zoom: number
  baseWidth: number
  baseHeight: number
}

export interface NpcMarkerData {
  marker: NpcMarker
  npcType: NpcType
  radius: number
  bodyHeight: number
  bodyProfile?: MapCharacterBodyProfile
  moveSpeed: number
  attackDesire: number
  parryProficiency: number
  initialPatrolMode: NpcPatrolMode
  detectionRangeLevel: NpcDetectionRangeLevel
  maxHealth: number
  maxPosture: number
  maxToughness: number
  color: string
  facing: number
  initialNormalMovesetId: NormalAttackMovesetId
  attackMoves: NpcAttackMove[]
  attackSpeedLevel: CharacterAttackSpeedLevel
  maxComboCount: number
  debugNoDamage: boolean
  debugNoDeath: boolean
  redTapeEnabled: boolean
  retreatEnabled: boolean
  retreatDelaySec: number
  canBeFollower: boolean
  equipWeapon: boolean
  factionId: string
  npcFactions: string[]
  allyFactions: string[]
  drops: MapNpcDropItem[]
  mainWeapon?: WeaponType
  mainWeaponConfig?: MapNpcWeapon
  mainWeaponMarker?: WeaponMarker
  secondaryWeapon?: WeaponType
  secondaryWeaponConfig?: MapNpcWeapon
  secondaryWeaponMarker?: WeaponMarker
}

export interface PlayerMarkerData {
  marker: PlayerMarker
  radius: number
  bodyHeight: number
  bodyProfile?: MapCharacterBodyProfile
  moveSpeed: number
  maxHealth: number
  maxPosture: number
  maxToughness: number
  color: string
  facing: number
  initialNormalMovesetId: NormalAttackMovesetId
  attackSpeedLevel: CharacterAttackSpeedLevel
  maxComboCount: number
  debugNoDamage: boolean
  debugNoDeath: boolean
  factionId: string
  npcFactions: string[]
  allyFactions: string[]
  mainWeapon?: WeaponType
  mainWeaponConfig?: MapNpcWeapon
  mainWeaponMarker?: WeaponMarker
  secondaryWeapon?: WeaponType
  secondaryWeaponConfig?: MapNpcWeapon
  secondaryWeaponMarker?: WeaponMarker
}

export interface WeaponMarkerData {
  marker: WeaponMarker
  weaponType: WeaponType
  category: WeaponCategory
  sizeLevel: number
  attackDamage: number
  postureDamage: number
  toughnessDamage: number
  bowAmmo?: number
}

export interface CheckpointMarkerData {
  marker: CheckpointMarker
  cellStroke: boolean
}

export interface HookAnchorMarkerData {
  marker: HookAnchorMarker
}

export type SunPickupMarker = fabric.Group & {
  editorShape: 'sun-pickup-marker'
  isLarge: boolean
}

export interface SunPickupMarkerData {
  marker: SunPickupMarker
  isLarge: boolean
}

export type ExpOrbMarker = fabric.Group & {
  editorShape: 'exp-orb-marker'
}

export interface ExpOrbMarkerData {
  marker: ExpOrbMarker
}

export type AttackPickupMarker = fabric.Object & {
  editorShape: 'attack-pickup-marker'
  weaponType: WeaponType
  pickupKind: AttackPickupKind
}

export interface AttackPickupMarkerData {
  marker: AttackPickupMarker
  weaponType: WeaponType
  kind: AttackPickupKind
}

export type EnvironmentMarker = fabric.Object & {
  editorShape: 'environment-marker'
  envType: MapEnvironmentObjectType
  envSeed: number
  envAssetId: string
  anchorDX: number
  anchorDY: number
  scaleXPermille: number
  scaleYPermille: number
  cellStroke: boolean
  flowerOptions: MapEnvironmentFlowerOptions | null
  keyText: string
  keyVariants: MapEnvironmentKeyVariant[]
}

export interface EnvironmentMarkerData {
  marker: EnvironmentMarker
  envType: MapEnvironmentObjectType
  envSeed: number
  envAssetId: string
  cellStroke: boolean
  flowerOptions: MapEnvironmentFlowerOptions | null
  keyText: string
  keyVariants: MapEnvironmentKeyVariant[]
}

export interface EditorMap {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  isDefault?: boolean
  thumbnail?: string
  source?: 'builtInDefault' | 'publicMapData'
  sourceDataHash?: string
  sourceVersion?: string
}

export interface EditorObjectData {
  id: number
  name: string
  type: ObjectType
  object: fabric.Object
  parentId: number | null
  isLocked: boolean
  isVisible: boolean
  hasControlsWhenUnlocked: boolean
  borderColorWhenUnlocked?: string
  cornerColorWhenUnlocked?: string
  cornerStrokeColorWhenUnlocked?: string
}
