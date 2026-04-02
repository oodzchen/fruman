import type { EditorMapData, MapCharacterBodyProfile } from './editorMapTypes'

export const CHARACTER_BODY_DRAW_SIZE = 128
export const CHARACTER_BODY_DRAW_HALF = CHARACTER_BODY_DRAW_SIZE / 2
export const PLAYER_BODY_PROFILE_INDEX = 1
export const ENEMY_BODY_PROFILE_INDEX_START = 2
export const DEFAULT_CHARACTER_EYE_X = 32
export const DEFAULT_CHARACTER_EYE_Y = -32
const MIN_CHARACTER_EYE_COORD = -56
const MAX_CHARACTER_EYE_COORD = 56

function getPositiveProfileSize(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : 0
}

function getProfilePointBounds(points: number[]): {
  width: number
  height: number
} | null {
  if (points.length < 6) {
    return null
  }
  let minX = points[0]
  let maxX = points[0]
  let minY = points[1]
  let maxY = points[1]
  for (let i = 2; i < points.length; i += 2) {
    const x = points[i]
    const y = points[i + 1]
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  return {
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  }
}

function hasProfileAbsoluteSize(
  profile: MapCharacterBodyProfile | null | undefined
): boolean {
  return getPositiveProfileSize(profile?.width) > 0
}

function getProfileReferenceWidth(
  profile: MapCharacterBodyProfile | null | undefined
): number {
  if (!hasProfileAbsoluteSize(profile)) {
    return CHARACTER_BODY_DRAW_SIZE
  }
  return (
    getProfilePointBounds(profile?.points ?? [])?.width ??
    CHARACTER_BODY_DRAW_SIZE
  )
}

function getProfileReferenceHeight(
  profile: MapCharacterBodyProfile | null | undefined
): number {
  if (!hasProfileAbsoluteSize(profile)) {
    return CHARACTER_BODY_DRAW_SIZE
  }
  return (
    getProfilePointBounds(profile?.points ?? [])?.height ??
    CHARACTER_BODY_DRAW_SIZE
  )
}

export function getCharacterBodyProfileWidth(
  profile: MapCharacterBodyProfile | null | undefined
): number {
  return getPositiveProfileSize(profile?.width)
}

export function getCharacterBodyProfileHeight(
  profile: MapCharacterBodyProfile | null | undefined
): number {
  const height = getPositiveProfileSize(profile?.height)
  return height > 0 ? height : getPositiveProfileSize(profile?.width)
}

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

export function getCharacterBloodColor(
  profile: MapCharacterBodyProfile | null | undefined,
  fallbackColor: string
): string {
  const color = profile?.bloodColor
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
    if (hasProfileAbsoluteSize(profile)) {
      return profile.eyeX
    }
    return clampCharacterEyeCoord(profile.eyeX)
  }
  return DEFAULT_CHARACTER_EYE_X
}

export function getCharacterEyeDrawY(
  profile: MapCharacterBodyProfile | null | undefined
): number {
  if (typeof profile?.eyeY === 'number' && Number.isFinite(profile.eyeY)) {
    if (hasProfileAbsoluteSize(profile)) {
      return profile.eyeY
    }
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
  const bodyWidth = getCharacterBodyProfileWidth(profile)
  const referenceWidth = getProfileReferenceWidth(profile)
  return (
    (getCharacterEyeDrawX(profile) *
      (bodyWidth > 0 ? bodyWidth : radius * 2) *
      facing) /
    referenceWidth
  )
}

export function getCharacterEyeOffsetY(
  profile: MapCharacterBodyProfile | null | undefined,
  radius: number,
  bodyHeight: number
): number {
  const profileHeight = getCharacterBodyProfileHeight(profile)
  const referenceHeight = getProfileReferenceHeight(profile)
  return (
    (getCharacterEyeDrawY(profile) *
      (profileHeight > 0
        ? profileHeight
        : getCharacterBodyHeight(bodyHeight, radius))) /
    referenceHeight
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
  const width = getCharacterBodyProfileWidth(profile) || radius * 2
  const height =
    getCharacterBodyProfileHeight(profile) ||
    getCharacterBodyHeight(bodyHeight, radius)
  const points = profile.points
  const scaleX = width / getProfileReferenceWidth(profile)
  const scaleY = height / getProfileReferenceHeight(profile)
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
