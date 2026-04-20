import {
  DEFAULT_BACKSTEP_DURATION,
  DEFAULT_BACKSTEP_HORIZONTAL_IMPULSE,
  DEFAULT_BACKSTEP_VERTICAL_IMPULSE,
  DEFAULT_GRAVITY,
  DEFAULT_PLAYER_RADIUS,
  DEFAULT_PLAYER_WEIGHT,
  DEFAULT_ROLL_COOLDOWN,
  DEFAULT_ROLL_DURATION,
  DEFAULT_ROLL_SPEED,
  DEFAULT_WALL_SLIDE_FRICTION,
  FALL_DAMAGE_KINETIC_FATAL,
  FALL_DAMAGE_KINETIC_THRESHOLD,
  FALL_DAMAGE_KINETIC_TO_HEALTH_DIVISOR,
  LANDING_MIN_VELOCITY,
  PLAYER_WEIGHT_REFERENCE,
  SOUND_DB_LAND,
  SPRINT_HOLD_THRESHOLD_MS,
  getSprintSpeedFromMoveSpeed,
} from '../../constants'
import {
  getPlayerCollisionMask,
  isGroundCollisionCategory,
  isObstacleCollisionCategory,
} from '../../physicsLayers'
import { getPlayerAgilityScalePercent } from '../../playerUpgrade'
import type { MainModule } from '../../types'
import { Faction } from '../Component'
import { componentRegistry } from '../ComponentRegistry'
import type { Entity } from '../Entity'
import { forEachPhysicsShapeId } from '../PhysicsShapeUtils'
import type { SpatialHash } from '../SpatialHash'
import { System } from '../System'
import type { SoundSystem } from './SoundSystem'
import type { StatsSystem } from './StatsSystem'

export class MovementSystem extends System {
  private box2d: MainModule
  private allEntities: Entity[] = []
  private spatialHash: SpatialHash | null = null
  private entityLookup?: (id: number) => Entity | undefined
  private soundSystem: SoundSystem | null = null
  private statsSystem: StatsSystem | null = null
  private tempVec: InstanceType<MainModule['b2Vec2']>
  private tempVec2: InstanceType<MainModule['b2Vec2']>
  private currentDeltaTime = 0
  private currentTimeMs = 0
  private readonly slopeNormalScale = 1024

  constructor(box2d: MainModule) {
    super()
    this.box2d = box2d
    this.tempVec = new box2d.b2Vec2(0, 0)
    this.tempVec2 = new box2d.b2Vec2(0, 0)

    const physicsType = componentRegistry.getComponentType('Physics')
    const movementType = componentRegistry.getComponentType('Movement')
    const inputType = componentRegistry.getComponentType('Input')
    this.setRequiredComponents([physicsType, movementType, inputType])
  }

  setEntities(entities: Entity[]): void {
    this.allEntities = entities
  }

  setSpatialHash(spatialHash: SpatialHash): void {
    this.spatialHash = spatialHash
  }

  setEntityLookup(lookup: (id: number) => Entity | undefined): void {
    this.entityLookup = lookup
  }

  setSoundSystem(soundSystem: SoundSystem): void {
    this.soundSystem = soundSystem
  }

  setStatsSystem(statsSystem: StatsSystem): void {
    this.statsSystem = statsSystem
  }

  update(entities: Entity[], deltaTime: number): void {
    this.currentDeltaTime = deltaTime
    const deltaMs = Math.max(0, deltaTime * 1000)
    this.currentTimeMs += deltaMs
    for (const entity of entities) {
      if (!entity.physics || !entity.movement || !entity.input) continue
      if (entity.stats?.isDead) {
        entity.input.moveDirection = 0
        entity.input.jumpRequested = false
        continue
      }

      // 更新硬直时间（必须在isStunned检查之前）
      if (entity.movement.knockbackDuration > 0) {
        entity.movement.knockbackElapsedTime += deltaTime
      }

      this.updateHitStunAnimation(entity)

      // 硬直期间无法移动
      if (entity.isStunned()) {
        entity.input.moveDirection = 0
        entity.input.jumpRequested = false
      }

      this.updateContactState(entity)
      this.handleInput(entity)
    }
  }

