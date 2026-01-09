import {
  DEFAULT_PLAYER_RADIUS,
  DEFAULT_PLAYER_WEIGHT,
  DEFAULT_ROLL_COOLDOWN,
  DEFAULT_ROLL_DURATION,
  DEFAULT_ROLL_SPEED,
  MASK_PLAYER,
  MASK_PLAYER_ROLLING,
  PLAYER_WEIGHT_REFERENCE,
} from '../../constants'
import type { MainModule } from '../../types'
import { componentRegistry } from '../ComponentRegistry'
import type { Entity } from '../Entity'
import type { SpatialHash } from '../SpatialHash'
import { System } from '../System'

export class MovementSystem extends System {
  private box2d: MainModule
  private allEntities: Entity[] = []
  private spatialHash: SpatialHash | null = null
  private tempVec: InstanceType<MainModule['b2Vec2']>
  private tempVec2: InstanceType<MainModule['b2Vec2']>

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

  update(entities: Entity[], _deltaTime: number): void {
    for (const entity of entities) {
      if (!entity.physics || !entity.movement || !entity.input) continue
      if (entity.stats?.isDead) {
        entity.input.moveDirection = 0
        entity.input.jumpRequested = false
        continue
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

    const now = Date.now()
    if (
      now - entity.movement.lastContactUpdate <
      entity.movement.contactUpdateIntervalMs
    ) {
      return
    }
    entity.movement.lastContactUpdate = now

    const velocity = b2Body_GetLinearVelocity(entity.physics.bodyId)
    const isFallingOrStill = velocity.y >= -0.1
    const capacity = b2Body_GetContactCapacity(entity.physics.bodyId)
    const contactData = b2Body_GetContactData(entity.physics.bodyId, capacity)

    let grounded = false
    let touchingWall = false
    let newWallDirection = 0

    for (let i = 0; i < contactData.length; i++) {
      const contact = contactData[i]
      const normal = contact.manifold.normal
      const absX = Math.abs(normal.x)
      const absY = Math.abs(normal.y)

      if (absY > 0.7 && isFallingOrStill) {
        grounded = true
      }

      if (absX > 0.7) {
        touchingWall = true
        newWallDirection = normal.x > 0 ? -1 : 1
      }

      contact.delete()
    }

    velocity.delete()

    entity.movement.isGrounded = grounded
    entity.movement.isTouchingWall = touchingWall

    if (entity.movement.isTouchingWall && !entity.movement.isGrounded) {
      entity.movement.wallDirection = newWallDirection
    } else {
      entity.movement.wallDirection = 0
    }
  }

  private handleInput(entity: Entity): void {
    if (!entity.physics || !entity.movement || !entity.input) return

    this.handleRoll(entity)

    if (entity.movement.isRolling) {
      return
    }

    this.handleMove(entity)
    this.handleJump(entity)
  }

  private handleRoll(entity: Entity): void {
    if (!entity.movement || !entity.input || !entity.physics) return

    const now = Date.now()

    if (entity.movement.isRolling) {
      const elapsed = now - entity.movement.rollStartTime
      if (elapsed >= entity.movement.rollDuration) {
        this.endRoll(entity)
      } else {
        this.updateRollPhysics(entity)
        const progress = Math.min(
          1,
          Math.max(0, elapsed / entity.movement.rollDuration)
        )
        entity.movement.rollAngle =
          progress * 2 * Math.PI * entity.movement.rollDirection
      }
      return
    }

    if (now < entity.movement.rollCooldownEndTime) return

    entity.input.inputBuffer.tryExecute(
      'roll',
      () => this.canRoll(entity),
      () => this.startRoll(entity)
    )
  }

  private canRoll(entity: Entity): boolean {
    if (!entity.movement) return false

    // 不能在攻击动作中翻滚
    const isInAttackAction =
      entity.weapon &&
      entity.weapon.isEquipped &&
      (entity.weapon.attackPhase === 'windup' ||
        entity.weapon.attackPhase === 'finalWindup' ||
        entity.weapon.attackPhase === 'swing' ||
        entity.weapon.attackPhase === 'pause' ||
        entity.weapon.attackPhase === 'recover')

    if (isInAttackAction) return false

    return entity.movement.isGrounded
  }

  private startRoll(entity: Entity): void {
    if (!entity.movement || !entity.input || !entity.physics) return

    entity.movement.isRolling = true
    entity.movement.rollStartTime = Date.now()
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

    const { b2Body_SetLinearVelocity, b2Body_GetLinearVelocity } = this.box2d

    const currentVel = b2Body_GetLinearVelocity(entity.physics.bodyId)
    const rollSpeed = DEFAULT_ROLL_SPEED
    const velX = entity.movement.rollDirection * rollSpeed

    this.tempVec.x = velX
    this.tempVec.y = currentVel.y
    b2Body_SetLinearVelocity(entity.physics.bodyId, this.tempVec)

    currentVel.delete()
  }

  private endRoll(entity: Entity): void {
    if (!entity.movement || !entity.physics) return
    entity.movement.isRolling = false
    entity.movement.rollCooldownEndTime = Date.now() + DEFAULT_ROLL_COOLDOWN

    // 恢复碰撞掩码
    const { b2Shape_GetFilter, b2Shape_SetFilter } = this.box2d
    const filter = b2Shape_GetFilter(entity.physics.shapeId)
    filter.maskBits = MASK_PLAYER
    b2Shape_SetFilter(entity.physics.shapeId, filter)
  }

  private handleMove(entity: Entity): void {
    if (!entity.physics || !entity.movement || !entity.input) return

    // 处于击退硬直状态时，不处理移动输入，保留物理惯性
    if (Date.now() < entity.movement.knockbackEndTime) return

    const { b2Body_SetLinearVelocity, b2Body_GetLinearVelocity, b2Vec2 } =
      this.box2d
    const currentVel = b2Body_GetLinearVelocity(entity.physics.bodyId)

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
        const target = this.allEntities.find(
          (e) => e.id === entity.input?.lockedTargetId
        )
        if (target && target.transform && entity.transform) {
          const dx = target.transform.x - entity.transform.x
          entity.input.lastMoveDirection = dx >= 0 ? 1 : -1
        }
      } else if (direction !== 0) {
        entity.input.lastMoveDirection = direction
      }
    }

    const wallJumpCooldown = 150
    const isInWallJumpCooldown =
      Date.now() - entity.movement.wallJumpTime < wallJumpCooldown

    if (isInWallJumpCooldown) {
      return
    }

    // 地面攻击时锁定位移，空中攻击允许移动
    if (isInAttackAction && entity.movement.isGrounded) {
      direction = 0
    }

    if (direction !== 0 && this.isEnemyBlocking(entity, direction)) {
      direction = 0
    }

    this.tempVec.x = direction * entity.movement.moveSpeed
    this.tempVec.y = currentVel.y
    b2Body_SetLinearVelocity(entity.physics.bodyId, this.tempVec)
  }

