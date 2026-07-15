import type { CharacterAttackSpeedLevel } from './types'

export const DEFAULT_CHARACTER_ATTACK_SPEED_LEVEL: CharacterAttackSpeedLevel =
  'normal'
export const DEFAULT_CHARACTER_MAX_COMBO_COUNT = 5
export const MIN_CHARACTER_MAX_COMBO_COUNT = 1
export const MAX_CHARACTER_MAX_COMBO_COUNT = 8

export const CHARACTER_ATTACK_SPEED_LEVELS: readonly CharacterAttackSpeedLevel[] =
  ['normal', 'fast', 'very_fast', 'slow', 'very_slow']

const CHARACTER_ATTACK_WINDUP_SCALE_PERCENT: Record<
  CharacterAttackSpeedLevel,
  number
> = {
  very_fast: 80,
  fast: 100,
  normal: 120,
  slow: 140,
  very_slow: 160,
}

export function normalizeCharacterAttackSpeedLevel(
  value: string | undefined
): CharacterAttackSpeedLevel {
  if (value === 'normal') return 'normal'
  if (value === 'very_fast') return 'very_fast'
  if (value === 'slow') return 'slow'
  if (value === 'very_slow') return 'very_slow'
  return DEFAULT_CHARACTER_ATTACK_SPEED_LEVEL
}

export function normalizeCharacterMaxComboCount(
  value: number | undefined
): number {
  if (value === undefined || !Number.isFinite(value)) {
    return DEFAULT_CHARACTER_MAX_COMBO_COUNT
  }
  const intValue = Math.round(value)
  return Math.max(
    MIN_CHARACTER_MAX_COMBO_COUNT,
    Math.min(MAX_CHARACTER_MAX_COMBO_COUNT, intValue)
  )
}

export function scaleCharacterWindupMs(
  baseMs: number,
  attackSpeedLevel: CharacterAttackSpeedLevel
): number {
  if (baseMs <= 0) {
    return 0
  }
  const scalePercent = CHARACTER_ATTACK_WINDUP_SCALE_PERCENT[attackSpeedLevel]
  return Math.max(1, Math.floor((baseMs * scalePercent + 50) / 100))
}