  private updateContactState(entity: Entity): void {
    if (!entity.physics || !entity.movement) return

    const {
      b2Body_GetContactData,
      b2Body_GetContactCapacity,
      b2Body_GetLinearVelocity,
      b2Shape_GetFilter,
      b2Shape_GetFriction,
    } = this.box2d

    const now = this.currentTimeMs
    if (
      now - entity.movement.lastContactUpdate <
      entity.movement.contactUpdateIntervalMs
    ) {
      return
    }
    entity.movement.lastContactUpdate = now

    const wasGrounded = entity.movement.wasGrounded
    // 获取实时速度用于接触检测（关键：保证物理逻辑正确）
    const vel = b2Body_GetLinearVelocity(entity.physics.bodyId)
    const velY = vel.y
    const velX = vel.x
    const slopeGroundVelocityMin = -2.5
    const slopeMoveSpeedMin = 0.1
    const isMovingAlongSurface = Math.abs(velX) >= slopeMoveSpeedMin
    const isFallingOrStill =
      velY >= -0.1 || (isMovingAlongSurface && velY >= slopeGroundVelocityMin)
    vel.delete()
    const capacity = b2Body_GetContactCapacity(entity.physics.bodyId)
    const contactData = b2Body_GetContactData(entity.physics.bodyId, capacity)

    let grounded = false
    let touchingWall = false
    let newWallDirection = 0
    const groundNormalMin = 0.2
    let hasSteepSurface = false
    let hasGroundSurface = false
    let hasObstacleSurface = false
    let groundSurfaceFriction = 0
    let obstacleSurfaceFriction = 0

    for (let i = 0; i < contactData.length; i++) {
      const contact = contactData[i]
      const normal = contact.manifold.normal
      const absX = Math.abs(normal.x)
      const absY = Math.abs(normal.y)

      const filterA = b2Shape_GetFilter(contact.shapeIdA)
      const filterB = b2Shape_GetFilter(contact.shapeIdB)
      const categoryA = filterA.categoryBits
      const categoryB = filterB.categoryBits
      const isGroundA = isGroundCollisionCategory(categoryA)
      const isGroundB = isGroundCollisionCategory(categoryB)
      const isObstacleA = isObstacleCollisionCategory(categoryA)
      const isObstacleB = isObstacleCollisionCategory(categoryB)
      let isSteepSurface = false
      if (isGroundA || isGroundB || isObstacleA || isObstacleB) {
        const normalX = (normal.x * this.slopeNormalScale) | 0
        const normalY = (normal.y * this.slopeNormalScale) | 0
        const absNormalX = normalX < 0 ? -normalX : normalX
        const absNormalY = normalY < 0 ? -normalY : normalY
        if (absNormalX > absNormalY) {
          hasSteepSurface = true
          isSteepSurface = true
        } else if (isGroundA || isGroundB) {
          hasGroundSurface = true
          const groundShapeId = isGroundA ? contact.shapeIdA : contact.shapeIdB
          const surfaceFriction = b2Shape_GetFriction(groundShapeId)
          if (surfaceFriction > groundSurfaceFriction) {
            groundSurfaceFriction = surfaceFriction
          }
        } else if (isObstacleA || isObstacleB) {
          hasObstacleSurface = true
          const obstacleShapeId = isObstacleA
            ? contact.shapeIdA
            : contact.shapeIdB
          const surfaceFriction = b2Shape_GetFriction(obstacleShapeId)
          if (surfaceFriction > obstacleSurfaceFriction) {
            obstacleSurfaceFriction = surfaceFriction
          }
        }
      }

      if (isSteepSurface) {
        touchingWall = true
        newWallDirection = normal.x > 0 ? -1 : 1
      } else if (absY > groundNormalMin && isFallingOrStill) {
        grounded = true
      } else if (absX > 0.7) {
        touchingWall = true
        newWallDirection = normal.x > 0 ? -1 : 1
      }

      contact.delete()
    }

    entity.movement.isGrounded = grounded
    entity.movement.isTouchingWall = touchingWall
    entity.movement.wasGrounded = grounded
    if (hasSteepSurface) {
      entity.movement.hasContactFriction = true
      entity.movement.contactFriction = 0
    } else if (hasGroundSurface) {
      entity.movement.hasContactFriction = true
      entity.movement.contactFriction = groundSurfaceFriction
    } else if (hasObstacleSurface) {
      entity.movement.hasContactFriction = true
      entity.movement.contactFriction = obstacleSurfaceFriction
    } else {
      entity.movement.hasContactFriction = false
      entity.movement.contactFriction = entity.movement.bodyFriction
    }
    entity.movement.hasSteepContact = hasSteepSurface

    if (entity.movement.isTouchingWall && !grounded) {
      entity.movement.wallDirection = newWallDirection
    } else {
      entity.movement.wallDirection = 0
    }

    this.updateBodyFriction(entity, grounded, touchingWall)

    if (!grounded && velY > 0) {
      if (entity.movement.maxFallVelocity === 0) {
        entity.movement.fallStartY = entity.transform?.y ?? 0
      }
      entity.movement.maxFallVelocity = Math.max(
        entity.movement.maxFallVelocity,
        velY
      )
      this.applyFatalFallDamageDuringFall(entity)
    }

    if (!wasGrounded && grounded) {
      if (this.soundSystem && entity.render) {
        const impactSpeed = Math.abs(velY)
        if (impactSpeed >= LANDING_MIN_VELOCITY) {
          const radius = entity.render.radius || DEFAULT_PLAYER_RADIUS
          this.soundSystem.emitSoundAt(
            entity.transform?.x ?? 0,
            (entity.transform?.y ?? 0) + radius,
            radius,
            SOUND_DB_LAND
          )
        }
      }

      this.applyFallDamage(entity)
      entity.movement.maxFallVelocity = 0
      entity.movement.fallStartY = 0
    }
  }

