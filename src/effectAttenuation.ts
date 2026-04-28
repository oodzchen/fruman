import { SOUND_IDS } from './worker/effectsProtocol'

const DEFAULT_SOUND_FALLOFF_DISTANCE = 16
const CLOSE_SOUND_FALLOFF_DISTANCE = scaleSoundFalloffDistance(80)
const CLEAR_SOUND_FALLOFF_DISTANCE = scaleSoundFalloffDistance(112)
const HEAVY_SOUND_FALLOFF_DISTANCE = scaleSoundFalloffDistance(150)
const LOUD_ULTIMATE_SOUND_FALLOFF_DISTANCE = scaleSoundFalloffDistance(200)
const MASSIVE_SOUND_FALLOFF_DISTANCE = scaleSoundFalloffDistance(260)
const EXPLOSIVE_SOUND_FALLOFF_DISTANCE = scaleSoundFalloffDistance(280)

const CAMERA_SHAKE_FALLOFF_MIN_DISTANCE = 18
const CAMERA_SHAKE_FALLOFF_MAX_DISTANCE = 34
const CAMERA_SHAKE_FALLOFF_DISTANCE_DIVISOR = 1

function scaleSoundFalloffDistance(multiplierPercent: number): number {
  return Math.trunc(
    (DEFAULT_SOUND_FALLOFF_DISTANCE * multiplierPercent + 50) / 100
  )
}

export function getSoundFalloffDistance(soundId: number): number {
  switch (soundId) {
    case SOUND_IDS.BODY_HIT:
    case SOUND_IDS.BODY_HIT_SHARP:
    case SOUND_IDS.STAGGER_BREAK:
    case SOUND_IDS.DEATH_SPLASH:
      return CLOSE_SOUND_FALLOFF_DISTANCE
    case SOUND_IDS.SWORD_BLOCK:
      return DEFAULT_SOUND_FALLOFF_DISTANCE
    case SOUND_IDS.SWORD_PARRY:
      return CLEAR_SOUND_FALLOFF_DISTANCE
    case SOUND_IDS.SWORD_HIT_OBSTACLE:
    case SOUND_IDS.WOOD_BOX_BROKEN:
    case SOUND_IDS.PASS_THROUGH_GRASS:
      return DEFAULT_SOUND_FALLOFF_DISTANCE
    case SOUND_IDS.SWORD_ULTIMATE_GIANT_RISE:
    case SOUND_IDS.SPEAR_ULTIMATE_THRUST:
      return LOUD_ULTIMATE_SOUND_FALLOFF_DISTANCE
    case SOUND_IDS.HEAVY_SWORD_HIT_GROUND:
    case SOUND_IDS.BIG_HAMMER_HIT_ROCK:
      return HEAVY_SOUND_FALLOFF_DISTANCE
    case SOUND_IDS.HAMMER_ULTIMATE_LAND:
      return MASSIVE_SOUND_FALLOFF_DISTANCE
    case SOUND_IDS.BOMB_EXPLOSION:
      return EXPLOSIVE_SOUND_FALLOFF_DISTANCE
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
