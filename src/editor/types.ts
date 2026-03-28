import { fabric } from 'fabric'

import type { WeaponCategory } from '../editorMapTypes'
import type {
  EnemyPatrolMode,
  EnemyType,
  NormalAttackMovesetId,
  WeaponType,
} from '../types'

export enum ObjectType {
  Empty = 'empty',
  Player = 'player',
  Enemy = 'enemy',
  Weapon = 'weapon',
  Camera = 'camera',
  Checkpoint = 'checkpoint',
  HookAnchor = 'hookAnchor',
  Ground = 'ground',
  Obstacle = 'obstacle',
  SunPickupSmall = 'sunPickupSmall',
  SunPickupLarge = 'sunPickupLarge',
}

export type GroundShapeType = 'rect' | 'triangle' | 'circle' | 'polygon'

export type CameraFrame = fabric.Rect & {
  editorShape: 'camera-frame'
}

export type PlayerMarker = fabric.Group & {
  editorShape: 'player-marker'
  radius: number
  bodyHeight: number
  maxHealth: number
  maxPosture: number
  maxToughness: number
  color: string
  facing: number
  initialNormalMovesetId: NormalAttackMovesetId
  debugNoDamage: boolean
  debugNoDeath: boolean
  weaponBackShape?: WeaponShape
  weaponFrontShape?: WeaponShape
}

export type EnemyMarker = fabric.Group & {
  editorShape: 'enemy-marker'
  enemyType: EnemyType
  radius: number
  bodyHeight: number
  moveSpeed: number
  attackDesire: number
  parryProficiency: number
  initialPatrolMode: EnemyPatrolMode
  maxHealth: number
  maxPosture: number
  maxToughness: number
  color: string
  facing: number // 1 for right, -1 for left
  initialNormalMovesetId: NormalAttackMovesetId
  debugNoDamage: boolean
  debugNoDeath: boolean
  equipWeapon: boolean
  mainWeapon?: WeaponType
  secondaryWeapon?: WeaponType
  weaponBackShape?: WeaponShape
  weaponFrontShape?: WeaponShape
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

export type CheckpointMarker = fabric.Group & {
  editorShape: 'checkpoint-marker'
}

export type HookAnchorMarker = fabric.Group & {
  editorShape: 'hook-anchor-marker'
}

export type WeaponShape = fabric.Object & {
  weaponWidthPx: number
  weaponHeightPx: number
  weaponBoundingWidthPx: number
  weaponBoundingHeightPx: number
  weaponRenderType: 'sword' | 'spear' | 'hammer' | 'bow' | 'hook'
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

export interface EnemyMarkerData {
  marker: EnemyMarker
  enemyType: EnemyType
  radius: number
  bodyHeight: number
  moveSpeed: number
  attackDesire: number
  parryProficiency: number
  initialPatrolMode: EnemyPatrolMode
  maxHealth: number
  maxPosture: number
  maxToughness: number
  color: string
  facing: number
  initialNormalMovesetId: NormalAttackMovesetId
  debugNoDamage: boolean
  debugNoDeath: boolean
  equipWeapon: boolean
  mainWeapon?: WeaponType
  mainWeaponMarker?: WeaponMarker
  secondaryWeapon?: WeaponType
  secondaryWeaponMarker?: WeaponMarker
}

export interface PlayerMarkerData {
  marker: PlayerMarker
  radius: number
  bodyHeight: number
  moveSpeed: number
  maxHealth: number
  maxPosture: number
  maxToughness: number
  color: string
  facing: number
  initialNormalMovesetId: NormalAttackMovesetId
  debugNoDamage: boolean
  debugNoDeath: boolean
  mainWeapon?: WeaponType
  mainWeaponMarker?: WeaponMarker
  secondaryWeapon?: WeaponType
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

export interface EditorMap {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  isDefault?: boolean
  thumbnail?: string
}

export interface EditorObjectData {
  id: number
  name: string
  type: ObjectType
  object: fabric.Object
  parentId: number | null
}