  private updateBodyFriction(
    entity: Entity,
    grounded: boolean,
    touchingWall: boolean
  ): void {
    if (!entity.physics || !entity.movement) return

    const shouldUseAirFriction = !grounded
    const targetFriction = shouldUseAirFriction
      ? DEFAULT_WALL_SLIDE_FRICTION
      : entity.movement.hasContactFriction
        ? entity.movement.contactFriction
        : entity.movement.bodyFriction
    if (entity.movement.currentFriction === targetFriction) return

    const { b2Shape_SetFriction } = this.box2d
    forEachPhysicsShapeId(entity.physics, (shapeId) => {
      b2Shape_SetFriction(shapeId, targetFriction)
    })
    entity.movement.currentFriction = targetFriction
  }

  private updateHitStunAnimation(entity: Entity): void {
    if (!entity.movement || !entity.stats) return
    if (
      entity.stats.isStaggered ||
      entity.movement.isRolling ||
      entity.movement.isBackstepping
    )
      return

    const knockbackDuration = entity.movement.knockbackDuration
    if (knockbackDuration <= 0) {
      if (entity.movement.rollAngle !== 0) {
        entity.movement.rollAngle = 0
      }
      return
    }

    const elapsedMs = entity.movement.knockbackElapsedTime * 1000
    const progress = Math.min(1, Math.max(0, elapsedMs / knockbackDuration))
    const facing =
      entity.input?.lastMoveDirection !== 0
        ? (entity.input?.lastMoveDirection ?? 1)
        : 1
    const backAngle = -facing * (Math.PI / 6)
    const backPhase = 0.7

    if (progress < backPhase) {
      const t = progress / backPhase
      const easedT = 1 - Math.pow(1 - t, 2)
      entity.movement.rollAngle = backAngle * easedT
      return
    }

    const t = (progress - backPhase) / (1 - backPhase)
    const easedT = 1 - Math.pow(1 - t, 2)
    entity.movement.rollAngle = backAngle * (1 - easedT)
  }

  private handleInput(entity: Entity): void {
    if (!entity.physics || !entity.movement || !entity.input) return

    if (entity.grapple?.retainAirMomentum && entity.movement.isGrounded) {
      entity.grapple.retainAirMomentum = false
    }

    this.handleSprintAndRoll(entity)

    if (entity.movement.isRolling || entity.movement.isBackstepping) {
      return
    }

    if (
      entity.grapple?.isPulling &&
      !(entity.grapple.isTethering && entity.movement.isGrounded)
    ) {
      return
    }
    if (
      entity.grapple &&
      entity.grapple.moveLockEndTime > this.currentTimeMs &&
      !entity.movement.isGrounded
    ) {
      return
    }

    this.handleMove(entity)
    this.handleJump(entity)
  }

