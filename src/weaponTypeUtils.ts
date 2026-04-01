import type { WeaponType } from './types'

export function normalizeWeaponType(
  weaponType: string | undefined
): WeaponType | undefined {
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

  return {
    weaponType: normalizedWeaponType,
    sizeLevel:
      Number.isFinite(sizeLevel) && sizeLevel !== undefined && sizeLevel > 0
        ? sizeLevel
        : 1,
  }
}
