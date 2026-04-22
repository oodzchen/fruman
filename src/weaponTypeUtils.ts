import {
  DEFAULT_BOMB_AMMO_ENEMY,
  DEFAULT_BOMB_AMMO_PLAYER,
  DEFAULT_BOW_AMMO_ENEMY,
  DEFAULT_BOW_AMMO_PLAYER,
  DEFAULT_GRAPE_AMMO_ENEMY,
  DEFAULT_GRAPE_AMMO_PLAYER,
  DEFAULT_WEAPON_GROUND_ROTATION_RAD,
  GRAPE_MIN_FORCE_RATIO,
  WEAPON_DEFAULT_DATA,
} from './constants'
import type { WeaponTemplate, WeaponType, WeaponVisualType } from './types'

const WEAPON_SIZE_UP_NUMERATOR = 6
const WEAPON_SIZE_DOWN_NUMERATOR = 4
const WEAPON_SIZE_SCALE_DENOMINATOR = 5
const WEAPON_ATTACK_SIZE_UP_NUMERATOR = 9
const WEAPON_ATTACK_SIZE_UP_DENOMINATOR = 5
const WEAPON_ATTACK_SIZE_DOWN_NUMERATOR = 5
const WEAPON_ATTACK_SIZE_DOWN_DENOMINATOR = 9
const WEAPON_STAT_FIXED_SCALE = 100
const LEGACY_WEAPON_STAT_EPSILON = 0.0001

type SizedWeaponTemplate = (typeof WEAPON_DEFAULT_DATA)[WeaponType]

export interface WeaponSizeAdjustedStats {
  attackDamage: number
  postureDamage: number
  toughnessDamage: number
}

function getWeaponBaseSizeLevel(
  template: WeaponTemplate | SizedWeaponTemplate
): number {
  return template.sizeLevel > 0 ? template.sizeLevel : 1
}

function roundScaledDivision(
  value: number,
  numerator: number,
  denominator: number
): number {
  return Math.floor((value * numerator + denominator / 2) / denominator)
}

function scaleWeaponStatBySizeSteps(
  baseValue: number,
  stepDelta: number
): number {
  if (!Number.isFinite(baseValue) || baseValue <= 0 || stepDelta === 0) {
    return baseValue
  }

  let scaledValue = Math.round(baseValue * WEAPON_STAT_FIXED_SCALE)
  if (stepDelta > 0) {
    for (let i = 0; i < stepDelta; i++) {
      scaledValue = roundScaledDivision(
        scaledValue,
        WEAPON_SIZE_UP_NUMERATOR,
        WEAPON_SIZE_SCALE_DENOMINATOR
      )
    }
  } else {
    for (let i = 0; i < -stepDelta; i++) {
      scaledValue = roundScaledDivision(
        scaledValue,
        WEAPON_SIZE_DOWN_NUMERATOR,
        WEAPON_SIZE_SCALE_DENOMINATOR
      )
    }
  }

  return scaledValue / WEAPON_STAT_FIXED_SCALE
}

function computeLegacyWeaponStatValue(
  template: WeaponTemplate | SizedWeaponTemplate,
  sizeLevel: number,
  baseValue: number
): number {
  return baseValue * computeWeaponScaleFactor(template, sizeLevel)
}

function shouldMigrateLegacyWeaponStatValue(
  template: WeaponTemplate | SizedWeaponTemplate,
  sizeLevel: number,
  currentValue: number,
  baseValue: number
): boolean {
  if (!Number.isFinite(currentValue)) {
    return true
  }

  const legacyValue = computeLegacyWeaponStatValue(
    template,
    sizeLevel,
    baseValue
  )
  return Math.abs(currentValue - legacyValue) <= LEGACY_WEAPON_STAT_EPSILON
}

function computePreviousStepWeaponStatValue(
  template: WeaponTemplate | SizedWeaponTemplate,
  sizeLevel: number,
  baseValue: number
): number {
  const baseLevel = getWeaponBaseSizeLevel(template)
  const currentLevel =
    Number.isFinite(sizeLevel) && sizeLevel > 0
      ? Math.round(sizeLevel)
      : baseLevel
  return scaleWeaponStatBySizeSteps(baseValue, currentLevel - baseLevel)
}

function shouldMigrateLegacyWeaponAttackValue(
  template: WeaponTemplate | SizedWeaponTemplate,
  sizeLevel: number,
  currentValue: number
): boolean {
  if (
    shouldMigrateLegacyWeaponStatValue(
      template,
      sizeLevel,
      currentValue,
      template.attackDamage
    )
  ) {
    return true
  }

  const previousStepValue = computePreviousStepWeaponStatValue(
    template,
    sizeLevel,
    template.attackDamage
  )
  return (
    Math.abs(currentValue - previousStepValue) <= LEGACY_WEAPON_STAT_EPSILON
  )
}

function computeWeaponAttackDamageFromMinSize(
  template: WeaponTemplate | SizedWeaponTemplate,
  sizeLevel: number
): number {
  const baseLevel = getWeaponBaseSizeLevel(template)
  const currentLevel =
    Number.isFinite(sizeLevel) && sizeLevel > 0
      ? Math.max(1, Math.round(sizeLevel))
      : baseLevel
  let scaledValue = Math.round(template.attackDamage * WEAPON_STAT_FIXED_SCALE)

  for (let i = 1; i < baseLevel; i++) {
    scaledValue = roundScaledDivision(
      scaledValue,
      WEAPON_ATTACK_SIZE_DOWN_NUMERATOR,
      WEAPON_ATTACK_SIZE_DOWN_DENOMINATOR
    )
  }

  for (let i = 1; i < currentLevel; i++) {
    scaledValue = roundScaledDivision(
      scaledValue,
      WEAPON_ATTACK_SIZE_UP_NUMERATOR,
      WEAPON_ATTACK_SIZE_UP_DENOMINATOR
    )
  }

  return scaledValue / WEAPON_STAT_FIXED_SCALE
}

