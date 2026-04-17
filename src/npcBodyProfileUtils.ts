import {
  CATERPILLAR_ANIMATION_NAME,
  CATERPILLAR_ATLAS_KEY,
  CATERPILLAR_SPINE_KEY,
  CATERPILLAR_SPINE_SCALE,
} from './constants'
import type { MapCharacterBodyProfile } from './editorMapTypes'
import type { NpcType } from './types'

const CATERPILLAR_PROFILE_POINTS = [
  -268, 11, -260, -182, -140, -178, -78, -139, 74, -125, 144, -133, 272, -135,
  274, -29, 176, 57, 40, 182, -8, 150, -67, 174, -148, 5,
]

const CATERPILLAR_PROFILE_WIDTH = 3282 / 1000
const CATERPILLAR_PROFILE_HEIGHT = 2184 / 1000

function cloneBodyProfile(
  profile: MapCharacterBodyProfile
): MapCharacterBodyProfile {
  return {
    ...profile,
    points: profile.points.slice(),
    layers: profile.layers?.map((layer) => ({
      ...layer,
    })),
  }
}

function isPositiveNumber(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

export function getDefaultNpcBodyProfile(
  npcType: NpcType
): MapCharacterBodyProfile | undefined {
  if (npcType !== 'caterpillar') {
    return undefined
  }
  return {
    points: CATERPILLAR_PROFILE_POINTS.slice(),
    width: CATERPILLAR_PROFILE_WIDTH,
    height: CATERPILLAR_PROFILE_HEIGHT,
    spineKey: CATERPILLAR_SPINE_KEY,
    spineAtlasKey: CATERPILLAR_ATLAS_KEY,
    spineAnimationName: CATERPILLAR_ANIMATION_NAME,
    spineScale: CATERPILLAR_SPINE_SCALE,
    spineMode: 'replace',
    spineSegmentedCollision: true,
  }
}

export function resolveNpcBodyProfile(
  npcType: NpcType,
  profile: MapCharacterBodyProfile | undefined
): MapCharacterBodyProfile | undefined {
  const defaultProfile = getDefaultNpcBodyProfile(npcType)
  if (!defaultProfile) {
    return profile ? cloneBodyProfile(profile) : undefined
  }
  if (!profile) {
    return defaultProfile
  }

  const resolvedProfile = cloneBodyProfile(profile)
  if (resolvedProfile.points.length < 6) {
    resolvedProfile.points = defaultProfile.points.slice()
  }
  if (!isPositiveNumber(resolvedProfile.width)) {
    resolvedProfile.width = defaultProfile.width
  }
  if (!isPositiveNumber(resolvedProfile.height)) {
    resolvedProfile.height = defaultProfile.height
  }
  if (!resolvedProfile.spineKey) {
    resolvedProfile.spineKey = defaultProfile.spineKey
  }
  if (!resolvedProfile.spineAtlasKey) {
    resolvedProfile.spineAtlasKey = defaultProfile.spineAtlasKey
  }
  if (!resolvedProfile.spineAnimationName) {
    resolvedProfile.spineAnimationName = defaultProfile.spineAnimationName
  }
  if (!isPositiveNumber(resolvedProfile.spineScale)) {
    resolvedProfile.spineScale = defaultProfile.spineScale
  }
  if (!resolvedProfile.spineMode) {
    resolvedProfile.spineMode = defaultProfile.spineMode
  }
  if (resolvedProfile.spineSegmentedCollision === undefined) {
    resolvedProfile.spineSegmentedCollision =
      defaultProfile.spineSegmentedCollision
  }
  return resolvedProfile
}
