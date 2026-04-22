import type { MapEnvironmentObject } from './editorMapTypes'

export interface EnvironmentTransformOffset {
  x: number
  y: number
}

export const DEFAULT_ENVIRONMENT_SCALE_PERMILLE = 1000

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

export function writeEnvironmentTransformedOffset(
  offsetX: number,
  offsetY: number,
  rotationDeg: number,
  scaleXPermille: number,
  scaleYPermille: number,
  out: EnvironmentTransformOffset
): void {
  const scaledX =
    (offsetX * scaleXPermille) / DEFAULT_ENVIRONMENT_SCALE_PERMILLE
  const scaledY =
    (offsetY * scaleYPermille) / DEFAULT_ENVIRONMENT_SCALE_PERMILLE
  if (rotationDeg === 0) {
    out.x = scaledX
    out.y = scaledY
    return
  }
  const rotationRad = (rotationDeg * Math.PI) / 180
  const cos = Math.cos(rotationRad)
  const sin = Math.sin(rotationRad)
  out.x = scaledX * cos - scaledY * sin
  out.y = scaledX * sin + scaledY * cos
}
