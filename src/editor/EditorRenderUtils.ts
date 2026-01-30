import { WEAPON_DEFAULT_DATA } from '../constants'
import { computeWeaponScaleFactor } from '../ecs/factories/PlayerFactory'
import { renderBody } from '../renderer/BodyRenderer'
import type { WeaponType } from '../types'

type WeaponTemplate = (typeof WEAPON_DEFAULT_DATA)[WeaponType]

export function computeEnemyBodyRadiusPx(
  radiusMeters: number,
  pixelsPerMeter: number
): number {
  return radiusMeters * pixelsPerMeter
}

export function computeWeaponRenderDimensions(
  template: WeaponTemplate,
  sizeLevel: number,
  pixelsPerMeter: number,
  isBow: boolean
): {
  widthPx: number
  heightPx: number
  boundingWidthPx: number
  boundingHeightPx: number
} {
  const scaleFactor = computeWeaponScaleFactor(template, sizeLevel)
  const widthPx = template.width * pixelsPerMeter * scaleFactor
  const heightPx = template.height * pixelsPerMeter * scaleFactor
  return {
    widthPx,
    heightPx,
    boundingWidthPx: widthPx,
    boundingHeightPx: isBow ? heightPx * 4 : heightPx,
  }
}

export function renderEnemyPreviewToContext(
  ctx: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  radiusMeters: number,
  bodyColor: string,
  pixelsPerMeter: number,
  facing = 1
): void {
  const bodyRadius = computeEnemyBodyRadiusPx(radiusMeters, pixelsPerMeter)
  ctx.save()
  ctx.translate(centerX, centerY)
  renderBody(ctx, bodyRadius, bodyColor, pixelsPerMeter, facing)
  ctx.restore()
}
