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
  ENEMY_ALERT_DURATION_MS,
  ENEMY_DECISION_COOLDOWN_MS,
  ENEMY_DETECTION_RANGE,
  ENEMY_PACE_PAUSE_MS,
  ENEMY_PACE_SWITCH_INTERVAL_MS,
  ENEMY_RETREAT_EXTRA_DISTANCE,
  FOOTSTEP_INTERVAL_MS,
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

  reset(): void {
    this.x = 0
    this.y = 0
    this.rotation = 0
  }

  getName(): string {
    return 'Transform'
  }
}

export class PhysicsComponent extends Component {
  bodyId!: b2BodyId
  shapeId!: b2ShapeId
  posX = 0
  posY = 0
  prevX = 0
  prevY = 0
  velX = 0
  velY = 0
  hasPrev = false

  reset(): void {
    this.bodyId = 0 as unknown as b2BodyId
    this.shapeId = 0 as unknown as b2ShapeId
    this.posX = 0
    this.posY = 0
    this.prevX = 0
    this.prevY = 0
    this.velX = 0
    this.velY = 0
    this.hasPrev = false
  }

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
  footstepIntervalMs = FOOTSTEP_INTERVAL_MS
  footstepTimerMs = 0
  wasGrounded = false

  reset(): void {
    this.moveSpeed = 0
    this.jumpForce = 0
    this.maxJumpDuration = 0
    this.jumpForceMultiplier = 0
    this.wallJumpPushAwayMultiplier = 0
    this.wallJumpUpwardMultiplier = 0
    this.maxWallJumps = 0
    this.isGrounded = false
    this.isTouchingWall = false
    this.wallDirection = 0
    this.wallJumpCount = 0
    this.wallJumpTime = 0
    this.wallJumpElapsedTime = 0
    this.isJumping = false
    this.jumpStartTime = 0
    this.jumpElapsedTime = 0
    this.lastContactUpdate = 0
    this.contactUpdateIntervalMs = 16
    this.baseWeight = 0
    this.carryWeight = 0
    this.bodyFriction = DEFAULT_BODY_FRICTION
    this.currentFriction = DEFAULT_BODY_FRICTION
    this.isSprinting = false
    this.lKeyHoldTime = 0
    this.lKeyIsDown = false
    this.isRolling = false
    this.rollStartTime = 0
    this.rollDuration = 0
    this.rollElapsedTime = 0
    this.rollDirection = 0
    this.rollAngle = 0
    this.rollCooldownEndTime = 0
    this.rollCooldownElapsedTime = 0
    this.knockbackEndTime = 0
    this.knockbackDuration = 0
    this.knockbackElapsedTime = 0
    this.footstepIntervalMs = FOOTSTEP_INTERVAL_MS
    this.footstepTimerMs = 0
    this.wasGrounded = false
  }

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
  mouseAimMoved = false
  mouseScreenX = 0
  mouseScreenY = 0

  lastMoveDirection = 0
  facingOverride: number | null = null
  inputBuffer = new InputBuffer()

  reset(): void {
    this.moveDirection = 0
    this.jumpRequested = false
    this.sprintRequested = false
    this.attackRequested = false
    this.blockRequested = false
    this.lockedTargetId = null
    this.lockToggleRequested = false
    this.lockSwitchIntent = 0
    this.lockLostTimer = 0
    this.freeAimToggleRequested = false
    this.freeAimAdjust = 0
    this.moveSpeedScale = 1
    this.mouseAimActive = false
    this.mouseAimX = 0
    this.mouseAimY = 0
    this.mouseAimMoved = false
    this.mouseScreenX = 0
    this.mouseScreenY = 0
    this.lastMoveDirection = 0
    this.facingOverride = null
    this.inputBuffer.clearAll()
  }

  getName(): string {
    return 'Input'
  }
}

export class RenderComponent extends Component {
  radius = 0.5
  color = '#F58025'
  borderColor = '#FFD700'
  visible = true

  reset(): void {
    this.radius = 0.5
    this.color = '#F58025'
    this.borderColor = '#FFD700'
    this.visible = true
  }

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
  hudVisibleTimer = 0

  isStaggered = false
  staggerElapsedTime = 0
  staggerDuration = 1000
  staggerAnimationPhase: 'none' | 'rotateBack' | 'prone' = 'none'
  staggerAnimationElapsed = 0

