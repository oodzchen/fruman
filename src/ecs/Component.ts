import { InputBuffer } from '../InputBuffer'
import {
  DEFAULT_BODY_FRICTION,
  DEFAULT_DEATH_FLASH_DURATION,
  DEFAULT_DEATH_FLATTEN_DURATION,
  DEFAULT_ENEMY_ATTACK_DESIRE,
  DEFAULT_ENEMY_MOVE_SPEED,
  DEFAULT_GRAVITY,
  DEFAULT_PLAYER_MAX_HEALTH,
  DEFAULT_PLAYER_MAX_POSTURE,
  DEFAULT_PLAYER_MAX_TOUGHNESS,
  DEFAULT_PLAYER_POSTURE_RECOVERY_PER_SEC,
  DEFAULT_PLAYER_TOUGHNESS_RECOVERY_PER_SEC,
  DEFAULT_WEAPON_ATTACK_DAMAGE,
  DEFAULT_WEAPON_POSTURE_DAMAGE,
  DEFAULT_WEAPON_TOUGHNESS_DAMAGE,
  ENEMY_DECISION_COOLDOWN_MS,
  ENEMY_DETECTION_RANGE,
  ENEMY_PACE_PAUSE_MS,
  ENEMY_PACE_SWITCH_INTERVAL_MS,
  ENEMY_RETREAT_EXTRA_DISTANCE,
} from '../constants'
import type {
  EnemyPatrolMode,
  EnemyType,
  WeaponVisualType,
  b2BodyId,
  b2ShapeId,
} from '../types'
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
  wallJumpElapsedTime = 0

  isJumping = false
  jumpStartTime = 0
  jumpElapsedTime = 0

  lastContactUpdate = 0
  contactUpdateIntervalMs = 16

  baseWeight = 0
  carryWeight = 0
  bodyFriction = DEFAULT_BODY_FRICTION
  currentFriction = DEFAULT_BODY_FRICTION

  isSprinting = false
  lKeyHoldTime = 0
  lKeyIsDown = false

  isRolling = false
  rollStartTime = 0
  rollDuration = 0
  rollElapsedTime = 0
  rollDirection = 0
  rollAngle = 0
  rollCooldownEndTime = 0
  rollCooldownElapsedTime = 0

  knockbackEndTime = 0
  knockbackDuration = 0
  knockbackElapsedTime = 0

  getName(): string {
    return 'Movement'
  }
}

export class InputComponent extends Component {
  moveDirection = 0
  jumpRequested = false
  sprintRequested = false
  attackRequested = false
  blockRequested = false
  lockedTargetId: number | null = null
  lockToggleRequested = false
  lockSwitchIntent = 0
  lockLostTimer = 0
  freeAimToggleRequested = false
  freeAimAdjust = 0
  moveSpeedScale = 1
  mouseAimActive = false
  mouseAimX = 0
  mouseAimY = 0

  lastMoveDirection = 0
  facingOverride: number | null = null
  inputBuffer = new InputBuffer()

  getName(): string {
    return 'Input'
  }
}

export class RenderComponent extends Component {
  radius = 0.5
  color = '#F58025'
  borderColor = '#FFD700'
  visible = true

  getName(): string {
    return 'Render'
  }
}

export class StatsComponent extends Component {
  maxHealth = DEFAULT_PLAYER_MAX_HEALTH
  health = DEFAULT_PLAYER_MAX_HEALTH
  maxPosture = DEFAULT_PLAYER_MAX_POSTURE
  posture = DEFAULT_PLAYER_MAX_POSTURE
  postureRecoveryPerSecond = DEFAULT_PLAYER_POSTURE_RECOVERY_PER_SEC
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

  isInCombat = false
  lastCombatTimestamp = 0
  combatExitTimer = 0
  combatExitTimeout = 5000