  private handleJump(entity: Entity): void {
    if (!entity.physics || !entity.movement || !entity.input) return

    // 击退硬直期间无法跳跃
    if (Date.now() < entity.movement.knockbackEndTime) return

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
    entity.input.inputBuffer.tryExecute(
      'jump',
      () => this.canJump(entity),
      () => this.doJump(entity)
    )

    if (!entity.movement.isJumping) return

    const {
      b2Body_GetLinearVelocity,
      b2Body_ApplyForceToCenter,
      b2Body_GetMass,
      b2Vec2,
    } = this.box2d
    const vel = b2Body_GetLinearVelocity(entity.physics.bodyId)
    const mass = b2Body_GetMass(entity.physics.bodyId)
    const jumpDuration = Date.now() - entity.movement.jumpStartTime
    const weightFactor = this.getWeightFactor(entity)
    const jumpScale = 1 / weightFactor

    if (
      vel.y < 0 &&
      jumpDuration < entity.movement.maxJumpDuration &&
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
      jumpDuration >= entity.movement.maxJumpDuration ||
      vel.y >= 0 ||
      !entity.input.jumpRequested
    ) {
      entity.movement.isJumping = false
    }
  }

  private canJump(entity: Entity): boolean {
    if (!entity.movement) return false

    if (entity.movement.isJumping) return false

    const canWallJump =
      entity.movement.isTouchingWall &&
      !entity.movement.isGrounded &&
      entity.movement.wallJumpCount < entity.movement.maxWallJumps

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
    entity.movement.jumpStartTime = Date.now()

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

      entity.movement.wallJumpTime = Date.now()
      entity.movement.wallJumpCount++
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
    const carryWeight = Math.max(0, entity.movement.carryWeight)
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

    const nearbyEntities = this.spatialHash
      ? this.spatialHash.query(
          entity.transform.x,
          entity.transform.y,
          myRadius + 2
        )
      : this.allEntities

    for (const other of nearbyEntities) {
      if (other.id === entity.id) continue
      if (!other.transform || !other.faction) continue
      if (other.stats?.isDead) continue

      if (!entity.faction.canAttack(other.faction)) continue

      const otherRadius = other.render?.radius ?? DEFAULT_PLAYER_RADIUS
      const otherX = other.transform.x

      const dx = otherX - myX
      const dy = other.transform.y - entity.transform.y
      const distance = Math.hypot(dx, dy)
      const touchDistance = myRadius + otherRadius + 0.1

      if (distance > touchDistance) continue

      const isInFront = (direction > 0 && dx > 0) || (direction < 0 && dx < 0)
      if (isInFront) {
        return true
      }
    }

    return false
  }
}
