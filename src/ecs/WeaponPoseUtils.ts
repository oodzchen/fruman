import { DEFAULT_WEAPON_VERTICAL_ROTATION_RAD } from '../constants'
import type { WeaponVisualType } from '../types'
import type { WeaponTransform } from './Component'

export function setWeaponBackTransform(
  playerPos: { x: number; y: number },
  facing: number,
  out: WeaponTransform,
  radius: number,
  weaponType: WeaponVisualType
): void {
  out.x = playerPos.x - facing * (radius + 0.2)
  out.y = playerPos.y

  if (weaponType === 'bow') {
    out.rotation = facing === 1 ? -Math.PI / 2 : Math.PI / 2
    return
  }

  out.rotation = DEFAULT_WEAPON_VERTICAL_ROTATION_RAD
}
