import type { EditorMapData, MapCharacterBodyProfile } from './editorMapTypes'

export const CHARACTER_BODY_DRAW_SIZE = 128
export const CHARACTER_BODY_DRAW_HALF = CHARACTER_BODY_DRAW_SIZE / 2
export const PLAYER_BODY_PROFILE_INDEX = 1
export const ENEMY_BODY_PROFILE_INDEX_START = 2
export const DEFAULT_CHARACTER_EYE_X = 32
export const DEFAULT_CHARACTER_EYE_Y = -32
const MIN_CHARACTER_EYE_COORD = -56
const MAX_CHARACTER_EYE_COORD = 56

export function isValidCharacterBodyProfile(
  profile: MapCharacterBodyProfile | null | undefined
): profile is MapCharacterBodyProfile {
  return !!profile && profile.points.length >= 6
}

export function getCharacterBodyColor(
  profile: MapCharacterBodyProfile | null | undefined,
  fallbackColor: string
): string {
  const color = profile?.color
  if (typeof color === 'string' && /^#[0-9a-fA-F]{6}$/.test(color)) {
    return color
  }
  return fallbackColor
}

export function clampCharacterEyeCoord(value: number): number {
  if (!Number.isFinite(value)) {
    return 0
  }
  return Math.max(
    MIN_CHARACTER_EYE_COORD,
    Math.min(MAX_CHARACTER_EYE_COORD, Math.round(value))
  )
}

export function getCharacterEyeDrawX(
  profile: MapCharacterBodyProfile | null | undefined
): number {
  if (typeof profile?.eyeX === 'number' && Number.isFinite(profile.eyeX)) {
    return clampCharacterEyeCoord(profile.eyeX)
  }
  return DEFAULT_CHARACTER_EYE_X
}

export function getCharacterEyeDrawY(
  profile: MapCharacterBodyProfile | null | undefined
): number {
  if (typeof profile?.eyeY === 'number' && Number.isFinite(profile.eyeY)) {
    return clampCharacterEyeCoord(profile.eyeY)
  }
  return DEFAULT_CHARACTER_EYE_Y
}

export function getCharacterEyeOffsetX(
  profile: MapCharacterBodyProfile | null | undefined,
  radius: number,
  facingDirection: number
): number {
  const facing = facingDirection < 0 ? -1 : 1
  return (
    (getCharacterEyeDrawX(profile) * radius * 2 * facing) /
    CHARACTER_BODY_DRAW_SIZE
  )
}

export function getCharacterEyeOffsetY(
  profile: MapCharacterBodyProfile | null | undefined,
  radius: number,
  bodyHeight: number
): number {
  return (
    (getCharacterEyeDrawY(profile) *
      getCharacterBodyHeight(bodyHeight, radius)) /
    CHARACTER_BODY_DRAW_SIZE
  )
}

export function getEnemyBodyProfileIndex(enemyIndex: number): number {
  return ENEMY_BODY_PROFILE_INDEX_START + enemyIndex
}

export function getCharacterBodyHeight(
  bodyHeight: number,
  radius: number
): number {
  return bodyHeight > 0 ? bodyHeight : radius * 2
}

export function buildCharacterBodyLocalPoints(
  profile: MapCharacterBodyProfile | null | undefined,
  radius: number,
  bodyHeight: number
): number[] | null {
  if (!isValidCharacterBodyProfile(profile) || radius <= 0) {
    return null
  }
  const width = radius * 2
  const height = getCharacterBodyHeight(bodyHeight, radius)
  const points = profile.points
  const scaleX = width / CHARACTER_BODY_DRAW_SIZE
  const scaleY = height / CHARACTER_BODY_DRAW_SIZE
  const localPoints = new Array<number>(points.length)
  for (let i = 0; i < points.length; i += 2) {
    localPoints[i] = points[i] * scaleX
    localPoints[i + 1] = points[i + 1] * scaleY
  }
  return localPoints
}

export function getCharacterBodyProfileFromMap(
  map: EditorMapData | null,
  profileIndex: number
): MapCharacterBodyProfile | null {
  if (!map || profileIndex <= 0) {
    return null
  }
  if (profileIndex === PLAYER_BODY_PROFILE_INDEX) {
    return map.player?.bodyProfile ?? null
  }
  const enemyIndex = profileIndex - ENEMY_BODY_PROFILE_INDEX_START
  if (enemyIndex < 0 || enemyIndex >= map.enemies.length) {
    return null
  }
  return map.enemies[enemyIndex]?.bodyProfile ?? null
}
