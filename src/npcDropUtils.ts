import type { MapNpcDropItem } from './editorMapTypes'
import type { NpcDropItemType, WeaponType } from './types'

export const NPC_DROP_ITEM_TYPES: NpcDropItemType[] = [
  'sword',
  'spear',
  'hammer',
  'bow',
  'grape',
  'hook',
  'sunPickupSmall',
  'sunPickupLarge',
  'expOrb',
]
export const DEFAULT_NPC_WEAPON_DROP_CHANCE = 50
export const DEFAULT_NPC_EXP_ORB_DROP_CHANCE = 100
export const DEFAULT_NPC_DROP_COUNT = 1
export const MAX_NPC_DROP_COUNT = 999

export function normalizeNpcDropItemType(
  value: string | null | undefined
): NpcDropItemType | null {
  if (!value) {
    return null
  }
  for (let i = 0; i < NPC_DROP_ITEM_TYPES.length; i++) {
    const itemType = NPC_DROP_ITEM_TYPES[i]
    if (itemType === value) {
      return itemType
    }
  }
  return null
}

export function normalizeNpcDropChance(
  chance: number | null | undefined
): number {
  const numericChance = typeof chance === 'number' ? chance : NaN
  if (!Number.isFinite(numericChance)) {
    return 100
  }
  const normalizedChance = Math.round(numericChance)
  if (normalizedChance < 1) {
    return 1
  }
  if (normalizedChance > 100) {
    return 100
  }
  return normalizedChance
}

export function normalizeNpcDropCount(
  count: number | null | undefined
): number {
  const numericCount = typeof count === 'number' ? count : NaN
  if (!Number.isFinite(numericCount)) {
    return DEFAULT_NPC_DROP_COUNT
  }
  const normalizedCount = Math.round(numericCount)
  if (normalizedCount < 1) {
    return 1
  }
  if (normalizedCount > MAX_NPC_DROP_COUNT) {
    return MAX_NPC_DROP_COUNT
  }
  return normalizedCount
}

export function normalizeNpcDropList(
  drops: ReadonlyArray<MapNpcDropItem> | null | undefined
): MapNpcDropItem[] {
  if (!drops || drops.length === 0) {
    return []
  }
  const normalizedDrops: MapNpcDropItem[] = []
  for (let i = 0; i < drops.length; i++) {
    const drop = drops[i]
    const itemType = normalizeNpcDropItemType(drop?.itemType)
    if (!itemType) {
      continue
    }
    normalizedDrops.push({
      itemType,
      chance: normalizeNpcDropChance(drop.chance),
      count: normalizeNpcDropCount(drop.count),
    })
  }
  return normalizedDrops
}

export function buildDefaultNpcDropList(
  mainWeaponType?: WeaponType,
  secondaryWeaponType?: WeaponType
): MapNpcDropItem[] {
  const defaultDrops: MapNpcDropItem[] = []
  if (mainWeaponType) {
    defaultDrops.push({
      itemType: mainWeaponType,
      chance: DEFAULT_NPC_WEAPON_DROP_CHANCE,
      count: DEFAULT_NPC_DROP_COUNT,
    })
  }
  if (secondaryWeaponType) {
    defaultDrops.push({
      itemType: secondaryWeaponType,
      chance: DEFAULT_NPC_WEAPON_DROP_CHANCE,
      count: DEFAULT_NPC_DROP_COUNT,
    })
  }
  defaultDrops.push({
    itemType: 'expOrb',
    chance: DEFAULT_NPC_EXP_ORB_DROP_CHANCE,
    count: DEFAULT_NPC_DROP_COUNT,
  })
  return defaultDrops
}

export function isWeaponDropItemType(
  itemType: NpcDropItemType
): itemType is WeaponType {
  return (
    itemType !== 'sunPickupSmall' &&
    itemType !== 'sunPickupLarge' &&
    itemType !== 'expOrb'
  )
}
