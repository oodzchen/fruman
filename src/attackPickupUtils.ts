import { getUltimateMovesetIdForWeaponType } from './ecs/AttackMoveRegistry'
import type { AttackSlotsComponent } from './ecs/Component'
import { DEFAULT_SKILL_MAX_CHARGES } from './ecs/Component'
import type { AttackPickupKind, WeaponType, WeaponVisualType } from './types'

export interface AttackPickupDefinition {
  weaponType: WeaponType
  kind: AttackPickupKind
}

export const ATTACK_PICKUP_DEFINITIONS: readonly AttackPickupDefinition[] = [
  { weaponType: 'sword', kind: 'ultimate' },
  { weaponType: 'spear', kind: 'ultimate' },
  { weaponType: 'hammer', kind: 'ultimate' },
  { weaponType: 'hammer', kind: 'skill' },
]

export const ATTACK_PICKUP_KIND_ULTIMATE_ID = 0
export const ATTACK_PICKUP_KIND_SKILL_ID = 1

export function getAttackPickupKindId(kind: AttackPickupKind): number {
  return kind === 'skill'
    ? ATTACK_PICKUP_KIND_SKILL_ID
    : ATTACK_PICKUP_KIND_ULTIMATE_ID
}

export function getAttackPickupKindFromId(id: number): AttackPickupKind {
  return id === ATTACK_PICKUP_KIND_SKILL_ID ? 'skill' : 'ultimate'
}

export function getAttackPickupMask(weaponType: WeaponVisualType): number {
  switch (weaponType) {
    case 'sword':
      return 1 << 0
    case 'spear':
      return 1 << 1
    case 'hammer':
      return 1 << 2
    case 'bow':
      return 1 << 3
    default:
      return 0
  }
}

export function getSkillIdForWeaponType(weaponType: WeaponVisualType): string {
  return weaponType === 'hammer' ? 'hammer_crit' : ''
}

export function getUltimateIconTypeForWeaponType(
  weaponType: WeaponVisualType
): 'sword' | 'hammer' | 'spear' {
  if (weaponType === 'hammer') {
    return 'hammer'
  }
  if (weaponType === 'spear') {
    return 'spear'
  }
  return 'sword'
}

export function hasUnlockedAttackPickup(
  attackSlots: AttackSlotsComponent,
  weaponType: WeaponVisualType,
  kind: AttackPickupKind
): boolean {
  const mask = getAttackPickupMask(weaponType)
  if (mask === 0) {
    return false
  }
  return kind === 'skill'
    ? (attackSlots.unlockedSkillMask & mask) !== 0
    : (attackSlots.unlockedUltimateMask & mask) !== 0
}

export function unlockAttackPickup(
  attackSlots: AttackSlotsComponent,
  weaponType: WeaponType,
  kind: AttackPickupKind
): boolean {
  const mask = getAttackPickupMask(weaponType)
  if (mask === 0) {
    return false
  }
  if (kind === 'skill') {
    if ((attackSlots.unlockedSkillMask & mask) !== 0) {
      return false
    }
    attackSlots.unlockedSkillMask |= mask
    setSkillChargesForWeaponType(
      attackSlots,
      weaponType,
      DEFAULT_SKILL_MAX_CHARGES
    )
    return true
  }
  if ((attackSlots.unlockedUltimateMask & mask) !== 0) {
    return false
  }
  attackSlots.unlockedUltimateMask |= mask
  return true
}

export function getUnlockedUltimateMovesetId(
  attackSlots: AttackSlotsComponent,
  weaponType: WeaponVisualType
): string {
  if (!hasUnlockedAttackPickup(attackSlots, weaponType, 'ultimate')) {
    return ''
  }
  return getUltimateMovesetIdForWeaponType(weaponType)
}

export function getUnlockedSkillId(
  attackSlots: AttackSlotsComponent,
  weaponType: WeaponVisualType
): string {
  if (!hasUnlockedAttackPickup(attackSlots, weaponType, 'skill')) {
    return ''
  }
  return getSkillIdForWeaponType(weaponType)
}

export function getSkillChargesForWeaponType(
  attackSlots: AttackSlotsComponent,
  weaponType: WeaponVisualType
): number {
  switch (weaponType) {
    case 'sword':
      return attackSlots.swordSkillCharges
    case 'spear':
      return attackSlots.spearSkillCharges
    case 'hammer':
      return attackSlots.hammerSkillCharges
    case 'bow':
      return attackSlots.bowSkillCharges
    default:
      return 0
  }
}

export function setSkillChargesForWeaponType(
  attackSlots: AttackSlotsComponent,
  weaponType: WeaponVisualType,
  charges: number
): void {
  const nextCharges = Math.max(0, Math.round(charges))
  switch (weaponType) {
    case 'sword':
      attackSlots.swordSkillCharges = nextCharges
      break
    case 'spear':
      attackSlots.spearSkillCharges = nextCharges
      break
    case 'hammer':
      attackSlots.hammerSkillCharges = nextCharges
      break
    case 'bow':
      attackSlots.bowSkillCharges = nextCharges
      break
  }
}

export function refillUnlockedSkills(attackSlots: AttackSlotsComponent): void {
  if ((attackSlots.unlockedSkillMask & getAttackPickupMask('sword')) !== 0) {
    attackSlots.swordSkillCharges = DEFAULT_SKILL_MAX_CHARGES
  }
  if ((attackSlots.unlockedSkillMask & getAttackPickupMask('spear')) !== 0) {
    attackSlots.spearSkillCharges = DEFAULT_SKILL_MAX_CHARGES
  }
  if ((attackSlots.unlockedSkillMask & getAttackPickupMask('hammer')) !== 0) {
    attackSlots.hammerSkillCharges = DEFAULT_SKILL_MAX_CHARGES
  }
  if ((attackSlots.unlockedSkillMask & getAttackPickupMask('bow')) !== 0) {
    attackSlots.bowSkillCharges = DEFAULT_SKILL_MAX_CHARGES
  }
}

export function syncAttackSlotsForWeaponType(
  attackSlots: AttackSlotsComponent,
  weaponType: WeaponVisualType
): void {
  const ultimateMovesetId = getUnlockedUltimateMovesetId(
    attackSlots,
    weaponType
  )
  attackSlots.ultimate.hasMoveset = ultimateMovesetId.length > 0
  attackSlots.ultimate.movesetId = ultimateMovesetId

  const skillId = getUnlockedSkillId(attackSlots, weaponType)
  attackSlots.skill.skillId = skillId
  attackSlots.skill.maxCharges = skillId ? DEFAULT_SKILL_MAX_CHARGES : 0
  attackSlots.skill.chargesRemaining = skillId
    ? getSkillChargesForWeaponType(attackSlots, weaponType)
    : 0
}
