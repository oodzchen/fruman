import { WEAPON_DEFAULT_DATA } from '../constants'
import { computeWeaponScaleFactor } from '../ecs/factories/PlayerFactory'
import type {
  MapCharacterBodyEyeStyle,
  MapCharacterBodyProfile,
} from '../editorMapTypes'
import { renderBody } from '../renderer/BodyRenderer'
import type { WeaponType } from '../types'

type WeaponTemplate = (typeof WEAPON_DEFAULT_DATA)[WeaponType]

export function computeNpcBodyRadiusPx(
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

export function renderNpcPreviewToContext(
  ctx: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  radiusMeters: number,
  bodyHeightMeters: number,
  bodyColor: string,
  pixelsPerMeter: number,
  facing = 1,
  bodyProfile: MapCharacterBodyProfile | null = null,
  bodyTexture: CanvasImageSource | null = null,
  fallbackEyeStyle: MapCharacterBodyEyeStyle = 'standard'
): void {
  const bodyRadius = computeNpcBodyRadiusPx(radiusMeters, pixelsPerMeter)
  const bodyHeightPx =
    bodyHeightMeters > 0 ? bodyHeightMeters * pixelsPerMeter : undefined
  ctx.save()
  ctx.translate(centerX, centerY)
  renderBody(
    ctx,
    bodyRadius,
    bodyColor,
    pixelsPerMeter,
    facing,
    bodyHeightPx,
    '',
    0,
    bodyProfile,
    bodyTexture,
    true,
    '#000000',
    fallbackEyeStyle
  )
  ctx.restore()
}
