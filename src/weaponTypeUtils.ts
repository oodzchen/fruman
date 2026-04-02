import {
  DEFAULT_BOW_AMMO_ENEMY,
  DEFAULT_BOW_AMMO_PLAYER,
  DEFAULT_GRAPE_AMMO_ENEMY,
  DEFAULT_GRAPE_AMMO_PLAYER,
  DEFAULT_WEAPON_GROUND_ROTATION_RAD,
  GRAPE_MIN_FORCE_RATIO,
} from './constants'
import type { WeaponType, WeaponVisualType } from './types'

export function normalizeWeaponType(
  weaponType: string | undefined
): WeaponType | undefined {
  if (
    weaponType === 'sword' ||
    weaponType === 'spear' ||
    weaponType === 'hammer' ||
    weaponType === 'bow' ||
    weaponType === 'grape' ||
    weaponType === 'hook'
  ) {
    return weaponType
  }
  return undefined
}

export function isRangedWeaponType(
  weaponType: string | undefined
): weaponType is Extract<WeaponType, 'bow' | 'grape'> {
  return weaponType === 'bow' || weaponType === 'grape'
}

export function isRangedAttackWeaponVisualType(
  weaponType: string | undefined
): weaponType is Extract<
  WeaponVisualType,
  'bow' | 'grape' | 'arrow' | 'grapeShot'
> {
  return (
    weaponType === 'bow' ||
    weaponType === 'grape' ||
    weaponType === 'arrow' ||
    weaponType === 'grapeShot'
  )
}

export function isSecondaryWeaponType(
  weaponType: string | undefined
): weaponType is Extract<WeaponType, 'bow' | 'grape'> {
  return isRangedWeaponType(weaponType)
}

export function getDefaultPlayerAmmoForWeaponType(
  weaponType: string | undefined
): number {
  return weaponType === 'grape'
    ? DEFAULT_GRAPE_AMMO_PLAYER
    : DEFAULT_BOW_AMMO_PLAYER
}

export function getDefaultNpcAmmoForWeaponType(
  weaponType: string | undefined
): number {
  return weaponType === 'grape'
    ? DEFAULT_GRAPE_AMMO_ENEMY
    : DEFAULT_BOW_AMMO_ENEMY
}

export function getGrapeChargeRangeScale(drawRatio: number): number {
  const clamped = Math.max(0, Math.min(1, drawRatio))
  if (clamped <= GRAPE_MIN_FORCE_RATIO) {
    return 1
  }

  const forceRatio = Math.min(
    1,
    Math.max(0, (clamped - GRAPE_MIN_FORCE_RATIO) / (1 - GRAPE_MIN_FORCE_RATIO))
  )
  return 1 + forceRatio * 0.2
}

export function getWeaponGroundRotationRad(
  weaponType: string | undefined
): number {
  return weaponType === 'grape'
    ? -DEFAULT_WEAPON_GROUND_ROTATION_RAD
    : DEFAULT_WEAPON_GROUND_ROTATION_RAD
}

export function getWeaponStaggerDropRotationRad(
  weaponType: string | undefined
): number {
  return weaponType === 'grape' ? Math.PI / 2 : 0
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
