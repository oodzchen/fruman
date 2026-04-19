import {
  DEFAULT_WEAPON_ATTACK_PAUSE_MS,
  DEFAULT_WEAPON_ATTACK_RECOVER_MS,
  DEFAULT_WEAPON_ATTACK_SWING_MS,
  DEFAULT_WEAPON_ATTACK_WINDUP_MS,
  DEFAULT_WEAPON_FINAL_WINDUP_MS,
} from '../constants'
import type {
  NormalAttackMovesetId,
  NpcAttackCondition,
  NpcAttackMove,
  NpcAttackMoveId,
  UltimateMovesetId,
  WeaponType,
  WeaponVisualType,
} from '../types'
import type { AttackMoveData, AttackMoveset } from './AttackMoveData'

export type AttackMovesetOwner = 'player' | 'npc'

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

export const NPC_ATTACK_MOVE_OPTIONS: Array<{
  value: NpcAttackMoveId
  labelKey: string
}> = [
  ...NORMAL_ATTACK_MOVESET_OPTIONS,
  {
    value: 'leap_attack',
    labelKey: 'editor_attack_module_leap_attack',
  },
]

export const DEFAULT_NPC_ATTACK_MOVES: ReadonlyArray<Readonly<NpcAttackMove>> =
  Object.freeze([{ movesetId: 'leap_attack', probability: 90 }])

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
    compatibleWeaponTypes: ['sword', 'spear'],

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
    compatibleWeaponTypes: ['sword', 'spear'],

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
    compatibleWeaponTypes: ['sword', 'spear'],

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
    compatibleWeaponTypes: ['sword', 'spear'],

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
    compatibleWeaponTypes: ['sword', 'spear'],

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
    compatibleWeaponTypes: ['hammer'],

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
    compatibleWeaponTypes: ['hammer'],

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
    compatibleWeaponTypes: ['hammer'],

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
    compatibleWeaponTypes: ['hammer'],

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
    compatibleWeaponTypes: ['hammer'],

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
    condition: 'any',
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
    condition: 'enemy_close',
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
    condition: 'any',
  },
  // 绝招占位（具体招式待实现）
  sword_ultimate: {
    id: 'sword_ultimate',
    defaultSequenceId: 'seq_sword_ultimate',
    sequences: [
      {
        id: 'seq_sword_ultimate',
        moves: ['sword_slash_front'],
        loop: false,
      },
    ],
    derivations: [],
    condition: 'any',
  },
  hammer_ultimate: {
    id: 'hammer_ultimate',
    defaultSequenceId: 'seq_hammer_ultimate',
    sequences: [
      {
        id: 'seq_hammer_ultimate',
        moves: ['hammer_strike_open'],
        loop: false,
      },
    ],
    derivations: [],
    condition: 'any',
  },
  spear_ultimate: {
    id: 'spear_ultimate',
    defaultSequenceId: 'seq_spear_ultimate',
    sequences: [
      {
        id: 'seq_spear_ultimate',
        moves: ['sword_thrust_open'],
        loop: false,
      },
    ],
    derivations: [],
    condition: 'any',
  },
  bow_ultimate: {
    id: 'bow_ultimate',
    defaultSequenceId: 'seq_bow_ultimate',
    sequences: [
      {
        id: 'seq_bow_ultimate',
        moves: ['sword_slash_front'],
        loop: false,
      },
    ],
    derivations: [],
    condition: 'enemy_far',
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
    condition: 'any',
  },
}

export function getMovesetForWeaponType(
  weaponType: string
): AttackMoveset | null {
  const movesetId = getDefaultAttackMovesetIdForWeaponType(
    weaponType as WeaponVisualType
  )
  return movesetId ? ATTACK_MOVESETS[movesetId] || null : null
}

export function getMovesetForWeaponTypeAndOwner(
  weaponType: string,
  _owner: AttackMovesetOwner
): AttackMoveset | null {
  return getMovesetForWeaponType(weaponType)
}

export function getDefaultAttackMovesetIdForWeaponType(
  weaponType: WeaponType | WeaponVisualType
): NormalAttackMovesetId | '' {
  if (weaponType === 'sword') {
    return 'sword_default'
  }
  if (weaponType === 'spear') {
    return 'sword_thrust'
  }
  if (weaponType === 'hammer') {
    return 'hammer_strike'
  }
  return ''
}

export function isMovesetCompatibleWithWeaponType(
  movesetId: string,
  weaponType: WeaponType
): boolean {
  switch (movesetId) {
    case 'sword_default':
      return weaponType === 'sword'
    case 'sword_thrust':
      return weaponType === 'sword' || weaponType === 'spear'
    case 'hammer_strike':
      return weaponType === 'hammer'
    default:
      return false
  }
}

export function getUltimateMovesetIdForWeaponType(
  weaponType: WeaponType | WeaponVisualType
): UltimateMovesetId | '' {
  if (weaponType === 'sword') {
    return 'sword_ultimate'
  }
  if (weaponType === 'hammer') {
    return 'hammer_ultimate'
  }
  if (weaponType === 'spear') {
    return 'spear_ultimate'
  }
  if (weaponType === 'bow') {
    return 'bow_ultimate'
  }
  return ''
}

export function getDefaultNormalAttackMovesetId(
  owner: AttackMovesetOwner
): NormalAttackMovesetId {
  return owner === 'npc' ? 'sword_default' : 'sword_default'
}

export function getNpcAttackMoveCondition(
  movesetId: NpcAttackMoveId
): NpcAttackCondition {
  if (movesetId === 'leap_attack') {
    return 'any'
  }
  return ATTACK_MOVESETS[movesetId]?.condition ?? 'any'
}

export function isNpcAttackMoveId(
  value: string | undefined
): value is NpcAttackMoveId {
  return value === 'leap_attack' || isNormalAttackMovesetId(value)
}

export function buildDefaultNpcAttackMoves(): NpcAttackMove[] {
  const result: NpcAttackMove[] = []
  for (let i = 0; i < DEFAULT_NPC_ATTACK_MOVES.length; i++) {
    const attackMove = DEFAULT_NPC_ATTACK_MOVES[i]
    result.push({
      movesetId: attackMove.movesetId,
      probability: attackMove.probability,
    })
  }
  return result
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
