import {
  DEFAULT_WEAPON_GROUND_ROTATION_RAD,
  DEFAULT_WEAPON_HEIGHT,
  DEFAULT_WEAPON_WIDTH,
} from '../constants'
import { renderWeapon as renderWeaponShape } from './WeaponRenderer'

export const HUD_SLOT_SIZE = 46
export const HUD_SLOT_SPACING = 14
export const HUD_SLOT_MARGIN = 16
export const HUD_SLOT_FILL = 'rgba(0, 0, 0, 0.5)'
export const HUD_SLOT_BORDER = 'rgba(255, 255, 255, 0.35)'
export const HUD_SLOT_BORDER_ACTIVE = 'rgba(255, 255, 255, 0.75)'
export const HUD_ICON_COLOR = '#ffffff'
export const HUD_ICON_ALPHA = 0.65
export const HUD_ICON_ALPHA_ACTIVE = 0.9
export const HUD_AMMO_ALPHA = 0.85
export const HUD_ICON_SCALE = 0.6
export const HUD_SIZE_BOX = 5
export const HUD_SIZE_OUTER_GAP = 0
const HUD_ICON_FONT = '12px monospace'

export function drawHudWeaponSlot(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  isActive: boolean,
  hasWeapon: boolean,
  weaponType: 'sword' | 'bow' | 'hook',
  weaponWidth: number,
  weaponHeight: number,
  sizeLevel: number,
  sizeMaxLevel: number,
  ammo: number,
  ammoText: string
): void {
  ctx.save()
  ctx.globalAlpha = 1
  ctx.fillStyle = HUD_SLOT_FILL
  const slotBorder = isActive ? HUD_SLOT_BORDER_ACTIVE : HUD_SLOT_BORDER
  ctx.strokeStyle = slotBorder
  ctx.lineWidth = 2
  ctx.fillRect(x, y, size, size)
  ctx.strokeRect(x, y, size, size)

  drawHudWeaponSizeIndicator(
    ctx,
    x,
    y,
    size,
    hasWeapon ? sizeLevel : 0,
    hasWeapon ? sizeMaxLevel : 0,
    isActive,
    slotBorder
  )

  if (hasWeapon) {
    const slotWidth = weaponWidth > 0 ? weaponWidth : DEFAULT_WEAPON_WIDTH
    const slotHeight = weaponHeight > 0 ? weaponHeight : DEFAULT_WEAPON_HEIGHT
    const activeScale = isActive ? 1.2 : 1
    const iconMax = size * HUD_ICON_SCALE * activeScale
    const iconScale = iconMax / slotWidth
    const iconWidth = slotWidth * iconScale
    const iconHeight = slotHeight * iconScale
    const centerX = x + size * 0.5
    const centerY = y + size * 0.5

    ctx.save()
    ctx.translate(centerX, centerY)
    ctx.rotate(DEFAULT_WEAPON_GROUND_ROTATION_RAD)
    ctx.globalAlpha = isActive ? HUD_ICON_ALPHA_ACTIVE : HUD_ICON_ALPHA
    ctx.fillStyle = HUD_ICON_COLOR
    ctx.strokeStyle = HUD_ICON_COLOR

    if (weaponType === 'bow') {
      const bowLineWidthBase = Math.max(1, Math.floor((iconHeight * 35) / 100))
      renderWeaponShape(
        ctx,
        'bow',
        iconWidth,
        iconHeight,
        HUD_ICON_COLOR,
        false,
        0,
        2,
        bowLineWidthBase
      )

      ctx.save()
      ctx.rotate(Math.PI / 6)
      const arrowLength = iconWidth * 0.85
      drawHudArrowShape(
        ctx,
        arrowLength,
        iconHeight * 0.2,
        false,
        HUD_ICON_COLOR,
        arrowLength * 0.5
      )
      ctx.restore()
    } else if (weaponType === 'hook') {
      renderWeaponShape(
        ctx,
        'hook',
        iconWidth,
        iconHeight,
        HUD_ICON_COLOR,
        false,
        0
      )
    } else {
      const halfLen = iconWidth / 2
      const halfThick = iconHeight / 2

      ctx.beginPath()
      ctx.moveTo(-halfLen, -halfThick)
      ctx.lineTo(halfLen - halfThick, -halfThick)
      ctx.arc(halfLen - halfThick, 0, halfThick, -Math.PI / 2, Math.PI / 2)
      ctx.lineTo(-halfLen, halfThick)
      ctx.closePath()

      ctx.fill()
      ctx.stroke()
    }
    ctx.restore()

    if (weaponType === 'bow' && ammoText.length > 0) {
      const ammoValue = ammo < 0 ? 0 : ammo
      if (ammoValue >= 0) {
        ctx.save()
        ctx.globalAlpha = HUD_AMMO_ALPHA
        ctx.fillStyle = HUD_ICON_COLOR
        ctx.font = HUD_ICON_FONT
        ctx.textAlign = 'right'
        ctx.textBaseline = 'bottom'
        ctx.fillText(ammoText, x + size - 4, y + size - 2)
        ctx.restore()
      }
    }
  }
  ctx.restore()
}

function drawHudWeaponSizeIndicator(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  filledCount: number,
  maxCount: number,
  isActive: boolean,
  borderColor: string
): void {
  if (maxCount <= 0) return
  const boxHeight = size / maxCount
  const startY = y
  const startX = x - HUD_SIZE_OUTER_GAP - HUD_SIZE_BOX

  ctx.save()
  ctx.lineWidth = 1
  ctx.strokeStyle = borderColor
  ctx.fillStyle = HUD_ICON_COLOR
  ctx.globalAlpha = HUD_ICON_ALPHA

  for (let i = 0; i < maxCount; i++) {
    const boxY = startY + size - boxHeight * (i + 1)
    ctx.fillStyle = HUD_SLOT_FILL
    ctx.fillRect(startX, boxY, HUD_SIZE_BOX, boxHeight)
    ctx.fillStyle = HUD_ICON_COLOR
    ctx.strokeRect(startX, boxY, HUD_SIZE_BOX, boxHeight)
    if (i < filledCount) {
      ctx.globalAlpha = isActive ? HUD_ICON_ALPHA_ACTIVE : HUD_ICON_ALPHA
      ctx.fillRect(startX, boxY, HUD_SIZE_BOX, boxHeight)
      ctx.globalAlpha = HUD_ICON_ALPHA
    }
  }
  ctx.restore()
}

function drawHudArrowShape(
  ctx: CanvasRenderingContext2D,
  lengthPx: number,
  thicknessPx: number,
  isAttacking: boolean,
  bodyColor: string,
  baseOffsetY: number
): void {
  const lineWidth = Math.max(1, thicknessPx * 0.9)
  const headLen = Math.max(4, lengthPx * 0.18)
  const headWidth = Math.max(4, thicknessPx * 1.6)
  const tipY = baseOffsetY - lengthPx

  ctx.strokeStyle = isAttacking ? '#FFFFFF' : bodyColor
  ctx.lineWidth = lineWidth

  ctx.beginPath()
  ctx.moveTo(0, baseOffsetY)
  ctx.lineTo(0, tipY)
  ctx.stroke()

  ctx.beginPath()
  ctx.moveTo(0, tipY)
  ctx.lineTo(-headWidth / 2, tipY + headLen)
  ctx.moveTo(0, tipY)
  ctx.lineTo(headWidth / 2, tipY + headLen)
  ctx.stroke()
}
