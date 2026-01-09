import {
  DEFAULT_DEATH_FLASH_DURATION,
  DEFAULT_DEATH_FLATTEN_DURATION,
  DEFAULT_ENEMY_ATTACK_DESIRE,
  DEFAULT_ENEMY_MOVE_SPEED,
  DEFAULT_PLAYER_MAX_HEALTH,
  DEFAULT_PLAYER_MAX_TOUGHNESS,
  DEFAULT_PLAYER_TOUGHNESS_RECOVERY_PER_SEC,
  DEFAULT_WEAPON_ATTACK_DAMAGE,
  DEFAULT_WEAPON_TOUGHNESS_DAMAGE,
  ENEMY_DECISION_COOLDOWN_MS,
  ENEMY_DETECTION_RANGE,
  ENEMY_PACE_PAUSE_MS,
  ENEMY_PACE_SWITCH_INTERVAL_MS,
  ENEMY_RETREAT_EXTRA_DISTANCE,
} from '../constants'
import { InputBuffer } from '../inputBuffer'
import type { b2BodyId, b2ShapeId } from '../types'
import { componentRegistry } from './ComponentRegistry'

export abstract class Component {
  abstract getName(): string

  getType(): number {
    return componentRegistry.getComponentType(this.getName())
  }
}

export class TransformComponent extends Component {
  x = 0
  y = 0
  rotation = 0

  getName(): string {
    return 'Transform'
  }
}

export class PhysicsComponent extends Component {
  bodyId!: b2BodyId
  shapeId!: b2ShapeId

  getName(): string {
    return 'Physics'
  }
}

export class MovementComponent extends Component {
  moveSpeed = 0
  jumpForce = 0
  maxJumpDuration = 0
  jumpForceMultiplier = 0
  wallJumpPushAwayMultiplier = 0
  wallJumpUpwardMultiplier = 0
  maxWallJumps = 0

  isGrounded = false
  isTouchingWall = false
  wallDirection = 0
  wallJumpCount = 0
  wallJumpTime = 0

  isJumping = false
  jumpStartTime = 0

  lastContactUpdate = 0
  contactUpdateIntervalMs = 16

  baseWeight = 0
  carryWeight = 0

  isRolling = false
  rollStartTime = 0
  rollDuration = 0
  rollDirection = 0
  rollCooldownEndTime = 0
  knockbackEndTime = 0

  getName(): string {
    return 'Movement'
  }
}

export class InputComponent extends Component {
  moveDirection = 0
  jumpRequested = false
  attackRequested = false
  blockRequested = false
  lockedTargetId: number | null = null
  lockToggleRequested = false
  lockSwitchIntent = 0

  lastMoveDirection = 0
  facingOverride: number | null = null
  inputBuffer = new InputBuffer()

  getName(): string {
    return 'Input'
  }
}

export class RenderComponent extends Component {
  radius = 0.5
  color = '#4CAF50'
  borderColor = '#FFD700'
  visible = true

  getName(): string {
    return 'Render'
  }
}

export class StatsComponent extends Component {
  maxHealth = DEFAULT_PLAYER_MAX_HEALTH
  health = DEFAULT_PLAYER_MAX_HEALTH
  maxToughness = DEFAULT_PLAYER_MAX_TOUGHNESS
  toughness = DEFAULT_PLAYER_MAX_TOUGHNESS
  toughnessRecoveryPerSecond = DEFAULT_PLAYER_TOUGHNESS_RECOVERY_PER_SEC
  isDead = false
  isVanished = false
  deathElapsedSec = 0
  deathFlashDurationSec = DEFAULT_DEATH_FLASH_DURATION
  deathFlattenDurationSec = DEFAULT_DEATH_FLATTEN_DURATION

  hitShakeElapsedMs = 0
  hitShakeDurationMs = 0
  hitShakeIntensity = 0
  hitShakeDirectionX = 0

  getName(): string {
    return 'Stats'
  }
}

