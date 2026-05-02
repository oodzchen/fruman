import { getDefaultAttackMovesetIdForWeaponType } from '../ecs/AttackMoveRegistry'
import type {
  WeaponComponent,
  WeaponSlotData,
  WeaponSlotsComponent,
} from '../ecs/Component'
import type { SaveGroundWeaponState, SaveWeaponSlotState } from '../saveTypes'
import type { WeaponType } from '../types'
import { normalizeWeaponType } from '../weaponTypeUtils'

export function applyWeaponSlotState(
  slot: WeaponSlotData,
  state: SaveWeaponSlotState | null
): void {
  if (!state) {
    slot.hasWeapon = false
    slot.movesetId = ''
    return
  }

  const normalizedWeaponType = normalizeWeaponType(state.weaponType)
  if (!normalizedWeaponType) {
    slot.hasWeapon = false
    slot.movesetId = ''
    return
  }

  slot.hasWeapon = true
  slot.weaponType = normalizedWeaponType
  slot.movesetId = getDefaultAttackMovesetIdForWeaponType(normalizedWeaponType)
  slot.sizeLevel = state.sizeLevel
  if (state.width !== undefined) slot.width = state.width
  if (state.height !== undefined) slot.height = state.height
  if (state.baseWidth !== undefined) slot.baseWidth = state.baseWidth
  if (state.sizeMaxLevel !== undefined) slot.sizeMaxLevel = state.sizeMaxLevel
  if (state.cornerRadius !== undefined) slot.cornerRadius = state.cornerRadius
  if (state.weight !== undefined) slot.weight = state.weight
  slot.attackDamage = state.attackDamage
  slot.postureDamage = state.postureDamage
  slot.toughnessDamage = state.toughnessDamage
  slot.bowAmmo = state.bowAmmo
  slot.bowAmmoMax = state.bowAmmoMax
}

export function syncActiveSlotFromWeapon(
  weaponSlots: WeaponSlotsComponent,
  weapon: WeaponComponent
): void {
  if (!weapon.isEquipped) return
  const targetSlot =
    weaponSlots.activeSlot === 'main' ? weaponSlots.main : weaponSlots.secondary
  targetSlot.hasWeapon = true
  targetSlot.weaponType = weapon.weaponType
  targetSlot.movesetId =
    weapon.movesetId ||
    getDefaultAttackMovesetIdForWeaponType(weapon.weaponType)
  targetSlot.width = weapon.baseWidth
  targetSlot.height = weapon.height
  targetSlot.baseWidth = weapon.baseWidth
  targetSlot.sizeLevel = weapon.sizeLevel
  targetSlot.sizeMaxLevel = weapon.sizeMaxLevel
  targetSlot.cornerRadius = weapon.cornerRadius
  targetSlot.weight = weapon.weight
  targetSlot.attackDamage = weapon.attackDamage
  targetSlot.postureDamage = weapon.postureDamage
  targetSlot.toughnessDamage = weapon.toughnessDamage
  targetSlot.bowAmmo = weapon.bowAmmo
  targetSlot.bowAmmoMax = weapon.bowAmmoMax
}

export function applyWeaponFromSlot(
  weapon: WeaponComponent,
  slot: WeaponSlotData
): void {
  if (!slot.hasWeapon) {
    weapon.movesetId = ''
    weapon.isEquipped = false
    return
  }

  const weaponType = slot.weaponType
  weapon.weaponType = weaponType
  weapon.movesetId =
    slot.movesetId || getDefaultAttackMovesetIdForWeaponType(weaponType)
  weapon.sizeLevel = slot.sizeLevel
  weapon.attackDamage = slot.attackDamage
  weapon.postureDamage = slot.postureDamage
  weapon.toughnessDamage = slot.toughnessDamage
  weapon.bowAmmo = slot.bowAmmo
  weapon.bowAmmoMax = slot.bowAmmoMax
  weapon.isEquipped = true

  if (slot.width > 0) {
    weapon.width = slot.width
    weapon.height = slot.height
    weapon.baseWidth = slot.baseWidth
    weapon.blockWidthStart = slot.width
    weapon.blockWidthTarget = slot.width
  }
  if (slot.sizeMaxLevel > 0) {
    weapon.sizeMaxLevel = slot.sizeMaxLevel
  }
  if (slot.cornerRadius > 0) {
    weapon.cornerRadius = slot.cornerRadius
  }
  if (slot.weight > 0) {
    weapon.weight = slot.weight
  }
}

export function applyGroundWeaponState(
  weapon: WeaponComponent,
  state: SaveGroundWeaponState
): void {
  const normalizedWeaponType = normalizeWeaponType(state.weaponType)
  if (!normalizedWeaponType) {
    return
  }
  weapon.weaponType = normalizedWeaponType
  weapon.movesetId =
    getDefaultAttackMovesetIdForWeaponType(normalizedWeaponType)
  weapon.sizeLevel = state.sizeLevel
  weapon.attackDamage = state.attackDamage
  weapon.postureDamage = state.postureDamage
  weapon.toughnessDamage = state.toughnessDamage
  weapon.bowAmmo = state.bowAmmo
  weapon.bowAmmoMax = state.bowAmmoMax
  weapon.isEquipped = false

  if (state.width !== undefined) {
    weapon.width = state.width
    weapon.blockWidthStart = state.width
    weapon.blockWidthTarget = state.width
  }
  if (state.height !== undefined) {
    weapon.height = state.height
  }
  if (state.baseWidth !== undefined) {
    weapon.baseWidth = state.baseWidth
  }
  if (state.sizeMaxLevel !== undefined) {
    weapon.sizeMaxLevel = state.sizeMaxLevel
  }
  if (state.cornerRadius !== undefined) {
    weapon.cornerRadius = state.cornerRadius
  }
  if (state.weight !== undefined) {
    weapon.weight = state.weight
  }

  weapon.position.x = state.position.x
  weapon.position.y = state.position.y
  weapon.visual.x = state.position.x
  weapon.visual.y = state.position.y
  weapon.attackStartTransform.x = state.position.x
  weapon.attackStartTransform.y = state.position.y
  weapon.swingStartTransform.x = state.position.x
  weapon.swingStartTransform.y = state.position.y
  weapon.swingEndTransform.x = state.position.x
  weapon.swingEndTransform.y = state.position.y
}

export function extractWeaponSlotState(
  slot: WeaponSlotData | null
): SaveWeaponSlotState | null {
  if (!slot || !slot.hasWeapon) return null
  return {
    weaponType: slot.weaponType as WeaponType,
    sizeLevel: slot.sizeLevel,
    width: slot.width,
    height: slot.height,
    baseWidth: slot.baseWidth,
    sizeMaxLevel: slot.sizeMaxLevel,
    cornerRadius: slot.cornerRadius,
    weight: slot.weight,
    attackDamage: slot.attackDamage,
    postureDamage: slot.postureDamage,
    toughnessDamage: slot.toughnessDamage,
    bowAmmo: slot.bowAmmo,
    bowAmmoMax: slot.bowAmmoMax,
  }
}