export function normalizeWeaponType(
  weaponType: string | undefined
): WeaponType | undefined {
  if (
    weaponType === 'sword' ||
    weaponType === 'spear' ||
    weaponType === 'hammer' ||
    weaponType === 'bow' ||
    weaponType === 'grape' ||
    weaponType === 'hook' ||
    weaponType === 'bomb'
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

export function isAmmoLimitedWeaponType(
  weaponType: string | undefined
): weaponType is Extract<WeaponType, 'bow' | 'grape' | 'bomb'> {
  return weaponType === 'bow' || weaponType === 'grape' || weaponType === 'bomb'
}

export function isConsumableWeaponType(
  weaponType: string | undefined
): weaponType is Extract<WeaponType, 'grape' | 'bomb'> {
  return weaponType === 'grape' || weaponType === 'bomb'
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
): weaponType is Extract<WeaponType, 'bow' | 'grape' | 'bomb'> {
  return weaponType === 'bomb' || weaponType === 'bow' || weaponType === 'grape'
}

export function getDefaultPlayerAmmoForWeaponType(
  weaponType: string | undefined
): number {
  return weaponType === 'bomb'
    ? DEFAULT_BOMB_AMMO_PLAYER
    : weaponType === 'grape'
      ? DEFAULT_GRAPE_AMMO_PLAYER
      : DEFAULT_BOW_AMMO_PLAYER
}

export function getDefaultNpcAmmoForWeaponType(
  weaponType: string | undefined
): number {
  return weaponType === 'bomb'
    ? DEFAULT_BOMB_AMMO_ENEMY
    : weaponType === 'grape'
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
    : weaponType === 'bomb'
      ? 0
      : DEFAULT_WEAPON_GROUND_ROTATION_RAD
}

export function getWeaponStaggerDropRotationRad(
  weaponType: string | undefined
): number {
  return weaponType === 'grape' ? Math.PI / 2 : 0
}

export function computeWeaponScaleFactor(
  template: WeaponTemplate | SizedWeaponTemplate,
  sizeLevel: number
): number {
  const baseLevel = getWeaponBaseSizeLevel(template)
  if (!Number.isFinite(sizeLevel) || sizeLevel <= 0) {
    return 1
  }
  return Math.max(0.5, sizeLevel / baseLevel)
}

export function computeWeaponDefaultStats(
  template: WeaponTemplate | SizedWeaponTemplate,
  sizeLevel: number
): WeaponSizeAdjustedStats {
  const baseLevel = getWeaponBaseSizeLevel(template)
  const currentLevel =
    Number.isFinite(sizeLevel) && sizeLevel > 0
      ? Math.round(sizeLevel)
      : baseLevel
  const stepDelta = currentLevel - baseLevel
  return {
    attackDamage: computeWeaponAttackDamageFromMinSize(template, currentLevel),
    postureDamage: scaleWeaponStatBySizeSteps(
      template.postureDamage,
      stepDelta
    ),
    toughnessDamage: scaleWeaponStatBySizeSteps(
      template.toughnessDamage,
      stepDelta
    ),
  }
}

export function resolveWeaponStatsForSize(
  template: WeaponTemplate | SizedWeaponTemplate,
  sizeLevel: number,
  currentStats?: Partial<WeaponSizeAdjustedStats>,
  migrateLegacyLinearDefaults = false
): WeaponSizeAdjustedStats {
  const defaultStats = computeWeaponDefaultStats(template, sizeLevel)
  if (!currentStats) {
    return defaultStats
  }

  const attackDamage = currentStats.attackDamage
  const postureDamage = currentStats.postureDamage
  const toughnessDamage = currentStats.toughnessDamage
  const resolvedAttackDamage =
    typeof attackDamage === 'number' &&
    Number.isFinite(attackDamage) &&
    (!migrateLegacyLinearDefaults ||
      !shouldMigrateLegacyWeaponAttackValue(template, sizeLevel, attackDamage))
      ? attackDamage
      : defaultStats.attackDamage
  const resolvedPostureDamage =
    typeof postureDamage === 'number' &&
    Number.isFinite(postureDamage) &&
    (!migrateLegacyLinearDefaults ||
      !shouldMigrateLegacyWeaponStatValue(
        template,
        sizeLevel,
        postureDamage,
        template.postureDamage
      ))
      ? postureDamage
      : defaultStats.postureDamage
  const resolvedToughnessDamage =
    typeof toughnessDamage === 'number' &&
    Number.isFinite(toughnessDamage) &&
    (!migrateLegacyLinearDefaults ||
      !shouldMigrateLegacyWeaponStatValue(
        template,
        sizeLevel,
        toughnessDamage,
        template.toughnessDamage
      ))
      ? toughnessDamage
      : defaultStats.toughnessDamage

  return {
    attackDamage: resolvedAttackDamage,
    postureDamage: resolvedPostureDamage,
    toughnessDamage: resolvedToughnessDamage,
  }
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
