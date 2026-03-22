import {
  DEFAULT_WEAPON_GROUND_ROTATION_RAD,
  DEFAULT_WEAPON_HEIGHT,
  DEFAULT_WEAPON_WIDTH,
} from '../constants'
import type { WeaponType } from '../types'
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
  weaponType: WeaponType,
  weaponWidth: number,
  weaponHeight: number,
  sizeLevel: number,
  sizeMaxLevel: number,
  ammo: number,
  ammoText: string
): void {
  const indicator = getHudWeaponIndicatorLevel(
    weaponType,
    hasWeapon ? sizeLevel : 0,
    hasWeapon ? sizeMaxLevel : 0
  )
  const renderType = getHudWeaponRenderType(weaponType)

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
    indicator.sizeLevel,
    indicator.sizeMaxLevel,
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

    if (renderType === 'bow') {
      ctx.save()
      ctx.translate(centerX, centerY)
      ctx.rotate(DEFAULT_WEAPON_GROUND_ROTATION_RAD)
      ctx.globalAlpha = isActive ? HUD_ICON_ALPHA_ACTIVE : HUD_ICON_ALPHA
      ctx.fillStyle = HUD_ICON_COLOR
      ctx.strokeStyle = HUD_ICON_COLOR
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
      ctx.restore()
    } else if (renderType === 'hook') {
      ctx.save()
      ctx.translate(centerX, centerY)
      ctx.rotate(DEFAULT_WEAPON_GROUND_ROTATION_RAD)
      ctx.globalAlpha = isActive ? HUD_ICON_ALPHA_ACTIVE : HUD_ICON_ALPHA
      ctx.fillStyle = HUD_ICON_COLOR
      ctx.strokeStyle = HUD_ICON_COLOR
      renderWeaponShape(
        ctx,
        'hook',
        iconWidth,
        iconHeight,
        HUD_ICON_COLOR,
        false,
        0
      )
      ctx.restore()
    } else if (renderType === 'hammer') {
      ctx.save()
      ctx.translate(centerX, centerY)
      ctx.rotate(DEFAULT_WEAPON_GROUND_ROTATION_RAD)
      ctx.globalAlpha = isActive ? HUD_ICON_ALPHA_ACTIVE : HUD_ICON_ALPHA
      ctx.fillStyle = HUD_ICON_COLOR
      ctx.strokeStyle = HUD_ICON_COLOR
      renderWeaponShape(
        ctx,
        'hammer',
        iconWidth,
        iconHeight,
        HUD_ICON_COLOR,
        false,
        0
      )
      ctx.restore()
    } else if (renderType === 'spear') {
      const minIconHeight = Math.max(5, Math.floor(size * 0.14))
      const spearIconHeight = Math.max(minIconHeight, iconHeight) * (2 / 3)
      const spearScale =
        slotHeight > 0 ? spearIconHeight / slotHeight : activeScale
      const spearIconWidth = slotWidth * spearScale
      const halfLen = spearIconWidth / 2
      const headLen = Math.max(spearIconHeight * 4, spearIconWidth * 0.1)
      const headMidX = halfLen - headLen / 2

      ctx.save()
      ctx.beginPath()
      ctx.rect(x, y, size, size)
      ctx.clip()
      ctx.translate(centerX, centerY)
      ctx.rotate(DEFAULT_WEAPON_GROUND_ROTATION_RAD)
      ctx.globalAlpha = isActive ? HUD_ICON_ALPHA_ACTIVE : HUD_ICON_ALPHA
      ctx.fillStyle = HUD_ICON_COLOR
      ctx.strokeStyle = HUD_ICON_COLOR
      ctx.translate(-headMidX, 0)
      renderWeaponShape(
        ctx,
        'spear',
        spearIconWidth,
        spearIconHeight,
        HUD_ICON_COLOR,
        false,
        0
      )
      ctx.restore()
    } else {
      ctx.save()
      ctx.translate(centerX, centerY)
      ctx.rotate(DEFAULT_WEAPON_GROUND_ROTATION_RAD)
      ctx.globalAlpha = isActive ? HUD_ICON_ALPHA_ACTIVE : HUD_ICON_ALPHA
      ctx.fillStyle = HUD_ICON_COLOR
      ctx.strokeStyle = HUD_ICON_COLOR
      renderWeaponShape(ctx, 'sword', iconWidth, iconHeight, HUD_ICON_COLOR)
      ctx.restore()
    }

    if (renderType === 'bow' && ammoText.length > 0) {
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

export const HUD_ULTIMATE_SIZE = 52
export const HUD_ULTIMATE_READY_BORDER = 'rgba(255, 255, 255, 0.85)'
export const HUD_ULTIMATE_COOLDOWN_BORDER = 'rgba(255, 255, 255, 0.25)'
export const HUD_ULTIMATE_FILL = 'rgba(0, 0, 0, 0.2)'

export function drawHudUltimateSlot(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  cooldownRatio: number,
  isReady: boolean,
  flashTimer100: number = 0,
  isHammer: boolean = false
): void {
  const radius = HUD_ULTIMATE_SIZE / 2
  ctx.save()
  ctx.globalAlpha = 1

  // 光晕：绝招可用时在圆圈外侧绘制渐变光晕
  if (isReady) {
    const glow = ctx.createRadialGradient(
      cx,
      cy,
      radius - 1,
      cx,
      cy,
      radius + 10
    )
    glow.addColorStop(0, 'rgba(255, 255, 255, 0.45)')
    glow.addColorStop(1, 'rgba(255, 255, 255, 0)')
    ctx.beginPath()
    ctx.arc(cx, cy, radius + 10, 0, Math.PI * 2)
    ctx.fillStyle = glow
    ctx.fill()
  }

  ctx.beginPath()
  ctx.arc(cx, cy, radius, 0, Math.PI * 2)
  ctx.fillStyle = HUD_ULTIMATE_FILL
  ctx.fill()

  if (isHammer) {
    drawHudUltimateHammerTip(ctx, cx, cy, radius, isReady)
  } else {
    drawHudUltimateSwordTip(ctx, cx, cy, radius, isReady)
  }

  // 冷却蒙层：从顶部向下覆盖，随时间从底部向上减少
  if (cooldownRatio > 0) {
    const overlayH = Math.ceil((cooldownRatio * (radius * 2)) / 100)
    ctx.save()
    ctx.beginPath()
    ctx.arc(cx, cy, radius, 0, Math.PI * 2)
    ctx.clip()
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)'
    ctx.fillRect(cx - radius, cy - radius, radius * 2, overlayH)
    ctx.restore()
  }

  ctx.beginPath()
  ctx.arc(cx, cy, radius, 0, Math.PI * 2)
  // flash 期间边框线性插值到亮白色
  const flashAlpha = flashTimer100 / 100
  ctx.strokeStyle =
    flashAlpha > 0
      ? `rgba(255, 255, 255, ${(0.35 + flashAlpha * 0.65).toFixed(2)})`
      : isReady
        ? HUD_ULTIMATE_READY_BORDER
        : HUD_ULTIMATE_COOLDOWN_BORDER
  ctx.lineWidth = flashAlpha > 0 ? 2 + Math.round(flashAlpha * 2) : 2
  ctx.stroke()

  ctx.restore()
}

function drawHudUltimateSwordTip(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  isReady: boolean
): void {
  const r = radius | 0
  // 90° 尖角：bHalf = taper_height（半宽等于斜刃段高度），剑身更宽
  const bHalf = Math.max(3, Math.floor((r * 58) / 100))
  const tipY = -(r - 1)
  const taperY = tipY + bHalf // 满足 90° 角

  ctx.save()
  ctx.translate(cx, cy)

  // 圆形裁剪视窗，下方截断由圆圈自然遮挡
  ctx.beginPath()
  ctx.arc(0, 0, r, 0, Math.PI * 2)
  ctx.clip()

  ctx.globalAlpha = isReady ? HUD_ICON_ALPHA_ACTIVE : HUD_ICON_ALPHA
  ctx.fillStyle = HUD_ICON_COLOR
  ctx.strokeStyle = HUD_ICON_COLOR
  ctx.lineWidth = 1
  ctx.lineJoin = 'round'

  // 剑尖向上，剑身向下延伸超出圆圈，由 clip 自然截断
  ctx.beginPath()
  ctx.moveTo(0, tipY)
  ctx.lineTo(bHalf, taperY)
  ctx.lineTo(bHalf, r + 2)
  ctx.lineTo(-bHalf, r + 2)
  ctx.lineTo(-bHalf, taperY)
  ctx.closePath()
  ctx.fill()
  ctx.stroke()
  ctx.restore()
}

function drawHudUltimateHammerTip(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  isReady: boolean
): void {
  const r = radius | 0
  ctx.save()
  ctx.translate(cx, cy)

  // 圆形裁剪，锤头和锤柄两端超出圆圈被自然截断
  ctx.beginPath()
  ctx.arc(0, 0, r, 0, Math.PI * 2)
  ctx.clip()

  ctx.globalAlpha = isReady ? HUD_ICON_ALPHA_ACTIVE : HUD_ICON_ALPHA
  ctx.fillStyle = HUD_ICON_COLOR
  ctx.strokeStyle = HUD_ICON_COLOR
  ctx.lineJoin = 'round'
  ctx.lineWidth = 1

  // 锤子：复用 hammer 形状，保持实际武器宽高比（1.1:0.45），旋转15°
  // 平移使锤头中心对齐地面水平中心（x=0），并上移使锤头只有少部分触地
  const hammerW = Math.round(r * 1.6)
  const hammerH = Math.round(r * 0.65)
  ctx.save()
  ctx.translate(-Math.round(r * 0.45), -Math.round(r * 0.08))
  ctx.rotate(Math.PI / 12)
  renderWeaponShape(ctx, 'hammer', hammerW, hammerH, HUD_ICON_COLOR, false, 0)
  ctx.restore()

  // 地面：填充矩形覆盖圆圈下部
  const groundY = Math.round(r * 0.5)
  ctx.beginPath()
  ctx.rect(-r, groundY, r * 2, r)
  ctx.fill()

  ctx.restore()
}

function getHudWeaponRenderType(
  weaponType: WeaponType
): 'sword' | 'spear' | 'hammer' | 'bow' | 'hook' {
  if (weaponType === 'bow') {
    return 'bow'
  }
  if (weaponType === 'spear') {
    return 'spear'
  }
  if (weaponType === 'hammer') {
    return 'hammer'
  }
  if (weaponType === 'hook') {
    return 'hook'
  }
  return 'sword'
}

function getHudWeaponIndicatorLevel(
  weaponType: WeaponType,
  sizeLevel: number,
  sizeMaxLevel: number
): { sizeLevel: number; sizeMaxLevel: number } {
  if (weaponType === 'hammer') {
    return { sizeLevel: 1, sizeMaxLevel: 2 }
  }
  return { sizeLevel, sizeMaxLevel }
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
