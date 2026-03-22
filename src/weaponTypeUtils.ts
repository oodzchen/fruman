import type { WeaponType, WeaponVisualType } from './types'

export type LegacyWeaponType = 'shortSword' | 'longSword' | 'bigHammer'
export type LegacyWeaponVisualType = LegacyWeaponType | WeaponVisualType

export function isLegacyWeaponType(
  weaponType: string
): weaponType is LegacyWeaponType {
  return (
    weaponType === 'shortSword' ||
    weaponType === 'longSword' ||
    weaponType === 'bigHammer'
  )
}

export function normalizeWeaponType(
  weaponType: string | undefined
): WeaponType | undefined {
  if (weaponType === 'shortSword' || weaponType === 'longSword') {
    return 'sword'
  }
  if (weaponType === 'bigHammer') {
    return 'hammer'
  }
  if (
    weaponType === 'sword' ||
    weaponType === 'spear' ||
    weaponType === 'hammer' ||
    weaponType === 'bow' ||
    weaponType === 'hook'
  ) {
    return weaponType
  }
  return undefined
}

export function normalizeWeaponTypeAndSizeLevel(
  weaponType: string | undefined,
  sizeLevel: number | undefined
): { weaponType: WeaponType; sizeLevel: number } | null {
  const normalizedWeaponType = normalizeWeaponType(weaponType)
  if (!normalizedWeaponType) {
    return null
  }

  if (weaponType === 'shortSword') {
    return { weaponType: 'sword', sizeLevel: 1 }
  }
  if (weaponType === 'longSword') {
    return { weaponType: 'sword', sizeLevel: 3 }
  }
  if (weaponType === 'bigHammer') {
    return { weaponType: 'hammer', sizeLevel: 2 }
  }

  return {
    weaponType: normalizedWeaponType,
    sizeLevel:
      Number.isFinite(sizeLevel) && sizeLevel !== undefined && sizeLevel > 0
        ? sizeLevel
        : 1,
  }
}
