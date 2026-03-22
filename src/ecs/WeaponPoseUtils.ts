import { DEFAULT_WEAPON_VERTICAL_ROTATION_RAD } from '../constants'
import type { WeaponVisualType } from '../types'
import type { WeaponTransform } from './Component'

export function setWeaponBackTransform(
  playerPos: { x: number; y: number },
  facing: number,
  out: WeaponTransform,
  radius: number,
  weaponType: WeaponVisualType,
  weaponWidth: number
): void {
  out.x = playerPos.x - facing * (radius + 0.2)

  if (weaponType === 'bow') {
    out.y = playerPos.y
    out.rotation = facing === 1 ? -Math.PI / 2 : Math.PI / 2
    return
  }

  if (weaponType === 'spear') {
    out.y = playerPos.y + radius - weaponWidth / 2
    out.rotation = DEFAULT_WEAPON_VERTICAL_ROTATION_RAD
    return
  }

  // 将武器下方（剑柄端）限制在地面以上，当武器足够长时上移中心点
  out.y = playerPos.y + Math.min(0, radius - weaponWidth / 2)
  out.rotation = DEFAULT_WEAPON_VERTICAL_ROTATION_RAD
}