  reset(): void {
    this.maxHealth = DEFAULT_PLAYER_MAX_HEALTH
    this.health = DEFAULT_PLAYER_MAX_HEALTH
    this.maxPosture = DEFAULT_PLAYER_MAX_POSTURE
    this.posture = DEFAULT_PLAYER_MAX_POSTURE
    this.postureRecoveryPerSecond = DEFAULT_PLAYER_POSTURE_RECOVERY_PER_SEC
    this.maxToughness = DEFAULT_PLAYER_MAX_TOUGHNESS
    this.toughness = DEFAULT_PLAYER_MAX_TOUGHNESS
    this.toughnessRecoveryPerSecond = DEFAULT_PLAYER_TOUGHNESS_RECOVERY_PER_SEC
    this.isDead = false
    this.isVanished = false
    this.deathElapsedSec = 0
    this.deathFlashDurationSec = DEFAULT_DEATH_FLASH_DURATION
    this.deathFlattenDurationSec = DEFAULT_DEATH_FLATTEN_DURATION
    this.hitShakeElapsedMs = 0
    this.hitShakeDurationMs = 0
    this.hitShakeIntensity = 0
    this.hitShakeDirectionX = 0
    this.isInCombat = false
    this.lastCombatTimestamp = 0
    this.combatExitTimer = 0
    this.combatExitTimeout = 5000
    this.hudVisibleTimer = 0
    this.isStaggered = false
    this.staggerElapsedTime = 0
    this.staggerDuration = 1000
    this.staggerAnimationPhase = 'none'
    this.staggerAnimationElapsed = 0
  }

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
  sizeLevel: number
  sizeMaxLevel: number
  cornerRadius: number
  weight: number
  attackDamage: number
  postureDamage: number
  toughnessDamage: number
  bowAmmo: number
  bowAmmoMax: number
}

const createWeaponSlotData = (): WeaponSlotData => ({
  hasWeapon: false,
  weaponType: 'sword',
  width: 0,
  height: 0,
  baseWidth: 0,
  sizeLevel: 0,
  sizeMaxLevel: 0,
  cornerRadius: 0,
  weight: 0,
  attackDamage: DEFAULT_WEAPON_ATTACK_DAMAGE,
  postureDamage: DEFAULT_WEAPON_POSTURE_DAMAGE,
  toughnessDamage: DEFAULT_WEAPON_TOUGHNESS_DAMAGE,
  bowAmmo: 0,
  bowAmmoMax: 0,
})

export class WeaponComponent extends Component {
  width = 0
  height = 0
  baseWidth = 0
  sizeLevel = 2
  sizeMaxLevel = 4
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
  bowFreeAimUseMouse = false
  bowFreeAimUseReticle = false
  bowFreeAimLastMouseX = 0
  bowFreeAimLastMouseY = 0
  bowFreeAimReticleOffsetX = 0
  bowFreeAimReticleOffsetY = 0
  bowAmmo = 0
  bowAmmoMax = 0

  isDropping = false
  isDropped = false
  isRecovering = false
  dropElapsedTime = 0
  dropStartTransform: WeaponTransform = { x: 0, y: 0, rotation: 0 }
  dropEndTransform: WeaponTransform = { x: 0, y: 0, rotation: 0 }
  dropStartOffset: WeaponRelativeTransform = { dx: 0, dy: 0, rotation: 0 }
  dropEndOffset: WeaponRelativeTransform = { dx: 0, dy: 0, rotation: 0 }

  pickupCooldownEndTime = 0 // 在此时间之前不可拾取（毫秒时间戳）