  private handleSprintAndRoll(entity: Entity): void {
    if (!entity.movement || !entity.input || !entity.physics) return

    // 1. 处理正在进行的翻滚
    if (entity.movement.isRolling) {
      entity.movement.rollElapsedTime += this.currentDeltaTime
      const elapsedMs = entity.movement.rollElapsedTime * 1000
      if (elapsedMs >= entity.movement.rollDuration) {
        this.endRoll(entity)
      } else {
        this.updateRollPhysics(entity)
        const progress = Math.min(
          1,
          Math.max(0, elapsedMs / entity.movement.rollDuration)
        )
        entity.movement.rollAngle =
          progress * 2 * Math.PI * entity.movement.rollDirection
      }
      return
    }

    // 1b. 处理正在进行的后跳
    if (entity.movement.isBackstepping) {
      entity.movement.backstepElapsedTime += this.currentDeltaTime
      const elapsedMs = entity.movement.backstepElapsedTime * 1000
      if (elapsedMs >= entity.movement.backstepDuration) {
        this.endBackstep(entity)
      }
      return
    }

    entity.movement.rollCooldownElapsedTime += this.currentDeltaTime

    // 2. 检查翻滚/后跳输入 (Ctrl键 -> InputBuffer 'roll')
    const cooldownMs = entity.movement.rollCooldownElapsedTime * 1000
    if (cooldownMs >= DEFAULT_ROLL_COOLDOWN && this.canRoll(entity)) {
      entity.input.inputBuffer.tryExecute(
        'roll',
        () => true,
        () => {
          if (entity.input!.moveDirection !== 0) {
            this.startRoll(entity)
          } else {
            this.startBackstep(entity)
          }
        }
      )
    }

    // 3. 处理奔跑 (Shift键 -> sprintRequested)
    // 取消了之前的按下阈值判断，现在Shift按下即视为奔跑请求
    if (entity.input.sprintRequested) {
      // 只有在移动且按下Shift键时才算Sprint
      if (entity.input.moveDirection !== 0) {
        entity.movement.isSprinting = true
      } else {
        // 原地按住Shift不算移动，但保持奔跑状态标记(准备)
        entity.movement.isSprinting = true
      }
    } else {
      entity.movement.isSprinting = false
    }

    entity.movement.lKeyIsDown = entity.input.sprintRequested
  }

  private canRoll(entity: Entity): boolean {
    if (!entity.movement) return false

    // 如果处于硬直状态，仅在趴下（prone）阶段允许翻滚
    if (entity.isStunned()) {
      return entity.stats?.staggerAnimationPhase === 'prone'
    }

    // 不能在攻击动作中翻滚
    const isInAttackAction =
      entity.weapon &&
      entity.weapon.isEquipped &&
      (entity.weapon.attackPhase === 'finalWindup' ||
        entity.weapon.attackPhase === 'swing' ||
        entity.weapon.attackPhase === 'pause' ||
        entity.weapon.attackPhase === 'recover')

    if (isInAttackAction) return false

    return entity.movement.isGrounded
  }

  private startRoll(entity: Entity): void {
    if (!entity.movement || !entity.input || !entity.physics) return

    // 如果是从崩塌（stagger）状态翻滚，解除崩塌
    if (entity.stats?.isStaggered) {
      entity.stats.isStaggered = false
      entity.stats.staggerElapsedTime = 0
      entity.stats.staggerAnimationPhase = 'none'
      entity.stats.staggerAnimationElapsed = 0
      entity.stats.posture = entity.stats.maxPosture

      // 如果是敌人，重置其AI状态
      if (entity.npcAI) {
        entity.npcAI.state = 'approach'
        entity.npcAI.comboSwingsDone = 0
        entity.npcAI.probeSwitchTimerMs = 0
        entity.npcAI.probePaceTimerMs = 0
        entity.npcAI.probePaceDirection = 1
        entity.npcAI.probePaceMovedDistance = 0
        entity.npcAI.probeLastPositionX = 0
        entity.npcAI.probeLastPositionY = 0
        entity.npcAI.probeHasTriggered = false
        if (entity.movement) {
          entity.movement.moveSpeed = entity.npcAI.moveSpeed
        }
      }
    }

    entity.movement.isRolling = true
    entity.movement.rollStartTime = this.currentTimeMs
    entity.movement.rollElapsedTime = 0
    entity.movement.rollDuration = DEFAULT_ROLL_DURATION

    entity.movement.rollDirection = entity.input.moveDirection || 1

    entity.movement.isJumping = false

    this.setRollCollisionMask(entity)

    // 开始翻滚时立即更新一次物理状态
    this.updateRollPhysics(entity)
  }

