import {
  DEFAULT_WEAPON_ATTACK_PAUSE_MS,
  DEFAULT_WEAPON_ATTACK_RECOVER_MS,
  DEFAULT_WEAPON_ATTACK_SWING_MS,
  DEFAULT_WEAPON_ATTACK_WINDUP_MS,
  DEFAULT_WEAPON_FINAL_WINDUP_MS,
} from '../constants'
import type { NormalAttackMovesetId } from '../types'
import type { AttackMoveData, AttackMoveset } from './AttackMoveData'

export type AttackMovesetOwner = 'player' | 'enemy'

export const NORMAL_ATTACK_MOVESET_OPTIONS: Array<{
  value: NormalAttackMovesetId
  labelKey: string
}> = [
  {
    value: 'sword_default',
    labelKey: 'editor_attack_module_slash',
  },
  {
    value: 'sword_thrust',
    labelKey: 'editor_attack_module_thrust',
  },
  {
    value: 'hammer_strike',
    labelKey: 'editor_attack_module_strike',
  },
]

export const ATTACK_MOVES: Record<string, AttackMoveData> = {
  sword_slash_front: {
    id: 'sword_slash_front',
    kind: 'slash',
    windupMs: DEFAULT_WEAPON_ATTACK_WINDUP_MS,
    swingMs: DEFAULT_WEAPON_ATTACK_SWING_MS,
    pauseMs: DEFAULT_WEAPON_ATTACK_PAUSE_MS,
    recoverMs: DEFAULT_WEAPON_ATTACK_RECOVER_MS,
    attackDamage: 0,
    postureDamage: 0,
    toughnessDamage: 0,
    knockback: 1,
    isUnstoppable: false,
    swingDirection: 'toFront',
    radiusScale: 100,
    soundId: 0,
  },
  sword_slash_head: {
    id: 'sword_slash_head',
    kind: 'slash',
    windupMs: DEFAULT_WEAPON_ATTACK_WINDUP_MS,
    swingMs: DEFAULT_WEAPON_ATTACK_SWING_MS,
    pauseMs: DEFAULT_WEAPON_ATTACK_PAUSE_MS,
    recoverMs: DEFAULT_WEAPON_ATTACK_RECOVER_MS,
    attackDamage: 0,
    postureDamage: 0,
    toughnessDamage: 0,
    knockback: 1,
    isUnstoppable: false,
    swingDirection: 'toHead',
    radiusScale: 100,
    soundId: 0,
  },
  sword_slash_front_combo: {
    id: 'sword_slash_front_combo',
    kind: 'slash',
    windupMs: 0,
    swingMs: DEFAULT_WEAPON_ATTACK_SWING_MS,
    pauseMs: DEFAULT_WEAPON_ATTACK_PAUSE_MS,
    recoverMs: DEFAULT_WEAPON_ATTACK_RECOVER_MS,
    attackDamage: 0,
    postureDamage: 0,
    toughnessDamage: 0,
    knockback: 1,
    isUnstoppable: false,
    swingDirection: 'toFront',
    radiusScale: 100,
    soundId: 0,
  },
  sword_slash_head_combo: {
    id: 'sword_slash_head_combo',
    kind: 'slash',
    windupMs: 0,
    swingMs: DEFAULT_WEAPON_ATTACK_SWING_MS,
    pauseMs: DEFAULT_WEAPON_ATTACK_PAUSE_MS,
    recoverMs: DEFAULT_WEAPON_ATTACK_RECOVER_MS,
    attackDamage: 0,
    postureDamage: 0,
    toughnessDamage: 0,
    knockback: 1,
    isUnstoppable: false,
    swingDirection: 'toHead',
    radiusScale: 100,
    soundId: 0,
  },
  sword_finisher: {
    id: 'sword_finisher',
    kind: 'slash',
    windupMs: DEFAULT_WEAPON_FINAL_WINDUP_MS,
    swingMs: DEFAULT_WEAPON_ATTACK_SWING_MS,
    pauseMs: DEFAULT_WEAPON_ATTACK_PAUSE_MS,
    recoverMs: DEFAULT_WEAPON_ATTACK_RECOVER_MS,
    attackDamage: 0,
    postureDamage: 0,
    toughnessDamage: 0,
    knockback: 2,
    isUnstoppable: false,
    swingDirection: 'toFront',
    radiusScale: 120,
    soundId: 0,
  },
  sword_thrust_open: {
    id: 'sword_thrust_open',
    kind: 'thrust',
    windupMs: DEFAULT_WEAPON_ATTACK_WINDUP_MS,
    swingMs: DEFAULT_WEAPON_ATTACK_SWING_MS,
    pauseMs: DEFAULT_WEAPON_ATTACK_PAUSE_MS,
    recoverMs: DEFAULT_WEAPON_ATTACK_RECOVER_MS,
    attackDamage: 0,
    postureDamage: 0,
    toughnessDamage: 0,
    damageScaleNumerator: 2,
    damageScaleDenominator: 3,
    compatibleWeaponTypes: ['sword', 'shortSword', 'longSword', 'spear'],
    knockback: 1,
    isUnstoppable: false,
    swingDirection: 'toFront',
    radiusScale: 100,
    soundId: 0,
  },
  sword_thrust_combo_1: {
    id: 'sword_thrust_combo_1',
    kind: 'thrust',
    windupMs: DEFAULT_WEAPON_ATTACK_WINDUP_MS,
    swingMs: DEFAULT_WEAPON_ATTACK_SWING_MS,
    pauseMs: DEFAULT_WEAPON_ATTACK_PAUSE_MS,
    recoverMs: DEFAULT_WEAPON_ATTACK_RECOVER_MS,
    attackDamage: 0,
    postureDamage: 0,
    toughnessDamage: 0,
    damageScaleNumerator: 2,
    damageScaleDenominator: 3,
    compatibleWeaponTypes: ['sword', 'shortSword', 'longSword', 'spear'],
    knockback: 1,
    isUnstoppable: false,
    swingDirection: 'toFront',
    radiusScale: 100,
    soundId: 0,
  },
  sword_thrust_combo_2: {
    id: 'sword_thrust_combo_2',
    kind: 'thrust',
    windupMs: DEFAULT_WEAPON_ATTACK_WINDUP_MS,
    swingMs: DEFAULT_WEAPON_ATTACK_SWING_MS,
    pauseMs: DEFAULT_WEAPON_ATTACK_PAUSE_MS,
    recoverMs: DEFAULT_WEAPON_ATTACK_RECOVER_MS,
    attackDamage: 0,
    postureDamage: 0,
    toughnessDamage: 0,
    damageScaleNumerator: 2,
    damageScaleDenominator: 3,
    compatibleWeaponTypes: ['sword', 'shortSword', 'longSword', 'spear'],
    knockback: 1,
    isUnstoppable: false,
    swingDirection: 'toFront',
    radiusScale: 100,
    soundId: 0,
  },
  sword_thrust_combo_3: {
    id: 'sword_thrust_combo_3',
    kind: 'thrust',
    windupMs: DEFAULT_WEAPON_ATTACK_WINDUP_MS,
    swingMs: DEFAULT_WEAPON_ATTACK_SWING_MS,
    pauseMs: DEFAULT_WEAPON_ATTACK_PAUSE_MS,
    recoverMs: DEFAULT_WEAPON_ATTACK_RECOVER_MS,
    attackDamage: 0,
    postureDamage: 0,
    toughnessDamage: 0,
    damageScaleNumerator: 2,
    damageScaleDenominator: 3,
    compatibleWeaponTypes: ['sword', 'shortSword', 'longSword', 'spear'],
    knockback: 1,
    isUnstoppable: false,
    swingDirection: 'toFront',
    radiusScale: 100,
    soundId: 0,
  },
  sword_thrust_finisher: {
    id: 'sword_thrust_finisher',
    kind: 'thrust',
    windupMs: DEFAULT_WEAPON_FINAL_WINDUP_MS,
    swingMs: DEFAULT_WEAPON_ATTACK_SWING_MS,
    pauseMs: DEFAULT_WEAPON_ATTACK_PAUSE_MS,
    recoverMs: DEFAULT_WEAPON_ATTACK_RECOVER_MS,
    attackDamage: 0,
    postureDamage: 0,
    toughnessDamage: 0,
    damageScaleNumerator: 2,
    damageScaleDenominator: 3,
    compatibleWeaponTypes: ['sword', 'shortSword', 'longSword', 'spear'],
    knockback: 2,
    isUnstoppable: false,
    swingDirection: 'toFront',
    radiusScale: 130,
    soundId: 0,
  },
  hammer_strike_open: {
    id: 'hammer_strike_open',
    kind: 'strike',
    windupMs: DEFAULT_WEAPON_ATTACK_WINDUP_MS,
    swingMs: DEFAULT_WEAPON_ATTACK_SWING_MS,
    pauseMs: DEFAULT_WEAPON_ATTACK_PAUSE_MS,
    recoverMs: DEFAULT_WEAPON_ATTACK_RECOVER_MS,
    attackDamage: 0,
    postureDamage: 0,
    toughnessDamage: 0,
    compatibleWeaponTypes: ['hammer', 'bigHammer'],
    knockback: 1,
    isUnstoppable: false,
    swingDirection: 'toFront',
    radiusScale: 100,
    soundId: 0,
  },
  hammer_strike_combo_1: {
    id: 'hammer_strike_combo_1',
    kind: 'strike',
    windupMs: DEFAULT_WEAPON_ATTACK_WINDUP_MS,
    swingMs: DEFAULT_WEAPON_ATTACK_SWING_MS,
    pauseMs: DEFAULT_WEAPON_ATTACK_PAUSE_MS,
    recoverMs: DEFAULT_WEAPON_ATTACK_RECOVER_MS,
    attackDamage: 0,
    postureDamage: 0,
    toughnessDamage: 0,
    compatibleWeaponTypes: ['hammer', 'bigHammer'],
    knockback: 1,
    isUnstoppable: false,
    swingDirection: 'toFront',
    radiusScale: 100,
    soundId: 0,
  },
  hammer_strike_combo_2: {
    id: 'hammer_strike_combo_2',
    kind: 'strike',
    windupMs: DEFAULT_WEAPON_ATTACK_WINDUP_MS,
    swingMs: DEFAULT_WEAPON_ATTACK_SWING_MS,
    pauseMs: DEFAULT_WEAPON_ATTACK_PAUSE_MS,
    recoverMs: DEFAULT_WEAPON_ATTACK_RECOVER_MS,
    attackDamage: 0,
    postureDamage: 0,
    toughnessDamage: 0,
    compatibleWeaponTypes: ['hammer', 'bigHammer'],
    knockback: 1,
    isUnstoppable: false,
    swingDirection: 'toFront',
    radiusScale: 100,
    soundId: 0,
  },
  hammer_strike_combo_3: {
    id: 'hammer_strike_combo_3',
    kind: 'strike',
    windupMs: DEFAULT_WEAPON_ATTACK_WINDUP_MS,
    swingMs: DEFAULT_WEAPON_ATTACK_SWING_MS,
    pauseMs: DEFAULT_WEAPON_ATTACK_PAUSE_MS,
    recoverMs: DEFAULT_WEAPON_ATTACK_RECOVER_MS,
    attackDamage: 0,
    postureDamage: 0,
    toughnessDamage: 0,
    compatibleWeaponTypes: ['hammer', 'bigHammer'],
    knockback: 1,
    isUnstoppable: false,
    swingDirection: 'toFront',
    radiusScale: 105,
    soundId: 0,
  },
  hammer_strike_finisher: {
    id: 'hammer_strike_finisher',
    kind: 'strike',
    windupMs: DEFAULT_WEAPON_FINAL_WINDUP_MS,
    swingMs: DEFAULT_WEAPON_ATTACK_SWING_MS,
    pauseMs: DEFAULT_WEAPON_ATTACK_PAUSE_MS,
    recoverMs: DEFAULT_WEAPON_ATTACK_RECOVER_MS,
    attackDamage: 0,
    postureDamage: 0,
    toughnessDamage: 0,
    compatibleWeaponTypes: ['hammer', 'bigHammer'],
    knockback: 2,
    isUnstoppable: false,
    swingDirection: 'toFront',
    radiusScale: 120,
    soundId: 0,
  },
}