export type WeaponTransform = { x: number; y: number; rotation: number }
export type WeaponRelativeTransform = {
  dx: number
  dy: number
  rotation: number
}

export class WeaponComponent extends Component {
  width = 0
  height = 0
  cornerRadius = 0
  weight = 0
  attackDamage = DEFAULT_WEAPON_ATTACK_DAMAGE
  toughnessDamage = DEFAULT_WEAPON_TOUGHNESS_DAMAGE
  knockback = 0
  isColliding = false
  position = { x: 0, y: 0 }
  rotation = 0
  isEquipped = false
  isInCombat = false
  isBlocking = false
  attackPhase:
    | 'idle'
    | 'windup'
    | 'swing'
    | 'rebound'
    | 'pause'
    | 'resetHead'
    | 'headHold'
    | 'recover'
    | 'finalWindup' = 'idle'
  attackElapsedMs = 0
  lastAttackTimestamp = 0
  attackStartTransform: WeaponTransform = { x: 0, y: 0, rotation: 0 }
  visual: WeaponTransform = { x: 0, y: 0, rotation: 0 }
  attackQueued = false
  comboCount = 0
  swingDirection: 'toFront' | 'toHead' = 'toFront'
  nextSwingDirection: 'toFront' | 'toHead' = 'toFront'
  attackFacing = 1
  attackStartOffset: WeaponRelativeTransform = { dx: 0, dy: 0, rotation: 0 }
  swingStartOffset: WeaponRelativeTransform = { dx: 0, dy: 0, rotation: 0 }
  swingEndOffset: WeaponRelativeTransform = { dx: 0, dy: 0, rotation: 0 }
  swingStartTransform: WeaponTransform = { x: 0, y: 0, rotation: 0 }
  swingEndTransform: WeaponTransform = { x: 0, y: 0, rotation: 0 }
  attackRadius = 0
  reboundLockedPause = false
  reboundTargetTransform: WeaponTransform = { x: 0, y: 0, rotation: 0 }
  reboundTargetOffset: WeaponRelativeTransform = { dx: 0, dy: 0, rotation: 0 }
  hitEntityIds: Set<number> = new Set()

  getName(): string {
    return 'Weapon'
  }
}

export enum Faction {
  Player = 'player',
  Enemy = 'enemy',
  Neutral = 'neutral',
}

export class FactionComponent extends Component {
  faction: Faction = Faction.Neutral

  getName(): string {
    return 'Faction'
  }

  canAttack(other: FactionComponent): boolean {
    if (this.faction === Faction.Neutral || other.faction === Faction.Neutral) {
      return false
    }
    if (this.faction === Faction.Player && other.faction === Faction.Player) {
      return false
    }
    return this.faction !== other.faction
  }
}

export class EnemyAIComponent extends Component {
  attackDesire = DEFAULT_ENEMY_ATTACK_DESIRE
  detectionRange = ENEMY_DETECTION_RANGE
  decisionCooldownMs = ENEMY_DECISION_COOLDOWN_MS
  paceSwitchIntervalMs = ENEMY_PACE_SWITCH_INTERVAL_MS
  pacePauseMs = ENEMY_PACE_PAUSE_MS
  paceDirection: -1 | 1 = 1
  lastDecisionTimestamp = 0
  lastPaceSwitchTimestamp = 0
  nextPaceResumeTimestamp = 0
  moveSpeed = DEFAULT_ENEMY_MOVE_SPEED
  state: 'approach' | 'combo' | 'retreat' = 'approach'
  comboSwingsDone = 0
  comboSwingTarget = 5
  lastFacing: -1 | 1 = 1
  retreatDirection: -1 | 1 = -1
  retreatTargetDistance = ENEMY_RETREAT_EXTRA_DISTANCE + 1
  patrolRange = 5
  patrolCenter = { x: 0, y: 0 }
  hasLineOfSight = false

  getName(): string {
    return 'EnemyAI'
  }
}