  private updateRollPhysics(entity: Entity): void {
    if (!entity.physics || !entity.movement) return

    const { b2Body_SetLinearVelocity } = this.box2d
    const rollSpeed = DEFAULT_ROLL_SPEED
    const velX = entity.movement.rollDirection * rollSpeed

    this.tempVec.x = velX
    this.tempVec.y = entity.physics.velY
    b2Body_SetLinearVelocity(entity.physics.bodyId, this.tempVec)
  }

  private endRoll(entity: Entity): void {
    if (!entity.movement || !entity.physics) return
    entity.movement.isRolling = false
    entity.movement.rollCooldownEndTime =
      this.currentTimeMs + DEFAULT_ROLL_COOLDOWN
    entity.movement.rollCooldownElapsedTime = 0

    this.restoreCollisionMask(entity)
  }

  private startBackstep(entity: Entity): void {
    if (!entity.movement || !entity.input || !entity.physics) return

    // 从崩塌状态恢复（与翻滚共享逻辑）
    if (entity.stats?.isStaggered) {
      entity.stats.isStaggered = false
      entity.stats.staggerElapsedTime = 0
      entity.stats.staggerAnimationPhase = 'none'
      entity.stats.staggerAnimationElapsed = 0
      entity.stats.posture = entity.stats.maxPosture
    }

    entity.movement.isBackstepping = true
    entity.movement.backstepElapsedTime = 0
    entity.movement.backstepDuration = DEFAULT_BACKSTEP_DURATION
    entity.movement.isJumping = false

    // 后跳方向：朝向的反方向
    const facing =
      entity.input.lastMoveDirection !== 0 ? entity.input.lastMoveDirection : 1
    const backstepDir = -facing

    // 施加一次性脉冲
    const {
      b2Body_ApplyLinearImpulseToCenter,
      b2Body_SetLinearVelocity,
      b2Body_GetMass,
    } = this.box2d
    const mass = b2Body_GetMass(entity.physics.bodyId)

    // 先清零水平速度再施加脉冲
    this.tempVec.x = 0
    this.tempVec.y = 0
    b2Body_SetLinearVelocity(entity.physics.bodyId, this.tempVec)

    this.tempVec.x = backstepDir * DEFAULT_BACKSTEP_HORIZONTAL_IMPULSE * mass
    this.tempVec.y = -DEFAULT_BACKSTEP_VERTICAL_IMPULSE * mass
    b2Body_ApplyLinearImpulseToCenter(entity.physics.bodyId, this.tempVec, true)
  }

  private endBackstep(entity: Entity): void {
    if (!entity.movement || !entity.physics) return
    entity.movement.isBackstepping = false
    entity.movement.rollCooldownEndTime =
      this.currentTimeMs + DEFAULT_ROLL_COOLDOWN
    entity.movement.rollCooldownElapsedTime = 0
  }

  private setRollCollisionMask(entity: Entity): void {
    if (!entity.physics) return
    const { b2Shape_GetFilter, b2Shape_SetFilter } = this.box2d
    const renderLayer = entity.render?.renderLayer ?? 0
    forEachPhysicsShapeId(entity.physics, (shapeId) => {
      const filter = b2Shape_GetFilter(shapeId)
      filter.maskBits = getPlayerCollisionMask(renderLayer, true)
      b2Shape_SetFilter(shapeId, filter)
    })
  }

  private restoreCollisionMask(entity: Entity): void {
    if (!entity.physics) return
    const { b2Shape_GetFilter, b2Shape_SetFilter } = this.box2d
    const renderLayer = entity.render?.renderLayer ?? 0
    forEachPhysicsShapeId(entity.physics, (shapeId) => {
      const filter = b2Shape_GetFilter(shapeId)
      filter.maskBits = getPlayerCollisionMask(renderLayer)
      b2Shape_SetFilter(shapeId, filter)
    })
  }

