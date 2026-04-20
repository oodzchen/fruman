import { DEFAULT_WEAPON_VERTICAL_ROTATION_RAD } from '../constants'
import type { WeaponVisualType } from '../types'
import { isRangedWeaponType } from '../weaponTypeUtils'
import type { AttackKind } from './AttackMoveData'
import type { WeaponRelativeTransform, WeaponTransform } from './Component'
import type { Entity } from './Entity'

export const FRONT_SWING_TILT_RAD = Math.PI / 16
const THRUST_START_RATIO = 35
const THRUST_END_RATIO = 105
const THRUST_GRIP_CLEARANCE = 0.06
const SWORD_THRUST_RETRACT_RADIUS_RATIO = 30
const SWORD_THRUST_RETRACT_WIDTH_RATIO = 18

export function getRangedAimRotation(
  weaponType: WeaponVisualType,
  aimAngle: number
): number {
  return aimAngle + (weaponType === 'grape' ? -Math.PI / 2 : Math.PI / 2)
}

function getRangedFrontRotation(
  weaponType: WeaponVisualType,
  facing: number
): number {
  if (weaponType === 'grape') {
    return facing === 1 ? -Math.PI / 2 : Math.PI / 2
  }
  return facing === 1 ? Math.PI / 2 : -Math.PI / 2
}

export function setWeaponBackTransform(
  playerPos: { x: number; y: number },
  facing: number,
  out: WeaponTransform,
  radius: number,
  weaponType: WeaponVisualType,
  weaponWidth: number,
  bodyHalfHeight?: number
): void {
  const halfH = bodyHalfHeight !== undefined ? bodyHalfHeight : radius
  out.x = playerPos.x - facing * (radius + 0.2)

  if (isRangedWeaponType(weaponType)) {
    out.y = playerPos.y
    out.rotation =
      weaponType === 'grape' ? 0 : -getRangedFrontRotation(weaponType, facing)
    return
  }

  if (weaponType === 'spear') {
    out.y = playerPos.y + halfH - weaponWidth / 2
    out.rotation = DEFAULT_WEAPON_VERTICAL_ROTATION_RAD
    return
  }

  out.y = playerPos.y + halfH - weaponWidth / 2
  out.rotation = DEFAULT_WEAPON_VERTICAL_ROTATION_RAD
}

export function clamp01(value: number): number {
  if (value < 0) return 0
  if (value > 1) return 1
  return value
}

export function lerpTransform(
  from: WeaponTransform,
  to: WeaponTransform,
  t: number,
  out: WeaponTransform
): void {
  const ct = clamp01(t)
  out.x = from.x + (to.x - from.x) * ct
  out.y = from.y + (to.y - from.y) * ct
  out.rotation = from.rotation + (to.rotation - from.rotation) * ct
}

export function lerpRelativeTransform(
  from: WeaponRelativeTransform,
  to: WeaponRelativeTransform,
  t: number,
  out: WeaponRelativeTransform
): void {
  const ct = clamp01(t)
  out.dx = from.dx + (to.dx - from.dx) * ct
  out.dy = from.dy + (to.dy - from.dy) * ct
  out.rotation = from.rotation + (to.rotation - from.rotation) * ct
}

export function getOffsetFromTransform(
  transform: WeaponTransform,
  playerPos: { x: number; y: number },
  out: WeaponRelativeTransform
): void {
  out.dx = transform.x - playerPos.x
  out.dy = transform.y - playerPos.y
  out.rotation = transform.rotation
}

export function applyOffset(
  offset: WeaponRelativeTransform,
  playerPos: { x: number; y: number },
  out: WeaponTransform
): void {
  out.x = playerPos.x + offset.dx
  out.y = playerPos.y + offset.dy
  out.rotation = offset.rotation
}

export function copyTransform(
  target: WeaponTransform,
  source: WeaponTransform
): void {
  target.x = source.x
  target.y = source.y
  target.rotation = source.rotation
}

export function copyRelativeTransform(
  target: WeaponRelativeTransform,
  source: WeaponRelativeTransform
): void {
  target.dx = source.dx
  target.dy = source.dy
  target.rotation = source.rotation
}

export function getTransformAtAngle(
  playerPos: { x: number; y: number },
  angle: number,
  radius: number,
  out: WeaponTransform
): void {
  out.x = playerPos.x + Math.cos(angle) * radius
  out.y = playerPos.y + Math.sin(angle) * radius
  out.rotation = angle
}

export function getFrontTransform(
  playerPos: { x: number; y: number },
  facing: number,
  out: WeaponTransform,
  radius: number,
  weaponType: WeaponVisualType,
  weaponWidth: number
): void {
  if (isRangedWeaponType(weaponType)) {
    const offsetX = radius + 0.2
    out.x = playerPos.x + facing * offsetX
    out.y = playerPos.y
    out.rotation = getRangedFrontRotation(weaponType, facing)
    return
  }

  if (weaponType === 'spear') {
    out.x = playerPos.x
    out.y = playerPos.y + radius - weaponWidth / 2
    out.rotation = DEFAULT_WEAPON_VERTICAL_ROTATION_RAD
    return
  }

  out.x = playerPos.x + facing * 0
  out.y = playerPos.y - weaponWidth / 2
  out.rotation = DEFAULT_WEAPON_VERTICAL_ROTATION_RAD
}

