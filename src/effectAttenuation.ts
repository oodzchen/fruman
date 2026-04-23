import { SOUND_IDS } from './worker/effectsProtocol'

const DEFAULT_SOUND_FALLOFF_DISTANCE = 16
const BODY_HIT_SOUND_FALLOFF_DISTANCE = 13
const BLOCK_SOUND_FALLOFF_DISTANCE = 16
const PARRY_SOUND_FALLOFF_DISTANCE = 18
const OBSTACLE_HIT_SOUND_FALLOFF_DISTANCE = 16
const DEATH_SPLASH_SOUND_FALLOFF_DISTANCE = 13
const HEAVY_GROUND_HIT_SOUND_FALLOFF_DISTANCE = 24
const ULTIMATE_LAND_SOUND_FALLOFF_DISTANCE = 28

const CAMERA_SHAKE_FALLOFF_MIN_DISTANCE = 18
const CAMERA_SHAKE_FALLOFF_MAX_DISTANCE = 34
const CAMERA_SHAKE_FALLOFF_DISTANCE_DIVISOR = 1

export function getSoundFalloffDistance(soundId: number): number {
  switch (soundId) {
    case SOUND_IDS.BODY_HIT:
    case SOUND_IDS.BODY_HIT_SHARP:
    case SOUND_IDS.STAGGER_BREAK:
      return BODY_HIT_SOUND_FALLOFF_DISTANCE
    case SOUND_IDS.SWORD_BLOCK:
      return BLOCK_SOUND_FALLOFF_DISTANCE
    case SOUND_IDS.SWORD_PARRY:
      return PARRY_SOUND_FALLOFF_DISTANCE
    case SOUND_IDS.SWORD_HIT_OBSTACLE:
      return OBSTACLE_HIT_SOUND_FALLOFF_DISTANCE
    case SOUND_IDS.DEATH_SPLASH:
      return DEATH_SPLASH_SOUND_FALLOFF_DISTANCE
    case SOUND_IDS.HEAVY_SWORD_HIT_GROUND:
    case SOUND_IDS.BIG_HAMMER_HIT_ROCK:
      return HEAVY_GROUND_HIT_SOUND_FALLOFF_DISTANCE
    case SOUND_IDS.HAMMER_ULTIMATE_LAND:
      return ULTIMATE_LAND_SOUND_FALLOFF_DISTANCE
    default:
      return DEFAULT_SOUND_FALLOFF_DISTANCE
  }
}

export function getCameraShakeFalloffDistance(intensityPx: number): number {
  const scaledDistance = intensityPx / CAMERA_SHAKE_FALLOFF_DISTANCE_DIVISOR
  if (scaledDistance <= CAMERA_SHAKE_FALLOFF_MIN_DISTANCE) {
    return CAMERA_SHAKE_FALLOFF_MIN_DISTANCE
  }
  if (scaledDistance >= CAMERA_SHAKE_FALLOFF_MAX_DISTANCE) {
    return CAMERA_SHAKE_FALLOFF_MAX_DISTANCE
  }
  return scaledDistance
}

export function computeDistanceAttenuation(
  listenerX: number,
  listenerY: number,
  sourceX: number,
  sourceY: number,
  maxDistance: number
): number {
  if (!(maxDistance > 0)) {
    return 1
  }
  const dx = listenerX - sourceX
  const dy = listenerY - sourceY
  const distanceSq = dx * dx + dy * dy
  if (distanceSq <= 0) {
    return 1
  }
  const maxDistanceSq = maxDistance * maxDistance
  if (distanceSq >= maxDistanceSq) {
    return 0
  }
  const distance = Math.sqrt(distanceSq)
  return 1 - distance / maxDistance
}