  private handleMove(entity: Entity): void {
    if (!entity.physics || !entity.movement || !entity.input) return

    // 硬直状态时不处理移动输入，保留物理惯性
    if (entity.isStunned()) return

    // 纯位移锁：仅阻止速度覆盖，不触发硬直
    if (entity.movement.knockbackMoveLockEndTime > 0) {
      if (this.currentTimeMs < entity.movement.knockbackMoveLockEndTime) return
      entity.movement.knockbackMoveLockEndTime = 0
    }

    const { b2Body_SetLinearVelocity } = this.box2d

    let direction = entity.input.moveDirection

    const isInAttackAction =
      entity.weapon &&
      entity.weapon.isEquipped &&
      (entity.weapon.attackPhase === 'windup' ||
        entity.weapon.attackPhase === 'finalWindup' ||
        entity.weapon.attackPhase === 'swing' ||
        entity.weapon.attackPhase === 'pause' ||
        entity.weapon.attackPhase === 'recover')

    if (!isInAttackAction) {
      if (entity.input.lockedTargetId !== null) {
        // 有锁定目标时，优先面朝目标，避免被 facingOverride 抢占
        const lockedTargetId = entity.input.lockedTargetId
        let target: Entity | undefined
        if (this.entityLookup) {
          target = this.entityLookup(lockedTargetId)
        } else {
          for (const candidate of this.allEntities) {
            if (candidate.id === lockedTargetId) {
              target = candidate
              break
            }
          }
        }
        if (target && target.transform && entity.transform) {
          const dx = target.transform.x - entity.transform.x
          entity.input.lastMoveDirection = dx >= 0 ? 1 : -1
        }
      } else if (entity.input.facingOverride !== null) {
        entity.input.lastMoveDirection = entity.input.facingOverride
      } else if (direction !== 0) {
        entity.input.lastMoveDirection = direction
      }
    }

    const wallJumpCooldownMs = 150
    entity.movement.wallJumpElapsedTime += this.currentDeltaTime
    const wallJumpElapsedMs = entity.movement.wallJumpElapsedTime * 1000

    if (wallJumpElapsedMs < wallJumpCooldownMs) {
      return
    }

    // 地面攻击时锁定位移，空中攻击和跳跃攻击允许移动
    if (
      isInAttackAction &&
      entity.movement.isGrounded &&
      entity.npcAI?.state !== 'leapAttack'
    ) {
      direction = 0
    }

    if (
      entity.movement.hasSteepContact &&
      direction !== 0 &&
      direction === entity.movement.wallDirection
    ) {
      direction = 0
    }

    if (direction !== 0 && this.isNpcBlocking(entity, direction)) {
      direction = 0
    }

    if (
      direction === 0 &&
      !entity.movement.isGrounded &&
      entity.grapple?.retainAirMomentum
    ) {
      return
    }

    const moveSpeedScale =
      entity.input.moveSpeedScale > 0 ? entity.input.moveSpeedScale : 1
    const agilityScalePercent = entity.level
      ? getPlayerAgilityScalePercent(entity.level)
      : 100
    const moveSpeed =
      (entity.movement.isSprinting
        ? getSprintSpeedFromMoveSpeed(entity.movement.moveSpeed)
        : entity.movement.moveSpeed) *
      moveSpeedScale *
      (agilityScalePercent / 100)

    this.tempVec.x = direction * moveSpeed
    this.tempVec.y = entity.physics.velY
    b2Body_SetLinearVelocity(entity.physics.bodyId, this.tempVec)
  }

  private handleJump(entity: Entity): void {
    if (!entity.physics || !entity.movement || !entity.input) return

    const isInAttackAction =
      entity.weapon &&
      entity.weapon.isEquipped &&
      (entity.weapon.attackPhase === 'windup' ||
        entity.weapon.attackPhase === 'finalWindup' ||
        entity.weapon.attackPhase === 'swing' ||
        entity.weapon.attackPhase === 'pause' ||
        entity.weapon.attackPhase === 'recover')

    const isLeapAttack = entity.npcAI?.state === 'leapAttack'
    if (isInAttackAction && !isLeapAttack) {
      return
    }

    entity.input.inputBuffer.update()
    if (
      entity.input.inputBuffer.hasActiveAction('jump') &&
      this.canJump(entity)
    ) {
      entity.input.inputBuffer.tryExecute(
        'jump',
        () => true,
        () => this.doJump(entity)
      )
    }

    if (!entity.movement.isJumping) return

    entity.movement.jumpElapsedTime += this.currentDeltaTime

    const {
      b2Body_ApplyForceToCenter,
      b2Body_GetMass,
      b2Body_GetLinearVelocity,
    } = this.box2d
    // 获取实时速度用于跳跃控制（关键：保证物理逻辑正确）
    const vel = b2Body_GetLinearVelocity(entity.physics.bodyId)
    const velY = vel.y
    const mass = b2Body_GetMass(entity.physics.bodyId)
    const jumpDurationMs = entity.movement.jumpElapsedTime * 1000
    const weightFactor = this.getWeightFactor(entity)
    const jumpScale = 1 / weightFactor

    if (
      velY < 0 &&
      jumpDurationMs < entity.movement.maxJumpDuration &&
      entity.input.jumpRequested
    ) {
      this.tempVec.x = 0
      this.tempVec.y =
        -entity.movement.jumpForce *
        mass *
        entity.movement.jumpForceMultiplier *
        jumpScale
      b2Body_ApplyForceToCenter(entity.physics.bodyId, this.tempVec, true)
    } else if (
      jumpDurationMs >= entity.movement.maxJumpDuration ||
      velY >= 0 ||
      !entity.input.jumpRequested
    ) {
      entity.movement.isJumping = false
    }
    vel.delete()
  }

