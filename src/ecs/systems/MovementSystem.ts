import {
  DEFAULT_GRAVITY,
  DEFAULT_PLAYER_RADIUS,
  DEFAULT_PLAYER_WEIGHT,
  DEFAULT_ROLL_COOLDOWN,
  DEFAULT_ROLL_DURATION,
  DEFAULT_ROLL_SPEED,
  DEFAULT_SPRINT_SPEED,
  DEFAULT_WALL_SLIDE_FRICTION,
  FALL_DAMAGE_KINETIC_FATAL,
  FALL_DAMAGE_KINETIC_THRESHOLD,
  FALL_DAMAGE_KINETIC_TO_HEALTH_DIVISOR,
  LANDING_MIN_VELOCITY,
  MASK_PLAYER,
  MASK_PLAYER_ROLLING,
  PLAYER_WEIGHT_REFERENCE,
  SOUND_DB_LAND,
  SPRINT_HOLD_THRESHOLD_MS,
} from '../../constants'
import type { MainModule } from '../../types'
import { Faction } from '../Component'
import { componentRegistry } from '../ComponentRegistry'
import type { Entity } from '../Entity'
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
    const isFallingOrStill = velY >= -0.1
    vel.delete()
    const capacity = b2Body_GetContactCapacity(entity.physics.bodyId)
    const contactData = b2Body_GetContactData(entity.physics.bodyId, capacity)

    let grounded = false
    let touchingWall = false
    let newWallDirection = 0
    const groundNormalMin = 0.2

    for (let i = 0; i < contactData.length; i++) {
      const contact = contactData[i]
      const normal = contact.manifold.normal
      const absX = Math.abs(normal.x)
      const absY = Math.abs(normal.y)

      if (absY > groundNormalMin && isFallingOrStill) {
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

    if (entity.movement.isTouchingWall && !entity.movement.isGrounded) {
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

    const shouldSlide = touchingWall && !grounded
    const targetFriction = shouldSlide
      ? DEFAULT_WALL_SLIDE_FRICTION
      : entity.movement.bodyFriction
    if (entity.movement.currentFriction === targetFriction) return

    const { b2Shape_SetFriction } = this.box2d
    b2Shape_SetFriction(entity.physics.shapeId, targetFriction)
    entity.movement.currentFriction = targetFriction
  }

  private updateHitStunAnimation(entity: Entity): void {
    if (!entity.movement || !entity.stats) return
    if (entity.stats.isStaggered || entity.movement.isRolling) return

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

    this.handleSprintAndRoll(entity)

    if (entity.movement.isRolling) {
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

    entity.movement.rollCooldownElapsedTime += this.currentDeltaTime

    // 2. 检查翻滚输入 (Ctrl键 -> InputBuffer 'roll')
    const cooldownMs = entity.movement.rollCooldownElapsedTime * 1000
    if (cooldownMs >= DEFAULT_ROLL_COOLDOWN && this.canRoll(entity)) {
      entity.input.inputBuffer.tryExecute(
        'roll',
        () => true,
        () => this.startRoll(entity)
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
      if (entity.enemyAI) {
        entity.enemyAI.state = 'approach'
        entity.enemyAI.comboSwingsDone = 0
        entity.enemyAI.probeSwitchTimerMs = 0
        entity.enemyAI.probePaceTimerMs = 0
        entity.enemyAI.probePaceDirection = 1
        entity.enemyAI.probePaceMovedDistance = 0
        entity.enemyAI.probeLastPositionX = 0
        entity.enemyAI.probeLastPositionY = 0
        entity.enemyAI.probeHasTriggered = false
        if (entity.movement) {
          entity.movement.moveSpeed = entity.enemyAI.moveSpeed
        }
      }
    }

    entity.movement.isRolling = true
    entity.movement.rollStartTime = this.currentTimeMs
    entity.movement.rollElapsedTime = 0
    entity.movement.rollDuration = DEFAULT_ROLL_DURATION

    // 优先使用当前按下的移动方向，如果没有按键则使用朝向
    const direction =
      entity.input.moveDirection !== 0
        ? entity.input.moveDirection
        : entity.input.lastMoveDirection !== 0
          ? entity.input.lastMoveDirection
          : 1
    entity.movement.rollDirection = direction

    entity.movement.isJumping = false

    // 修改碰撞掩码以穿过敌人
    const { b2Shape_GetFilter, b2Shape_SetFilter } = this.box2d
    const filter = b2Shape_GetFilter(entity.physics.shapeId)
    filter.maskBits = MASK_PLAYER_ROLLING
    b2Shape_SetFilter(entity.physics.shapeId, filter)

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

    // 恢复碰撞掩码
    const { b2Shape_GetFilter, b2Shape_SetFilter } = this.box2d
    const filter = b2Shape_GetFilter(entity.physics.shapeId)
    filter.maskBits = MASK_PLAYER
    b2Shape_SetFilter(entity.physics.shapeId, filter)
  }

  private handleMove(entity: Entity): void {
    if (!entity.physics || !entity.movement || !entity.input) return

    // 硬直状态时不处理移动输入，保留物理惯性
    if (entity.isStunned()) return

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
      if (entity.input.facingOverride !== null) {
        entity.input.lastMoveDirection = entity.input.facingOverride
      } else if (entity.input.lockedTargetId !== null) {
        // 如果有锁定目标，始终面朝目标
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

    // 地面攻击时锁定位移，空中攻击允许移动
    if (isInAttackAction && entity.movement.isGrounded) {
      direction = 0
    }

    if (direction !== 0 && this.isEnemyBlocking(entity, direction)) {
      direction = 0
    }

    const moveSpeedScale =
      entity.input.moveSpeedScale > 0 ? entity.input.moveSpeedScale : 1
    const moveSpeed =
      (entity.movement.isSprinting
        ? DEFAULT_SPRINT_SPEED
        : entity.movement.moveSpeed) * moveSpeedScale

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

    if (isInAttackAction) {
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

  private isEnemyBlocking(entity: Entity, direction: number): boolean {
    if (!entity.transform || !entity.faction) return false

    const myRadius = entity.render?.radius ?? DEFAULT_PLAYER_RADIUS
    const myX = entity.transform.x
    const myFaction = entity.faction.faction

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
        (myFaction === Faction.Enemy && other.faction.faction === Faction.Enemy)
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
        knockback: 0,
      })
    } else if (kineticEnergy >= FALL_DAMAGE_KINETIC_THRESHOLD) {
      const excessKinetic = kineticEnergy - FALL_DAMAGE_KINETIC_THRESHOLD
      const damage = excessKinetic / FALL_DAMAGE_KINETIC_TO_HEALTH_DIVISOR
      this.statsSystem.applyWeaponHit(entity, {
        attackDamage: damage,
        postureDamage: 0,
        toughnessDamage: 0,
        knockback: 0,
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
      knockback: 0,
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
