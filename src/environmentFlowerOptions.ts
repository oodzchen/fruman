import type { MapEnvironmentFlowerOptions } from './editorMapTypes'

export const ENVIRONMENT_FLOWER_ROOT_GRASS_COUNT_MIN = 0
export const ENVIRONMENT_FLOWER_ROOT_GRASS_COUNT_MAX = 3
export const ENVIRONMENT_FLOWER_CLUMP_WIDTH_PERCENT_MIN = 24
export const ENVIRONMENT_FLOWER_CLUMP_WIDTH_PERCENT_MAX = 68
export const ENVIRONMENT_FLOWER_STEM_HEIGHT_PERCENT_MIN = 70
export const ENVIRONMENT_FLOWER_STEM_HEIGHT_PERCENT_MAX = 126
export const ENVIRONMENT_FLOWER_STEM_LEAN_PERCENT_MIN = -18
export const ENVIRONMENT_FLOWER_STEM_LEAN_PERCENT_MAX = 18
export const ENVIRONMENT_FLOWER_PETAL_COUNT_MIN = 3
export const ENVIRONMENT_FLOWER_PETAL_COUNT_MAX = 12
export const ENVIRONMENT_FLOWER_PETAL_LENGTH_PERCENT_MIN = 14
export const ENVIRONMENT_FLOWER_PETAL_LENGTH_PERCENT_MAX = 28
export const ENVIRONMENT_FLOWER_PETAL_WIDTH_PERCENT_MIN = 7
export const ENVIRONMENT_FLOWER_PETAL_WIDTH_PERCENT_MAX = 18
export const ENVIRONMENT_FLOWER_PETAL_ANGLE_OFFSET_DEG_MIN = 0
export const ENVIRONMENT_FLOWER_PETAL_ANGLE_OFFSET_DEG_MAX = 359
export const ENVIRONMENT_FLOWER_STAMEN_RADIUS_PERCENT_MIN = 4
export const ENVIRONMENT_FLOWER_STAMEN_RADIUS_PERCENT_MAX = 8

const FLOWER_OPTION_FIELD_COUNT = 12

export function clearEnvironmentFlowerOptions(
  target: MapEnvironmentFlowerOptions
): void {
  target.rootGrassCount = undefined
  target.clumpWidthPercent = undefined
  target.stemHeightPercent = undefined
  target.stemLeanPercent = undefined
  target.petalCount = undefined
  target.petalLengthPercent = undefined
  target.petalWidthPercent = undefined
  target.petalAngleOffsetDeg = undefined
  target.petalColor = undefined
  target.stamenEnabled = undefined
  target.stamenRadiusPercent = undefined
  target.stamenColor = undefined
}

export function hasEnvironmentFlowerOptions(
  options: MapEnvironmentFlowerOptions | null | undefined
): options is MapEnvironmentFlowerOptions {
  return (
    !!options &&
    (options.rootGrassCount !== undefined ||
      options.clumpWidthPercent !== undefined ||
      options.stemHeightPercent !== undefined ||
      options.stemLeanPercent !== undefined ||
      options.petalCount !== undefined ||
      options.petalLengthPercent !== undefined ||
      options.petalWidthPercent !== undefined ||
      options.petalAngleOffsetDeg !== undefined ||
      options.petalColor !== undefined ||
      options.stamenEnabled !== undefined ||
      options.stamenRadiusPercent !== undefined ||
      options.stamenColor !== undefined)
  )
}

export function cloneEnvironmentFlowerOptions(
  source: MapEnvironmentFlowerOptions | null | undefined
): MapEnvironmentFlowerOptions | undefined {
  if (!hasEnvironmentFlowerOptions(source)) {
    return undefined
  }
  const target: MapEnvironmentFlowerOptions = {}
  copyEnvironmentFlowerOptions(source, target)
  return target
}

export function copyEnvironmentFlowerOptions(
  source: MapEnvironmentFlowerOptions,
  target: MapEnvironmentFlowerOptions
): void {
  clearEnvironmentFlowerOptions(target)
  target.rootGrassCount = source.rootGrassCount
  target.clumpWidthPercent = source.clumpWidthPercent
  target.stemHeightPercent = source.stemHeightPercent
  target.stemLeanPercent = source.stemLeanPercent
  target.petalCount = source.petalCount
  target.petalLengthPercent = source.petalLengthPercent
  target.petalWidthPercent = source.petalWidthPercent
  target.petalAngleOffsetDeg = source.petalAngleOffsetDeg
  target.petalColor = source.petalColor
  target.stamenEnabled = source.stamenEnabled
  target.stamenRadiusPercent = source.stamenRadiusPercent
  target.stamenColor = source.stamenColor
}

export function buildEnvironmentFlowerOptionsCacheKey(
  options: MapEnvironmentFlowerOptions | null | undefined
): string {
  if (!hasEnvironmentFlowerOptions(options)) {
    return ''
  }
  const fields = new Array<string>(FLOWER_OPTION_FIELD_COUNT)
  fields[0] = formatNumberOption(options.rootGrassCount)
  fields[1] = formatNumberOption(options.clumpWidthPercent)
  fields[2] = formatNumberOption(options.stemHeightPercent)
  fields[3] = formatNumberOption(options.stemLeanPercent)
  fields[4] = formatNumberOption(options.petalCount)
  fields[5] = formatNumberOption(options.petalLengthPercent)
  fields[6] = formatNumberOption(options.petalWidthPercent)
  fields[7] = formatNumberOption(options.petalAngleOffsetDeg)
  fields[8] = options.petalColor ?? ''
  fields[9] =
    options.stamenEnabled === undefined ? '' : options.stamenEnabled ? '1' : '0'
  fields[10] = formatNumberOption(options.stamenRadiusPercent)
  fields[11] = options.stamenColor ?? ''
  return fields.join(',')
}

function formatNumberOption(value: number | undefined): string {
  return value === undefined ? '' : `${Math.round(value)}`
}