  private canJump(entity: Entity): boolean {
    if (!entity.movement) return false
    if (entity.isStunned()) return false

    if (entity.movement.isJumping) return false

    const isDifferentWall =
      entity.movement.isTouchingWall &&
      !entity.movement.isGrounded &&
      entity.movement.wallDirection !== entity.movement.lastWallJumpDirection

    const canWallJump =
      entity.movement.isTouchingWall &&
      !entity.movement.isGrounded &&
      (entity.movement.wallJumpCount < entity.movement.maxWallJumps ||
        isDifferentWall)

    return entity.movement.isGrounded || canWallJump
  }

  private doJump(entity: Entity): void {
    if (!entity.physics || !entity.movement) return

    const {
      b2Body_ApplyLinearImpulseToCenter,
      b2Body_SetLinearVelocity,
      b2Body_GetMass,
    } = this.box2d

    // 立即设置摩擦力为0，防止起跳第一帧若贴墙产生摩擦导致跳跃高度降低
    forEachPhysicsShapeId(entity.physics, (shapeId) => {
      this.box2d.b2Shape_SetFriction(shapeId, DEFAULT_WALL_SLIDE_FRICTION)
    })
    entity.movement.currentFriction = DEFAULT_WALL_SLIDE_FRICTION

    const mass = b2Body_GetMass(entity.physics.bodyId)
    const weightFactor = this.getWeightFactor(entity)
    const jumpScale = 1 / weightFactor

    entity.movement.isJumping = true
    entity.movement.jumpStartTime = this.currentTimeMs
    entity.movement.jumpElapsedTime = 0

    const isDifferentWall =
      entity.movement.isTouchingWall &&
      !entity.movement.isGrounded &&
      entity.movement.wallDirection !== entity.movement.lastWallJumpDirection

    if (isDifferentWall) {
      entity.movement.wallJumpCount = 0
    }

    const canWallJump =
      entity.movement.isTouchingWall &&
      !entity.movement.isGrounded &&
      entity.movement.wallJumpCount < entity.movement.maxWallJumps

    if (canWallJump) {
      const pushAwaySpeed =
        -entity.movement.wallDirection *
        entity.movement.moveSpeed *
        entity.movement.wallJumpPushAwayMultiplier *
        jumpScale
      const upwardSpeed =
        -entity.movement.jumpForce *
        entity.movement.wallJumpUpwardMultiplier *
        jumpScale

      this.tempVec.x = pushAwaySpeed
      this.tempVec.y = upwardSpeed
      b2Body_SetLinearVelocity(entity.physics.bodyId, this.tempVec)

      entity.movement.wallJumpTime = this.currentTimeMs
      entity.movement.wallJumpElapsedTime = 0
      entity.movement.wallJumpCount++
      entity.movement.lastWallJumpDirection = entity.movement.wallDirection
    } else if (entity.movement.isGrounded) {
      entity.movement.wallJumpCount = 0
      this.tempVec.x = 0
      this.tempVec.y = -entity.movement.jumpForce * mass * 0.6 * jumpScale
      b2Body_ApplyLinearImpulseToCenter(
        entity.physics.bodyId,
        this.tempVec,
        true
      )
    }
  }

  private getWeightFactor(entity: Entity): number {
    if (!entity.movement) return 1
    const baseWeight =
      entity.movement.baseWeight > 0
        ? entity.movement.baseWeight
        : DEFAULT_PLAYER_WEIGHT

    // 自动从装备的武器读取重量
    const carryWeight = entity.weapon?.isEquipped ? entity.weapon.weight : 0

    const effectiveWeight = baseWeight + carryWeight
    const referenceWeight =
      PLAYER_WEIGHT_REFERENCE > 0
        ? PLAYER_WEIGHT_REFERENCE
        : DEFAULT_PLAYER_WEIGHT
    const factor = effectiveWeight / referenceWeight
    return factor > 0 ? factor : 1
  }

