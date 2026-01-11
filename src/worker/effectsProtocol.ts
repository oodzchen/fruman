import { ENTITY_STRIDE, MAX_ENTITIES } from './binaryProtocol'

export const EFFECT_STRIDE = 4
export const EFFECT_OFFSETS = {
  TYPE: 0,
  X: 1,
  Y: 2,
  COLOR: 3,
}

export const EFFECT_TYPES = {
  SPARK: 0,
  BLOOD: 1,
} as const

export const MAX_EFFECTS = 256
export const EFFECTS_BASE_OFFSET = MAX_ENTITIES * ENTITY_STRIDE
export const EFFECT_BUFFER_FLOATS = MAX_EFFECTS * EFFECT_STRIDE
export const STATE_BUFFER_FLOATS = EFFECTS_BASE_OFFSET + EFFECT_BUFFER_FLOATS
