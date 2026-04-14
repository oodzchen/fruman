import { isHexColorString, normalizeHexColor } from './colorUtils'
import type { EditorMapData, MapCharacterBodyProfile } from './editorMapTypes'

export const CHARACTER_BODY_DRAW_SIZE = 128
export const CHARACTER_BODY_DRAW_HALF = CHARACTER_BODY_DRAW_SIZE / 2
export const PLAYER_BODY_PROFILE_INDEX = 1
export const NPC_BODY_PROFILE_INDEX_START = 2
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
  const extents = getProfilePointExtents(points)
  if (!extents) {
    return null
  }
  return {
    width: extents.width,
    height: extents.height,
  }
}

function getProfilePointExtents(points: number[]): {
  minX: number
  maxX: number
  minY: number
  maxY: number
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
    minX,
    maxX,
    minY,
    maxY,
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

function resolveCharacterBodyProfileSize(
  profile: MapCharacterBodyProfile | null | undefined
): {
  width: number
  height: number
} {
  const width = getPositiveProfileSize(profile?.width)
  const height = getPositiveProfileSize(profile?.height)
  if (width <= 0 && height <= 0) {
    return { width: 0, height: 0 }
  }
  const bounds = getProfilePointBounds(profile?.points ?? [])
  if (!bounds) {
    return {
      width,
      height: height > 0 ? height : width,
    }
  }
  if (width > 0 && height > 0) {
    const scaleX = width / bounds.width
    const scaleY = height / bounds.height
    const uniformScale = (scaleX + scaleY) * 0.5
    return {
      width: bounds.width * uniformScale,
      height: bounds.height * uniformScale,
    }
  }
  if (width > 0) {
    const uniformScale = width / bounds.width
    return {
      width,
      height: bounds.height * uniformScale,
    }
  }
  const uniformScale = height / bounds.height
  return {
    width: bounds.width * uniformScale,
    height,
  }
}

export function getCharacterBodyProfileWidth(
  profile: MapCharacterBodyProfile | null | undefined
): number {
  return resolveCharacterBodyProfileSize(profile).width
}

export function getCharacterBodyProfileHeight(
  profile: MapCharacterBodyProfile | null | undefined
): number {
  return resolveCharacterBodyProfileSize(profile).height
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
  if (isHexColorString(color)) {
    return normalizeHexColor(color)
  }
  return normalizeHexColor(fallbackColor)
}

export function getCharacterBloodColor(
  profile: MapCharacterBodyProfile | null | undefined,
  fallbackColor: string
): string {
  const color = profile?.bloodColor
  if (isHexColorString(color)) {
    return normalizeHexColor(color)
  }
  if (fallbackColor.length === 0) {
    return ''
  }
  return normalizeHexColor(fallbackColor)
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

export function getNpcBodyProfileIndex(npcIndex: number): number {
  return NPC_BODY_PROFILE_INDEX_START + npcIndex
}

export function getCharacterBodyHeight(
  bodyHeight: number,
  radius: number
): number {
  return bodyHeight > 0 ? bodyHeight : radius * 2
}

export function getCharacterBodyHalfWidth(
  profile: MapCharacterBodyProfile | null | undefined,
  radius: number
): number {
  const width = getCharacterBodyProfileWidth(profile)
  return (width > 0 ? width : radius * 2) * 0.5
}

export function getCharacterBodyHalfHeight(
  profile: MapCharacterBodyProfile | null | undefined,
  radius: number,
  bodyHeight: number
): number {
  const height = getCharacterBodyProfileHeight(profile)
  return (
    (height > 0 ? height : getCharacterBodyHeight(bodyHeight, radius)) * 0.5
  )
}

const MAX_GROUND_PICKUP_RADIUS_BONUS = 5.0

export function getCharacterGroundPickupRadius(
  profile: MapCharacterBodyProfile | null | undefined,
  radius: number,
  bodyHeight: number,
  baseRadius: number
): number {
  if (baseRadius <= 0) {
    return 0
  }
  const halfWidth = getCharacterBodyHalfWidth(profile, radius)
  const halfHeight = getCharacterBodyHalfHeight(profile, radius, bodyHeight)
  const heightBonus = Math.max(0, halfHeight - radius)
  const widthBonus = Math.max(0, halfWidth - radius)
  return (
    baseRadius +
    Math.min(MAX_GROUND_PICKUP_RADIUS_BONUS, Math.max(heightBonus, widthBonus))
  )
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
  const npcIndex = profileIndex - NPC_BODY_PROFILE_INDEX_START
  if (npcIndex < 0 || npcIndex >= map.npcs.length) {
    return null
  }
  return map.npcs[npcIndex]?.bodyProfile ?? null
}