export function getThrustTransforms(
  radius: number,
  facing: number,
  playerPos: { x: number; y: number },
  weaponType: WeaponVisualType,
  weaponWidth: number,
  outStart: WeaponTransform,
  outEnd: WeaponTransform
): void {
  const isLongSpear = weaponWidth > 0 && weaponWidth >= 3
  const startGripOffset = isLongSpear ? weaponWidth * 0.36 : 0
  const endGripOffset = isLongSpear ? weaponWidth * 0.2 : 0
  const endDistance = (radius * THRUST_END_RATIO) / 100
  const minStartDistance = weaponWidth / 2 + THRUST_GRIP_CLEARANCE
  let startDistance = (radius * THRUST_START_RATIO) / 100
  if (startDistance < minStartDistance) {
    startDistance = minStartDistance
  }
  if (startDistance >= endDistance) {
    startDistance = endDistance * 0.7
  }
  const thrustY = playerPos.y
  const rotation = facing === 1 ? 0 : -Math.PI

  if (weaponType === 'sword') {
    const retractByRadius = (radius * SWORD_THRUST_RETRACT_RADIUS_RATIO) / 100
    const retractByWidth =
      (weaponWidth * SWORD_THRUST_RETRACT_WIDTH_RATIO) / 100
    const retractDistance = Math.max(retractByRadius, retractByWidth)

    outStart.x = playerPos.x - facing * retractDistance
    outStart.y = thrustY
    outStart.rotation = rotation

    outEnd.x = playerPos.x + facing * endDistance
    outEnd.y = thrustY
    outEnd.rotation = rotation
    return
  }

  outStart.x = playerPos.x + facing * (startDistance - startGripOffset)
  outStart.y = thrustY
  outStart.rotation = rotation

  outEnd.x = playerPos.x + facing * (endDistance - endGripOffset)
  outEnd.y = thrustY
  outEnd.rotation = rotation
}

export function getStrikeTransforms(
  playerPos: { x: number; y: number },
  facing: number,
  radius: number,
  _weaponType: WeaponVisualType,
  outStart: WeaponTransform,
  outEnd: WeaponTransform
): void {
  const frontAngle =
    facing === 1 ? FRONT_SWING_TILT_RAD : -Math.PI - FRONT_SWING_TILT_RAD
  const headAngle = DEFAULT_WEAPON_VERTICAL_ROTATION_RAD
  getTransformAtAngle(playerPos, headAngle, radius, outStart)
  getTransformAtAngle(playerPos, frontAngle, radius, outEnd)
}

export function getSwingTransforms(
  radius: number,
  facing: number,
  kind: AttackKind,
  direction: 'toFront' | 'toHead',
  playerPos: { x: number; y: number },
  weaponType: WeaponVisualType,
  weaponWidth: number,
  outStart: WeaponTransform,
  outEnd: WeaponTransform
): void {
  if (kind === 'thrust') {
    getThrustTransforms(
      radius,
      facing,
      playerPos,
      weaponType,
      weaponWidth,
      outStart,
      outEnd
    )
    return
  }
  if (kind === 'strike') {
    getStrikeTransforms(playerPos, facing, radius, weaponType, outStart, outEnd)
    return
  }

  const frontAngle =
    facing === 1 ? FRONT_SWING_TILT_RAD : -Math.PI - FRONT_SWING_TILT_RAD
  const headAngle = DEFAULT_WEAPON_VERTICAL_ROTATION_RAD
  const swingStartAngle = direction === 'toFront' ? headAngle : frontAngle
  const swingEndAngle = direction === 'toFront' ? frontAngle : headAngle

  getTransformAtAngle(playerPos, swingStartAngle, radius, outStart)
  getTransformAtAngle(playerPos, swingEndAngle, radius, outEnd)
}

export function realignToFacing(
  weapon: Entity['weapon'],
  playerPos: { x: number; y: number },
  facing: number,
  minimumElapsedMs: number,
  radius: number
): void {
  if (!weapon) return
  getFrontTransform(
    playerPos,
    facing,
    weapon.visual,
    radius,
    weapon.weaponType,
    weapon.width
  )
  getOffsetFromTransform(weapon.visual, playerPos, weapon.attackStartOffset)
  weapon.attackFacing = facing
  copyTransform(weapon.attackStartTransform, weapon.visual)
  copyTransform(weapon.swingStartTransform, weapon.visual)
  copyTransform(weapon.swingEndTransform, weapon.visual)
  getOffsetFromTransform(weapon.visual, playerPos, weapon.swingStartOffset)
  getOffsetFromTransform(weapon.visual, playerPos, weapon.swingEndOffset)

  weapon.attackElapsedMs = Math.max(weapon.attackElapsedMs, minimumElapsedMs)
}