  private isNpcBlocking(entity: Entity, direction: number): boolean {
    if (!entity.transform || !entity.faction) return false

    const myRadius = entity.render?.radius ?? DEFAULT_PLAYER_RADIUS
    const myX = entity.transform.x
    const myFactionId = entity.faction.factionId

    const nearbyEntities = this.spatialHash
      ? this.spatialHash.query(
          entity.transform.x,
          entity.transform.y,
          myRadius + 2
        )
      : this.allEntities
    const nearbyCount = this.spatialHash
      ? this.spatialHash.getQueryResultLength()
      : nearbyEntities.length

    for (let i = 0; i < nearbyCount; i++) {
      const other = nearbyEntities[i]
      if (other.id === entity.id) continue
      if (!other.transform || !other.faction) continue
      if (other.stats?.isDead) continue

      const shouldBlock =
        entity.faction.canAttack(other.faction) ||
        (!!entity.npcAI &&
          !!other.npcAI &&
          myFactionId === other.faction.factionId)
      if (!shouldBlock) continue

      const otherRadius = other.render?.radius ?? DEFAULT_PLAYER_RADIUS
      const otherX = other.transform.x

      const dx = otherX - myX
      const dy = other.transform.y - entity.transform.y
      const touchDistance = myRadius + otherRadius + 0.1
      const distanceSquared = dx * dx + dy * dy
      const touchDistanceSquared = touchDistance * touchDistance
      if (distanceSquared > touchDistanceSquared) continue

      const isInFront = (direction > 0 && dx > 0) || (direction < 0 && dx < 0)
      if (isInFront) {
        return true
      }
    }

    return false
  }

  private applyFallDamage(entity: Entity): void {
    if (!entity.movement || !entity.stats || !this.statsSystem) return
    if (entity.stats.isDead) return

    const fallVelocity = entity.movement.maxFallVelocity
    if (fallVelocity <= 0) return

    const effectiveWeight = this.getEffectiveWeight(entity)

    const kineticEnergy = 0.5 * effectiveWeight * fallVelocity * fallVelocity

    if (kineticEnergy >= FALL_DAMAGE_KINETIC_FATAL) {
      const fatalDamage = entity.stats.maxHealth
      this.statsSystem.applyWeaponHit(entity, {
        attackDamage: fatalDamage,
        postureDamage: 0,
        toughnessDamage: 0,
        impactLevel: 'small',
      })
    } else if (kineticEnergy >= FALL_DAMAGE_KINETIC_THRESHOLD) {
      const excessKinetic = kineticEnergy - FALL_DAMAGE_KINETIC_THRESHOLD
      const damage = excessKinetic / FALL_DAMAGE_KINETIC_TO_HEALTH_DIVISOR
      this.statsSystem.applyWeaponHit(entity, {
        attackDamage: damage,
        postureDamage: 0,
        toughnessDamage: 0,
        impactLevel: 'small',
      })
    }
  }

  private applyFatalFallDamageDuringFall(entity: Entity): void {
    if (!entity.movement || !entity.stats || !this.statsSystem) return
    if (entity.stats.isDead) return
    if (!entity.transform) return

    const fallHeight = entity.transform.y - entity.movement.fallStartY
    if (fallHeight <= 0) return

    const effectiveWeight = this.getEffectiveWeight(entity)
    const kineticEnergy = effectiveWeight * DEFAULT_GRAVITY * fallHeight
    if (kineticEnergy < FALL_DAMAGE_KINETIC_FATAL) return

    const fatalDamage = entity.stats.maxHealth
    this.statsSystem.applyWeaponHit(entity, {
      attackDamage: fatalDamage,
      postureDamage: 0,
      toughnessDamage: 0,
      impactLevel: 'small',
    })
  }

  private getEffectiveWeight(entity: Entity): number {
    if (!entity.movement) return DEFAULT_PLAYER_WEIGHT
    const baseWeight =
      entity.movement.baseWeight > 0
        ? entity.movement.baseWeight
        : DEFAULT_PLAYER_WEIGHT
    const carryWeight = entity.weapon?.isEquipped ? entity.weapon.weight : 0
    return baseWeight + carryWeight
  }
}
