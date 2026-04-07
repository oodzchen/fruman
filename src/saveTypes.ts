import type { EditorMapData } from './editorMapTypes'
import type { NpcType, WeaponType } from './types'

export type NpcAIState =
  | 'approach'
  | 'combo'
  | 'retreat'
  | 'pacing'
  | 'probe'
  | 'alert'
  | 'leapAttack'
  | 'idle'

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
  thumbnail?: string
}

export interface SaveWeaponSlotState {
  weaponType: WeaponType
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
  hasGrapple?: boolean
  mainWeapon: SaveWeaponSlotState | null
  secondaryWeapon: SaveWeaponSlotState | null
  activeSlot: 'main' | 'secondary'
}

export interface SaveNpcState {
  spawnIndex: number
  id?: string
  npcType?: NpcType
  enemyType?: NpcType
  position: { x: number; y: number }
  facing: number
  health: number
  posture: number
  toughness: number
  isDead: boolean
  isVanished: boolean
  aiState: NpcAIState
  currentWaypointIndex: number
  mainWeapon: SaveWeaponSlotState | null
  secondaryWeapon: SaveWeaponSlotState | null
  activeSlot: 'main' | 'secondary'
}

export interface SaveGroundWeaponState {
  spawnIndex: number
  position: { x: number; y: number }
  renderLayer?: number
  weaponType: WeaponType
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

export interface SaveGroundSunPickupState {
  spawnIndex: number
  position: { x: number; y: number }
  renderLayer?: number
  isLarge: boolean
}

export interface SaveCheckpointState {
  x: number
  y: number
}

export interface SaveData {
  version: 1
  meta: SaveMeta
  mapId: string
  mapData: EditorMapData
  playTimeMs: number
  worldStateReady: boolean
  activeCheckpoint?: SaveCheckpointState | null
  player: SavePlayerState
  npcs: SaveNpcState[]
  enemies?: SaveNpcState[]
  groundWeapons: SaveGroundWeaponState[]
  groundSunPickups: SaveGroundSunPickupState[]
  camera: { x: number; y: number; zoom: number }
}