export const ATTACK_MOVESETS: Record<string, AttackMoveset> = {
  sword_default: {
    id: 'sword_default',
    defaultSequenceId: 'seq_sword_default',
    sequences: [
      {
        id: 'seq_sword_default',
        moves: [
          'sword_slash_front',
          'sword_slash_head_combo',
          'sword_slash_front_combo',
          'sword_slash_head_combo',
          'sword_finisher',
        ],
        loop: false,
      },
    ],
    derivations: [],
  },
  sword_thrust: {
    id: 'sword_thrust',
    defaultSequenceId: 'seq_sword_thrust',
    sequences: [
      {
        id: 'seq_sword_thrust',
        moves: [
          'sword_thrust_open',
          'sword_thrust_combo_1',
          'sword_thrust_combo_2',
          'sword_thrust_combo_3',
          'sword_thrust_finisher',
        ],
        loop: false,
      },
    ],
    derivations: [],
  },
  hammer_strike: {
    id: 'hammer_strike',
    defaultSequenceId: 'seq_hammer_strike',
    sequences: [
      {
        id: 'seq_hammer_strike',
        moves: [
          'hammer_strike_open',
          'hammer_strike_combo_1',
          'hammer_strike_combo_2',
          'hammer_strike_combo_3',
          'hammer_strike_finisher',
        ],
        loop: false,
      },
    ],
    derivations: [],
  },
  // Used for testing combo
  test_combo: {
    id: 'test_combo',
    defaultSequenceId: 'seq_test_combo',
    sequences: [
      {
        id: 'seq_test_combo',
        moves: [
          'sword_slash_front',
          'sword_slash_head_combo',
          'sword_finisher',
        ],
        loop: false,
      },
    ],
    derivations: [],
  },
}

export function getMovesetForWeaponType(
  weaponType: string
): AttackMoveset | null {
  return getMovesetForWeaponTypeAndOwner(weaponType, 'player')
}

export function getMovesetForWeaponTypeAndOwner(
  weaponType: string,
  owner: AttackMovesetOwner
): AttackMoveset | null {
  if (weaponType === 'spear') {
    return ATTACK_MOVESETS.sword_thrust || null
  }
  if (weaponType === 'hammer' || weaponType === 'bigHammer') {
    return ATTACK_MOVESETS.hammer_strike || null
  }
  if (weaponType === 'sword') {
    return ATTACK_MOVESETS[getDefaultNormalAttackMovesetId(owner)] || null
  }
  return null
}

export function getDefaultNormalAttackMovesetId(
  owner: AttackMovesetOwner
): NormalAttackMovesetId {
  return owner === 'enemy' ? 'sword_default' : 'sword_thrust'
}

export function isNormalAttackMovesetId(
  value: string | undefined
): value is NormalAttackMovesetId {
  return (
    value === 'sword_default' ||
    value === 'sword_thrust' ||
    value === 'hammer_strike'
  )
}
