import {
  DEFAULT_WEAPON_ATTACK_PAUSE_MS,
  DEFAULT_WEAPON_ATTACK_RECOVER_MS,
  DEFAULT_WEAPON_ATTACK_SWING_MS,
  DEFAULT_WEAPON_ATTACK_WINDUP_MS,
  DEFAULT_WEAPON_FINAL_WINDUP_MS,
} from '../constants'
import type { AttackMoveData, AttackMoveset } from './AttackMoveData'

export type AttackMovesetOwner = 'player' | 'enemy'

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
    compatibleWeaponTypes: ['sword', 'shortSword', 'longSword'],
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
    compatibleWeaponTypes: ['sword', 'shortSword', 'longSword'],
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
    compatibleWeaponTypes: ['sword', 'shortSword', 'longSword'],
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
    compatibleWeaponTypes: ['sword', 'shortSword', 'longSword'],
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
    compatibleWeaponTypes: ['sword', 'shortSword', 'longSword'],
    knockback: 2,
    isUnstoppable: false,
    swingDirection: 'toFront',
    radiusScale: 115,
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
  if (weaponType === 'sword') {
    if (owner === 'enemy') {
      return ATTACK_MOVESETS['sword_default'] || null
    }
    return ATTACK_MOVESETS['sword_thrust'] || null
  }
  return null
}
