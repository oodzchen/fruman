import type { WeaponComponent } from './ecs/Component'
import { FLAGS } from './worker/binaryProtocol'

export const SKELETAL_ANIMATION_NAMES = [
  'idle',
  'move',
  'run',
  'jump',
  'roll',
  'stagger',
  'collapse',
] as const

export type SkeletalAnimationName = (typeof SKELETAL_ANIMATION_NAMES)[number]
type SkeletalWeaponAttackPhase = WeaponComponent['attackPhase']

const MIN_LOCOMOTION_SPEED_1000 = 600
const MIN_RUN_SPEED_1000 = 5000

export function isSkeletalMoveAnimationAllowed(flags: number): boolean {
  return isSkeletalMoveAnimationAllowedFromState(
    (flags & FLAGS.DEAD) !== 0,
    (flags & FLAGS.STAGGERED) !== 0,
    (flags & FLAGS.ROLLING) !== 0,
    (flags & FLAGS.WEAPON_ATTACKING) !== 0,
    (flags & FLAGS.WEAPON_BLOCKING) !== 0
  )
}

export function isSkeletalWeaponAttacking(
  attackPhase: SkeletalWeaponAttackPhase | undefined,
  isGrounded: boolean
): boolean {
  return attackPhase === 'swing' || (attackPhase === 'pause' && !isGrounded)
}

export function isSkeletalCombatReady(
  attackPhase: SkeletalWeaponAttackPhase | undefined,
  isBlocking: boolean,
  lockedTargetId: number | null
): boolean {
  return (
    isBlocking ||
    lockedTargetId !== null ||
    (attackPhase !== undefined && attackPhase !== 'idle')
  )
}

export function resolveSkeletalAnimationName(
  flags: number,
  moveDir: number
): SkeletalAnimationName {
  return resolveSkeletalAnimationNameFromMotionState(
    (flags & FLAGS.DEAD) !== 0,
    (flags & FLAGS.STAGGERED) !== 0,
    (flags & FLAGS.ROLLING) !== 0,
    (flags & FLAGS.WEAPON_ATTACKING) !== 0,
    (flags & FLAGS.WEAPON_BLOCKING) !== 0,
    true,
    false,
    moveDir,
    moveDir === 0 ? 0 : MIN_LOCOMOTION_SPEED_1000 / 1000,
    0
  )
}

export function resolveSkeletalAnimationNameFromMotionState(
  isDead: boolean,
  isStaggered: boolean,
  isRolling: boolean,
  isWeaponAttacking: boolean,
  isWeaponBlocking: boolean,
  isGrounded: boolean,
  isSprinting: boolean,
  moveDir: number,
  velocityX: number,
  velocityY: number
): SkeletalAnimationName {
  const horizontalSpeed1000 = getSkeletalHorizontalSpeed1000(velocityX)
  if (!isGrounded) {
    if (isDead) {
      return 'collapse'
    }
    if (isStaggered) {
      return 'stagger'
    }
    if (isRolling) {
      return 'roll'
    }
    return 'jump'
  }
  return resolveSkeletalAnimationNameFromState(
    isDead,
    isStaggered,
    isRolling,
    isWeaponAttacking,
    isWeaponBlocking,
    moveDir,
    horizontalSpeed1000,
    Math.round(velocityY * 1000),
    isSprinting
  )
}

export function resolveSkeletalAnimationNameFromState(
  isDead: boolean,
  isStaggered: boolean,
  isRolling: boolean,
  isWeaponAttacking: boolean,
  isWeaponBlocking: boolean,
  moveDir: number,
  horizontalSpeed1000 = 0,
  _verticalSpeed1000 = 0,
  isSprinting = false
): SkeletalAnimationName {
  if (isDead) {
    return 'collapse'
  }
  if (isStaggered) {
    return 'stagger'
  }
  if (isRolling) {
    return 'roll'
  }
  if (isSprinting && horizontalSpeed1000 >= MIN_RUN_SPEED_1000) {
    return 'run'
  }
  if (
    moveDir !== 0 &&
    horizontalSpeed1000 >= MIN_LOCOMOTION_SPEED_1000 &&
    isSkeletalMoveAnimationAllowedFromState(
      isDead,
      isStaggered,
      isRolling,
      isWeaponAttacking,
      isWeaponBlocking
    )
  ) {
    return 'move'
  }
  return 'idle'
}

export function resolveSkeletalMoveDirection(
  velocityX: number,
  fallbackMoveDir: number,
  fallbackFacing: number
): number {
  const velocityX1000 = Math.round(velocityX * 1000)
  if (velocityX1000 >= MIN_LOCOMOTION_SPEED_1000) {
    return 1
  }
  if (velocityX1000 <= -MIN_LOCOMOTION_SPEED_1000) {
    return -1
  }
  if (fallbackMoveDir > 0) {
    return 1
  }
  if (fallbackMoveDir < 0) {
    return -1
  }
  return fallbackFacing < 0 ? -1 : 1
}

export function getSkeletalHorizontalSpeed1000(velocityX: number): number {
  const speed1000 = Math.round(velocityX * 1000)
  return speed1000 < 0 ? -speed1000 : speed1000
}

function isSkeletalMoveAnimationAllowedFromState(
  isDead: boolean,
  isStaggered: boolean,
  isRolling: boolean,
  isWeaponAttacking: boolean,
  isWeaponBlocking: boolean
): boolean {
  return (
    !isDead &&
    !isStaggered &&
    !isRolling &&
    !isWeaponAttacking &&
    !isWeaponBlocking
  )
}