  reset(): void {
    this.width = 0
    this.height = 0
    this.baseWidth = 0
    this.sizeLevel = 2
    this.sizeMaxLevel = 4
    this.blockWidthStart = 0
    this.blockWidthTarget = 0
    this.cornerRadius = 0
    this.weight = 0
    this.weaponType = 'sword'
    this.attackDamage = DEFAULT_WEAPON_ATTACK_DAMAGE
    this.postureDamage = DEFAULT_WEAPON_POSTURE_DAMAGE
    this.toughnessDamage = DEFAULT_WEAPON_TOUGHNESS_DAMAGE
    this.knockback = 0
    this.isColliding = false
    this.isUnstoppable = false
    this.position.x = 0
    this.position.y = 0
    this.rotation = 0
    this.isEquipped = false
    this.isBlocking = false
    this.attackPhase = 'idle'
    this.attackElapsedMs = 0
    this.lastAttackTimestamp = 0
    this.attackStartTransform.x = 0
    this.attackStartTransform.y = 0
    this.attackStartTransform.rotation = 0
    this.visual.x = 0
    this.visual.y = 0
    this.visual.rotation = 0
    this.attackQueued = false
    this.comboCount = 0
    this.swingDirection = 'toFront'
    this.nextSwingDirection = 'toFront'
    this.attackFacing = 1
    this.attackStartOffset.dx = 0
    this.attackStartOffset.dy = 0
    this.attackStartOffset.rotation = 0
    this.swingStartOffset.dx = 0
    this.swingStartOffset.dy = 0
    this.swingStartOffset.rotation = 0
    this.swingEndOffset.dx = 0
    this.swingEndOffset.dy = 0
    this.swingEndOffset.rotation = 0
    this.swingStartTransform.x = 0
    this.swingStartTransform.y = 0
    this.swingStartTransform.rotation = 0
    this.swingEndTransform.x = 0
    this.swingEndTransform.y = 0
    this.swingEndTransform.rotation = 0
    this.attackRadius = 0
    this.reboundLockedPause = false
    this.reboundTargetTransform.x = 0
    this.reboundTargetTransform.y = 0
    this.reboundTargetTransform.rotation = 0
    this.reboundTargetOffset.dx = 0
    this.reboundTargetOffset.dy = 0
    this.reboundTargetOffset.rotation = 0
    this.hitEntityIds.clear()
    this.isParrying = false
    this.parryElapsedTime = 0
    this.parryWindowDuration = 200
    this.parryStartTransform.x = 0
    this.parryStartTransform.y = 0
    this.parryStartTransform.rotation = 0
    this.parryEndTransform.x = 0
    this.parryEndTransform.y = 0
    this.parryEndTransform.rotation = 0
    this.parryStartOffset.dx = 0
    this.parryStartOffset.dy = 0
    this.parryStartOffset.rotation = 0
    this.parryEndOffset.dx = 0
    this.parryEndOffset.dy = 0
    this.parryEndOffset.rotation = 0
    this.parryHitWeaponIds.clear()
    this.parryCounterTimerMs = 0
    this.parryCounterActive = false
    this.bowIsDrawing = false
    this.bowDrawElapsedMs = 0
    this.bowDrawRatio = 0
    this.bowForceRatio = 0
    this.bowReleaseRatio = 0
    this.bowReleasePending = false
    this.bowReleaseDelayMs = 0
    this.bowReleaseDelayTotalMs = 0
    this.bowRecoverElapsedMs = 0
    this.bowAimAngle = 0
    this.bowHasAim = false
    this.bowFreeAim = false
    this.bowFreeAimAngle = 0
    this.bowFreeAimReticleX = 0
    this.bowFreeAimReticleY = 0
    this.bowFreeAimUseMouse = false
    this.bowFreeAimUseReticle = false
    this.bowFreeAimLastMouseX = 0
    this.bowFreeAimLastMouseY = 0
    this.bowFreeAimReticleOffsetX = 0
    this.bowFreeAimReticleOffsetY = 0
    this.bowAmmo = 0
    this.bowAmmoMax = 0
    this.isDropping = false
    this.isDropped = false
    this.isRecovering = false
    this.dropElapsedTime = 0
    this.dropStartTransform.x = 0
    this.dropStartTransform.y = 0
    this.dropStartTransform.rotation = 0
    this.dropEndTransform.x = 0
    this.dropEndTransform.y = 0
    this.dropEndTransform.rotation = 0
    this.dropStartOffset.dx = 0
    this.dropStartOffset.dy = 0
    this.dropStartOffset.rotation = 0
    this.dropEndOffset.dx = 0
    this.dropEndOffset.dy = 0
    this.dropEndOffset.rotation = 0
    this.pickupCooldownEndTime = 0
  }

  getName(): string {
    return 'Weapon'
  }
}

export class WeaponSlotsComponent extends Component {
  main = createWeaponSlotData()
  secondary = createWeaponSlotData()
  activeSlot: WeaponSlotId = 'main'

  reset(): void {
    this.main = createWeaponSlotData()
    this.secondary = createWeaponSlotData()
    this.activeSlot = 'main'
  }

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

  reset(): void {
    this.faction = Faction.Neutral
  }

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
  canHit = true
  isStuck = false
  stuckEntityId: number | null = null
  stuckOffsetX = 0
  stuckOffsetY = 0
  stuckRotation = 0
  stuckDirX = 0
  stuckDirY = 0
  prevX = 0
  prevY = 0
  hasPrev = false