  isStaggered = false
  staggerElapsedTime = 0
  staggerDuration = 1000
  staggerAnimationPhase: 'none' | 'rotateBack' | 'prone' = 'none'
  staggerAnimationElapsed = 0

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
export type WeaponSlotId = 'main' | 'secondary'
export type WeaponSlotData = {
  hasWeapon: boolean
  weaponType: WeaponVisualType
  width: number
  height: number
  baseWidth: number
  cornerRadius: number
  weight: number
  attackDamage: number
  postureDamage: number
  toughnessDamage: number
}

const createWeaponSlotData = (): WeaponSlotData => ({
  hasWeapon: false,
  weaponType: 'sword',
  width: 0,
  height: 0,
  baseWidth: 0,
  cornerRadius: 0,
  weight: 0,
  attackDamage: DEFAULT_WEAPON_ATTACK_DAMAGE,
  postureDamage: DEFAULT_WEAPON_POSTURE_DAMAGE,
  toughnessDamage: DEFAULT_WEAPON_TOUGHNESS_DAMAGE,
})

export class WeaponComponent extends Component {
  width = 0
  height = 0
  baseWidth = 0
  blockWidthStart = 0
  blockWidthTarget = 0
  cornerRadius = 0
  weight = 0
  weaponType: WeaponVisualType = 'sword'
  attackDamage = DEFAULT_WEAPON_ATTACK_DAMAGE
  postureDamage = DEFAULT_WEAPON_POSTURE_DAMAGE
  toughnessDamage = DEFAULT_WEAPON_TOUGHNESS_DAMAGE
  knockback = 0
  isColliding = false
  isUnstoppable = false
  position = { x: 0, y: 0 }
  rotation = 0
  isEquipped = false
  isBlocking = false
  attackPhase:
    | 'idle'
    | 'block'
    | 'windup'
    | 'swing'
    | 'rebound'
    | 'pause'
    | 'resetHead'
    | 'headHold'
    | 'recover'
    | 'finalWindup'
    | 'blockReturn' = 'idle'
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

  isParrying = false
  parryElapsedTime = 0 // 帧数
  parryWindowDuration = 200
  parryStartTransform: WeaponTransform = { x: 0, y: 0, rotation: 0 }
  parryEndTransform: WeaponTransform = { x: 0, y: 0, rotation: 0 }
  parryStartOffset: WeaponRelativeTransform = { dx: 0, dy: 0, rotation: 0 }
  parryEndOffset: WeaponRelativeTransform = { dx: 0, dy: 0, rotation: 0 }
  parryHitWeaponIds: Set<number> = new Set()
  parryCounterTimerMs = 0
  parryCounterActive = false

  bowIsDrawing = false
  bowDrawElapsedMs = 0
  bowDrawRatio = 0
  bowForceRatio = 0
  bowReleaseRatio = 0
  bowReleasePending = false
  bowReleaseDelayMs = 0
  bowReleaseDelayTotalMs = 0
  bowRecoverElapsedMs = 0
  bowAimAngle = 0
  bowHasAim = false
  bowFreeAim = false
  bowFreeAimAngle = 0
  bowFreeAimReticleX = 0
  bowFreeAimReticleY = 0

  isDropping = false
  isDropped = false
  isRecovering = false
  dropElapsedTime = 0
  dropStartTransform: WeaponTransform = { x: 0, y: 0, rotation: 0 }
  dropEndTransform: WeaponTransform = { x: 0, y: 0, rotation: 0 }
  dropStartOffset: WeaponRelativeTransform = { dx: 0, dy: 0, rotation: 0 }
  dropEndOffset: WeaponRelativeTransform = { dx: 0, dy: 0, rotation: 0 }

  pickupCooldownEndTime = 0 // 在此时间之前不可拾取（毫秒时间戳）

  getName(): string {
    return 'Weapon'
  }
}

export class WeaponSlotsComponent extends Component {
  main = createWeaponSlotData()
  secondary = createWeaponSlotData()
  activeSlot: WeaponSlotId = 'main'

