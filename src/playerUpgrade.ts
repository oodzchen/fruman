import { PLAYER_HEALTH_PER_LEVEL, PLAYER_MAX_LEVEL } from './constants'

export type PlayerUpgradeStat = 'attack' | 'defense' | 'agility' | 'toughness'

export interface PlayerUpgradeLevelsLike {
  attackLevel: number
  defenseLevel: number
  agilityLevel: number
  toughnessLevel: number
}

export const PLAYER_UPGRADE_STAT_ORDER: readonly PlayerUpgradeStat[] = [
  'attack',
  'defense',
  'agility',
  'toughness',
]

export const PLAYER_UPGRADE_MAX_LEVEL = Math.max(0, PLAYER_MAX_LEVEL - 1)

const PLAYER_UPGRADE_STEP_PERCENT = 10
const PLAYER_AGILITY_MAX_BONUS_PERCENT = 100

export function clampPlayerLevel(level: number | undefined): number {
  if (typeof level !== 'number' || !Number.isFinite(level)) {
    return 1
  }
  const rounded = Math.round(level)
  if (rounded < 1) {
    return 1
  }
  if (rounded > PLAYER_MAX_LEVEL) {
    return PLAYER_MAX_LEVEL
  }
  return rounded
}

export function clampPlayerUpgradeLevel(level: number | undefined): number {
  if (typeof level !== 'number' || !Number.isFinite(level)) {
    return 0
  }
  const rounded = Math.round(level)
  if (rounded < 0) {
    return 0
  }
  if (rounded > PLAYER_UPGRADE_MAX_LEVEL) {
    return PLAYER_UPGRADE_MAX_LEVEL
  }
  return rounded
}

export function getPlayerUpgradeLevel(
  levels: PlayerUpgradeLevelsLike,
  stat: PlayerUpgradeStat
): number {
  switch (stat) {
    case 'attack':
      return clampPlayerUpgradeLevel(levels.attackLevel)
    case 'defense':
      return clampPlayerUpgradeLevel(levels.defenseLevel)
    case 'agility':
      return clampPlayerUpgradeLevel(levels.agilityLevel)
    case 'toughness':
      return clampPlayerUpgradeLevel(levels.toughnessLevel)
  }
}

export function setPlayerUpgradeLevel(
  levels: PlayerUpgradeLevelsLike,
  stat: PlayerUpgradeStat,
  value: number
): void {
  const nextValue = clampPlayerUpgradeLevel(value)
  switch (stat) {
    case 'attack':
      levels.attackLevel = nextValue
      return
    case 'defense':
      levels.defenseLevel = nextValue
      return
    case 'agility':
      levels.agilityLevel = nextValue
      return
    case 'toughness':
      levels.toughnessLevel = nextValue
      return
  }
}

export function isPlayerUpgradeStatMaxed(
  levels: PlayerUpgradeLevelsLike,
  stat: PlayerUpgradeStat
): boolean {
  return getPlayerUpgradeLevel(levels, stat) >= PLAYER_UPGRADE_MAX_LEVEL
}

export function getPlayerAttackBonusPercent(
  levels: PlayerUpgradeLevelsLike
): number {
  return (
    clampPlayerUpgradeLevel(levels.attackLevel) * PLAYER_UPGRADE_STEP_PERCENT
  )
}

export function getPlayerDefenseReductionPercent(
  levels: PlayerUpgradeLevelsLike
): number {
  return (
    clampPlayerUpgradeLevel(levels.defenseLevel) * PLAYER_UPGRADE_STEP_PERCENT
  )
}

export function getPlayerAgilityBonusPercent(
  levels: PlayerUpgradeLevelsLike
): number {
  return getPlayerAgilityBonusPercentByLevel(levels.agilityLevel)
}

function getPlayerAgilityBonusPercentByLevel(
  level: number | undefined
): number {
  const agilityLevel = clampPlayerUpgradeLevel(level)
  if (PLAYER_UPGRADE_MAX_LEVEL <= 0) {
    return 0
  }
  return Math.round(
    (agilityLevel * PLAYER_AGILITY_MAX_BONUS_PERCENT) / PLAYER_UPGRADE_MAX_LEVEL
  )
}

export function getPlayerAgilityScalePercent(
  levels: PlayerUpgradeLevelsLike
): number {
  return 100 + getPlayerAgilityBonusPercent(levels)
}

export function getPlayerToughnessBonusPercent(
  levels: PlayerUpgradeLevelsLike
): number {
  return (
    clampPlayerUpgradeLevel(levels.toughnessLevel) * PLAYER_UPGRADE_STEP_PERCENT
  )
}

export function getPlayerUpgradePreviewPercent(
  levels: PlayerUpgradeLevelsLike,
  stat: PlayerUpgradeStat
): number {
  if (isPlayerUpgradeStatMaxed(levels, stat)) {
    return 0
  }
  if (stat !== 'agility') {
    return PLAYER_UPGRADE_STEP_PERCENT
  }
  const currentLevel = clampPlayerUpgradeLevel(levels.agilityLevel)
  const nextLevel = clampPlayerUpgradeLevel(currentLevel + 1)
  return (
    getPlayerAgilityBonusPercentByLevel(nextLevel) -
    getPlayerAgilityBonusPercentByLevel(currentLevel)
  )
}

export function getPlayerDerivedMaxHealth(
  baseMaxHealth: number,
  level: number
): number {
  const normalizedLevel = clampPlayerLevel(level)
  return Math.max(
    1,
    baseMaxHealth + (normalizedLevel - 1) * PLAYER_HEALTH_PER_LEVEL
  )
}

export function getPlayerDerivedMaxToughness(
  baseMaxToughness: number,
  levels: PlayerUpgradeLevelsLike
): number {
  const scalePercent = 100 + getPlayerToughnessBonusPercent(levels)
  return Math.max(0, (baseMaxToughness * scalePercent) / 100)
}