  reset(): void {
    this.ownerId = 0
    this.faction = Faction.Player
    this.velocityX = 0
    this.velocityY = 0
    this.gravity = DEFAULT_GRAVITY
    this.hitRadius = 0.12
    this.elapsedMs = 0
    this.lifetimeMs = 2500
    this.canHit = true
    this.isStuck = false
    this.stuckEntityId = null
    this.stuckOffsetX = 0
    this.stuckOffsetY = 0
    this.stuckRotation = 0
    this.stuckDirX = 0
    this.stuckDirY = 0
    this.prevX = 0
    this.prevY = 0
    this.hasPrev = false
  }

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
  paceMovedDistance = 0
  paceLastPositionX = 0
  paceLastPositionY = 0
  lastDecisionTimestamp = 0
  lastPaceSwitchTimestamp = 0
  nextPaceResumeTimestamp = 0
  moveSpeed = DEFAULT_ENEMY_MOVE_SPEED
  state: 'approach' | 'combo' | 'retreat' | 'pacing' | 'probe' | 'alert' =
    'approach'
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
  arrowDefenseTimeRemainingMs = 0
  arrowDefenseSwitchTimerMs = 0
  arrowDefenseActive = false
  bowHoldTimerMs = 0
  bowCooldownTimerMs = 0
  archerShotCheckPending = false
  combatResetTime = 5000
  alertTimeRemainingMs = 0
  alertDurationMs = ENEMY_ALERT_DURATION_MS
  alertPaceDirection: -1 | 1 = 1
  alertPaceMovedDistance = 0
  alertPaceLastPositionX = 0
  alertPaceLastPositionY = 0
  alertLastPaceSwitchTimestamp = 0
  alertNextPaceResumeTimestamp = 0
  alertChaseActive = false
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

  reset(): void {
    this.attackDesire = DEFAULT_ENEMY_ATTACK_DESIRE
    this.parryProficiency = 0
    this.detectionRange = ENEMY_DETECTION_RANGE
    this.decisionCooldownMs = ENEMY_DECISION_COOLDOWN_MS
    this.paceSwitchIntervalMs = ENEMY_PACE_SWITCH_INTERVAL_MS
    this.pacePauseMs = ENEMY_PACE_PAUSE_MS
    this.paceDirection = 1
    this.paceMovedDistance = 0
    this.paceLastPositionX = 0
    this.paceLastPositionY = 0
    this.lastDecisionTimestamp = 0
    this.lastPaceSwitchTimestamp = 0
    this.nextPaceResumeTimestamp = 0
    this.moveSpeed = DEFAULT_ENEMY_MOVE_SPEED
    this.state = 'approach'
    this.initialPatrolMode = 'patrol'
    this.comboSwingsDone = 0
    this.comboSwingTarget = 5
    this.lastFacing = 1
    this.retreatDirection = -1
    this.retreatTargetDistance = ENEMY_RETREAT_EXTRA_DISTANCE + 1
    this.patrolRange = 5
    this.patrolCenter.x = 0
    this.patrolCenter.y = 0
    this.hasLineOfSight = false
    this.targetLostTimer = 0
    this.playerSwingActive = false
    this.parryAttemptedThisSwing = false
    this.probeSwitchTimerMs = 0
    this.probePaceTimerMs = 0
    this.probePaceDirection = 1
    this.probePaceMovedDistance = 0
    this.probeLastPositionX = 0
    this.probeLastPositionY = 0
    this.probeHasTriggered = false
    this.forcedChaseDistanceRemaining = 0
    this.forcedChaseDirection = 1
    this.forcedChaseLastX = 0
    this.arrowDefenseTimeRemainingMs = 0
    this.arrowDefenseSwitchTimerMs = 0
    this.arrowDefenseActive = false
    this.bowHoldTimerMs = 0
    this.bowCooldownTimerMs = 0
    this.archerShotCheckPending = false
    this.combatResetTime = 5000
    this.alertTimeRemainingMs = 0
    this.alertDurationMs = ENEMY_ALERT_DURATION_MS
    this.alertPaceDirection = 1
    this.alertPaceMovedDistance = 0
    this.alertPaceLastPositionX = 0
    this.alertPaceLastPositionY = 0
    this.alertLastPaceSwitchTimestamp = 0
    this.alertNextPaceResumeTimestamp = 0
    this.alertChaseActive = false
    this.lastPosition.x = 0
    this.lastPosition.y = 0
    this.stuckTimer = 0
    this.stuckThreshold = 500
    this.lastPositionUpdateTime = 0
    this.positionCheckInterval = 300
    this.obstacleJumpStage = 0
    this.obstacleJumpDirection = 1
    this.jumpStartTimestamp = 0
    this.jumpStartPosition.x = 0
    this.jumpStartPosition.y = 0
    this.patrolWaypoints = []
    this.currentWaypointIndex = 0
    this.patrolResumeTimestamp = 0
    this.patrolState = 'moving'
    this.patrolStuckTimer = 0
    this.enemyType = 'default'
  }

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
  scanElapsedMs = 0
  scanIntervalMs = 100
  detectedTargetId: number | null = null

  reset(): void {
    this.radius = 10
    this.fov = (160 * Math.PI) / 180
    this.rayCount = DEFAULT_SENSOR_RAY_COUNT
    this.scanResults = createRayCastResults(DEFAULT_SENSOR_RAY_COUNT)
    this.scanElapsedMs = 0
    this.scanIntervalMs = 100
    this.detectedTargetId = null
  }

  getName(): string {
    return 'Sensor'
  }
}
