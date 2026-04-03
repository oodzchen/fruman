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
]
export const DEFAULT_NPC_WEAPON_DROP_CHANCE = 50

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
    })
  }
  if (secondaryWeaponType) {
    defaultDrops.push({
      itemType: secondaryWeaponType,
      chance: DEFAULT_NPC_WEAPON_DROP_CHANCE,
    })
  }
  return defaultDrops
}

export function isWeaponDropItemType(
  itemType: NpcDropItemType
): itemType is WeaponType {
  return itemType !== 'sunPickupSmall' && itemType !== 'sunPickupLarge'
}
