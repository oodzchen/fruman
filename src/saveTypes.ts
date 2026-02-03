import type { EditorMapData } from './editorMapTypes'
import type { EnemyType, WeaponVisualType } from './types'

export type EnemyAIState =
  | 'approach'
  | 'combo'
  | 'retreat'
  | 'pacing'
  | 'probe'
  | 'alert'

export interface SaveMeta {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  playTimeMs: number
  mapId: string
  mapName: string
  playerHealth: number
  playerMaxHealth: number
}

export interface SaveWeaponSlotState {
  weaponType: WeaponVisualType
  sizeLevel: number
  width?: number
  height?: number
  baseWidth?: number
  sizeMaxLevel?: number
  cornerRadius?: number
  weight?: number
  attackDamage: number
  postureDamage: number
  toughnessDamage: number
  bowAmmo: number
  bowAmmoMax: number
}

export interface SavePlayerState {
  id?: string
  position: { x: number; y: number }
  facing: number
  health: number
  maxHealth: number
  posture: number
  maxPosture: number
  toughness: number
  maxToughness: number
  mainWeapon: SaveWeaponSlotState | null
  secondaryWeapon: SaveWeaponSlotState | null
  activeSlot: 'main' | 'secondary'
}

export interface SaveEnemyState {
  spawnIndex: number
  id?: string
  enemyType?: EnemyType
  position: { x: number; y: number }
  facing: number
  health: number
  posture: number
  toughness: number
  isDead: boolean
  isVanished: boolean
  aiState: EnemyAIState
  currentWaypointIndex: number
  mainWeapon: SaveWeaponSlotState | null
  secondaryWeapon: SaveWeaponSlotState | null
  activeSlot: 'main' | 'secondary'
}

export interface SaveGroundWeaponState {
  spawnIndex: number
  position: { x: number; y: number }
  weaponType: WeaponVisualType
  sizeLevel: number
  width?: number
  height?: number
  baseWidth?: number
  sizeMaxLevel?: number
  cornerRadius?: number
  weight?: number
  attackDamage: number
  postureDamage: number
  toughnessDamage: number
  bowAmmo: number
  bowAmmoMax: number
}

export interface SaveData {
  version: 1
  meta: SaveMeta
  mapId: string
  mapData: EditorMapData
  playTimeMs: number
  worldStateReady: boolean
  player: SavePlayerState
  enemies: SaveEnemyState[]
  groundWeapons: SaveGroundWeaponState[]
  camera: { x: number; y: number; zoom: number }
}
