import type { MapEnvironmentObject } from './editorMapTypes'

export interface EnvironmentTransformOffset {
  x: number
  y: number
}

export const DEFAULT_ENVIRONMENT_SCALE_PERMILLE = 1000

function roundScaledValue(
  value: number,
  numerator: number,
  denominator: number
) {
  if (denominator === 0) {
    return 0
  }
  return Math.round((value * numerator) / denominator)
}

export function normalizeEnvironmentScalePermille(
  value: number | undefined
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_ENVIRONMENT_SCALE_PERMILLE
  }
  const normalized = Math.round(value)
  return normalized > 0 ? normalized : DEFAULT_ENVIRONMENT_SCALE_PERMILLE
}

export function normalizeEnvironmentRotationDeg(
  value: number | undefined
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 0
  }
  let normalized = Math.round(value) % 360
  if (normalized < 0) {
    normalized += 360
  }
  return normalized
}

export function getEnvironmentScaleXPermille(
  object: Pick<MapEnvironmentObject, 'scaleXPermille'>
): number {
  return normalizeEnvironmentScalePermille(object.scaleXPermille)
}

export function getEnvironmentScaleYPermille(
  object: Pick<MapEnvironmentObject, 'scaleYPermille'>
): number {
  return normalizeEnvironmentScalePermille(object.scaleYPermille)
}

export function getEnvironmentRotationDeg(
  object: Pick<MapEnvironmentObject, 'rotationDeg'>
): number {
  return normalizeEnvironmentRotationDeg(object.rotationDeg)
}

export function scaleEnvironmentValue(
  value: number,
  scalePermille: number
): number {
  return roundScaledValue(
    value,
    normalizeEnvironmentScalePermille(scalePermille),
    DEFAULT_ENVIRONMENT_SCALE_PERMILLE
  )
}

export function getEnvironmentEffectiveScalePermille(
  baseScalePermille: number | undefined,
  transientScale: number | undefined
): number {
  const normalizedBaseScale = normalizeEnvironmentScalePermille(
    baseScalePermille ?? DEFAULT_ENVIRONMENT_SCALE_PERMILLE
  )
  if (typeof transientScale !== 'number' || !Number.isFinite(transientScale)) {
    return normalizedBaseScale
  }
  return normalizeEnvironmentScalePermille(
    roundScaledValue(
      normalizedBaseScale,
      Math.round(transientScale * DEFAULT_ENVIRONMENT_SCALE_PERMILLE),
      DEFAULT_ENVIRONMENT_SCALE_PERMILLE
    )
  )
}

export function writeEnvironmentTransformedOffset(
  offsetX: number,
  offsetY: number,
  rotationDeg: number,
  _scaleXPermille: number,
  _scaleYPermille: number,
  out: EnvironmentTransformOffset
): void {
  if (rotationDeg === 0) {
    out.x = offsetX
    out.y = offsetY
    return
  }
  const rotationRad = (rotationDeg * Math.PI) / 180
  const cos = Math.cos(rotationRad)
  const sin = Math.sin(rotationRad)
  out.x = offsetX * cos - offsetY * sin
  out.y = offsetX * sin + offsetY * cos
}