  getName(): string {
    return 'WeaponSlots'
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

export class ArrowComponent extends Component {
  ownerId = 0
  faction: Faction = Faction.Player
  velocityX = 0
  velocityY = 0
  gravity = DEFAULT_GRAVITY
  hitRadius = 0.12
  elapsedMs = 0
  lifetimeMs = 2500

  getName(): string {
    return 'Arrow'
  }
}

export class EnemyAIComponent extends Component {
  attackDesire = DEFAULT_ENEMY_ATTACK_DESIRE
  parryProficiency = 0
  detectionRange = ENEMY_DETECTION_RANGE
  decisionCooldownMs = ENEMY_DECISION_COOLDOWN_MS
  paceSwitchIntervalMs = ENEMY_PACE_SWITCH_INTERVAL_MS
  pacePauseMs = ENEMY_PACE_PAUSE_MS
  paceDirection: -1 | 1 = 1
  lastDecisionTimestamp = 0
  lastPaceSwitchTimestamp = 0
  nextPaceResumeTimestamp = 0
  moveSpeed = DEFAULT_ENEMY_MOVE_SPEED
  state: 'approach' | 'combo' | 'retreat' | 'pacing' | 'probe' = 'approach'
  initialPatrolMode: EnemyPatrolMode = 'patrol'
  comboSwingsDone = 0
  comboSwingTarget = 5
  lastFacing: -1 | 1 = 1
  retreatDirection: -1 | 1 = -1
  retreatTargetDistance = ENEMY_RETREAT_EXTRA_DISTANCE + 1
  patrolRange = 5
  patrolCenter = { x: 0, y: 0 }
  hasLineOfSight = false
  targetLostTimer = 0
  playerSwingActive = false
  parryAttemptedThisSwing = false
  probeSwitchTimerMs = 0
  probePaceTimerMs = 0
  probePaceDirection: -1 | 1 = 1
  probePaceMovedDistance = 0
  probeLastPositionX = 0
  probeLastPositionY = 0
  probeHasTriggered = false
  forcedChaseDistanceRemaining = 0
  forcedChaseDirection: -1 | 1 = 1
  forcedChaseLastX = 0
  combatResetTime = 5000
  lastPosition = { x: 0, y: 0 }
  stuckTimer = 0
  stuckThreshold = 500
  lastPositionUpdateTime = 0
  positionCheckInterval = 300
  obstacleJumpStage = 0 // 0: None, 1: First Jump, 2: Wall Jump, 3: Recovery
  obstacleJumpDirection: -1 | 1 = 1
  jumpStartTimestamp = 0
  jumpStartPosition = { x: 0, y: 0 }

  // Patrol properties
  patrolWaypoints: { x: number; y: number }[] = []
  currentWaypointIndex = 0
  patrolResumeTimestamp = 0
  patrolState: 'moving' | 'waiting' = 'moving'
  patrolStuckTimer = 0
  enemyType: EnemyType = 'default'

  getName(): string {
    return 'EnemyAI'
  }
}

export type RayCastResult = {
  start: { x: number; y: number }
  end: { x: number; y: number }
  hit: boolean
  hitPoint?: { x: number; y: number }
  hitEntityId?: number
  isHostile?: boolean
}

const DEFAULT_SENSOR_RAY_COUNT = 9

const createRayCastResults = (count: number): RayCastResult[] => {
  const results: RayCastResult[] = []
  for (let i = 0; i < count; i++) {
    results.push({
      start: { x: 0, y: 0 },
      end: { x: 0, y: 0 },
      hit: false,
      hitPoint: { x: 0, y: 0 },
    })
  }
  return results
}

export class SensorComponent extends Component {
  radius = 10
  fov = (160 * Math.PI) / 180 // +/- 80 degrees
  rayCount = DEFAULT_SENSOR_RAY_COUNT
  scanResults: RayCastResult[] = createRayCastResults(DEFAULT_SENSOR_RAY_COUNT)
  lastScanTimestamp = 0
  scanIntervalMs = 100
  detectedTargetId: number | null = null

  getName(): string {
    return 'Sensor'
  }
}
